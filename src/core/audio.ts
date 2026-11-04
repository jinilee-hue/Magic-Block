// One Web Audio context for everything: pre-made voice clips (lead-in + loudness from voice.json), synthesized
// sound effects (like Word Mashup: no files), and a music loop (the intro video's own music) that ducks while
// someone talks.
import voiceData from '../data/voice.json';

type Clip = [file: string, start: number, gain: number, dur: number];
const CLIPS = (voiceData as unknown as { clips: Record<string, Clip> }).clips;

const SETTINGS_KEY = 'pj-settings-v1';
export const settings: { music: boolean; sfx: boolean } = (() => {
  try { return { music: true, sfx: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { music: true, sfx: true }; }
})();
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } };

const MUSIC_VOL = 0.3, SFX_VOL = 0.55;
let ctx: AudioContext | null = null;
let master!: GainNode, voiceBus!: GainNode, sfxBus!: GainNode, musicBus!: GainNode, musicDuck!: GainNode;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const base = new URL('./', location.href).href;

export const audioCtx = () => ctx;
export const hasClip = (key: string) => !!CLIPS[key];
export const clipDur = (key: string) => CLIPS[key]?.[3] ?? 0;

/** Create/resume the context. Call from a user gesture (START, SKIP, a tap). */
export function unlock(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain(); master.connect(ctx.destination);
    voiceBus = ctx.createGain(); voiceBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = settings.sfx ? SFX_VOL : 0; sfxBus.connect(master);
    musicDuck = ctx.createGain(); musicDuck.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = settings.music ? MUSIC_VOL : 0; musicBus.connect(musicDuck);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  // iOS: a silent one-sample buffer started inside the gesture unlocks output
  try { const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); } catch { /* ignore */ }
  return ctx;
}

async function fetchDecode(url: string): Promise<AudioBuffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok || /text\/html/.test(r.headers.get('content-type') || '')) return null;
    const ab = await r.arrayBuffer();
    const c = ctx ?? unlock();
    return await c.decodeAudioData(ab);
  } catch (e) { console.warn('audio: decode failed', url, e); return null; }
}

export function loadClip(key: string): Promise<AudioBuffer | null> {
  const c = CLIPS[key];
  if (!c) return Promise.resolve(null);
  let p = buffers.get(key);
  if (!p) { p = fetchDecode(`${base}voice/${c[0]}`); buffers.set(key, p); }
  return p;
}
export const preload = (keys: string[]) => Promise.all(keys.map(loadClip));

export interface Playing { done: Promise<void>; stop(): void; startAt: number; endAt: number }

/** Schedule one clip at context time `when` (0 = now). `done` resolves when it ends or is stopped. */
export async function playClip(key: string, when = 0, gainMul = 1): Promise<Playing | null> {
  const info = CLIPS[key];
  const buf = await loadClip(key);
  if (!info || !buf || !ctx) return null;
  const s = ctx.createBufferSource(); s.buffer = buf;
  const g = ctx.createGain(); g.gain.value = info[2] * gainMul;
  s.connect(g); g.connect(voiceBus);
  const t0 = Math.max(ctx.currentTime + 0.01, when || 0);
  const dur = Math.max(0.05, buf.duration - info[1]);
  s.start(t0, info[1]);
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  s.onended = () => { resolve(); try { g.disconnect(); } catch { /* gone */ } };
  return { done, startAt: t0, endAt: t0 + dur, stop() { try { s.stop(); } catch { /* not started */ } resolve(); } };
}

/** Lower the music while a voice plays. */
let talkDuck = false, held = false;
export function duck(on: boolean) { talkDuck = on; applyDuck(); }
/** A read-aloud turn: music off until it ends (to a microphone the music box sounds like someone talking). */
export function holdMusic(on: boolean) { held = on; applyDuck(); }
function applyDuck() {
  if (!ctx) return;
  const t = ctx.currentTime, to = held ? 0 : talkDuck ? 0.3 : 1;
  musicDuck.gain.cancelScheduledValues(t);
  musicDuck.gain.setTargetAtTime(to, t, to < 1 ? 0.06 : 0.5);
}

export function setMusic(on: boolean) { settings.music = on; saveSettings(); if (ctx) musicBus.gain.setTargetAtTime(on ? MUSIC_VOL : 0, ctx.currentTime, 0.1); if (on) startMusic(); }
export function setSfx(on: boolean) { settings.sfx = on; saveSettings(); if (ctx) sfxBus.gain.setTargetAtTime(on ? SFX_VOL : 0, ctx.currentTime, 0.05); }

