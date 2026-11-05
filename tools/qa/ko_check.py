"""Read Korean voice takes back with a multilingual whisper (faster-whisper, CPU int8) — tools/build_voice.py uses it
for the Korean tutor lines ('k:' clips), the English read-back (voice_check.ts, whisper-base.en) can't hear Korean.

    uv run --with faster-whisper python tools/qa/ko_check.py --json <list.json>   # [{file, target, ...}] → <list>_out.json
    uv run --with faster-whisper python tools/qa/ko_check.py '<target text>' a.mp3 b.wav ...

sim = how close the transcript is to the target (letters and digits only, difflib ratio); build_voice takes >= 0.75.
Model: KO_MODEL (default 'small'), downloaded once to KO_MODELS (default ~/.cache/phonics-jenga/models/fw, or the
scratch copy if it is already there).
"""
import difflib
import json
import os
import pathlib
import sys

from faster_whisper import WhisperModel

SCRATCH = pathlib.Path('/Users/jini/.hermes/cache/scratch/jenga/models/fw')
ROOT_DIR = os.environ.get('KO_MODELS') or (str(SCRATCH) if SCRATCH.exists() else str(pathlib.Path.home() / '.cache/phonics-jenga/models/fw'))
m = WhisperModel(os.environ.get('KO_MODEL', 'small'), device='cpu', compute_type='int8', download_root=ROOT_DIR)
norm = lambda s: ''.join(ch for ch in s if ch.isalnum())


def check(path, target):
    segs, _ = m.transcribe(path, language='ko', beam_size=5, vad_filter=False)
    text = ''.join(s.text for s in segs).strip()
    return text, difflib.SequenceMatcher(None, norm(text), norm(target)).ratio()


if __name__ == '__main__':
    if sys.argv[1] == '--json':
        items = json.load(open(sys.argv[2]))
        out = []
        for it in items:
            text, sim = check(it['file'], it['target'])
            out.append({**it, 'heard': text, 'sim': round(sim, 3)})
            print(f"{sim:.2f}  {os.path.basename(it['file'])}: {text}", flush=True)
        json.dump(out, open(sys.argv[2].replace('.json', '_out.json'), 'w'), ensure_ascii=False)
    else:
        for p in sys.argv[2:]:
            text, sim = check(p, sys.argv[1])
            print(f'{sim:.2f}  {os.path.basename(p)}: {text}', flush=True)
