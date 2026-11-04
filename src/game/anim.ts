// Small animation helpers driven by the stage clock (so everything pauses/steps together).
import type { Stage } from './stage';

export const ease = {
  linear: (k: number) => k,
  inOut: (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  out: (k: number) => 1 - Math.pow(1 - k, 3),
  in: (k: number) => k * k * k,
  back: (k: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
};

export function animate(stage: Stage, dur: number, f: (k: number, t: number) => void, e: (k: number) => number = ease.inOut): Promise<void> {
  return new Promise((res) => {
    let t = 0;
    f(e(0), 0);
    const off = stage.tick((dt) => {
      t += dt;
      const k = Math.min(1, t / dur);
      f(e(k), t);
      if (k >= 1) { off(); res(); }
    });
  });
}

/** seeded PRNG (mulberry32) — tests pass ?seed= to get the same tower */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(a: T[], r: () => number) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
