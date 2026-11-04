"""Original background music for Phonics Jenga: a gentle 16-bar music-box loop (C major, 96 BPM, 40 s).

The concept videos carry narration and a few effects but no music track (separated music stem ≈ -45 dB), so the
game gets its own loop. Toy-piano melody + soft bass + pad + light shaker, with a short reverb. The reverb tail is
wrapped back to the start so the loop is seamless.  → public/bgm.mp3
Run: /Users/jini/.hermes/bin/uv run --with numpy --with scipy python tools/make_bgm.py
"""
import pathlib
import subprocess

import numpy as np
from scipy.signal import fftconvolve

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 44100
BPM = 96
BEAT = 60 / BPM
BARS = 16
LOOP = BARS * 4 * BEAT               # 40 s
N = int(LOOP * SR) + SR * 4
rng = np.random.default_rng(7)
mid = lambda m: 440 * 2 ** ((m - 69) / 12)
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}


def m(s):  # 'E5' → midi
    return NOTE[s[:-1]] + 12 * (int(s[-1]) + 1)


CHORDS = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G', 'F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'G']
TONES = {'C': ['C', 'E', 'G'], 'Am': ['A', 'C', 'E'], 'F': ['F', 'A', 'C'], 'G': ['G', 'B', 'D'], 'Em': ['E', 'G', 'B']}
MEL = [
    [('E5', 0, 1), ('G5', 1, 1), ('C6', 2, 1.5), ('G5', 3.5, .5)],
    [('A5', 0, 1), ('G5', 1, .5), ('E5', 1.5, .5), ('C5', 2, 2)],
    [('F5', 0, 1), ('A5', 1, 1), ('C6', 2, 1), ('A5', 3, 1)],
    [('G5', 0, 1.5), ('F5', 1.5, .5), ('E5', 2, 1), ('D5', 3, 1)],
    [('E5', 0, 1), ('G5', 1, 1), ('C6', 2, 1), ('E6', 3, 1)],
    [('D6', 0, 1), ('C6', 1, .5), ('A5', 1.5, .5), ('G5', 2, 2)],
    [('A5', 0, .5), ('G5', .5, .5), ('F5', 1, 1), ('D5', 2, 1), ('F5', 3, 1)],
    [('D5', 0, 1), ('G5', 1, 1), ('F5', 2, 1), ('D5', 3, 1)],
    [('F5', 0, 1), ('E5', 1, .5), ('F5', 1.5, .5), ('A5', 2, 2)],
    [('G5', 0, 1), ('F5', 1, .5), ('G5', 1.5, .5), ('B5', 2, 2)],
    [('G5', 0, 1), ('B5', 1, 1), ('E6', 2, 1.5), ('D6', 3.5, .5)],
    [('C6', 0, 1), ('B5', 1, .5), ('A5', 1.5, .5), ('E5', 2, 2)],
    [('A5', 0, 1), ('C6', 1, 1), ('F6', 2, 1), ('C6', 3, 1)],
    [('B5', 0, 1), ('D6', 1, 1), ('G6', 2, 1), ('F6', 3, 1)],
    [('E6', 0, 1), ('D6', 1, .5), ('C6', 1.5, .5), ('G5', 2, 1), ('E5', 3, 1)],
    [('G5', 0, 1), ('F5', 1, 1), ('D5', 2, 1), ('B4', 3, 1)],
]

L = np.zeros(N); R = np.zeros(N)


def add(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    j = min(N, i + len(sig))
    s = sig[:j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan)); R[i:j] += s * np.sqrt(0.5 * (1 + pan))


def musicbox(f, dur):
    t = np.arange(int((dur + 1.6) * SR)) / SR
    tau = 0.55 * (523 / f) ** 0.35
    env = np.minimum(1, t / 0.003) * np.exp(-t / tau)
    s = (np.sin(2 * np.pi * f * t) + 0.42 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / (tau * .5))
         + 0.16 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t / (tau * .35)) + 0.08 * np.sin(2 * np.pi * 4.2 * f * t) * np.exp(-t / .06))
    s += 0.5 * np.sin(2 * np.pi * f * 1.003 * t)          # a touch of chorus
    return s * env / 1.6


