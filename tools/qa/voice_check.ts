// Read-back check of the word clips: does a recogniser hear each clip as its word, and is there nothing else in it?
// usage: STT_MODEL=onnx-community/whisper-base.en STT_MODELS_DIR=<dir>/ node tools/qa/voice_check.ts [list.json]
//   list.json = [{ "file": "/abs/x.mp3", "target": "mad" }, ...]; default = every w: clip in src/data/voice.json
// prints one line per clip (✗ = not heard as the word or longer than 1.4 s of sound) and writes the result to stdout JSON
// at the end (last line) so tools/build_voice.py can parse it.
import { env, pipeline } from '@huggingface/transformers';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MODEL = process.env.STT_MODEL ?? 'onnx-community/whisper-tiny.en';
env.allowRemoteModels = false;
env.localModelPath = process.env.STT_MODELS_DIR ?? `${ROOT}public/stt/models/`;

type Item = { file: string; target: string; start?: number; dur?: number };
let items: Item[];
if (process.argv[2]) items = JSON.parse(readFileSync(process.argv[2], 'utf8'));
else {
  const clips: Record<string, [string, number, number, number]> = JSON.parse(readFileSync(`${ROOT}src/data/voice.json`, 'utf8')).clips;
  items = Object.entries(clips).filter(([k]) => k.startsWith('w:')).map(([k, v]) => ({ file: `${ROOT}public/voice/${v[0]}`, target: k.slice(2), start: v[1], dur: v[3] }));
}
const ALTS: Record<string, string[]> = {};
for (const w of JSON.parse(readFileSync(`${ROOT}src/data/words.json`, 'utf8')).words) ALTS[w.w] = w.alts ?? [];
// words that sound the same: the recogniser can't tell them apart from the sound alone
const SAME: Record<string, string[]> = { sun: ['son'], meat: ['meet'], mail: ['male'], my: ['mi', 'mai'], mitt: ['mit'], mom: ['mum', 'mam'], nap: ['knap'],
  lake: ['leak'], mop: ['mob'], mad: ['madd'], tail: ['tale'], hop: [], rug: [], van: [], bug: [], kit: [], cap: [], mat: ['matt'], mess: [], met: ['mett'] };
const NUM: Record<string, string> = { '6': 'six', '10': 'ten', '1': 'one', '2': 'two' };
const norm = (s: string) => (NUM[s.replace(/[^0-9]/g, '')] ?? s).toLowerCase().replace(/[^a-z]/g, '');
/** 1 = same letters (for tutor lines) */
function similar(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(1, a.length, b.length);
}

const pipe: any = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: 'cpu' });
const out: { target: string; file: string; text: string; ok: boolean; sound: number }[] = [];
for (const it of items) {
  const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', it.file, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 26 }).stdout as Buffer;
  let a = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
  if (it.start != null) a = a.slice(Math.round(it.start * 16000), it.dur != null ? Math.round((it.start + it.dur) * 16000) : undefined);
  // seconds of sound (20 ms frames above 3% of the loudest frame)
  const F = 320; let peak = 0; const rms: number[] = [];
  for (let i = 0; i + F <= a.length; i += F) { let s = 0; for (let j = i; j < i + F; j++) s += a[j] * a[j]; const r = Math.sqrt(s / F); rms.push(r); peak = Math.max(peak, r); }
  const on = rms.map((r) => r > peak * 0.03); const first = on.indexOf(true), last = on.lastIndexOf(true);
  const sound = first < 0 ? 0 : (last - first + 1) * 0.02;
  // 0.4 s of quiet around the clip: whisper flips on bare 0.3 s words ("hat" → "Hah!") but not with a little room
  const pad = new Float32Array(a.length + 12800); pad.set(a, 6400);
  const r = await pipe(pad, { language: undefined });
  const text = String(r.text ?? '').trim();
  const words = text.split(/\s+/).map(norm).filter(Boolean);
  const line = /\s/.test(it.target.trim());          // a tutor line: close enough, any length
  const good = new Set([norm(it.target), ...(ALTS[it.target] ?? []).map(norm), ...(SAME[it.target] ?? [])]);
  const ok = line ? similar(norm(it.target), words.join('')) >= 0.75
    : words.length === 1 && good.has(words[0]) || (words.length === 2 && good.has(words.join('')));
  const long = !line && sound > 1.4;
  out.push({ target: it.target, file: it.file, text, ok: ok && !long, sound: +sound.toFixed(2) });
  console.log(`${ok && !long ? '  ' : '✗ '}${it.target.padEnd(10)} ${sound.toFixed(2)}s  ${JSON.stringify(text)}`);
}
console.log(`${out.filter((o) => o.ok).length}/${out.length} ok`);
console.log(JSON.stringify(out));
