"""Original background music for Phonics Jenga, upbeat version (user: "배경음악도 신나는 음악이었으면 좋겠어").

A bouncy 16-bar kids' game loop: C major, 128 BPM, 30 s. Marimba hook over C–G–Am–F, "oom-pah" synth bass, off-beat
ukulele-style chord plucks, kick / clap / hats (four on the floor in the second half), glockenspiel sparkles at the
phrase ends and a snare fill that runs back into bar 1. Everything is synthesised here (no samples, no licences).
The reverb tail is folded back onto the start, so the loop is seamless.  → public/bgm.mp3
Run: /Users/jini/.hermes/bin/uv run --with numpy --with scipy python tools/make_bgm.py
(The first, gentle music-box loop is in git history: tools/make_bgm.py before this version.)
"""
import pathlib
import subprocess
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 44100
BPM = 128
BEAT = 60 / BPM
BARS = 16
LOOP = BARS * 4 * BEAT               # 30 s
N = int(LOOP * SR) + SR * 3
rng = np.random.default_rng(11)
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}
hz = lambda midi: 440 * 2 ** ((midi - 69) / 12)


def m(s):  # 'E5' → midi
    return NOTE[s[:-1]] + 12 * (int(s[-1]) + 1)


CHORDS = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'G']
TONES = {'C': ['C', 'E', 'G'], 'G': ['G', 'B', 'D'], 'Am': ['A', 'C', 'E'], 'F': ['F', 'A', 'C']}
HOOK1 = [('E5', 0, .5), ('G5', .5, .5), ('C6', 1, 1), ('G5', 2, .5), ('E5', 2.5, .5), ('G5', 3, 1)]
HOOK2 = [('D5', 0, .5), ('G5', .5, .5), ('B5', 1, 1), ('A5', 2, .5), ('G5', 2.5, .5), ('D5', 3, 1)]
MEL = [
    HOOK1, HOOK2,
    [('C5', 0, .5), ('E5', .5, .5), ('A5', 1, 1), ('A5', 2, .5), ('G5', 2.5, .5), ('E5', 3, 1)],
    [('F5', 0, .5), ('A5', .5, .5), ('C6', 1, .75), ('A5', 1.75, .25), ('G5', 2, .5), ('F5', 2.5, .5), ('E5', 3, .5), ('D5', 3.5, .5)],
    HOOK1, HOOK2,
    [('A5', 0, .5), ('C6', .5, .5), ('F6', 1, 1), ('E6', 2, .5), ('D6', 2.5, .5), ('C6', 3, 1)],
    [('B5', 0, .5), ('A5', .5, .5), ('G5', 1, .5), ('F5', 1.5, .5), ('D5', 2, 1), ('G5', 3, .5), ('B5', 3.5, .5)],
    [('C6', 0, .5), ('B5', .5, .5), ('A5', 1, .5), ('E5', 1.5, .5), ('A5', 2, 1), ('C6', 3, .5), ('E6', 3.5, .5)],
    [('D6', 0, .5), ('C6', .5, .5), ('A5', 1, .5), ('F5', 1.5, .5), ('A5', 2, 1), ('C6', 3, 1)],
    [('E6', 0, .5), ('D6', .5, .5), ('C6', 1, .5), ('G5', 1.5, .5), ('E5', 2, .5), ('G5', 2.5, .5), ('C6', 3, 1)],
    [('B5', 0, .5), ('C6', .5, .5), ('D6', 1, 1), ('B5', 2, .5), ('G5', 2.5, .5), ('D6', 3, 1)],
    [('E6', 0, .75), ('D6', .75, .25), ('C6', 1, .5), ('A5', 1.5, .5), ('E5', 2, .5), ('A5', 2.5, .5), ('C6', 3, 1)],
    [('F6', 0, .75), ('E6', .75, .25), ('D6', 1, .5), ('C6', 1.5, .5), ('A5', 2, .5), ('C6', 2.5, .5), ('F5', 3, 1)],
    [('G5', 0, .5), ('A5', .5, .5), ('B5', 1, .5), ('D6', 1.5, .5), ('G6', 2, .5), ('F6', 2.5, .5), ('E6', 3, .5), ('D6', 3.5, .5)],
    [('D6', 0, 1), ('B5', 1.5, .5), ('G5', 2, .5)],
]

