import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publish_committee', Path(__file__).resolve().parents[1] / 'scripts/publish_committee.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublicCommitteeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.report = self.root / 'source.json'
        self.pdf = self.root / 'source.pdf'
        self.pdf.write_bytes(b'%PDF-1.7\nSynthetic committee fixture')
        self.source = {'schema_version': 1, 'date': '2026-11-05', 'data_date': '2026-11-04',
                       'sections': {key: 'Analyse complète ' + key for key in publisher.SECTIONS},
                       'pdf_url': 'https://chatgpt.com/library?file_id=old'}
        self.site = self.root / 'site'

    def run_publish(self):
        self.report.write_text(json.dumps(self.source), encoding='utf-8')
        return publisher.publish(self.report, self.pdf, self.site)

    def test_publication_is_readable_without_keys_and_preserves_other_editions(self):
        self.run_publish()
        previous = (self.site / 'data/committee/2026-11-05.json').read_bytes()
        report = json.loads(previous)
        self.assertEqual(report['sections'], self.source['sections'])
        self.assertEqual(report['pdf_url'], 'reports/committee/2026-11-05-comite-investissement.pdf')
        self.assertEqual((self.site / report['pdf_url']).read_bytes(), self.pdf.read_bytes())
        self.source['date'] = '2026-11-12'
        self.run_publish()
        index = json.loads((self.site / 'data/committee-reports.json').read_text())
        self.assertEqual([e['date'] for e in index['editions']], ['2026-11-12', '2026-11-05'])
        self.assertEqual((self.site / 'data/committee/2026-11-05.json').read_bytes(), previous)
        for entry in index['editions']:
            self.assertEqual(entry['visibility'], 'public')
            self.assertEqual(entry['sha256'], publisher.digest((self.site / entry['path']).read_bytes()))
            self.assertEqual(entry['pdf_sha256'], publisher.digest((self.site / entry['pdf_path']).read_bytes()))
        self.run_publish()
        self.assertEqual(len(json.loads((self.site / 'data/committee-reports.json').read_text())['editions']), 2)

    def test_invalid_inputs_leave_published_history_unchanged(self):
        self.run_publish()
        before = {p.relative_to(self.site): p.read_bytes() for p in self.site.rglob('*') if p.is_file()}
        for change in ('missing', 'date', 'pdf'):
            with self.subTest(change=change):
                original = json.loads(json.dumps(self.source))
                if change == 'missing':
                    del self.source['sections']['os']
                elif change == 'date':
                    self.source['date'] = '2026-02-30'
                else:
                    self.pdf.write_bytes(b'<html>No PDF</html>')
                with self.assertRaises(ValueError):
                    self.run_publish()
                self.assertEqual({p.relative_to(self.site): p.read_bytes() for p in self.site.rglob('*') if p.is_file()}, before)
                self.source = original


if __name__ == '__main__':
    unittest.main()
