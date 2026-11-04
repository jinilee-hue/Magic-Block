"""Pre-made voice clips (no device speechSynthesis: the voice must be the same on every device).

- Word clips  : Microsoft neural 'Ana' (en-US-AnaNeural, a young girl), rate -10%  → public/voice/w_<word>.mp3
- Tutor lines : the fox — Ana, rate -5%, pitch +10Hz (same tutor voice as Halli Galli / Word Mashup) → public/voice/t_<key>.mp3
- First sounds: OFFICIAL FPR K letter-sound recordings copied from Phonics Island (public/fpr) → public/voice/s_<x>.mp3
  (TTS can't say a lone phoneme like /m/ reliably; the textbook recordings can.)
Made with edge-tts (free, prototype only — for release use Azure Speech or a voice actor).

Files are the downloaded mp3s, stream-copied (never re-encoded) and cut 0.15 s after speech. Lead-in and loudness are
applied at playback from src/data/voice.json: {key: [file, start s, gain, dur s]}.
Run: /Users/jini/.hermes/bin/uv run --with edge-tts --with numpy python tools/build_voice.py
"""
import asyncio
import json
import pathlib
import re
import subprocess

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'voice'
JSON_OUT = ROOT / 'src' / 'data' / 'voice.json'
CACHE = pathlib.Path.home() / '.cache' / 'phonics-jenga' / 'voice'
PI = pathlib.Path.home() / 'Documents/Jini/2026/Phonics/Phonics_island/phonics-island-3d/public'
SR = 24000
VOICE = 'en-US-AnaNeural'
WORD_RATE, WORD_PITCH = '-10%', '+0Hz'
TUTOR_RATE, TUTOR_PITCH = '-5%', '+10Hz'

TUTOR = {
    'welcome': "Let's play Phonics Jenga!",
    'rule': 'Find a block that starts with m!',
    'rotate': 'Turn the tower to see all the blocks!',
    'turn1': 'Player one, your turn!',
    'turn2': 'Player two, your turn!',
    'look': 'Look for m!',
    'perfect': 'Perfect! Pull it out!',
    'sayit': 'Now say the word.',
    'great1': 'Awesome! You got the block!',
    'great2': 'Great reading!',
    'great3': 'Yes! You did it!',
    'goodtry': 'Good try! This block is yours!',
    'again': 'Try again! Listen.',
    'louder': "I can't hear you. Say it loud!",
    'tapmic': 'Tap the mic and say it!',
    'nomic': 'Say it out loud!',
    'uhoh': 'Uh-oh!',
    'startswith': 'It starts with',
    'notm': 'Not m!',
    'allout': 'Wow! All the m blocks are out!',
    'watch': 'Now watch the tower!',
    'win1': 'Player one wins!',
    'win2': 'Player two wins!',
    'tie': "It's a tie! You both did great!",
    'playagain': "Let's play again!",
}

words = [w['w'] for w in json.loads((ROOT / 'src/data/words.json').read_text())['words']]
letters = sorted({w[0] for w in words})
fname = lambda s: re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')

jobs = []  # (key, text, rate, pitch, cachefile)
for w in words:
    jobs.append((f'w:{w}', f'{w}.', WORD_RATE, WORD_PITCH, CACHE / f'w_{fname(w)}_{WORD_RATE}{WORD_PITCH}.mp3'))
for k, t in TUTOR.items():
    jobs.append((f't:{k}', t, TUTOR_RATE, TUTOR_PITCH, CACHE / f't_{fname(t)}_{TUTOR_RATE}{TUTOR_PITCH}.mp3'))


async def fetch_all():
    import edge_tts
    CACHE.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(6)
    todo = [j for j in jobs if not j[4].exists()]

    async def one(j):
        key, text, rate, pitch, dst = j
        async with sem:
            for attempt in range(5):
                try:
                    tmp = dst.with_suffix('.part')
                    await edge_tts.Communicate(text, VOICE, rate=rate, pitch=pitch).save(str(tmp))
                    tmp.rename(dst)
                    return
                except Exception as e:  # the service drops connections now and then
                    if attempt == 4:
                        raise RuntimeError(f'{key}: {e}')
                    await asyncio.sleep(1.5 * (attempt + 1))
    await asyncio.gather(*(one(j) for j in todo))
    return len(todo)


print('downloaded', asyncio.run(fetch_all()), 'new clips · cache', CACHE)

LEAD, TAIL = .10, .15
FR = int(SR * .01)


def decode(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(p), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def speech(x, floor_db=-50):
    n = len(x) // FR
    rms = np.sqrt((x[:n * FR].reshape(n, FR) ** 2).mean(1) + 1e-12)
    return rms, np.nonzero(rms > rms.max() * 10 ** (floor_db / 20))[0]


OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('*.mp3'):
    f.unlink()
manifest = {}


def place(key, raw, dst, target_db=-17, floor_db=-50):
    _, act = speech(decode(raw), floor_db)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-t', f'{(act[-1] + 1) * FR / SR + TAIL:.3f}',
                    '-c:a', 'copy', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '0', str(dst)],
                   check=True)
    y = decode(dst)
    rms, act = speech(y, floor_db)
    voiced = rms[act[0]:act[-1] + 1]
    loud = np.sqrt((voiced[voiced > voiced.max() * .1] ** 2).mean())
    g = min(10 ** (target_db / 20) / loud, 10 ** (-1 / 20) / np.abs(y).max())
    start = max(0., act[0] * FR / SR - LEAD)
    manifest[key] = [dst.name, round(start, 3), round(float(g), 3), round(len(y) / SR - start, 3)]


for key, text, rate, pitch, raw in jobs:
    place(key, raw, OUT / f'{key[0]}_{fname(key[2:])}.mp3')

# official letter sounds (FPR K) — the clips carry ~0.5 s of silence before the sound; trim + level them too
fpr = json.loads((PI / 'fpr/manifest.json').read_text())['clips']
for L in sorted(set(letters) | {'m'}):
    src = PI / fpr[f'sound:{L}']
    place(f's:{L}', src, OUT / f's_{L}.mp3', target_db=-18, floor_db=-40)

JSON_OUT.write_text(json.dumps({'voice': VOICE, 'word': [WORD_RATE, WORD_PITCH], 'tutor': [TUTOR_RATE, TUTOR_PITCH],
                                'clips': manifest}, indent=0), encoding='utf-8')
d = sorted((v[3], k) for k, v in manifest.items())
size = sum((OUT / v[0]).stat().st_size for v in manifest.values())
print(f'{len(manifest)} clips · {size / 1024:.0f} KB · shortest {d[:3]} · longest {d[-3:]}')
print('sounds', {k: v for k, v in manifest.items() if k.startswith('s:')})
