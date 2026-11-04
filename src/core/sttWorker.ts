/// <reference lib="webworker" />
// On-device speech recognition (transformers.js on ONNX Runtime WASM). The child's audio only ever lives in this
// worker's memory for one utterance: nothing is stored or sent anywhere. Model + runtime files come from our own site.
import { env, pipeline } from '@huggingface/transformers';
import { checkReading, type AsrParts } from './sttCheck.ts';

type Load = { type: 'load'; base: string; model: string };
type Run = { type: 'run'; id: number; audio: Float32Array };
type Check = { type: 'check'; id: number; audio: Float32Array; target: string; alts: string[]; rivals: string[] };
type Asr = ((audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>) & AsrParts;

let asr: Promise<Asr> | null = null;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<Load | Run | Check>) => {
  const m = e.data;
  if (m.type === 'load') {
    if (!asr) {
      env.allowRemoteModels = false; // never fetch from the model hub at runtime
      env.allowLocalModels = true;
      // a path, not a full URL: transformers.js only checks which optional files (tokenizer, preprocessor) exist
      // for local paths, and would silently skip them for an http(s) URL
      env.localModelPath = `${new URL(m.base).pathname}stt/models/`;
      env.useBrowserCache = true; // the model downloads once, then comes from Cache Storage
      const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
      if (onnx.wasm) {
        // the plain SIMD build: smallest, and enough for the WASM backend on every browser
        onnx.wasm.wasmPaths = { mjs: `${m.base}stt/ort/ort-wasm-simd-threaded.mjs`, wasm: `${m.base}stt/ort/ort-wasm-simd-threaded.wasm` };
        onnx.wasm.numThreads = 1; // GitHub Pages has no cross-origin isolation, so no threads anyway
      }
      const files = new Map<string, [number, number]>();
      asr = pipeline('automatic-speech-recognition', m.model, {
        device: 'wasm', dtype: 'q8',
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status !== 'progress' || !p.file) return;
          files.set(p.file, [p.loaded ?? 0, p.total ?? 0]);
          let a = 0, b = 0; for (const [x, y] of files.values()) { a += x; b += y; }
          post({ type: 'progress', loaded: a, total: b });
        },
      }) as unknown as Promise<Asr>;
    }
    try {
      const p = await asr;
      await p(new Float32Array(8000)); // warm-up: first run compiles the kernels
      await checkReading(p, new Float32Array(8000), 'map', [], ['cap']); // ... and the scoring path
      post({ type: 'ready' });
    } catch (err) {
      asr = null;
      post({ type: 'error', error: `${String(err)} ${(err as Error)?.stack ?? ''}`.slice(0, 1500) });
    }
    return;
  }
  if (m.type === 'check') {
    try {
      if (!asr) throw new Error('not loaded');
      const p = await asr;
      const t0 = performance.now();
      const r = await checkReading(p, m.audio, m.target, m.alts, m.rivals);
      post({ type: 'checked', id: m.id, r: { ...r, ms: Math.round(performance.now() - t0) } });
    } catch (err) {
      post({ type: 'checked', id: m.id, error: String(err) });
    }
    return;
  }
  if (m.type === 'run') {
    try {
      if (!asr) throw new Error('not loaded');
      const p = await asr;
      const t0 = performance.now();
      const out = await p(m.audio);
      const text = (Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : out.text ?? '').trim();
      post({ type: 'result', id: m.id, text, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      post({ type: 'result', id: m.id, text: '', ms: 0, error: String(err) });
    }
  }
};
