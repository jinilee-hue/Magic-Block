// The fox's voice: a line is a list of clip keys ('t:welcome', 'w:map', 's:m') and pauses (seconds), played back to
// back. One speaker at a time: a new line cuts the old one. Listeners (the fox sprite) hear when talking starts/stops.
import { audioCtx, duck, hasClip, loadClip, playClip, type Playing } from './audio';

export type Part = string | number;
type Listener = (talking: boolean) => void;

let token = 0;
let playing: Playing[] = [];
let talking = false;
const listeners: Listener[] = [];
/** the last lines played (clip keys, for tests via window.__pj.said) */
export const said: string[] = [];
export const onTalk = (f: Listener) => { listeners.push(f); };
export const isTalking = () => talking;
function emit(on: boolean) { if (talking === on) return; talking = on; duck(on); listeners.forEach((f) => f(on)); }

/** Play a line. Resolves true when it finished, false if something cut it. */
export async function say(parts: Part[]): Promise<boolean> {
  stopSpeech();
  const my = ++token;
  const keys = parts.filter((p): p is string => typeof p === 'string');
  for (const k of keys) if (!hasClip(k)) console.warn('speech: missing clip', k);
  await Promise.all(keys.filter(hasClip).map(loadClip));
  const ctx = audioCtx();
  if (my !== token || !ctx) return false;
  said.push(keys.join(' ')); if (said.length > 60) said.shift();
  let t = ctx.currentTime + 0.04;
  const mine: Playing[] = [];
  for (const p of parts) {
    if (typeof p === 'number') { t += p; continue; }
    const pl = await playClip(p, t);
    if (my !== token) { pl?.stop(); mine.forEach((m) => m.stop()); return false; }
    if (!pl) continue;
    mine.push(pl); t = pl.endAt + 0.07;
  }
  playing = mine;
  emit(true);
  const waitMs = Math.max(0, (t - ctx.currentTime) * 1000);
  await new Promise((r) => setTimeout(r, waitMs));
  if (my !== token) return false;
  playing = [];
  emit(false);
  return true;
}

export function stopSpeech() {
  token++;
  playing.forEach((p) => p.stop());
  playing = [];
  emit(false);
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
