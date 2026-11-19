"""Word clips and the /m/ sound from the lesson pack (phonics-kit rule 2026-11-19: content = the lesson pack).

Every word of src/data/words.json that the pack FP.K.U1L1 has an audio file for (its official MP3s; mirror, mitt,
mushroom, match are the pack's own WAV takes) replaces the fox's company-TTS clip w:<word>; the pack's /m/ replaces s:m.
Writes public/voice/w_<word>.mp3, s_m.mp3 and their [file, start, gain, dur] in src/data/voice.json — nothing else.
build_voice.py runs this at its end (so a full rebuild keeps the pack's clips); run it alone after a pack update:
  uv run --with numpy python tools/pack_voice.py
Then: uv run python tools/build_mouth_cues.py  (the fox's mouth for the new clips)
"""
import json
import pathlib
import re
import subprocess
import sys
import tempfile

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'voice'
JSON_OUT = ROOT / 'src' / 'data' / 'voice.json'
sys.path.insert(0, str(pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit/tools'))
import lessonpack  # noqa: E402

TB = 'FP.K.U1L1'
SR = 24000
FR = int(SR * .01)
LEAD, TAIL = .10, .25        # as build_voice.py
fname = lambda s: re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


def decode(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(p), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def speech(x, floor_db):
    n = len(x) // FR
    rms = np.sqrt((x[:n * FR].reshape(n, FR) ** 2).mean(1) + 1e-12)
    return rms, np.nonzero(rms > rms.max() * 10 ** (floor_db / 20))[0]


def trim(src, dst, target_db=-18, floor_db=-40):
    """build_voice.py's trim on any input (the pack's WAVs too): MP3 mono 24 kHz cut 0.25 s after the speech"""
    _, act = speech(decode(src), floor_db)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-t', f'{(act[-1] + 1) * FR / SR + TAIL:.3f}', '-ac', '1',
                    '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', '-id3v2_version', '0',
                    '-write_xing', '0', str(dst)], check=True)
    y = decode(dst)
    rms, act = speech(y, floor_db)
    voiced = rms[act[0]:act[-1] + 1]
    loud = np.sqrt((voiced[voiced > voiced.max() * .1] ** 2).mean())
    g = min(10 ** (target_db / 20) / loud, 10 ** (-1 / 20) / np.abs(y).max())
    start = max(0., act[0] * FR / SR - LEAD)
    return [round(start, 3), round(float(g), 3), round(len(y) / SR - start, 3)]


def apply(log=print):
    pk = lessonpack.load(lessonpack.pack_dir(TB))
    words = [w['w'] for w in json.loads((ROOT / 'src/data/words.json').read_text())['words']]
    voice = json.loads(JSON_OUT.read_text(encoding='utf-8'))
    clips, done = voice['clips'], []
    for w in words:
        e = pk['words'].get(w)
        if not e or e['audio_src'] != 'pack':
            continue
        dst = OUT / f'w_{fname(w)}.mp3'
        clips[f'w:{w}'] = [dst.name, *trim(e['audio'], dst)]
        done.append(w)
    snd = pk['sound']
    clips[f"s:{snd['text']}"] = [f"s_{snd['text']}.mp3", *trim(snd['audio'], OUT / f"s_{snd['text']}.mp3")]
    voice['pack'] = {'tb_id': pk['tb_id'], 'resource_version': pk['resource_version'], 'words': done, 'sounds': [snd['text']]}
    JSON_OUT.write_text(json.dumps(voice, indent=0, ensure_ascii=False), encoding='utf-8')
    log(f"{TB} pack audio: {len(done)} words ({', '.join(done)}) + /{snd['text']}/")
    return done


if __name__ == '__main__':
    apply()
