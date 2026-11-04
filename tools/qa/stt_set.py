"""Speech-check test set: the 28 m-words read by many voices (child, adult, Korean-accented), in rough conditions,
plus things that must NOT pass (a different first sound, other words, Korean chatter, music, noise).

usage: /Users/jini/.hermes/bin/uv run --with edge-tts --with numpy python tools/qa/stt_set.py [out_dir]
writes <out>/<id>.f32 (16 kHz mono float32, prepared like mic.ts prepareForStt) + <out>/set.json
"""
import asyncio
import json
import os
import pathlib
import subprocess
import sys

import edge_tts
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/jini/.hermes/cache/scratch/jenga/sttset')
RAW = OUT / 'raw'
RAW.mkdir(parents=True, exist_ok=True)
SR = 16000
rng = np.random.default_rng(11)

M = json.loads((ROOT / 'src/data/words.json').read_text())['words']
MW = [w['w'] for w in M if w['m']]
# how a Korean child might say them (Konglish): read by a Korean voice = a strong accent
KO = {'mad': '매드', 'mail': '메일', 'mailbox': '메일박스', 'make': '메이크', 'man': '맨', 'map': '맵', 'mask': '마스크', 'mat': '맷',
      'match': '매치', 'maze': '메이즈', 'meat': '미트', 'met': '멧', 'mess': '메스', 'milk': '밀크', 'mirror': '미러', 'mitt': '밋',
      'mitten': '미튼', 'mix': '믹스', 'mom': '맘', 'monkey': '멍키', 'moon': '문', 'mop': '몹', 'mouse': '마우스', 'mouth': '마우쓰',
      'mud': '머드', 'mug': '머그', 'mushroom': '머쉬룸', 'my': '마이'}
# the same word with another first sound (must not pass for the m-word)
SWAP = {'map': 'cap', 'mat': 'cat', 'mop': 'top', 'mug': 'bug', 'mud': 'bud', 'mad': 'sad', 'man': 'pan', 'met': 'net', 'mix': 'six',
        'mitt': 'kit', 'mail': 'nail', 'make': 'cake', 'mom': 'Tom', 'moon': 'noon', 'milk': 'silk', 'mouse': 'house', 'mouth': 'south',
        'mask': 'task', 'match': 'catch', 'maze': 'daze', 'meat': 'seat', 'mess': 'yes', 'mitten': 'kitten', 'monkey': 'donkey', 'my': 'pie'}
SWAP_KO = {'cap': '캡', 'cat': '캣', 'top': '탑', 'bug': '버그', 'bud': '버드', 'sad': '새드', 'pan': '팬', 'net': '넷', 'six': '식스', 'kit': '킷',
           'nail': '네일', 'cake': '케이크', 'Tom': '탐', 'noon': '눈', 'silk': '실크', 'house': '하우스', 'south': '사우스', 'task': '태스크',
           'catch': '캐치', 'daze': '데이즈', 'seat': '시트', 'yes': '예스', 'kitten': '키튼', 'donkey': '동키', 'pie': '파이'}
OTHER = ['dog', 'sun', 'banana', 'apple', 'hello', 'red', 'fish', 'tree', 'jump', 'bed']
KO_CHAT = ['몰라요', '음...', '이거 뭐예요?', '선생님!', '네!', '아니야', '잠깐만요', '다시요']

VOICES = {  # name: (edge voice, rate, pitch, kid-shift factor, korean text?)
    'ana': ('en-US-AnaNeural', '-10%', '+0Hz', 1.0, False),
    'maisie': ('en-GB-MaisieNeural', '-5%', '+0Hz', 1.0, False),
    'guy': ('en-US-GuyNeural', '+0%', '+0Hz', 1.0, False),
    'jenny_kid': ('en-US-JennyNeural', '+0%', '+0Hz', 1.22, False),
    'sunhi_kr': ('ko-KR-SunHiNeural', '+0%', '+0Hz', 1.0, True),
    'injoon_kr': ('ko-KR-InJoonNeural', '+0%', '+0Hz', 1.0, True),
    'sunhi_kid': ('ko-KR-SunHiNeural', '+0%', '+0Hz', 1.2, True),
}


async def tts(text, voice, rate, pitch, path):
    if path.exists() and path.stat().st_size > 0:
        return
    for k in range(4):
        try:
            await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(path))
            return
        except Exception as e:  # network hiccup
            print('retry', text, voice, e)
            await asyncio.sleep(1.5 * (k + 1))
    raise RuntimeError(f'tts failed {text} {voice}')


def load(path, shift=1.0):
    af = 'aresample=16000' if shift == 1.0 else f'asetrate=24000*{shift},aresample=16000,atempo={1 / shift:.5f}'
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-af', af, '-ac', '1', '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.float32).copy()


def trim(x, thr=0.01):
    idx = np.where(np.abs(x) > thr * np.abs(x).max())[0]
    if not len(idx):
        return x
    a, b = max(0, idx[0] - int(0.30 * SR)), min(len(x), idx[-1] + int(0.24 * SR))  # like the mic: 300 ms before, 240 ms after
    return x[a:b]


def prepare(x):  # mic.ts prepareForStt: peak to 0.9 (max x8), 0.25 s of silence each side
    p = np.abs(x).max()
    g = min(8, 0.9 / p) if p > 0.001 else 1
    pad = np.zeros(4000, np.float32)
    return np.concatenate([pad, (x * g).astype(np.float32), pad])