L = np.zeros(N); R = np.zeros(N)


def add(sig, t, pan=0.0, gain=1.0):
    i = int(round(t * SR))
    j = min(N, i + len(sig))
    s = sig[:j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan)); R[i:j] += s * np.sqrt(0.5 * (1 + pan))


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def marimba(f, dur):
    t = tt(max(dur, .25) + .9)
    env = np.minimum(1, t / .002) * np.exp(-t / (.32 * (523 / f) ** .3))
    s = np.sin(2 * np.pi * f * t) + .28 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t / .05) + .1 * np.sin(2 * np.pi * 9.9 * f * t) * np.exp(-t / .018)
    return s * env


def glock(f):
    t = tt(1.4)
    env = np.minimum(1, t / .001) * np.exp(-t / .5)
    return (np.sin(2 * np.pi * f * t) + .35 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / .12) + .2 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t / .05)) * env


def pluck(f, dur=.32):
    """ukulele-ish: bright harmonics that die out faster the higher they are"""
    t = tt(dur + .25)
    s = np.zeros_like(t)
    for k in range(1, 9):
        s += (1 / k) * np.sin(2 * np.pi * k * f * t + rng.random()) * np.exp(-t * (6 + 5 * k))
    return s * np.minimum(1, t / .002)


def bass(f, dur):
    """punchy synth bass: a saw whose upper harmonics close quickly (filter-envelope feel)"""
    t = tt(dur + .06)
    s = np.zeros_like(t)
    for k in range(1, 10):
        s += ((-1) ** (k + 1) / k) * np.sin(2 * np.pi * k * f * t) * np.exp(-t * (2 + 9 * (k - 1)))
    env = np.minimum(1, t / .004) * np.where(t < dur, 1, np.exp(-(t - dur) / .02))
    return s * env


def kick():
    t = tt(.32)
    f = 46 + 110 * np.exp(-t / .035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t / .16) + .3 * np.exp(-t / .004) * rng.standard_normal(len(t)) * .3) * np.minimum(1, t / .001)


BP_CLAP = butter(2, [900, 2600], btype='band', fs=SR, output='sos')
HP_HAT = butter(2, 7000, btype='high', fs=SR, output='sos')
BP_SN = butter(2, [1500, 6000], btype='band', fs=SR, output='sos')


def clap():
    t = tt(.28)
    n = rng.standard_normal(len(t))
    env = np.zeros_like(t)
    for d in (0, .011, .022):                                 # three hands, slightly apart
        env += (t >= d) * np.exp(-np.clip(t - d, 0, None) / .008)
    env += (t >= .03) * np.exp(-np.clip(t - .03, 0, None) / .11) * .6
    return sosfilt(BP_CLAP, n * env) * 2.2


def hat(open_=False):
    t = tt(.4 if open_ else .07)
    return sosfilt(HP_HAT, rng.standard_normal(len(t))) * np.exp(-t / (.16 if open_ else .022))


def snare():
    t = tt(.2)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / .05)
    return (sosfilt(BP_SN, rng.standard_normal(len(t))) * np.exp(-t / .07) * 1.6 + .5 * body)


