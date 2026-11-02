#!/usr/bin/env python3
"""Prepare the internal fiscal-horizon view from retained, dated public records.

This is a read-only import of the user's P/E workbook. It never manufactures
EBITDA forecasts, joins providers' histories, or modifies the source workbook.
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from forward_fiscal_calendars import normalize_instrument

ROOT = Path(__file__).resolve().parents[1]


def positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def iso(value):
    return value.date().isoformat() if isinstance(value, datetime) else None


def prepare(workbook_path):
    from openpyxl import load_workbook
    workbook = load_workbook(workbook_path, read_only=True, data_only=True)
    monthly = {}
    for row in workbook['Historique'].iter_rows(min_row=6, values_only=True):
        if len(row) < 29 or not row[1] or not iso(row[3]) or not iso(row[4]):
            continue
        date, consensus = iso(row[3]), iso(row[4])
        age = (row[3].date() - row[4].date()).days
        if not 0 <= age <= 7:
            raise ValueError('Consensus date outside permitted interval')
        entry = {'date': date, 'consensus_date': consensus}
        for horizon, ratio_column, eps_column, end_column in [(1, 18, 8, 7), (2, 19, 10, 9)]:
            value, eps, end = row[ratio_column], row[eps_column], iso(row[end_column])
            if positive(value):
                if not positive(row[5]) or not positive(eps) or not end or end < date:
                    raise ValueError('Invalid forward denominator')
                if abs(value - row[5] / eps) > 1e-6 * max(1, value):
                    raise ValueError('Cached P/E does not reconcile to historical price/EPS')
            entry['fy' + str(horizon)] = value if positive(value) else None
            entry['period_fy' + str(horizon)] = end
        monthly.setdefault(row[1], []).append(entry)
    workbook.close()
    config = json.loads((ROOT / 'data/valuation-universe.json').read_text())
    index = json.loads((ROOT / 'data/valuations/index.json').read_text())
    latest = {row['id']: row for row in index['instruments']}
    output = []
    for instrument in config['instruments']:
        identity = instrument['id']
        if identity == 'POW':
            continue  # Explicit exclusion retained from the valuation brief.
        path = ROOT / 'data/valuations' / (identity + '.json')
        archive = json.loads(path.read_text()) if path.exists() else {}
        row = {key: instrument.get(key) for key in ['id', 'title', 'symbol', 'financial', 'type']}
        row['latest'] = latest.get(identity, {}).get('latest')
        row['observations'] = archive.get('observations', [])
        entries = sorted(monthly.get(identity, []), key=lambda entry: entry['date'])
        if entries:
            row['pe_history'] = {'source': {'label': 'DoltHub · consensus datés',
                'urls': ['https://www.dolthub.com/repositories/post-no-preference/earnings',
                         'https://www.dolthub.com/repositories/post-no-preference/stocks'],
                'note': 'Relevés mensuels conservés dans le classeur SAVY du 29 octobre 2026. Aucun consensus actuel réappliqué au passé.'},
                'frequency': 'monthly', 'rows': entries}
        output.append(normalize_instrument(row))
    dashboard = {'schema_version': 1, 'kind': 'savy_forward_dashboard', 'default_id': 'NVDA',
            'prepared_at': datetime.now(timezone.utc).isoformat(), 'archive_generated_at': index['generated_at'],
            'instruments': output}
    audit_path = ROOT / 'data/forward-audit.json'
    if audit_path.exists():
        audit = json.loads(audit_path.read_text())
        dashboard['audit'] = audit
        suspended = {r['id']: r for r in audit['results'] if r['ev_status'] == 'withheld'}
        for instrument in output:
            if instrument['id'] in suspended:
                instrument['ev_quality'] = {'status': 'withheld', 'reason': 'ev_bridge_unreconciled',
                    'note': suspended[instrument['id']]['ev_note'], 'source_url': audit['mda_balance_source_url']}
    return dashboard


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/forward-valuation.json')
    args = parser.parse_args()
    data = prepare(args.workbook)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps({'stocks': len(data['instruments']),
        'pe_monthly_histories': sum(bool(row.get('pe_history')) for row in data['instruments']),
        'output': str(args.output)}))