// ── music: an original music-box loop (tools/make_bgm.py; the concept videos have no music track) ─────────────
const MUSIC_LOOP = 40;   // seconds: 16 bars at 96 BPM — loop exactly there (an mp3 pads its last frame)
let music: AudioBufferSourceNode | null = null, musicLoading: Promise<AudioBuffer | null> | null = null;
export async function startMusic() {
  if (!ctx || music || !settings.music) return;
  musicLoading ??= fetchDecode(`${base}bgm.mp3`);
  const buf = await musicLoading;
  if (!buf || music || !ctx) return;
  music = ctx.createBufferSource(); music.buffer = buf; music.loop = true;
  music.loopStart = 0; music.loopEnd = Math.min(buf.duration, MUSIC_LOOP);
  music.connect(musicBus); music.start(ctx.currentTime + 0.05);
}
export function stopMusic() { try { music?.stop(); } catch { /* not started */ } music = null; }

// ── sound effects ───────────────────────────────────────────────────────────────────────────────────────────
let noiseBuf: AudioBuffer | null = null;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
function noiseBuffer(): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ctx!.createBuffer(1, ctx!.sampleRate, ctx!.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function note(freq: number, t: number, dur: number, type: OscillatorType, vol: number) {
  const o = ctx!.createOscillator(), g = ctx!.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number) {
  const s = ctx!.createBufferSource(); s.buffer = noiseBuffer();
  const f = ctx!.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx!.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  return { f, g };
}
/** a short wooden knock */
function tok(t: number, freq: number, vol: number) {
  const o = ctx!.createOscillator(), g = ctx!.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq * 1.6, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.2);
  noise(t, 0.05, 'bandpass', freq * 6, 2.5, vol * 0.6);
}

export type Sfx = 'tap' | 'slide' | 'knock' | 'pop' | 'success' | 'wrong' | 'whoosh' | 'turn' | 'collapse' | 'start' | 'tick' | 'listen';
export function sfx(name: Sfx) {
  if (!ctx || !settings.sfx) return;
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'tap': tok(t, 520, 0.25); break;
    case 'tick': tok(t, 900, 0.12); break;
    case 'slide': { // wood rubbing on wood: band-passed noise that wobbles, then a soft 'tock' as it comes free
      const { f, g } = noise(t, 0.95, 'bandpass', 700, 1.4, 0.3);
      for (let k = 0; k < 8; k++) g.gain.setValueAtTime(0.14 + Math.random() * 0.2, t + 0.08 + k * 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
      f.frequency.linearRampToValueAtTime(1300, t + 0.9);
      tok(t + 0.92, 380, 0.25);
      break;
    }
    case 'knock': tok(t, 220, 0.5); tok(t + 0.13, 200, 0.42); tok(t + 0.26, 185, 0.3); break;
    case 'pop': note(880, t, 0.12, 'sine', 0.2); note(1320, t + 0.04, 0.1, 'sine', 0.12); break;
    case 'success': [81, 86, 91, 96].forEach((m, i) => note(midi(m), t + i * 0.085, 0.5, 'triangle', 0.22)); note(midi(98), t + 0.36, 0.7, 'sine', 0.12); break;
    case 'wrong': note(midi(63), t, 0.28, 'triangle', 0.22); note(midi(58), t + 0.2, 0.4, 'triangle', 0.22); break;
    case 'whoosh': { const { f } = noise(t, 0.45, 'bandpass', 600, 0.8, 0.25); f.frequency.exponentialRampToValueAtTime(3200, t + 0.4); break; }
    case 'turn': note(midi(84), t, 0.3, 'sine', 0.16); note(midi(88), t + 0.1, 0.4, 'sine', 0.14); break;
    // "your turn to talk": a short, soft rising blip, over before the microphone starts judging (guardMs)
    case 'listen': note(midi(79), t, 0.12, 'sine', 0.16); note(midi(86), t + 0.07, 0.16, 'sine', 0.14); break;
    case 'start': [72, 76, 79, 84].forEach((m, i) => note(midi(m), t + i * 0.07, 0.35, 'triangle', 0.2)); break;
    case 'collapse': {
      for (let k = 0; k < 30; k++) tok(t + 0.05 + Math.pow(Math.random(), 1.6) * 2.4, 150 + Math.random() * 280, 0.16 + Math.random() * 0.3);
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(40, t + 1.2);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 1.5);
      break;
    }
  }
}
