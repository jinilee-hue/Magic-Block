// Offline speech-check evaluation (Node, same whisper-tiny.en q8 files the game ships).
// usage: node tools/qa/stt_eval.ts [set_dir] [out.json]
// For every clip: free transcription (what the game does now) + forced scores: log P(" Map.") etc. given the audio.
import { env, pipeline, Tensor } from '@huggingface/transformers';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scoreReading } from '../../src/core/readCheck.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SET = process.argv[2] ?? '/Users/jini/.hermes/cache/scratch/jenga/sttset';
const OUT = process.argv[3] ?? '/Users/jini/.hermes/cache/scratch/jenga/stt_eval.json';
const MODEL = process.env.STT_MODEL ?? 'onnx-community/whisper-tiny.en';
env.allowRemoteModels = false;
env.localModelPath = process.env.STT_MODELS_DIR ?? `${ROOT}public/stt/models/`;

type Item = { id: string; target: string; should: boolean; kind: string; voice: string; said: string };
const items: Item[] = JSON.parse(readFileSync(`${SET}/set.json`, 'utf8'));
const pipe: any = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: 'cpu' });
const { model, tokenizer, processor } = pipe;
const SOT = 50257, NOTS = 50362, EOT = 50256;

const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);
const forms = (w: string) => [` ${cap(w)}.`, ` ${cap(w)}!`, ` ${cap(w)}`, ` ${w}.`, ` ${cap(w)}?`];
const lse = (xs: number[]) => { const m = Math.max(...xs); return m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0)); };

async function encode(audio: Float32Array) {
  const feats = await processor(audio);
  const mi = await model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: feats.input_features, model_inputs: { input_features: feats.input_features },
    model_input_name: 'input_features', generation_config: { guidance_scale: null },
  });
  return { feats, enc: mi.encoder_outputs };
}

/** log P(text tokens + end | audio) */
async function score(enc: any, text: string) {
  const ids: number[] = [SOT, NOTS, ...tokenizer.encode(text, { add_special_tokens: false }), EOT];
  const inp = new Tensor('int64', BigInt64Array.from(ids.slice(0, -1).map(BigInt)), [1, ids.length - 1]);
  const out = await model.forward({ encoder_outputs: enc, decoder_input_ids: inp });
  const [, L, V] = out.logits.dims; const d = out.logits.data as Float32Array;
  let s = 0;
  for (let i = 1; i < L; i++) {                         // position i predicts ids[i + 1]
    const row = d.subarray(i * V, (i + 1) * V);
    let m = -Infinity; for (let k = 0; k < V; k++) if (row[k]! > m) m = row[k]!;
    let z = 0; for (let k = 0; k < V; k++) z += Math.exp(row[k]! - m);
    s += row[ids[i + 1]!]! - m - Math.log(z);
  }
  return s;
}

const heardOk = (t: string, h: string) => scoreReading(t, h).ok || scoreReading(t, h.replace(/\s+/g, '')).ok;
const ONSETS = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'n', 'p', 'r', 's', 't', 'w', 'y'];
const DICT = new Set(readFileSync('/usr/share/dict/words', 'utf8').split('\n').map((w) => w.trim()).filter((w) => w && w === w.toLowerCase()));
const rivals = (w: string) => [...new Set(ONSETS.map((c) => c + w.slice(1)).filter((x) => x !== w && DICT.has(x)))];

const res: any[] = [];
let tFree = 0, tForce = 0, nForce = 0;
for (const [i, it] of items.entries()) {
  const audio = new Float32Array(readFileSync(`${SET}/${it.id}.f32`).buffer.slice(0));
  let t0 = performance.now();
  const out = await pipe(audio);
  const text = String(out.text ?? '').trim();
  tFree += performance.now() - t0;
  t0 = performance.now();
  const { enc } = await encode(audio);
  const sT = lse(await Promise.all(forms(it.target).map((f) => score(enc, f))));
  const sFree = await score(enc, text ? ` ${text}` : '');
  const rv: Record<string, number> = {};
  for (const r of rivals(it.target)) rv[r] = lse(await Promise.all(forms(r).slice(0, 3).map((f) => score(enc, f))));
  nForce += 1 + forms(it.target).length + Object.keys(rv).length * 3;
  tForce += performance.now() - t0;
  res.push({ ...it, text, base: heardOk(it.target, text), sT, sFree, rv });
  if (i % 100 === 0) console.log(i, it.id, JSON.stringify(text), heardOk(it.target, text), sT.toFixed(2), sFree.toFixed(2));
}
writeFileSync(OUT, JSON.stringify(res));
console.log(`free decode ${(tFree / items.length).toFixed(0)} ms/clip · forced ${(tForce / nForce).toFixed(1)} ms/pass (${(nForce / items.length).toFixed(1)} passes/clip)`);