def bass(f, dur):
    t = np.arange(int((dur + .4) * SR)) / SR
    env = np.minimum(1, t / 0.012) * np.exp(-t / 0.55) * (t < dur + .3)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)) * env


def pad(fs, dur):
    t = np.arange(int((dur + .6) * SR)) / SR
    env = np.minimum(1, t / .35) * np.where(t < dur, 1, np.exp(-(t - dur) / .25))
    s = np.zeros_like(t)
    for f in fs:
        for k, a in ((1, 1), (3, 1 / 9), (5, 1 / 25)):
            s += a * np.sin(2 * np.pi * f * k * t + rng.random() * 6.28)
    return s * env / len(fs)


def shaker(dur=.07):
    t = np.arange(int(dur * SR)) / SR
    n = rng.standard_normal(len(t))
    n = np.diff(np.concatenate([[0], n]))                    # brighter
    return n * np.exp(-t / .018)


for bar in range(BARS):
    t0 = bar * 4 * BEAT
    ch = CHORDS[bar]
    root = TONES[ch][0]
    # melody
    for note, b, ln in MEL[bar]:
        add(musicbox(mid(m(note)), ln * BEAT), t0 + b * BEAT + rng.uniform(0, .006), pan=.18, gain=.30)
    # soft echo of the melody an octave down on the last beat-and-a-half of long notes
    # bass: root on 1, fifth on 3
    r3 = m(root + '2') if root not in ('A', 'B') else m(root + '1')
    add(bass(mid(r3), 1.6 * BEAT), t0, gain=.34)
    add(bass(mid(r3 + 7), 1.6 * BEAT), t0 + 2 * BEAT, gain=.28)
    # pad chord
    fs = [mid(m(n + '4')) for n in TONES[ch]]
    add(pad(fs, 3.8 * BEAT), t0, pan=-.15, gain=.07)
    # shaker on the off-beats, a softer tick on the beats
    for k in range(8):
        add(shaker(), t0 + k * BEAT / 2 + .004, pan=.45 if k % 2 else -.3, gain=.05 if k % 2 else .025)

# reverb (stereo, exponentially decaying noise)
ir_t = np.arange(int(1.9 * SR)) / SR
irL = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / .42); irR = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / .42)
irL[:int(.012 * SR)] = 0; irR[:int(.017 * SR)] = 0
irL /= np.sqrt((irL ** 2).sum()); irR /= np.sqrt((irR ** 2).sum())
wetL = fftconvolve(L, irL)[:N]; wetR = fftconvolve(R, irR)[:N]
L2 = L + .32 * wetL; R2 = R + .32 * wetR

# seamless loop: fold everything after LOOP back onto the start
n = int(round(LOOP * SR))
outL = L2[:n].copy(); outR = R2[:n].copy()
tail = len(L2) - n
outL[:tail] += L2[n:]; outR[:tail] += R2[n:]
st = np.stack([outL, outR], 1)
st *= 10 ** (-3 / 20) / np.abs(st).max()
rms = 20 * np.log10(np.sqrt((st ** 2).mean()))
print(f'loop {LOOP:.2f}s · peak -3 dBFS · rms {rms:.1f} dBFS')

wav = ROOT / 'tools' / 'bgm_loop.wav'
pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
import wave
with wave.open(str(wav), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-c:a', 'libmp3lame', '-b:a', '128k', str(ROOT / 'public' / 'bgm.mp3')], check=True)
wav.unlink()
print('→', ROOT / 'public' / 'bgm.mp3', (ROOT / 'public' / 'bgm.mp3').stat().st_size // 1024, 'KB')
