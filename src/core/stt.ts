// On-device speech recognition front-end: one worker per page, loaded in the background when a unit opens.
// Until the model is ready (or if it can't load), read-along falls back to "a voice was heard".
// whisper tiny.en (8-bit) in a worker; a reading is judged by sttCheck.ts (free transcript + forced scores).
import type { Reading } from './sttCheck.ts';
export const STT_MODEL = 'onnx-community/whisper-tiny.en';

type State = 'off' | 'loading' | 'ready' | 'error';
let worker: Worker | null = null;
let state: State = 'off';
let seq = 0;
let loaded = 0, total = 0;
const waiters = new Map<number, (r: { text: string; ms: number } | null) => void>();
export type Checked = Reading & { ms: number };
const checkers = new Map<number, (r: Checked | null) => void>();
let readyWaiters: ((ok: boolean) => void)[] = [];

export const sttState = () => state;
export const sttProgress = () => (total ? loaded / total : 0);

function settle(ok: boolean) { const w = readyWaiters; readyWaiters = []; w.forEach((f) => f(ok)); }

/** Start downloading + compiling the model in a worker (idempotent). */
export function sttPreload(model = STT_MODEL) {
  if (worker || state === 'error') return;
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') { state = 'error'; return; }
  try {
    worker = new Worker(new URL('./sttWorker.ts', import.meta.url), { type: 'module' });
  } catch (e) { console.warn('stt: no worker', e); state = 'error'; return; }
  state = 'loading';
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data as { type: string; id?: number; text?: string; ms?: number; error?: string; loaded?: number; total?: number };
    if (d.type === 'ready') { state = 'ready'; settle(true); }
    else if (d.type === 'error') { state = 'error'; console.warn('stt: load failed', d.error); settle(false); }
    else if (d.type === 'progress') { loaded = d.loaded ?? 0; total = d.total ?? 0; }
    else if (d.type === 'result') {
      const f = waiters.get(d.id!); waiters.delete(d.id!);
      if (d.error) console.warn('stt: run failed', d.error);
      f?.(d.error ? null : { text: d.text ?? '', ms: d.ms ?? 0 });
    } else if (d.type === 'checked') {
      const f = checkers.get(d.id!); checkers.delete(d.id!);
      if (d.error) console.warn('stt: check failed', d.error);
      f?.(d.error ? null : (d as unknown as { r: Checked }).r);
    }
  };
  worker.onerror = (e) => { console.warn('stt: worker error', e.message); state = 'error'; settle(false); };
  worker.postMessage({ type: 'load', base: new URL('./', location.href).href, model });
}

/** Resolves true once the model is ready (false on error or after `ms`). */
export function sttWhenReady(ms: number): Promise<boolean> {
  if (state === 'ready') return Promise.resolve(true);
  if (state === 'error' || state === 'off') return Promise.resolve(false);
  return new Promise((res) => {
    const t = setTimeout(() => { readyWaiters = readyWaiters.filter((f) => f !== done); res(false); }, ms);
    const done = (ok: boolean) => { clearTimeout(t); res(ok); };
    readyWaiters.push(done);
  });
}

/** 16 kHz mono PCM -> text, or null if the model isn't ready / the run failed / it took longer than `ms`. */
export function transcribe(audio16k: Float32Array, ms = 12000): Promise<{ text: string; ms: number } | null> {
  if (!worker || state !== 'ready') return Promise.resolve(null);
  const id = ++seq;
  const a = new Float32Array(audio16k); // own buffer, so it can be transferred
  return new Promise((res) => {
    waiters.set(id, res);
    worker!.postMessage({ type: 'run', id, audio: a }, [a.buffer]);
    setTimeout(() => { if (waiters.delete(id)) res(null); }, ms);
  });
}

/** Was `target` read? (16 kHz mono PCM) null if the model isn't ready / failed / took longer than `ms`. */
export function check(audio16k: Float32Array, target: string, alts: string[], rivals: string[], ms = 15000): Promise<Checked | null> {
  if (!worker || state !== 'ready') return Promise.resolve(null);
  const id = ++seq;
  const a = new Float32Array(audio16k);
  return new Promise((res) => {
    checkers.set(id, res);
    worker!.postMessage({ type: 'check', id, audio: a, target, alts, rivals }, [a.buffer]);
    setTimeout(() => { if (checkers.delete(id)) res(null); }, ms);
  });
}
