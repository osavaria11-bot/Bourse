#!/usr/bin/env python3
"""Build a natural Canadian French narration as a generated Pages asset.

Only the public news edition is read. Generated MP3s are cached across Pages
deployments and never added to Git or regenerated just because quotes refresh.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VOICE = "fr-CA-AntoineNeural"
RATE = "-3%"


def narration() -> dict:
    source = """
const fs = require('node:fs'), U = require('./js/briefing-audio-utils.js');
const edition = JSON.parse(fs.readFileSync('data/daily-briefing.json', 'utf8'));
const result = U.narration(edition);
if (!result) throw new Error('No valid public news edition');
console.log(JSON.stringify({...result, edition_date: edition.edition_date}));
"""
    return json.loads(subprocess.check_output(["node", "-e", source], cwd=ROOT, text=True))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def audio_key(content: dict) -> str:
    return digest((VOICE + "\n" + RATE + "\n" + content["text"]).encode("utf-8"))


def cached(content: dict, output: Path) -> dict | None:
    try:
        manifest = json.loads((output / "briefing-audio.json").read_text(encoding="utf-8"))
        filename = f"briefing-{audio_key(content)[:24]}.mp3"
        if (manifest.get("schema_version") != 1 or manifest.get("kind") != "briefing_audio"
                or manifest.get("text") != content["text"] or manifest.get("voice") != VOICE
                or manifest.get("rate") != RATE or manifest.get("src") != "data/audio/" + filename):
            return None
        audio = output / "audio" / filename
        if digest(audio.read_bytes()) != manifest.get("audio_sha256"):
            return None
        if not isinstance(manifest.get("duration"), (float, int)) or not 0 < manifest["duration"] < 7200:
            return None
        if len(manifest.get("chapters", [])) != len(content["chapters"]):
            return None
        previous = 0
        for item, chapter in zip(manifest["chapters"], content["chapters"]):
            if any(item.get(key) != chapter[key] for key in ("title", "start", "end")):
                return None
            start, end = item["time_start"], item["time_end"]
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (start, end)):
                return None
            if abs(start - previous) > .01 or end <= start or end > manifest["duration"] + .01:
                return None
            previous = end
        return manifest if abs(previous - manifest["duration"]) <= .01 else None
    except (OSError, ValueError, TypeError, KeyError):
        return None


def duration(path: Path) -> float:
    seconds = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path)
    ], text=True, timeout=30))
    if not math.isfinite(seconds) or not 0 < seconds < 7200:
        raise ValueError("Invalid generated audio duration")
    return seconds


async def synthesize(text: str, destination: Path) -> None:
    import edge_tts  # Installed only when a new public edition needs rendering.
    for attempt in range(3):
        try:
            await asyncio.wait_for(edge_tts.Communicate(text, VOICE, rate=RATE).save(str(destination)), timeout=100)
            if destination.stat().st_size < 1000:
                raise ValueError("Empty narration")
            return
        except Exception:
            destination.unlink(missing_ok=True)
            if attempt == 2:
                raise
            await asyncio.sleep(attempt + 1)


async def generate(content: dict, output: Path) -> dict:
    if not all(shutil.which(binary) for binary in ("ffmpeg", "ffprobe")):
        raise RuntimeError("FFmpeg and ffprobe must be installed before generating a new narration")
    output.mkdir(parents=True, exist_ok=True)
    audio_directory = output / "audio"
    audio_directory.mkdir(exist_ok=True)
    filename = f"briefing-{audio_key(content)[:24]}.mp3"
    with tempfile.TemporaryDirectory(prefix="savy-narration-") as temporary:
        temporary = Path(temporary)
        lengths = []
        for index, chapter in enumerate(content["chapters"]):
            destination = temporary / f"chapter-{index:02}.mp3"
            # Browser chapter offsets use UTF-16 units, including any emoji.
            text = content["text"].encode("utf-16-le")[chapter["start"] * 2:chapter["end"] * 2].decode("utf-16-le")
            await synthesize(text, destination)
            lengths.append(duration(destination))
            print(f"Narration chapter {index + 1}/{len(content['chapters'])} generated", flush=True)
        playlist = temporary / "concat.txt"
        playlist.write_text("\n".join(f"file 'chapter-{i:02}.mp3'" for i in range(len(lengths))), encoding="utf-8")
        combined = temporary / filename
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                        "-i", str(playlist), "-c", "copy", str(combined)], check=True, timeout=60)
        total = duration(combined)
        timings, elapsed = [], 0
        scale = total / sum(lengths)
        for chapter, seconds in zip(content["chapters"], lengths):
            end = elapsed + seconds * scale
            timings.append({**chapter, "time_start": round(elapsed, 6), "time_end": round(end, 6)})
            elapsed = end
        timings[-1]["time_end"] = total
        audio_bytes = combined.read_bytes()
        if not 1000 <= len(audio_bytes) <= 32 * 1024 * 1024:
            raise ValueError("Narration size outside expected limits")
        manifest = {"schema_version": 1, "kind": "briefing_audio", "edition_date": content["edition_date"],
                    "generated_at": datetime.now(timezone.utc).isoformat(), "voice": VOICE, "rate": RATE,
                    "voice_label": "Antoine · Français (Canada)", "src": "data/audio/" + filename,
                    "text": content["text"], "adapted": content.get("adapted", False), "duration": total,
                    "audio_sha256": digest(audio_bytes), "chapters": timings}
        # Publish the complete audio before its manifest, both atomically.
        staged = audio_directory / (filename + ".tmp")
        staged.write_bytes(audio_bytes)
        staged.replace(audio_directory / filename)
        staged_manifest = output / "briefing-audio.json.tmp"
        staged_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        staged_manifest.replace(output / "briefing-audio.json")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--reuse-only", action="store_true")
    args = parser.parse_args()
    content = narration()
    manifest = cached(content, args.output_dir)
    if manifest:
        print(f"Reusing verified {VOICE} narration: {manifest['duration']:.1f}s")
        return
    if args.reuse_only:
        raise SystemExit("Current edition needs a new natural narration")
    manifest = asyncio.run(generate(content, args.output_dir))
    print(f"Natural narration ready: {VOICE}, {manifest['duration']:.1f}s, {len(manifest['chapters'])} chapters")


if __name__ == "__main__":
    main()
