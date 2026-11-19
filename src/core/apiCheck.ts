// The read check on the company phonics-api (phonics-kit, 2026-11-19 rule for every phonics game): with a key on this
// device (the title's key button), the reading goes once to /v1/speech/analyze (Wav2Vec2 on the company server, the
// audio is not stored) and PhonicsAPI.judge compares the phonemes it heard with the word and its rivals — the same word
// with another first sound (words.json). Rivals starting with b are not held against the child, as in sttCheck.ts: a
// Korean speaker's word-initial m is often half a b. null = no answer (no key, offline, busy, timeout) → whisper judges.
import '../vendor/phonics-api.js';
import PH from '../data/phonemes.json';
import type { WordInfo } from '../game/tower';

const table = PH as Record<string, string[]>;

export interface ApiReading { verdict: PhonicsJudge['verdict']; heard: string; d: Record<string, number>; ms: number }

export async function apiCheck(pcm16k: Float32Array, word: WordInfo): Promise<ApiReading | null> {
  const PA = window.PhonicsAPI;
  if (!PA || !PA.usable() || !table[word.w]) return null;
  const r = await PA.analyze(PA.encodeWav(pcm16k, 16000), word.w);
  if (!r.ok) return null;
  const rivals = (word.rivals ?? []).filter((w) => !w.startsWith('b'));
  const j = PA.judge(r.data, word.w, rivals, table);
  return { verdict: j.verdict, heard: j.heard, d: j.d, ms: r.ms ?? 0 };
}
