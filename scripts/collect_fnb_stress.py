#!/usr/bin/env python3
"""Documented CAD total-return stress inputs; preserve last valid data on failure."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json
import math
from pathlib import Path
import sys
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent))
import daily_fnb as F
from fnb_sources import Client, month_end

ROOT = Path(__file__).resolve().parents[1]
EVENTS = {
    'gfc2008': ('2007-12-31', '2008-12-31'),
    'covid2020': ('2020-02-19', '2020-03-23'),
    'rates2022': ('2021-12-31', '2022-12-30'),
}


class ValidatedHistory(dict):
    suspect_sessions = ()


def parse_history(payload, symbol, currency, instrument='ETF', quarantine=False):
    if payload.get('chart', {}).get('error'):
        raise ValueError(str(payload['chart']['error']))
    d = payload['chart']['result'][0]
    if d['meta'].get('symbol') != symbol or d['meta'].get('currency') != currency or d['meta'].get('instrumentType') != instrument:
        raise ValueError('Unexpected stress source identity: ' + symbol)
    values = d['indicators'].get('adjclose', [{}])[0].get('adjclose') if instrument == 'ETF' else d['indicators']['quote'][0]['close']
    if not values or len(values) != len(d['timestamp']):
        raise ValueError('Missing adjusted total-return prices: ' + symbol)
    out = ValidatedHistory()
    for ts, value in zip(d['timestamp'], values):
        if value is None:
            continue
        if not isinstance(value, (float, int)) or not math.isfinite(value) or value <= 0:
            raise ValueError('Invalid stress price: ' + symbol)
        day = datetime.fromtimestamp(ts, ZoneInfo(d['meta'].get('exchangeTimezoneName', 'UTC'))).date().isoformat()
        out[day] = value
    # Reject corrupt splits/price errors instead of silently clipping the shock.
    ordered = sorted(out)
    bad = [b for a,b in zip(ordered,ordered[1:]) if abs(out[b]/out[a]-1)>.5]
    if bad and not quarantine: raise ValueError('Suspicious stress source price jump: ' + symbol)
    out.suspect_sessions = tuple(bad)
    return out


def period_return(prices, start, end):
    # Exact common endpoints only: never shift a newly launched fund forward.
    if start not in prices or end not in prices or any(start < d <= end for d in getattr(prices,'suspect_sessions',())):
        return None
    return prices[end] / prices[start] - 1


def build(analysis, histories, cutoff, source_urls, errors=None):
    events = {}
    for key, (start, end) in EVENTS.items():
        assets = {}
        for ticker, prices in histories.items():
            if ticker == 'FX':
                continue
            r = period_return(prices, start, end)
            if r is not None:
                assets[ticker] = {'return': r, 'start': start, 'end': end, 'currency': 'CAD',
                                  'total_return': True, 'source_url': source_urls[ticker]}
        shocks = {}
        if 'VEQT' in assets:
            shocks['market'] = assets['VEQT']['return']
        else:
            # A current global equity mix in a past environment. US-listed
            # proxies are already converted to CAD, with no double FX overlay.
            weights = analysis['universe']['geo'].get('VEQT', [])
            proxies = ['US', 'CA', 'DEV', 'EM']
            if len(weights) >= 4 and abs(sum(weights[:4])-1) < 1e-6 and all(t in assets for t in proxies):
                shocks['market'] = sum(w * assets[t]['return'] for t, w in zip(proxies, weights))
        for name, long, short in [('value','VVL','VEQT'), ('momentum','VMO','VEQT'), ('quality','FCUQ','VFV'), ('lowvol','FCUL','VFV'), ('credit','XCB','XGB')]:
            if long in assets and short in assets:
                shocks[name] = assets[long]['return'] - assets[short]['return']
        if 'XBB' in assets:
            shocks['bond'] = assets['XBB']['return']
        fx = period_return(histories.get('FX', {}), start, end)
        if fx is not None:
            shocks['fx'] = fx
        # An incomplete set of historical strategy shocks must not be silently
        # set to zero. Use an explicitly labeled market-only beta projection.
        full = ['market','value','momentum','quality','lowvol','bond','credit','fx']
        if not all(k in shocks for k in full):
            shocks = {'market': shocks['market']} if 'market' in shocks else {}
        events[key] = {'start': start, 'end': end, 'assets': assets, 'factor_shocks': shocks,
                       'market_method': 'VEQT observé' if 'VEQT' in assets else 'Allocation géographique actuelle de VEQT, proxys SPY/XIC/EFA/EEM en CAD',
                       'source_urls': list(source_urls.values())}
    dates = analysis['universe']['dates']
    factors = {name: [] for name in ['bond', 'credit', 'fx']}
    for month in dates:
        end = F.previous_trading_day(month_end(month)).isoformat()
        start = F.previous_trading_day(date.fromisoformat(month+'-01') - timedelta(days=1)).isoformat()
        bond = period_return(histories.get('XBB', {}), start, end)
        corp = period_return(histories.get('XCB', {}), start, end)
        govt = period_return(histories.get('XGB', {}), start, end)
        factors['bond'].append(bond)
        factors['credit'].append(corp-govt if corp is not None and govt is not None else None)
        factors['fx'].append(period_return(histories.get('FX', {}), start, end))
    return {'schema_version': 1, 'as_of': cutoff, 'generated_at': datetime.now(F.TZ).isoformat(timespec='seconds'),
            'status': 'partial' if errors else 'current', 'errors': errors or {}, 'scenarios': events,
            'model_factors': {'dates': dates, 'returns': factors}, 'source_urls': source_urls,
            'indices': {}, 'reconstructions': {},
            'method': 'Actual adjusted ETF endpoint returns in CAD. USD proxies converted as (1+rUSD)*(1+rUSD/CAD)-1. Portfolio scenarios use current starting weights and buy-and-hold. No historical portfolio holdings inferred. No invented index data. XBB total return = rate proxy; XCB-XGB = imperfect credit proxy, with duration mismatch. FX = USD/CAD. All sensitivities are conditional estimates, not contractual hedge ratios.'}


def validate(d):
    if d.get('schema_version') != 1 or set(d['scenarios']) != set(EVENTS) or d.get('status') not in ['current','partial','stale']:
        raise ValueError('Invalid stress schema')
    for key, event in d['scenarios'].items():
        start, end = EVENTS[key]
        for row in event['assets'].values():
            if row['start'] != start or row['end'] != end or row['currency'] != 'CAD' or row['total_return'] is not True or not row.get('source_url') or not math.isfinite(row['return']) or row['return'] < -1:
                raise ValueError('Invalid historical stress return')
        if any(not math.isfinite(v) for v in event['factor_shocks'].values()):
            raise ValueError('Invalid factor shock')
    n = len(d['model_factors']['dates'])
    if any(len(v) != n or any(x is not None and not math.isfinite(x) for x in v) for v in d['model_factors']['returns'].values()):
        raise ValueError('Invalid model factor dates')
    return d


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT/'data/fnb-stress-history.json')
    args = parser.parse_args()
    if args.check:
        d = validate(json.loads(args.output.read_text())); print('Validated stress inputs:',d['as_of'],d['status']); return 0
    analysis = json.loads((ROOT/'data/fnb-analysis.json').read_text())
    config = json.loads((ROOT/'data/fnb-model.json').read_text())
    cutoff = F.completed_session(datetime.now(F.TZ)).isoformat()
    old = json.loads(args.output.read_text()) if args.output.exists() else None
    if old and old['as_of'] == cutoff and old['status'] == 'current' and old['model_factors']['dates'] == analysis['universe']['dates']:
        validate(old); print('Stress inputs already current:', cutoff); return 0
    tickers = {t for p in analysis['results'].values() for t in p['weights']} | {'VEQT','VFV','VVL','VMO','FCUQ','FCUL'}
    specs = {t:(config['funds'][t]['quote_symbol'],'CAD','ETF') for t in tickers}
    specs.update({'US':('SPY','USD','ETF'),'CA':('XIC.TO','CAD','ETF'),'DEV':('EFA','USD','ETF'),'EM':('EEM','USD','ETF'),
                  'XBB':('XBB.TO','CAD','ETF'),'XCB':('XCB.TO','CAD','ETF'),'XGB':('XGB.TO','CAD','ETF'),'FX':('CAD=X','CAD','CURRENCY')})
    client = Client(args.cache); histories = {}; errors = {}; urls = {}
    def collect(item):
        ticker,(symbol,currency,instrument) = item
        try:
            params = {'period1':int(datetime(2007,12,28,tzinfo=F.TZ).timestamp()),'period2':int(datetime.combine(date.fromisoformat(cutoff)+timedelta(days=1),datetime.min.time(),F.TZ).timestamp()),'interval':'1d','events':'div,splits,capitalGains'}
            url = 'https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol)+'?'+urlencode(params)
            history=parse_history(client.json(url),symbol,currency,instrument,quarantine=True)
            warning='Séances suspectes exclues des périodes qui les traversent : '+', '.join(history.suspect_sessions) if history.suspect_sessions else None
            return ticker,history,warning
        except Exception as e:
            return ticker,{},str(e)[:300]
    with ThreadPoolExecutor(max_workers=4) as executor:
        for ticker, prices, error in executor.map(collect, sorted(specs.items())):
            histories[ticker] = prices
            urls[ticker] = 'https://finance.yahoo.com/quote/'+quote(specs[ticker][0])+'/history/'
            if error: errors[ticker] = error
    fx = histories.get('FX', {})
    for ticker in ['US','DEV','EM']:
        histories[ticker] = {day:value*fx[day] for day,value in histories[ticker].items() if day in fx}
    try:
        if not any(histories.get(t) for t in tickers): raise ValueError('All stress sources unavailable')
        data = validate(build(analysis,histories,cutoff,urls,errors))
        F.write(args.output,data)
        print('Stress inputs:',cutoff,data['status'],'; actual returns:',{k:len(v['assets']) for k,v in data['scenarios'].items()},'; source errors:',errors)
        return 0
    except Exception as e:
        if old:
            old.update(status='stale',error=str(e)[:500]); F.write(args.output,old)
        print('Stress collection unavailable:',str(e),file=sys.stderr); return 1


if __name__ == '__main__':
    raise SystemExit(main())
