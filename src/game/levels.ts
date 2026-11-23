// Game levels (phonics-kit README "공통 규칙: 레벨", user 2026-11-22): nobody picks one. START goes on at the level saved on
// this device (both players share it) and the end of a game sets the next one: up one after a game played well, the
// same after a middling one, down one after two poor games in a row. Each level is a little harder, the game's own way:
// a taller tower, the first letter's clue on the block ends fading out (launcher F9: the big letter on the ends let a
// child match the shape without reading), rhyme traps beside the m-blocks, fewer ✕.
import '../vendor/phonics-progress.js';
import { M_PER_GAME } from './tower';

/** the block ends: 'big' = the first letter alone, filling the end (as before levels); 'small' = the whole word, the first
 *  letter no bigger than the rest but still in the dark ink (the rest paler); 'word' = the whole word, no letter marked */
export type Ends = 'big' | 'small' | 'word';
export interface Level {
  /** layers × 3 blocks */
  layers: number;
  ends: Ends;
  /** the other words: every rhyme partner of the tower's m-words (pan/man, cap/map …), each next to its m-block */
  traps: boolean;
  /** wrong blocks a player may pick: the last one brings the tower down */
  strikes: number;
  /** m-words in the tower; the rest of the layers × 3 blocks are the other words (Unit 1's other lessons — a, s, t, p … —
   *  and the lesson pack's non-m words: a preview of the lessons to come) */
  m: number;
}
export const LEVELS: Level[] = [
  // never under the original 10 layers (user 2026-11-23: "블럭 갯수가 적어져서 그런지 좀 허전해 … 원래 갯수는 유지"):
  // level 1 has fewer m-words in the same 30 blocks, the other words fill the rest
  { layers: 10, m: 11, ends: 'big', traps: false, strikes: 3 },
  { layers: 10, m: 14, ends: 'big', traps: false, strikes: 3 },
  { layers: 10, m: 14, ends: 'small', traps: false, strikes: 3 },
  { layers: 11, m: 15, ends: 'small', traps: true, strikes: 3 },
  { layers: 12, m: 17, ends: 'word', traps: true, strikes: 3 },
  { layers: 12, m: 17, ends: 'word', traps: true, strikes: 2 },
];
/** m-words in a tower of this many layers (only for ?layers= tests; a level says its own `m`): the same share of the
 *  blocks as the 10-layer tower's 14 of 30 (10 → 14, 11 → 15, 12 → 17) */
export const mFor = (layers: number) => Math.round(layers * M_PER_GAME / 10);

/** a game played well (the tower didn't fall, ≥ 70 % of the pulled m-blocks read right), poorly (it fell, or < 40 %) */
export type Verdict = 'good' | 'ok' | 'poor';
export function verdict(toppled: boolean, read: number, pulled: number): Verdict {
  const rate = pulled ? read / pulled : 0;
  return toppled || rate < 0.4 ? 'poor' : rate >= 0.7 ? 'good' : 'ok';
}

const KEY = 'pj.level.v1';                  // { level, poor } — poor = poor games in a row
export interface LevelState { level: number; poor: number }
const clamp = (n: number) => Math.min(LEVELS.length, Math.max(1, Math.round(n) || 1));

export function loadLevel(): LevelState {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LevelState> | null;
    if (o && typeof o.level === 'number') return { level: clamp(o.level), poor: o.poor === 1 ? 1 : 0 };
  } catch { /* private mode */ }
  // nothing of its own yet: the shared progress record's level, if the launcher set one
  const lv = window.PhonicsProgress?.get('magic-block').level;
  return { level: typeof lv === 'number' ? clamp(lv) : 1, poor: 0 };
}

/** the level after a game: saved, and in the shared progress record when it changed */
export function nextLevel(s: LevelState, v: Verdict): LevelState {
  const n: LevelState = v === 'good' ? { level: clamp(s.level + 1), poor: 0 }
    : v === 'ok' ? { level: s.level, poor: 0 }
    : s.poor >= 1 ? { level: clamp(s.level - 1), poor: 0 } : { level: s.level, poor: 1 };
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ }
  if (n.level !== s.level) { try { window.PhonicsProgress?.setLevel('magic-block', n.level); } catch (e) { console.warn('progress', e); } }
  return n;
}
