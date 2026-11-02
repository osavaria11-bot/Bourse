#!/usr/bin/env python3
"""Export the internal tab as one offline, self-contained HTML preview."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def refresh_bundle():
    """Keep the private runner with the preview, independent of this checkout.

    Explicit public-source allowlist: no repository metadata, secrets, personal
    holdings, workbook or other workspace files. Dataset comes from the latest
    preview when the next morning's run starts.
    """
    paths = ['scripts/refresh_forward_internal.py', 'scripts/export_forward_preview.py',
             'scripts/forward_fiscal_calendars.py', 'scripts/collect_valuations.py',
             'data/valuation-universe.json', 'js/valuation-utils.js',
             'js/forward-valuation-utils.js', 'js/forward-valuation.js',
             'css/forward-valuation.css', 'css/fonts/source-sans-3-latin-variable.woff2',
             'docs/forward-refresh.md', 'tests/test_forward_refresh.py']
    buffer = io.BytesIO()
    manifest = {'schema_version': 1, 'kind': 'savy_private_refresh_runner', 'files': {}}
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in paths:
            content = (ROOT / name).read_bytes()
            archive.writestr(name, content)
            manifest['files'][name] = hashlib.sha256(content).hexdigest()
        archive.writestr('refresh-manifest.json', json.dumps(manifest, ensure_ascii=False))
    return base64.b64encode(buffer.getvalue()).decode()


def export(destination):
    dataset = json.loads((ROOT / 'data/forward-valuation.json').read_text())
    data = json.dumps(dataset, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    font_path = ROOT / 'css/fonts/source-sans-3-latin-variable.woff2'
    font = '@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:200 900;font-display:swap;src:url(data:font/woff2;base64,' + base64.b64encode(font_path.read_bytes()).decode() + ') format("woff2")}' if font_path.exists() else ''
    base = '''*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:#0b1420;color:#e9f0f6;font:14px/1.5 "Source Sans 3",system-ui,sans-serif;--text:#e9f0f6;--muted:#9baec0;--border:#29394a;--surface:#132131;--raised:#1b2b3e}button,input,select{font:inherit}button{font-family:inherit}a{color:#6edbd9}header.preview-header{display:flex;justify-content:space-between;gap:20px;align-items:center;max-width:1440px;margin:0 auto 28px;padding:22px 0 18px;border-bottom:1px solid #29394a}.preview-brand{font-size:25px;letter-spacing:.1em;font-weight:700}.preview-brand span{font-size:10px;letter-spacing:.16em;font-weight:500;color:#9baec0;margin-left:17px}.preview-edition{font-size:11px;color:#9baec0}body{padding:0 38px 32px}main{max-width:1440px;margin:auto}footer{max-width:1440px;margin:24px auto 0;color:#768b9e;font-size:10px;border-top:1px solid #213243;padding-top:13px}@media(max-width:540px){body{padding:0 14px 24px}header.preview-header{margin-bottom:20px;padding:16px 0 14px}.preview-brand{font-size:21px}.preview-brand span{display:block;margin:1px 0 0;font-size:8px}.preview-edition{font-size:10px;text-align:right;max-width:150px}}'''
    css = (ROOT / 'css/forward-valuation.css').read_text()
    scripts = '\n'.join((ROOT / path).read_text() for path in ['js/valuation-utils.js', 'js/forward-valuation-utils.js', 'js/forward-valuation.js'])
    html = '''<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="SAVY : aperçu interne des multiples forward FY1 et FY2, avec moyenne et quartiles historiques."><title>SAVY — Valorisation forward · Interne</title><style>''' + font + base + css + '''</style></head><body><header class="preview-header"><div class="preview-brand">SAVY<span>RECHERCHE / VALORISATION</span></div><div class="preview-edition">Vérification · 5 titres<br>2 novembre 2026</div></header><main><div id="panel-recherche-forward"><p>Chargement des multiples forward…</p></div></main><footer>Aperçu interne. Les dates et la couverture sont indiquées pour chaque série.</footer><noscript>Activer JavaScript pour utiliser le sélecteur d’action et les graphiques.</noscript><script>window.SAVY_FORWARD_DATA=''' + data + ''';</script><script>''' + scripts + '''</script></body></html>'''
    if dataset.get('refresh'):
        html = html.replace('Vérification · 5 titres<br>2 novembre 2026', 'Refresh interne<br>' + dataset['refresh']['as_of'], 1)
    bundle = '<script type="application/octet-stream" id="savy-forward-refresh-bundle">' + refresh_bundle() + '</script>'
    html = html.replace('<script>window.SAVY_FORWARD_DATA=', bundle + '<script>window.SAVY_FORWARD_DATA=', 1)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html)
    print(json.dumps({'path': str(destination), 'size_bytes': destination.stat().st_size}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    export(parser.parse_args().output.resolve())
