#!/usr/bin/env python3
"""Refresh current fiscal multiples, reusing SAVY's dated closes.

No publication, trading, workbook rebuild, historical vendor splice or
backdating. A source refusal stops further requests to that source. Last
valid inputs survive individual failures. Only standard-library dependencies.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

from collect_valuations import fetch, table_snapshot, write
from forward_fiscal_calendars import normalize_snapshot

ROOT = Path(__file__).resolve().parents[1]
TZ = ZoneInfo('America/Toronto')
DATA = ROOT / 'data/forward-valuation.json'
URL = re.compile(r'https://www\.marketscreener\.com/quote/stock/[A-Z0-9_-]+-\d+/valuation/')


class SourceRefusal(ValueError):
    pass


def positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def read_baseline(path):
    text = path.read_text()
    marker = 'window.SAVY_FORWARD_DATA='
    start = text.index(marker) + len(marker)
    result = json.loads(text[start:text.index(';</script>', start)])
    if result.get('kind') != 'savy_forward_dashboard' or result.get('schema_version') != 1:
        raise ValueError('Aperçu interne incompatible')
    return result


def source_snapshot(identity, config, previous, now, fetcher, clock):
    url = previous.get('source_url', '')
    if not URL.fullmatch(url):
        raise ValueError('URL de consensus absente ou non vérifiée')
    body = fetcher(url)
    if 'valuationEnterpriseTable' not in body and re.search(r'verify (?:that )?you are human|checking your browser|<title>Just a moment|automated traffic|unusual traffic', body[:20000], re.I):
        raise SourceRefusal('Source suspendue : vérification humaine ou refus automatisé')
    now = clock()
    snapshot = table_snapshot(body, config, url, now)
    today = now.astimezone(TZ).date().isoformat()
    snapshot.update(consensus_date=today, consensus_observed_at=now.isoformat(),
                    consensus_date_basis='table_observation_date', consensus_fetch_status='fresh')
    return normalize_snapshot(identity, snapshot)


def revalue(snapshot, close, config, now):
    """Use a dated close in exactly the forecast currency and listing.

    No approximate FX, CDR substitution, split backfill or future consensus
    assigned to the previous closing date. Large changes need reconciliation.
    """
    s = deepcopy(snapshot)
    today = now.astimezone(TZ).date()
    if not positive(close.get('value')) or not close.get('date'):
        raise ValueError('Clôture datée absente')
    price_day = date.fromisoformat(close['date'])
    if s.get('price_date') and close['date'] < s['price_date']:
        raise ValueError('Archive de prix antérieure au dernier cours valide')
    consensus_day = date.fromisoformat(s.get('consensus_date', s['date']))
    if not 0 <= (today - price_day).days <= 7:
        raise ValueError('Clôture future ou de plus de sept jours')
    if not 0 <= (today - consensus_day).days <= 7:
        raise ValueError('Prévisions futures ou de plus de sept jours')
    expected = config.get('valuation_symbol', config['symbol'])
    if close.get('quote_symbol') != expected or close.get('currency') != s['currency']:
        raise ValueError('Devise ou cotation du cours incompatible avec le consensus')
    ratio = close['value'] / s['price']
    if not .65 <= ratio <= 1.35:
        raise ValueError('Variation importante ou fractionnement à rapprocher')
    cap = s['market_cap_millions']
    raw_ev = s.get('source_enterprise_value_millions', s.get('enterprise_value_millions'))
    bridge = s.get('ev_bridge_millions', raw_ev - cap if raw_ev is not None else None)
    s.setdefault('source_table_price', s['price'])
    s.setdefault('source_table_market_cap_millions', cap)
    s.update(date=today.isoformat(), observed_at=now.isoformat(), price=float(close['value']),
             market_cap_millions=cap * ratio, ev_bridge_millions=bridge,
             enterprise_value_millions=cap * ratio + bridge if bridge is not None else None,
             price_date=close['date'], price_date_status='verified_from_savy_close',
             price_symbol=expected, price_source_url=close['source_url'],
             definition='annual_consensus_fiscal_fy1_fy2', complete_session=False)
    # These are observations at collection time, not invented closing sessions.
    if not any(f['period_end'] >= s['date'] for f in s['forecasts']):
        raise ValueError('Aucun exercice futur disponible')
    return s


def refresh(dashboard, prices, configs, now, only=None, fetcher=fetch, workers=4, clock=None, budget_seconds=180):
    output = deepcopy(dashboard)
    clock = clock or (lambda: now)
    today = now.astimezone(TZ).date().isoformat()
    generated = datetime.fromisoformat(prices['generated_at'].replace('Z', '+00:00'))
    if generated > now or prices.get('kind') != 'security_prices':
        raise ValueError('Archive de cours invalide ou future')
    closes = {p['id']: p for p in prices['series']}
    definitions = {p['id']: p for p in configs['instruments']}
    seeds = {r['id']: r['snapshot'] for r in dashboard.get('audit', {}).get('results', [])}
    selected = [s for s in output['instruments'] if only is None or s['id'] in only]
    if only and only - {s['id'] for s in selected}:
        raise ValueError('Action hors de l’univers interne')
    stop = threading.Event()
    if dashboard.get('refresh', {}).get('source_refused') and dashboard['refresh'].get('as_of') == today:
        stop.set()
    deadline = time.monotonic() + budget_seconds

    def one(stock):
        identity = stock['id']
        prior = stock.get('current_snapshot') or seeds.get(identity) or stock.get('latest')
        close, config = closes.get(identity), definitions.get(identity)
        annual = stock.get('annual_valuation')
        annual_status = 'not_applicable' if stock.get('financial') else 'reused' if annual else 'unavailable'
        annual_error = None
        try:
            if not prior or not config:
                raise ValueError('Consensus ou définition manquant')
            consensus = prior.get('consensus_date', prior['date'])
            annual_ready = stock.get('financial') or (annual and annual.get('date') == today)
            weekend_reuse = now.astimezone(TZ).weekday() >= 5 and close and close['date'] == prior.get('price_date') and (annual or stock.get('financial'))
            reused = (consensus == today and annual_ready) or weekend_reuse
            inputs = prior
            if reused:
                status, error = 'reused', None
            else:
                if stop.is_set():
                    raise ValueError('Source suspendue après un refus d’accès')
                if time.monotonic() >= deadline:
                    raise ValueError('Budget de collecte de trois minutes atteint')
                try:
                    inputs = source_snapshot(identity, config, prior, now, fetcher, clock)
                    # Annual ratios and growth use a single provider table; they
                    # do not need a compatible Yahoo/native-listing close.
                    rows = inputs.pop('annual_financials', [])
                    if not stock.get('financial'):
                        if rows:
                            stock['annual_valuation'] = {'date': inputs['date'], 'observed_at': inputs['observed_at'],
                                'source_url': inputs['source_url'], 'currency': inputs['currency'], 'rows': rows}
                            annual_status = 'collected'
                        else:
                            annual_error = 'Tableau annuel absent de la source'
                            annual_status = 'retained' if annual else 'unavailable'
                    status, error = 'collected', None
                except SourceRefusal:
                    stop.set()
                    raise
                except HTTPError as exc:
                    if exc.code in [401, 403, 429]:
                        stop.set()
                    raise
            if not close:
                raise ValueError('Clôture datée absente ; tableau annuel indépendant du cours SAVY')
            candidate = revalue(inputs, close, config, clock())
            # Preserve the observation timestamp if none of the inputs changed.
            if reused and candidate['price_date'] == prior.get('price_date') and candidate['price'] == prior['price']:
                candidate = deepcopy(prior)
        except Exception as exc:
            error = str(exc)[:250]
            if annual_status != 'collected' and not stock.get('financial'):
                annual_status = 'retained' if annual else 'unavailable'
                annual_error = error
            # A dated retained consensus may still support today's close, but is
            # explicitly cached. An invalid price or old consensus never does.
            try:
                if not prior or not close or not config:
                    raise ValueError('No fallback')
                candidate = revalue(prior, close, config, clock())
                status = 'cached'
            except Exception:
                candidate = deepcopy(stock.get('current_snapshot'))
                status = 'retained' if candidate else 'unavailable'
        if candidate:
            if stock.get('financial') or stock.get('ev_quality', {}).get('status') == 'withheld':
                if candidate.get('enterprise_value_millions') is not None:
                    candidate['source_enterprise_value_millions'] = candidate['enterprise_value_millions']
                candidate['enterprise_value_millions'] = None
            stock['current_snapshot'] = candidate
            # Separate morning observations never enter the old closing archive
            # or the Dolt monthly quartiles. First observation of a day is immutable.
            history = stock.setdefault('refresh_history', [])
            if not any(s['date'] == candidate['date'] for s in history):
                history.append(deepcopy(candidate))
                history.sort(key=lambda s: s['date'])
        stock['current_status'] = {'status': status, 'checked_at': clock().isoformat(), 'error': error}
        stock['annual_status'] = {'status': annual_status, 'checked_at': clock().isoformat(), 'error': annual_error}
        return {'id': identity, **stock['current_status']}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(one, selected))
    counts = {key: sum(r['status'] == key for r in results) for key in ['collected', 'reused', 'cached', 'retained', 'unavailable']}
    eligible = [s for s in output['instruments'] if not s.get('financial')]
    annual_coverage = {'eligible': len(eligible), 'available': sum(any(positive(row.get('ev_ebitda')) for row in s.get('annual_valuation', {}).get('rows', [])) for s in eligible)}
    output['refresh'] = {'schema_version': 1, 'kind': 'savy_forward_refresh',
        'checked_at': clock().isoformat(), 'as_of': clock().astimezone(TZ).date().isoformat(), 'runner': 'morning_briefing',
        'prices_generated_at': prices['generated_at'], 'price_dates': sorted({closes[r['id']]['date'] for r in results if r['id'] in closes}),
        'scope': [r['id'] for r in results], 'counts': counts, 'results': results, 'annual_coverage': annual_coverage,
        'source_refused': stop.is_set(), 'historical_quartiles_refreshed': False,
        'note': 'Les multiples récents restent distincts des historiques DoltHub. Les dates du cours et des prévisions sont conservées. Les observations matinales ne sont pas des clôtures rétrospectives.'}
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-html', type=Path)
    parser.add_argument('--prices', type=Path, default=ROOT / 'data/security-prices.json')
    parser.add_argument('--only', help='Identifiants séparés par des virgules ; défaut : univers public interne complet')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--data-only', action='store_true', help='Actualiser uniquement le JSON du site ; aucun export HTML')
    args = parser.parse_args()
    if not args.data_only and not args.output:
        parser.error('--output ou --data-only est requis')
    dashboard = read_baseline(args.baseline_html) if args.baseline_html else json.loads(DATA.read_text())
    result = refresh(dashboard, json.loads(args.prices.read_text()),
        json.loads((ROOT / 'data/valuation-universe.json').read_text()), datetime.now(timezone.utc),
        set(args.only.split(',')) if args.only else None, clock=lambda: datetime.now(timezone.utc))
    # Validate the staged data with the same validator as the UI before replacing
    # the working dataset or producing a deliverable.
    import subprocess
    staged = DATA.with_suffix('.refresh-check.json')
    write(staged, result)
    try:
        subprocess.run(['node', '-e', "require('./js/forward-valuation-utils.js').validate(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')))", str(staged)], cwd=ROOT, check=True, capture_output=True, text=True)
        staged.replace(DATA)
    finally:
        staged.unlink(missing_ok=True)
    if not args.data_only:
        from export_forward_preview import export
        export(args.output.resolve())
    print(json.dumps({'as_of': result['refresh']['as_of'], 'counts': result['refresh']['counts'],
        'source_refused': result['refresh']['source_refused'], 'quartiles_refreshed': False}))
    return 0 if result['refresh']['counts']['collected'] + result['refresh']['counts']['reused'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