BGM = load(ROOT / 'public/bgm.mp3')


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)) + 1e-9)


def cond(x, kind):
    x = trim(x)
    if kind == 'clean':
        return x
    if kind == 'bgm':  # the game's music from the speakers, 6 dB under the voice
        s = int(rng.integers(0, len(BGM) - len(x) - 1))
        m = BGM[s:s + len(x)]
        return x + m * (rms(x) / rms(m)) * 10 ** (-6 / 20)
    if kind == 'cut':  # the mic opened late: the first 120 ms of the word are gone
        on = np.where(np.abs(x) > 0.05 * np.abs(x).max())[0][0]
        return x[on + int(0.12 * SR):]
    if kind == 'room':  # far from the mic: reverb + fan noise + quiet
        t = np.arange(int(0.5 * SR)) / SR
        ir = rng.standard_normal(len(t)) * np.exp(-t / 0.07)
        ir[0] = 6
        ir /= np.abs(ir).sum() ** 0.5 * 4
        y = np.convolve(x, ir)[:len(x) + int(0.2 * SR)]
        n = np.cumsum(rng.standard_normal(len(y))) * 0.02
        n -= np.convolve(n, np.ones(400) / 400, 'same')  # brown-ish noise, no DC
        return 0.25 * (y / np.abs(y).max() + n * (rms(y / np.abs(y).max()) / rms(n)) * 10 ** (-12 / 20))
    raise ValueError(kind)


async def main():
    items = []
    jobs = []
    # positives
    for vn, (voice, rate, pitch, shift, ko) in VOICES.items():
        for w in MW:
            text = KO[w] if ko else w
            p = RAW / f'{voice}_{rate}_{text}.mp3'
            jobs.append((text, voice, rate, pitch, p))
    for w, s in SWAP.items():
        for vn in ('ana', 'guy', 'sunhi_kr'):
            voice, rate, pitch, shift, ko = VOICES[vn]
            text = SWAP_KO[s] if ko else s
            jobs.append((text, voice, rate, pitch, RAW / f'{voice}_{rate}_{text}.mp3'))
    for o in OTHER:
        jobs.append((o, 'en-US-AnaNeural', '-10%', '+0Hz', RAW / f'en-US-AnaNeural_-10%_{o}.mp3'))
    for c in KO_CHAT:
        for voice in ('ko-KR-SunHiNeural', 'ko-KR-InJoonNeural'):
            jobs.append((c, voice, '+0%', '+0Hz', RAW / f'{voice}_+0%_{c}.mp3'))
    sem = asyncio.Semaphore(6)

    async def run(j):
        async with sem:
            await tts(*j)
    await asyncio.gather(*(run(j) for j in jobs))
    print('tts clips', len(jobs))

    def save(id_, x, target, should, kind, voice, said):
        np.asarray(prepare(x), np.float32).tofile(OUT / f'{id_}.f32')
        items.append({'id': id_, 'target': target, 'should': should, 'kind': kind, 'voice': voice, 'said': said})

    for vn, (voice, rate, pitch, shift, ko) in VOICES.items():
        for w in MW:
            text = KO[w] if ko else w
            x = load(RAW / f'{voice}_{rate}_{text}.mp3', shift)
            for kind in ('clean', 'bgm', 'cut', 'room'):
                save(f'pos_{vn}_{w}_{kind}', cond(x, kind), w, True, kind, vn, text)
    for w, s in SWAP.items():
        for vn in ('ana', 'guy', 'sunhi_kr'):
            voice, rate, pitch, shift, ko = VOICES[vn]
            text = SWAP_KO[s] if ko else s
            x = load(RAW / f'{voice}_{rate}_{text}.mp3', shift)
            for kind in ('clean', 'bgm'):
                save(f'swap_{vn}_{w}_{kind}', cond(x, kind), w, False, f'swap-{kind}', vn, text)
    for i, w in enumerate(MW):
        o = OTHER[i % len(OTHER)]
        save(f'other_{w}', cond(load(RAW / f'en-US-AnaNeural_-10%_{o}.mp3'), 'clean'), w, False, 'other', 'ana', o)
    for i, c in enumerate(KO_CHAT):
        for voice in ('ko-KR-SunHiNeural', 'ko-KR-InJoonNeural'):
            x = cond(load(RAW / f'{voice}_+0%_{c}.mp3'), 'clean')
            for w in (MW[(i * 3) % len(MW)], MW[(i * 3 + 7) % len(MW)]):
                save(f'kochat_{voice[6:12]}_{i}_{w}', x, w, False, 'korean', voice, c)
    for i in range(6):  # music alone (the voice detector can fire on the music box) and fan noise
        s = int(rng.integers(0, len(BGM) - 2 * SR))
        save(f'music_{i}', BGM[s:s + int(1.6 * SR)].copy(), MW[(i * 5) % len(MW)], False, 'music', '-', '(music)')
        n = np.cumsum(rng.standard_normal(int(1.2 * SR))).astype(np.float32)
        n -= np.convolve(n, np.ones(400) / 400, 'same').astype(np.float32)
        save(f'noise_{i}', n / np.abs(n).max() * 0.05, MW[(i * 5 + 2) % len(MW)], False, 'noise', '-', '(noise)')
    (OUT / 'set.json').write_text(json.dumps(items, ensure_ascii=False, indent=0))
    from collections import Counter
    print(len(items), 'items', Counter((it['should'], it['kind']) for it in items))

asyncio.run(main())
