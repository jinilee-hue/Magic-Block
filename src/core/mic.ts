// Microphone capture with a simple energy voice detector. One utterance is kept in memory, handed to the on-device
// recogniser and then dropped: nothing is recorded to disk or sent anywhere.
// A read-aloud turn opens the microphone once (openMic) and listens as many times as it needs: no re-opening between
// tries, so the start of a word is never lost while the device wakes up, and its noise/level filters stay settled.
import { audioCtx } from './audio';

export interface Levels { peak: number; floor: number; thr: number }
export type ListenResult =
  | { kind: 'speech'; pcm: Float32Array; sr: number; voicedMs: number; lv: Levels }
  | { kind: 'silence'; lv: Levels }
  | { kind: 'denied' }
  | { kind: 'error'; error: string }
  | { kind: 'aborted' };

export interface ListenOpts {
  /** no voice by then -> 'silence' */
  startTimeoutMs: number;
  /** cap once the voice has started */
  maxMs: number;
  /** this much quiet after the voice ends the utterance */
  endSilenceMs: number;
  /** ignore this much at the start (the room still rings with the tutor's voice) */
  guardMs?: number;
  /** 'waiting' = the microphone really is live now (show it, play the cue); 'voice' = someone started talking */
  onState?: (s: 'waiting' | 'voice') => void;
  /** 0..1 loudness, every 20 ms */
  onLevel?: (v: number) => void;
  /** checked every frame: the activity closed */
  aborted?: () => boolean;
  /** checked every frame: the child tapped the mic to finish (only counts once they have started talking) */
  stopNow?: () => boolean;
}

let blocked = false;
export const micSupported = () => !!navigator.mediaDevices?.getUserMedia && window.isSecureContext && typeof AudioWorkletNode !== 'undefined';
/** the user said no to the microphone (this session) */
export const micBlocked = () => blocked;

// ---- test hook: queue fake utterances (audio URL + delay) that stand in for the microphone
type Fake = { url: string | string[] | null; delayMs: number };
const fakes: Fake[] = [];
export const micTest = {
  /** next listen() gets these clips back to back (null = silence) after delayMs, instead of the real microphone */
  feed(url: string | string[] | null, delayMs = 600) { fakes.push({ url, delayMs }); },
  pending: () => fakes.length,
  clear() { fakes.length = 0; },
};

const WORKLET = `class PiCap extends AudioWorkletProcessor {
  constructor(o) { super(); this.n = o.processorOptions.frame; this.b = new Float32Array(this.n); this.i = 0; }
  process(inputs) {
    const c = inputs[0] && inputs[0][0];
    if (c) for (let k = 0; k < c.length; k++) { this.b[this.i++] = c[k]; if (this.i === this.n) { this.port.postMessage(this.b.slice(0)); this.i = 0; } }
    return true;
  }
}
registerProcessor('pi-cap', PiCap);`;
let workletUrl = '';
const withWorklet = new WeakSet<BaseAudioContext>();

let own: AudioContext | null = null;
function audioContext(): AudioContext {
  const app = audioCtx(); // the app's context: already unlocked by the first tap
  if (app) return app;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return (own ??= new AC());
}

async function fakeStream(ac: AudioContext, f: Fake): Promise<MediaStream> {
  const dest = ac.createMediaStreamDestination();
  let t = ac.currentTime + f.delayMs / 1000;
  for (const u of f.url == null ? [] : Array.isArray(f.url) ? f.url : [f.url]) {
    const buf = await ac.decodeAudioData(await (await fetch(u)).arrayBuffer());
    const s = ac.createBufferSource(); s.buffer = buf; s.connect(dest);
    s.start(t); t += buf.duration + 0.08;
  }
  return dest.stream;
}

export type MicOpen = { kind: 'ok'; mic: Mic } | { kind: 'denied' } | { kind: 'error'; error: string } | { kind: 'aborted' };

/** Open the microphone for one read-aloud turn (asks for permission the first time). */
export async function openMic(aborted?: () => boolean): Promise<MicOpen> {
  const ac = audioContext();
  if (ac.state === 'suspended') { try { await ac.resume(); } catch { /* resumes with the stream below */ } }
  try {
    if (!withWorklet.has(ac)) {
      if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ac.audioWorklet.addModule(workletUrl);
      withWorklet.add(ac);
    }
  } catch (e) { return { kind: 'error', error: String(e) }; }
  if (fakes.length) return { kind: 'ok', mic: new Mic(ac, null) }; // tests: the queued clips stand in for the microphone
  if (!micSupported()) return { kind: 'denied' };
  // the permission prompt can stay open forever: let the activity give up on it (closed, or no answer for a while)
  // no echo cancellation: we never listen while the fox talks (the cue is guarded), and with it Chrome re-routes all
  // of its own sound through its echo canceller (and macOS toggles the mic's hardware noise reduction) the moment the
  // mic opens — right after the fox says the word, which could put a hiccup into the voice (user: "튜터가 카드 단어
  // 읽어보라고 말할때 딱꾹질 같은게 들어갈때가 있어"). Noise suppression and gain control are input-only, kept.
  const gum = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  let poll = 0;
  const gaveUp = new Promise<'abort'>((res) => { poll = window.setInterval(() => { if (aborted?.()) res('abort'); }, 200); });
  try {
    const r = await Promise.race([gum, gaveUp]);
    if (r === 'abort') { gum.then((s) => s.getTracks().forEach((t) => t.stop()), () => undefined); return { kind: 'aborted' }; }
    if (ac.state === 'suspended') { try { await ac.resume(); } catch { /* ignore */ } }
    return { kind: 'ok', mic: new Mic(ac, r) };
  } catch (e) {
    const n = (e as DOMException).name;
    if (n === 'NotAllowedError' || n === 'SecurityError') { blocked = true; return { kind: 'denied' }; }
    if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'NotReadableError') return { kind: 'denied' };
    return { kind: 'error', error: String(e) };
  } finally { clearInterval(poll); }
}

