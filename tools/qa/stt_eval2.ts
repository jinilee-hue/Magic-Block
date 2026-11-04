// Speech-check evaluation with the game's own code path (src/core/sttCheck.ts) — Node, same model files.
// usage: [STT_MODEL=onnx-community/whisper-base.en STT_MODELS_DIR=<dir>/] node tools/qa/stt_eval2.ts [set_dir] [out.json]
// Every rival is scored (freeOnsets '') so tools/qa/stt_grid.py can try leaving letters out afterwards.
import { env, pipeline } from '@huggingface/transformers';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scoreReading } from '../../src/core/readCheck.ts';
import { checkReading, RULE } from '../../src/core/sttCheck.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SET = process.argv[2] ?? '/Users/jini/.hermes/cache/scratch/jenga/sttset';
const OUT = process.argv[3] ?? '/Users/jini/.hermes/cache/scratch/jenga/stt_eval2.json';
const MODEL = process.env.STT_MODEL ?? 'onnx-community/whisper-tiny.en';
env.allowRemoteModels = false;
env.localModelPath = process.env.STT_MODELS_DIR ?? `${ROOT}public/stt/models/`;

type Item = { id: string; target: string; should: boolean; kind: string; voice: string; said: string };
const items: Item[] = JSON.parse(readFileSync(`${SET}/set.json`, 'utf8'));
const W = new Map<string, { alts: string[]; rivals: string[] }>();
for (const w of JSON.parse(readFileSync(`${ROOT}src/data/words.json`, 'utf8')).words) if (w.m) W.set(w.w, w);
const pipe: any = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: 'cpu' });
const heardOk = (t: string, h: string) => scoreReading(t, h).ok || scoreReading(t, h.replace(/\s+/g, '')).ok;

const res: any[] = [];
let t = 0;
for (const [i, it] of items.entries()) {
  const audio = new Float32Array(readFileSync(`${SET}/${it.id}.f32`).buffer.slice(0));
  const w = W.get(it.target)!;
  const t0 = performance.now();
  const r = await checkReading(pipe, audio, it.target, w.alts, w.rivals, { ...RULE, freeOnsets: '' });
  const ms = performance.now() - t0; t += ms;
  res.push({ ...it, ...r, base: heardOk(it.target, r.text), ms: Math.round(ms) });
  if (i % 100 === 0) console.log(i, it.id, JSON.stringify(r.text), r.ok, r.gap, r.rgap, `${ms.toFixed(0)} ms`);
}
writeFileSync(OUT, JSON.stringify(res));
console.log(`${MODEL}: ${(t / items.length).toFixed(0)} ms/clip`);
