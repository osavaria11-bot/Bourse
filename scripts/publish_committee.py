#!/usr/bin/env python3
"""Publish the user-authorized public committee report and PDF on the SAVY site."""
import argparse
import base64
from datetime import date
import hashlib
import json
from pathlib import Path

SECTIONS = ('summary', 'os', 'jmc', 'mcl', 'comparison', 'optimization',
            'recommendations', 'follow_up', 'outlook', 'methodology')


def valid_date(value):
    try:
        return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def digest(data):
    return base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('=')


def publish(report_path, pdf_path, site_dir):
    source = json.loads(Path(report_path).read_text(encoding='utf-8'))
    if not isinstance(source, dict) or source.get('schema_version', 1) != 1 or not valid_date(source.get('date')):
        raise ValueError('Date ou format du rapport invalide.')
    sections = source.get('sections')
    if not isinstance(sections, dict) or any(not isinstance(sections.get(k), str) or not sections[k].strip() for k in SECTIONS):
        raise ValueError('Les dix analyses complètes sont obligatoires.')
    if sum(len(sections[k]) for k in SECTIONS) > 250000:
        raise ValueError('Rapport trop volumineux.')
    day = source['date']
    report_rel = f'data/committee/{day}.json'
    pdf_rel = f'reports/committee/{day}-comite-investissement.pdf'
    report = {'schema_version': 1, 'date': day, 'sections': {k: sections[k] for k in SECTIONS}, 'pdf_url': pdf_rel}
    for key in ('data_date', 'finviz_date'):
        if source.get(key):
            if not valid_date(source[key]):
                raise ValueError(f'{key} invalide.')
            report[key] = source[key]
    pdf = Path(pdf_path).read_bytes()
    if not pdf.startswith(b'%PDF-') or len(pdf) > 20000000:
        raise ValueError('PDF invalide ou supérieur à 20 Mo.')
    raw = (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    site = Path(site_dir)
    index_path = site / 'data/committee-reports.json'
    index = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {'schema_version': 2, 'editions': []}
    if not isinstance(index, dict) or index.get('schema_version') not in (1, 2) or not isinstance(index.get('editions'), list):
        raise ValueError('Historique illisible : aucune édition remplacée.')
    editions = index['editions']
    if len(editions) > 5000 or any(not isinstance(e, dict) or not valid_date(e.get('date')) for e in editions) or len({e['date'] for e in editions}) != len(editions):
        raise ValueError('Historique invalide : aucune édition remplacée.')
    record = {'date': day, 'visibility': 'public', 'path': report_rel,
              'pdf_path': pdf_rel, 'sha256': digest(raw), 'pdf_sha256': digest(pdf)}
    editions = sorted([e for e in editions if e['date'] != day] + [record], key=lambda e: e['date'], reverse=True)
    index_raw = (json.dumps({'schema_version': 2, 'editions': editions}, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    # Validate all inputs before writing; the index is written last.
    for relative, content in ((report_rel, raw), (pdf_rel, pdf), ('data/committee-reports.json', index_raw)):
        destination = site / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + '.tmp')
        temporary.write_bytes(content)
        temporary.replace(destination)
    return {'date': day, 'report': report_rel, 'pdf': pdf_rel, 'editions': len(editions)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True)
    parser.add_argument('--pdf', required=True)
    parser.add_argument('--site-dir', default=Path(__file__).resolve().parents[1], type=Path)
    args = parser.parse_args()
    print(json.dumps(publish(args.report, args.pdf, args.site_dir), ensure_ascii=False))
