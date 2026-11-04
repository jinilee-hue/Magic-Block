// "Did the child read THIS word?" on top of whisper (transformers.js), for one short word.
// Free transcription alone is a poor judge here: tiny.en writes the commonest word it can ("mad" → "Math!",
// "mug" → "Month!") and passed only 46% of correct readings in tools/qa (Korean-accented voices 7%), while it let
// "cap" pass for "map". So the recogniser is also asked how well the audio fits the target itself (forced decoding of
// " Map." etc.), compared with
//   (a) its own transcript:                    gap  = log P(transcript) - log P(target)   → the audio is this word
//   (b) the word with another first sound:     rgap = log P(best rival) - log P(target)   → it starts with /m/
//   (c) nothing:                               sT   = log P(target) must not be tiny      → not a cough or chatter
//   (d) whisper's own no-speech guess must be low (music / noise: ≥ 0.44; accepted readings: 99% under 0.34)
// Rivals starting with b are not held against the child: a Korean speaker's word-initial m is often half a b
// (denasalised), and it is the same lip sound. Thresholds from tools/qa/stt_grid.py (28 words × 7 voices × 4 rooms):
// correct readings 89% per try (child / adult English voices 89-99%, strongly Korean-accented 74-87%) vs 46% for the
// transcript alone; the same word with another first sound passes 11-13%, other words 4%, Korean chatter 9%,
// music / noise 0%. Leaning to "pass": after 3 real tries the turn passes anyway ("Good try!").
// whisper-base.en (77 MB vs 41 MB) did no better on this set.
//
// Speed: the audio is encoded once; one decoder pass for the prompt caches the audio side, the free transcript is a
// greedy decode on that cache, and each candidate word costs ONE more short pass (its ".", "!", end-of-text endings
// all come from the same next-token distribution).
import { Tensor } from '@huggingface/transformers';
import { exactReading } from './readCheck.ts';

export const RULE = { gap: 8, rgap: 2, minT: -10, maxNo: 0.5, freeOnsets: 'b' };

/** the parts of a transformers.js ASR pipeline this needs */
export interface AsrParts {
  model: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  tokenizer: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  processor: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export interface Reading {
  text: string; ok: boolean; exact: boolean; gap: number; rgap: number; rival: string; sT: number; sFree: number
  /** probability that there was no speech at all (whisper's own detector) */
  pNo: number
  rv: Record<string, number>
}

type Logits = { dims: number[]; data: Float32Array };
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const ids = (a: number[]) => new Tensor('int64', BigInt64Array.from(a.map((x) => BigInt(x))), [1, a.length]);
const lse2 = (xs: number[]) => { const m = Math.max(...xs); return m === -Infinity ? m : m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0)); };

/** log-softmax row `pos` of a [1, L, V] logits tensor, as a function of the token */
function row(l: Logits, pos: number) {
  const V = l.dims[2]!; const r = l.data.subarray(pos * V, (pos + 1) * V);
  let m = -Infinity; for (let k = 0; k < V; k++) if (r[k]! > m) m = r[k]!;
  let z = 0; for (let k = 0; k < V; k++) z += Math.exp(r[k]! - m);
  const c = m + Math.log(z);
  return { lp: (tok: number) => r[tok]! - c, r, c };
}

const special = new WeakMap<object, { SOT: number; NOTS: number; EOT: number; NO: number; ends: number[]; suppress: Set<number>; begin: Set<number> }>();
function tokensOf(p: AsrParts) {
  let s = special.get(p.model);
  if (s) return s;
  const gc = p.model.generation_config ?? {};
  const T0 = 50000; // special tokens live above the text vocabulary
  const one = (t: string) => p.tokenizer.encode(t, { add_special_tokens: false })[0] as number;
  const id = (t: string) => {
    const v = p.tokenizer.model?.tokens_to_ids?.get?.(t) ?? p.tokenizer.convert_tokens_to_ids?.([t])?.[0];
    return typeof v === 'number' && v > T0 ? v : -1;
  };
  s = {
    SOT: gc.decoder_start_token_id ?? 50257,
    NOTS: gc.no_timestamps_token_id ?? 50362,
    EOT: Array.isArray(gc.eos_token_id) ? gc.eos_token_id[0] : gc.eos_token_id ?? 50256,
    NO: Math.max(id('<|nospeech|>'), id('<|nocaptions|>')),
    ends: ['.', '!', '?'].map(one),
    suppress: new Set<number>(gc.suppress_tokens ?? []),
    begin: new Set<number>(gc.begin_suppress_tokens ?? [220]),
  };
  special.set(p.model, s);
  return s;
}