for bar in range(BARS):
    t0 = bar * 4 * BEAT
    ch = CHORDS[bar]
    tones = TONES[ch]
    root = m(tones[0] + '2')
    if root > m('E2'):
        root -= 12                                            # keep the bass between E1 and D#2
    second_half = bar >= 8
    # melody (marimba) + a quiet octave-up double in the second half
    for note, b, ln in MEL[bar]:
        f = hz(m(note))
        add(marimba(f, ln * BEAT), t0 + b * BEAT, pan=.12, gain=.34)
        if second_half:
            add(marimba(f * 2, ln * BEAT), t0 + b * BEAT + .004, pan=-.25, gain=.07)
    # bass: root on the beat, octave on the "and" (oom-pah); a walk-up into the next bar on bar 8 and 16
    for k in range(4):
        add(bass(hz(root), .42 * BEAT), t0 + k * BEAT, gain=.30)
        add(bass(hz(root + 12), .3 * BEAT), t0 + (k + .5) * BEAT, gain=.20)
    # off-beat chord plucks (ukulele feel)
    for k in range(4):
        for i, n in enumerate(tones):
            add(pluck(hz(m(n + '4'))), t0 + (k + .5) * BEAT + i * .006, pan=-.3, gain=.11)
    # drums
    kicks = [0, 1, 2, 3] if second_half else ([0, 2, 2.5] if bar % 2 else [0, 2])
    for b in kicks:
        add(kick(), t0 + b * BEAT, gain=.62)
    for b in (1, 3):
        if bar in (7, 15) and b == 3:
            continue
        add(clap(), t0 + b * BEAT, pan=.05, gain=.26)
    for k in range(8):
        if bar % 2 and k == 7:
            add(hat(True), t0 + k * BEAT / 2, pan=.35, gain=.07)
        else:
            add(hat(), t0 + k * BEAT / 2, pan=.35, gain=.06 if k % 2 else .035)
    if second_half:                                           # 16th shaker for drive
        for k in range(16):
            add(hat() * .6, t0 + k * BEAT / 4 + .003, pan=-.45, gain=.025 if k % 2 else .012)
    # fills: snare 16ths on beats 3-4 of bars 8 and 16, louder towards the downbeat
    if bar in (7, 15):
        for k in range(8):
            add(snare(), t0 + 2 * BEAT + k * BEAT / 4, pan=-.05, gain=.09 + .03 * k)
        # glockenspiel sparkle up the chord
        for k, n in enumerate(['G5', 'B5', 'D6', 'G6']):
            add(glock(hz(m(n))), t0 + (2 + k * .5) * BEAT, pan=.4, gain=.10)
    if bar in (3, 11):
        for k, n in enumerate(['C6', 'E6', 'G6', 'C7']):
            add(glock(hz(m(n))), t0 + (3 + k * .25) * BEAT, pan=.4, gain=.08)

# a little room (short, so it stays punchy)
ir_t = np.arange(int(1.1 * SR)) / SR
irL = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / .22); irR = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / .22)
irL[:int(.01 * SR)] = 0; irR[:int(.014 * SR)] = 0
irL /= np.sqrt((irL ** 2).sum()); irR /= np.sqrt((irR ** 2).sum())
wetL = fftconvolve(L, irL)[:N]; wetR = fftconvolve(R, irR)[:N]
L2 = L + .16 * wetL; R2 = R + .16 * wetR

# seamless loop: fold everything after LOOP back onto the start
n = int(round(LOOP * SR))
outL = L2[:n].copy(); outR = R2[:n].copy()
tail = len(L2) - n
outL[:tail] += L2[n:]; outR[:tail] += R2[n:]
st = np.stack([outL, outR], 1)
st /= np.abs(st).max()
st = np.tanh(st * 1.6) / np.tanh(1.6)                      # gentle glue / limiting
# about as loud as the old music-box loop (it measured -15.4 dBFS RMS; drums sound louder, so a little under), peaks ≤ -1 dBFS
st *= 10 ** (-17 / 20) / np.sqrt((st ** 2).mean())
st *= min(1, 10 ** (-1 / 20) / np.abs(st).max())
rms = 20 * np.log10(np.sqrt((st ** 2).mean())); peak = 20 * np.log10(np.abs(st).max())
print(f'loop {LOOP:.2f}s · {BPM} BPM · peak {peak:.1f} dBFS · rms {rms:.1f} dBFS')

wav = ROOT / 'tools' / 'bgm_loop.wav'
pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
with wave.open(str(wav), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-c:a', 'libmp3lame', '-b:a', '160k', str(ROOT / 'public' / 'bgm.mp3')], check=True)
wav.unlink()
print('→', ROOT / 'public' / 'bgm.mp3', (ROOT / 'public' / 'bgm.mp3').stat().st_size // 1024, 'KB')
