#!/usr/bin/env python3
"""Reproduce the bounded five-name audit from retained public source records.

No network requests, archive backfills, workbook edits, or publication.
Use --source-dir once to retain the five source snapshots; subsequent runs
reuse the audit's exact source snapshots and dated price evidence.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path

from forward_fiscal_calendars import CALENDARS, normalize_instrument, normalize_snapshot

ROOT = Path(__file__).resolve().parents[1]
SCOPE = ['NVDA', 'MDA', 'MU', 'AAPL', 'RY']
AS_OF = '2026-11-02'
AUDIT_PATH = ROOT / 'data/forward-audit.json'


def revision(current, previous):
    return 100 * (current / previous - 1) if current is not None and previous and previous > 0 else None


def audit_result(instrument, source_snapshot, price_check):
    identity = instrument['id']
    snapshot = normalize_snapshot(identity, source_snapshot)
    if snapshot['date'] != AS_OF or price_check['date'] != '2026-10-30':
        raise ValueError('Unexpected audit observation or price date')
    if snapshot['currency'] != price_check['currency'] or abs(snapshot['price'] - price_check['value']) > .005:
        raise ValueError('Provider price does not reconcile to the retained closing price')
    snapshot.update(price_date=price_check['date'], price_date_status='matched_to_archived_close',
                    complete_session=False, consensus_date_basis='table_observation_date')
    # A Nov 2 observation is never backdated to the Oct 30 closing session.
    bridge = snapshot.get('enterprise_value_millions')
    previous = normalize_snapshot(identity, instrument['latest'])
    previous_by_year = {int(f['period_end'][:4]): f for f in previous['forecasts']}
    old_future = sorted((f for f in previous['forecasts'] if f['period_end'] >= previous['date']), key=lambda f: f['period_end'])
    future = sorted((f for f in snapshot['forecasts'] if f['period_end'] >= AS_OF), key=lambda f: f['period_end'])
    if len(future) < 2:
        raise ValueError('Two future fiscal forecasts are required')
    if identity == 'RY':
        status = 'not_applicable'
        note = 'EV/EBITDA non pertinent pour une banque.'
    elif identity == 'MDA':
        status = 'withheld'
        note = 'EV suspendue : le pont de dette nette annuel du fournisseur doit être rapproché du bilan plus récent. MDA annonce une trésorerie nette de 153 M$ au T2 2026, selon sa propre définition.'
    else:
        status = 'indicative'
        note = 'EV indicative : capitalisation du fournisseur et pont de dette nette annuel. Le rapprochement avec le dernier bilan trimestriel reste à faire.'
    if status != 'indicative':
        snapshot['source_enterprise_value_millions'] = bridge
        snapshot['enterprise_value_millions'] = None
    periods = []
    for horizon, forecast in enumerate(future[:2], 1):
        old = previous_by_year.get(int(forecast['period_end'][:4]), {})
        eps, ebitda = forecast['eps'], forecast['ebitda_millions']
        periods.append({'horizon': horizon, 'fiscal_year': int(forecast['period_end'][:4]),
            'period_end': forecast['period_end'], 'eps': eps, 'ebitda_millions': ebitda,
            'eps_analysts': forecast.get('eps_analysts'), 'ebitda_analysts': forecast.get('ebitda_analysts'),
            'pe': snapshot['price'] / eps if eps and eps > 0 else None,
            'ev_ebitda': bridge / ebitda if status == 'indicative' and bridge and bridge > 0 and ebitda and ebitda > 0 else None,
            'previous_eps': old.get('eps'), 'eps_revision_pct': revision(eps, old.get('eps')),
            'previous_ebitda_millions': old.get('ebitda_millions'),
            'ebitda_revision_pct': revision(ebitda, old.get('ebitda_millions'))})
    return {'id': identity, 'title': instrument['title'], 'source_snapshot': deepcopy(source_snapshot),
        'snapshot': snapshot, 'price_check': deepcopy(price_check), 'calendar': CALENDARS[identity],
        'previous_observation_date': previous['date'], 'previous_fy1_end': old_future[0]['period_end'],
        'fiscal_rollover': old_future[0]['period_end'] != future[0]['period_end'],
        'periods': periods, 'ev_status': status, 'ev_note': note,
        'ev_source_bridge_millions': bridge - source_snapshot['market_cap_millions'] if bridge is not None else None,
        'accounting_basis': 'Définition BPA/EBITDA du fournisseur ; correspondance avec les mesures ajustées de la société non certifiée.'}


def run(source_dir=None):
    dashboard_path = ROOT / 'data/forward-valuation.json'
    dashboard = json.loads(dashboard_path.read_text())
    instruments = {i['id']: i for i in dashboard['instruments']}
    if source_dir:
        prices = json.loads((ROOT / 'data/security-prices.json').read_text())
        closes = {p['id']: p for p in prices['series']}
        inputs = []
        for identity in SCOPE:
            close = closes[identity]
            inputs.append((identity, json.loads((source_dir / (identity + '-source.json')).read_text()),
                {key: close[key] for key in ['date', 'currency', 'value', 'source_url', 'quote_symbol']} |
                {'archive_generated_at': prices['generated_at']}))
    else:
        retained = json.loads(AUDIT_PATH.read_text())
        inputs = [(r['id'], r['source_snapshot'], r['price_check']) for r in retained['results']]
    results = [audit_result(instruments[identity], source, close) for identity, source, close in inputs]
    audit = {'schema_version': 1, 'kind': 'savy_forward_five_stock_audit', 'as_of': AS_OF, 'scope': SCOPE,
        'price_date': '2026-10-30', 'results': results,
        'method': 'Prévisions relevées le 2 novembre, cours rapprochés de la clôture archivée du 30 octobre. Les dates de chaque révision d’analyste ne sont pas fournies. Aucune observation rétrospective ajoutée aux quartiles.',
        'history_review': [
            {'source': 'DoltHub · post-no-preference/earnings', 'status': 'no_ebitda_estimate_table',
             'url': 'https://www.dolthub.com/discover?tab=discover',
             'finding': 'Tables de prévisions BPA et ventes repérées ; aucune table de consensus EBITDA FY1/FY2 repérée. Les résultats réalisés ne remplacent pas des prévisions.'},
            {'source': 'Historique générique MarketScreener conservé', 'status': 'horizon_and_pit_unverified',
             'url': 'https://www.marketscreener.com/quote/stock/NVIDIA-CORPORATION-57355629/valuation/',
             'finding': 'Horizon et disponibilité historique des estimations non certifiés : série exclue des quartiles forward.'},
            {'source': 'Bloomberg · données point-in-time', 'status': 'licensed_source_required',
             'url': 'https://professional.bloomberg.com/products/data/enterprise-catalog/cofi/',
             'finding': 'Le catalogue décrit une offre Enterprise Data via Data License ; aucune autorisation ou connexion correspondante disponible pour cette vérification.'}],
        'ev_history_status': 'unavailable',
        'mda_balance_source_url': 'https://mda-en.investorroom.com/financial-documents'}
    dashboard['instruments'] = [normalize_instrument(i) for i in dashboard['instruments']]
    for instrument in dashboard['instruments']:
        if instrument['id'] == 'MDA':
            instrument['ev_quality'] = {'status': 'withheld', 'reason': 'ev_bridge_unreconciled',
                'note': next(r['ev_note'] for r in results if r['id'] == 'MDA'),
                'source_url': audit['mda_balance_source_url']}
    dashboard['audit'] = audit
    for path, data in [(AUDIT_PATH, audit), (dashboard_path, dashboard)]:
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps({'scope': SCOPE, 'pe_values': sum(p['pe'] is not None for r in results for p in r['periods']),
        'indicative_ev_values': sum(p['ev_ebitda'] is not None for r in results for p in r['periods']),
        'withheld_ev': [r['id'] for r in results if r['ev_status'] == 'withheld'], 'ev_history': audit['ev_history_status']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path)
    run(parser.parse_args().source_dir)
