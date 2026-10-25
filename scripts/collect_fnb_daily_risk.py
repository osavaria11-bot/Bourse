#!/usr/bin/env python3
"""One-session historical VaR at current target weights, separate from ledgers."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import hashlib
import json
import math
from pathlib import Path
import sys
from zoneinfo import ZoneInfo
from urllib.parse import quote, urlencode

if str(Path(__file__).parent) not in sys.path:sys.path.insert(0,str(Path(__file__).parent))
import daily_fnb as F
from fnb_sources import Client, FID

ROOT=Path(__file__).resolve().parents[1]
CONFIDENCE=.95
MIN_OBSERVATIONS=252

def signature(analysis):
    value={'start':analysis['dates'][0]+'-01','weights':{key:analysis['results'][key]['weights'] for key in analysis['order']}}
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def historical_var(returns, confidence=CONFIDENCE):
    if not returns or any(not math.isfinite(v) for v in returns):raise ValueError('Incomplete daily returns')
    return sorted(-r for r in returns)[math.ceil(len(returns)*confidence)-1]

def distribution_shape(returns):
    n=len(returns)
    if n<4 or any(not math.isfinite(v) for v in returns):return {'skewness':None,'excess_kurtosis':None}
    mean=sum(returns)/n;centered=[v-mean for v in returns];m2=sum(v*v for v in centered)/n
    if m2<=1e-24:return {'skewness':None,'excess_kurtosis':None}
    m3=sum(v**3 for v in centered)/n;m4=sum(v**4 for v in centered)/n
    skew=math.sqrt(n*(n-1))/(n-2)*m3/m2**1.5
    excess=(n-1)/((n-2)*(n-3))*((n+1)*(m4/m2**2-3)+6)
    return {'skewness':skew,'excess_kurtosis':excess}

def build(analysis, prices, cutoff, generated_at, return_series=None):
    start=date.fromisoformat(analysis['dates'][0]+'-01');anchor=F.previous_trading_day(start-timedelta(days=1))
    sessions=[];day=anchor
    while day.isoformat()<=cutoff:
        if F.trading_day(day):sessions.append(day.isoformat())
        day+=timedelta(days=1)
    tickers=sorted({ticker for key in analysis['order'] for ticker in analysis['results'][key]['weights']})
    daily={t:[] for t in tickers};accepted=[];missing=[];return_series=return_series or {}
    for before,after in zip(sessions,sessions[1:]):
        if after<start.isoformat():continue
        if any(after not in return_series[t] if t in return_series else before not in prices.get(t,{}) or after not in prices.get(t,{}) for t in tickers):missing.append(after);continue
        values={t:return_series[t][after] if t in return_series else prices[t][after]['adjusted_close']/prices[t][before]['adjusted_close']-1 for t in tickers}
        if any(not math.isfinite(v) or abs(v)>.5 for v in values.values()):raise ValueError('Suspicious adjusted daily move; verify source/splits before publishing: '+after)
        for t,v in values.items():daily[t].append(v)
        accepted.append(after)
    expected=len(sessions)-1
    if len(accepted)<MIN_OBSERVATIONS or len(accepted)<expected*.98:raise ValueError(f'Insufficient common daily coverage: {len(accepted)}/{expected}')
    if not accepted or accepted[-1]!=cutoff:raise ValueError('Latest completed session missing from daily VaR sample')
    results={}
    for key in analysis['order']:
        weights=analysis['results'][key]['weights']
        if any(not math.isfinite(w) or w<0 for w in weights.values()) or abs(sum(weights.values())-1)>1e-8:raise ValueError('Invalid target weights: '+key)
        values=[sum(w*daily[t][i] for t,w in weights.items()) for i in range(len(accepted))]
        results[key]={'weights':weights,'var95':historical_var(values),**distribution_shape(values)}
    return {'schema_version':2,'confidence':CONFIDENCE,'horizon_sessions':1,'method':'historical_current_target_weights_v1',
        'generated_at':generated_at,'as_of':cutoff,'sample_start':accepted[0],'sample_end':accepted[-1],
        'daily_series':{'currency':'CAD','total_return':True,'dates':accepted,'session_indices':[sessions.index(d) for d in accepted],'returns':daily},
        'observations':len(accepted),'expected_observations':expected,'missing_sessions':missing,
        'weights_signature':signature(analysis),'shape_estimators':'bias_corrected_fisher','status':'current','error':None,'results':results,
        'source':'CAD, rendement total. FEQT : rendements quotidiens officiels Fidelity sur valeur liquidative, utilisés sur toute la fenêtre. Autres FNB : clôtures boursières ajustées Yahoo Finance. Distributions et fractionnements ajustés.',
        'return_basis':{t:('issuer_nav_total_return' if t in return_series else 'adjusted_market_close_total_return') for t in tickers},
        'source_urls':sorted({p['source_url'] for t,rows in prices.items() if t not in return_series for p in rows.values()} | ({'https://www.fidelity.ca/en/products/etfs/feqt/'} if 'FEQT' in return_series else set())),
        'method_note':'Simulation historique à poids cibles actuels constants : somme des poids × rendements réels de chaque séance. Échantillon commun à tous les portefeuilles et benchmarks. FEQT utilise les rendements totaux quotidiens de valeur liquidative de son émetteur sur toute la fenêtre, sans raccorder des prix de fournisseurs différents. Les autres fonds utilisent deux clôtures ajustées consécutives d’une même source. Les séances manquantes sont exclues; aucun rendement sur plusieurs séances ne devient une observation à un jour. Distinct du backtest mensuel rééquilibré en janvier et du suivi réel depuis lancement.'}

def validate(data):
    if data.get('schema_version') not in (1,2) or data.get('horizon_sessions')!=1 or data.get('confidence')!=CONFIDENCE or data.get('method')!='historical_current_target_weights_v1':raise ValueError('Invalid daily VaR schema')
    if data['observations']<MIN_OBSERVATIONS or not data['sample_start']<=data['sample_end']==data['as_of']:raise ValueError('Invalid daily VaR sample')
    if data.get('status') not in ['current','stale']:raise ValueError('Invalid daily VaR source status')
    for key,row in data['results'].items():
        if not math.isfinite(row['var95']) or not -1<=row['var95']<=1 or abs(sum(row['weights'].values())-1)>1e-8:raise ValueError('Invalid daily VaR result: '+key)
        for metric in ['skewness','excess_kurtosis']:
            if metric not in row or row[metric] is not None and not math.isfinite(row[metric]):raise ValueError('Invalid daily distribution shape: '+key)
    if data.get('schema_version')==2:
        series=data['daily_series'];n=data['observations']
        if series.get('currency')!='CAD' or series.get('total_return') is not True or len(series['dates'])!=n or len(set(series['dates']))!=n or sorted(series['dates'])!=series['dates']:raise ValueError('Invalid joint daily dates/currency')
        if len(series['session_indices'])!=n or any(b<=a for a,b in zip(series['session_indices'],series['session_indices'][1:])):raise ValueError('Invalid session indices')
        for ticker,values in series['returns'].items():
            if len(values)!=n or any(not math.isfinite(v) or abs(v)>.5 for v in values):raise ValueError('Invalid joint return series: '+ticker)
        for row in data['results'].values():
            if any(t not in series['returns'] for t in row['weights']):raise ValueError('Missing position returns')
            recomputed=[sum(w*series['returns'][t][i] for t,w in row['weights'].items()) for i in range(n)]
            if abs(historical_var(recomputed)-row['var95'])>1e-10:raise ValueError('Daily VaR inconsistent with retained returns')
    return data

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'data/fnb-daily-risk.json');parser.add_argument('--check',action='store_true');parser.add_argument('--cache',type=Path)
    args=parser.parse_args(argv)
    if args.check:
        data=validate(json.loads(args.output.read_text()));print('Validated actual one-session VaR:',data['observations'],'sessions,',len(data['results']),'series');return 0
    analysis=json.loads((ROOT/'data/fnb-analysis.json').read_text());cutoff=F.completed_session(datetime.now(ZoneInfo('America/Toronto'))).isoformat()
    old=json.loads(args.output.read_text()) if args.output.exists() else None
    if old and old.get('schema_version')==2 and old.get('as_of')==cutoff and old.get('weights_signature')==signature(analysis) and old.get('shape_estimators')=='bias_corrected_fisher' and old.get('status')=='current':validate(old);print('Daily VaR already current:',cutoff);return 0
    try:
        config=json.loads((ROOT/'data/fnb-model.json').read_text());tickers={t for key in analysis['order'] for t in analysis['results'][key]['weights']}
        first=F.previous_trading_day(date.fromisoformat(analysis['dates'][0]+'-01')-timedelta(days=1)).isoformat()
        print('Collecting',len(tickers),'CAD ETF histories:',first,'through',cutoff,flush=True)
        client=Client(args.cache)
        def collect_one(ticker):
            symbol=config['funds'][ticker]['quote_symbol']
            params={'period1':int(datetime.combine(date.fromisoformat(first),datetime.min.time(),F.TZ).timestamp()),
                    'period2':int(datetime.combine(date.fromisoformat(cutoff)+timedelta(days=1),datetime.min.time(),F.TZ).timestamp()),
                    'interval':'1d','events':'div,splits,capitalGains'}
            payload=client.json('https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol)+'?'+urlencode(params))
            return ticker,F.parse_prices(payload,symbol,first,cutoff)
        with ThreadPoolExecutor(max_workers=4) as executor:prices=dict(executor.map(collect_one,sorted(tickers)))
        # The quote feed has a documented gap in FEQT in spring 2024. Use
        # its issuer's complete daily total-return series for the whole fund
        # sample, rather than manufacturing closing prices or a splice.
        fund=client.json(FID+'fund/EN/FEQT')
        if fund.get('axisCode')!='FEQT' or fund['series']['L']['currency']!='CAD':raise ValueError('FEQT issuer identity mismatch')
        official=client.json(FID+'dailyPerformance/en/feqt?series=L');factors=official['dailyPerformanceBySeries']['L']
        end=date.fromisoformat(official['asOfDate']);first_official=end-timedelta(days=len(factors)-1)
        feqt={}
        for i,value in enumerate(factors):
            if value is None:continue
            if not isinstance(value,(int,float)) or not math.isfinite(value) or not .5<value<1.5:raise ValueError('Invalid official FEQT one-session factor')
            feqt[(first_official+timedelta(days=i)).isoformat()]=value-1
        data=build(analysis,prices,cutoff,datetime.now(ZoneInfo('America/Toronto')).isoformat(timespec='seconds'),{'FEQT':feqt})
        validate(data);F.write(args.output,data);print('Daily VaR:',data['observations'],'common sessions;',len(data['results']),'series',flush=True);return 0
    except Exception as error:
        if old:
            old.update(status='stale',error=str(error)[:500]);F.write(args.output,old)
        print('Daily VaR collection unavailable:',str(error)[:1000],file=sys.stderr);return 1

if __name__=='__main__':raise SystemExit(main())
