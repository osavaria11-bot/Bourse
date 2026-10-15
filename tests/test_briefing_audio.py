"""Verify that quote refreshes reuse only complete audio for the current edition."""
import json
import tempfile
import unittest
from pathlib import Path

from scripts.generate_briefing_audio import VOICE, RATE, audio_key, cached, digest


class BriefingAudioCacheTests(unittest.TestCase):
    def test_cached_audio_requires_matching_text_timings_and_file_digest(self):
        content = {"text": "Bonjour les marchés.", "chapters": [{"title": "Présentation", "start": 0, "end": 20}]}
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / "audio").mkdir()
            filename = f"briefing-{audio_key(content)[:24]}.mp3"
            audio_file = output / "audio" / filename
            audio_file.write_bytes(b"cache integrity fixture")
            manifest = {"schema_version": 1, "kind": "briefing_audio", "text": content["text"],
                        "voice": VOICE, "rate": RATE, "src": "data/audio/" + filename,
                        "audio_sha256": digest(audio_file.read_bytes()), "duration": 4,
                        "chapters": [{**content["chapters"][0], "time_start": 0, "time_end": 4}]}
            (output / "briefing-audio.json").write_text(json.dumps(manifest))
            self.assertEqual(cached(content, output), manifest)
            self.assertIsNone(cached({**content, "text": "A newer edition"}, output))
            audio_file.write_bytes(b"incomplete download")
            self.assertIsNone(cached(content, output))
            audio_file.write_bytes(b"cache integrity fixture")
            manifest["chapters"][0]["time_end"] = 3
            (output / "briefing-audio.json").write_text(json.dumps(manifest))
            self.assertIsNone(cached(content, output))


if __name__ == "__main__":
    unittest.main()
