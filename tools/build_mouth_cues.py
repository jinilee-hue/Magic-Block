"""Mouth shapes for every voice clip, so the fox's mouth follows what it says (Rhubarb Lip Sync 1.13).

For each clip in src/data/voice.json: decode public/voice/<file> to 16 kHz mono WAV, run rhubarb with the words of the
clip as the dialog (tutor lines from voice.json `lines`, a word clip = the word; letter sounds use the phonetic
recognizer), and keep the cues → src/data/mouth.json  { "<clip key>": [[start s, shape], ...] }, times in the FILE's
time (the game maps them to the audio clock: file time = clip offset + (now - start)).

Shapes (Rhubarb's): A closed (m b p) · B slightly open (most consonants) · C open (e, a as in 'bed', 'cat') ·
D wide (a as in 'father') · E rounded (o as in 'off', er) · F puckered (oo, w) · G f/v · H l · X rest.
Run after tools/build_voice.py:  uv run python tools/build_mouth_cues.py [--all]   (default: only new/changed clips)
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RHUBARB = Path(os.environ.get('RHUBARB', os.path.expanduser('~/.cache/rhubarb/Rhubarb-Lip-Sync-1.13.0-macOS/rhubarb')))
VOICE = json.loads((ROOT / 'src' / 'data' / 'voice.json').read_text())
OUT = ROOT / 'src' / 'data' / 'mouth.json'
CACHE = Path(os.environ.get('MOUTH_CACHE', '/Users/jini/.hermes/cache/scratch/jenga/mouthcues'))


def dialog(key: str) -> str | None:
    kind, ident = key.split(':', 1)
    if kind == 't':
        return VOICE.get('lines', {}).get(ident)
    if kind == 'w':
        return ident.replace('_', ' ')
    return None                          # s: letter sounds → phonetic recognizer, no text


def cues_for(key: str, file: Path) -> tuple[str, list]:
    text = dialog(key)
    h = hashlib.sha1(file.read_bytes() + (text or '').encode()).hexdigest()[:16]
    hit = CACHE / f'{key.replace(":", "_")}_{h}.json'
    if hit.exists():
        return key, json.loads(hit.read_text())
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / 'a.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(file), '-ac', '1', '-ar', '16000', str(wav)], check=True)
        cmd = [str(RHUBARB), '-q', '-f', 'json', '--extendedShapes', 'GHX']
        if text:
            d = Path(tmp) / 'd.txt'; d.write_text(text)
            cmd += ['-d', str(d)]
        else:
            cmd += ['-r', 'phonetic']
        r = subprocess.run(cmd + [str(wav)], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f'rhubarb failed on {key}: {r.stderr[-300:]}')
        data = json.loads(r.stdout)
    out = [[round(c['start'], 3), c['value']] for c in data['mouthCues']]
    hit.write_text(json.dumps(out))
    return key, out


def main():
    if not RHUBARB.exists():
        raise SystemExit(f'rhubarb not found at {RHUBARB} (download the macOS release of rhubarb-lip-sync 1.13)')
    CACHE.mkdir(parents=True, exist_ok=True)
    clips = VOICE['clips']
    jobs = [(k, ROOT / 'public' / 'voice' / v[0]) for k, v in clips.items()]
    missing = [k for k, f in jobs if not f.exists()]
    if missing:
        raise SystemExit(f'missing voice files: {missing}')
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = dict(ex.map(lambda j: cues_for(*j), jobs))
    out = {k: res[k] for k in sorted(res)}
    OUT.write_text(json.dumps(out, separators=(',', ':')))
    shapes = {}
    for cs in out.values():
        for _, s in cs:
            shapes[s] = shapes.get(s, 0) + 1
    print(f'{len(out)} clips → {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB) · shapes {dict(sorted(shapes.items()))}')


if __name__ == '__main__':
    main()