export class Mic {
  constructor(private ac: AudioContext, private stream: MediaStream | null) {}
  get live() { return !!this.stream?.getAudioTracks().some((t) => t.readyState === 'live'); }

  /** one utterance (or silence) */
  async listen(o: ListenOpts): Promise<ListenResult> {
    const fake = fakes.shift();
    if (fake) {
      const s = await fakeStream(this.ac, fake);
      return run(this.ac, s, { ...o, guardMs: 0 }).finally(() => s.getTracks().forEach((t) => t.stop()));
    }
    if (!this.stream || !this.live) return { kind: 'error', error: 'microphone closed' };
    return run(this.ac, this.stream, o);
  }

  close() { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; }
}

function run(ac: AudioContext, stream: MediaStream, o: ListenOpts): Promise<ListenResult> {
  const sr = ac.sampleRate, F = Math.round(sr * 0.02); // 20 ms frames
  const src = ac.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ac, 'pi-cap', { processorOptions: { frame: F }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const sink = ac.createGain(); sink.gain.value = 0; // keeps the node pulled, silently
  src.connect(node); node.connect(sink); sink.connect(ac.destination);
  const guard = Math.round((o.guardMs ?? 0) / 20);

  return new Promise<ListenResult>((resolve) => {
    const frames: Float32Array[] = [];
    let floor = 0.004, run = 0, start = -1, lastVoice = -1, voiced = 0, done = false, peak = 0, thr = 0.012;
    const lv = () => ({ peak: +peak.toFixed(4), floor: +floor.toFixed(4), thr: +thr.toFixed(4) });
    const finish = (r: ListenResult) => {
      if (done) return; done = true;
      node.port.onmessage = null;
      try { src.disconnect(); node.disconnect(); sink.disconnect(); } catch { /* already gone */ }
      resolve(r);
    };
    const utterance = () => {
      const a = Math.max(0, start - 15), b = Math.min(frames.length, lastVoice + 12); // 300 ms before, 240 ms after
      const pcm = new Float32Array((b - a) * F);
      for (let i = a; i < b; i++) pcm.set(frames[i]!, (i - a) * F);
      return { kind: 'speech' as const, pcm, sr, voicedMs: voiced * 20, lv: lv() };
    };
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (done) return;
      const f = e.data; frames.push(f);
      const i = frames.length - 1;
      if (i === 0) o.onState?.('waiting');
      if (i < guard) return;                 // kept for the lead-in, but not judged (the cue, the room's echo)
      let s = 0; for (let k = 0; k < f.length; k++) s += f[k]! * f[k]!;
      const rms = Math.sqrt(s / f.length);
      thr = Math.max(0.01, floor * 3.2);
      const on = rms > thr;
      if (!on) floor = rms < floor ? floor * 0.8 + rms * 0.2 : floor * 0.99 + rms * 0.01; // track the room, not the voice
      if (rms > peak) peak = rms;
      o.onLevel?.(Math.min(1, Math.sqrt(rms / 0.2)));
      if (o.aborted?.()) return finish({ kind: 'aborted' });
      if (start < 0) {
        run = on ? run + 1 : 0;
        if (run >= 4) { start = i - 3; lastVoice = i; voiced = run; o.onState?.('voice'); }
        else if (i * 20 >= o.startTimeoutMs) return finish({ kind: 'silence', lv: lv() });
        return;
      }
      if (on) { voiced++; lastVoice = i; }
      const quietMs = (i - lastVoice) * 20;
      if (o.stopNow?.() || (quietMs >= o.endSilenceMs) || (i - start) * 20 >= o.maxMs) {
        // a click or a cough is not a reading
        return finish(voiced >= 8 ? utterance() : { kind: 'silence', lv: lv() });
      }
    };
    // safety net: the worklet never delivered (suspended context etc.)
    setTimeout(() => { if (!done && frames.length === 0) finish({ kind: 'error', error: 'no audio frames' }); }, 4000);
  });
}

/** One-shot: open, listen once, close. */
export async function listen(o: ListenOpts): Promise<ListenResult> {
  const m = await openMic(o.aborted);
  if (m.kind !== 'ok') return m;
  try { return await m.mic.listen(o); } finally { m.mic.close(); }
}

/** Any-rate mono PCM -> 16 kHz, peak-normalised, with a little silence on both ends (what the recogniser likes). */
export async function prepareForStt(pcm: Float32Array, sr: number): Promise<Float32Array> {
  let out = pcm;
  if (sr !== 16000) {
    const len = Math.max(1, Math.ceil((pcm.length * 16000) / sr));
    const oc = new OfflineAudioContext(1, len, 16000);
    const b = oc.createBuffer(1, pcm.length, sr); b.copyToChannel(new Float32Array(pcm), 0);
    const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
    out = (await oc.startRendering()).getChannelData(0);
  }
  let peak = 0; for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const g = peak > 0.001 ? Math.min(8, 0.9 / peak) : 1;
  const pad = 4000; // 0.25 s
  const r = new Float32Array(out.length + pad * 2);
  for (let i = 0; i < out.length; i++) r[pad + i] = out[i]! * g;
  return r;
}

/** Decode an audio file to 16 kHz PCM (tests and evaluation). */
export async function fileToStt(url: string): Promise<Float32Array> {
  const ac = audioContext();
  const buf = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const ch = buf.getChannelData(0);
  return prepareForStt(ch, buf.sampleRate);
}