export async function checkReading(p: AsrParts, audio: Float32Array, target: string, alts: string[], rivals: string[], rule = RULE): Promise<Reading> {
  const T = tokensOf(p);
  const feats = (await p.processor(audio)).input_features;
  const enc = (await p.model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: feats, model_inputs: { input_features: feats }, model_input_name: 'input_features', generation_config: { guidance_scale: null },
  })).encoder_outputs;
  const pastOf = (o: Record<string, unknown>) => { const r: Record<string, unknown> = {}; for (const k in o) if (k.startsWith('present')) r[k.replace('present', 'past_key_values')] = o[k]; return r; };
  const step = (toks: number[], past: Record<string, unknown>) => p.model.forward({ encoder_outputs: enc, decoder_input_ids: ids(toks), past_key_values: past });

  // the prompt: whisper's no-speech guess (after start-of-transcript) and the first-word distribution (after no-timestamps)
  const pre = await p.model.forward({ encoder_outputs: enc, decoder_input_ids: ids([T.SOT, T.NOTS]) });
  const past0 = pastOf(pre);
  const pNo = T.NO >= 0 ? Math.exp(row(pre.logits, 0).lp(T.NO)) : 0;
  const first = row(pre.logits, 1);

  // free transcript: greedy, like the pipeline (no leading blank / end at the start, no special tokens)
  const out: number[] = [];
  let sFree = 0, cur = first, past = past0;
  for (let k = 0; k < 20; k++) {
    const banned = (t: number) => (k === 0 && T.begin.has(t)) || (t !== T.EOT && (t >= T.SOT || T.suppress.has(t)));
    let best = -1, bv = -Infinity;
    for (let t = 0; t < cur.r.length; t++) if (cur.r[t]! > bv && !banned(t)) { bv = cur.r[t]!; best = t; }
    sFree += cur.lp(best);
    if (best === T.EOT || best < 0) break;
    out.push(best);
    const o = await step([best], past);
    past = pastOf(o); cur = row(o.logits, 0);
  }
  const text = String(p.tokenizer.decode(out, { skip_special_tokens: true }) ?? '').trim();

  // log P(" Word" + one of . ! ? or nothing, then the end | audio): one short pass per word
  const word = async (w: string) => {
    const t: number[] = p.tokenizer.encode(` ${cap(w)}`, { add_special_tokens: false });
    const o = await step([...t, T.ends[0]!], past0);
    let s = first.lp(t[0]!);
    for (let i = 0; i + 1 < t.length; i++) s += row(o.logits, i).lp(t[i + 1]!);
    const end = row(o.logits, t.length - 1), afterDot = row(o.logits, t.length).lp(T.EOT);
    return s + lse2([...T.ends.map((e) => end.lp(e) + afterDot), end.lp(T.EOT)]);
  };
  const ws: number[] = [];
  for (const w of [target, ...alts]) ws.push(await word(w));
  const sT = lse2(ws);
  let best = -Infinity, rival = '';
  const rv: Record<string, number> = {};
  for (const r of rivals) {
    if (rule.freeOnsets.includes(r[0]!)) continue;
    const s = await word(r);
    rv[r] = +s.toFixed(2);
    if (s > best) { best = s; rival = r; }
  }
  const exact = exactReading(target, text);
  const gap = sFree - sT, rgap = rival ? best - sT : -99;
  const ok = exact || (gap < rule.gap && rgap < rule.rgap && sT > rule.minT && pNo < rule.maxNo);
  return { text, ok, exact, gap: +gap.toFixed(2), rgap: +rgap.toFixed(2), rival, sT: +sT.toFixed(2), sFree: +sFree.toFixed(2), pNo: +pNo.toFixed(3), rv };
}
