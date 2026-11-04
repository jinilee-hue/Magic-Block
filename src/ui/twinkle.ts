// The painted sparkle lights of the playroom (warm dust motes floating in the window's sunbeam; positions in
// src/data/sparkles.json come from tools/find_sparkles.py) twinkle forever: each one flares up on its own slow beat,
// the bigger ones with a little star. They live inside the background element, so they follow its cover crop and
// the camera zoom. CSS: .twinkles in style.css (hidden with prefers-reduced-motion).
import SPOTS from '../data/sparkles.json';
import { BG } from '../game/stage';

export function twinkle(sky: HTMLElement) {
  const box = document.createElement('div');
  box.className = 'twinkles';
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [x, y, r] of SPOTS as number[][]) {
    const i = document.createElement('i');
    if (r >= 2.6) i.className = 'star';
    const st = i.style;
    st.left = `${((x / BG.w) * 100).toFixed(3)}%`;
    st.top = `${((y / BG.h) * 100).toFixed(3)}%`;
    st.setProperty('--d', Math.max(18, r * 9).toFixed(1));
    st.setProperty('--t', `${(2.6 + rnd() * 3.4).toFixed(2)}s`);
    st.setProperty('--dl', `${(-rnd() * 6).toFixed(2)}s`);
    st.setProperty('--a', (0.6 + rnd() * 0.4).toFixed(2));
    box.appendChild(i);
  }
  sky.appendChild(box);
  // the picture's box under background-size: cover (centred), like stage.ts places the table
  const fit = () => {
    const w = sky.clientWidth, h = sky.clientHeight, s = Math.max(w / BG.w, h / BG.h);
    box.style.cssText = `left:${((w - BG.w * s) / 2).toFixed(1)}px;top:${((h - BG.h * s) / 2).toFixed(1)}px;` +
      `width:${(BG.w * s).toFixed(1)}px;height:${(BG.h * s).toFixed(1)}px;--k:${s.toFixed(4)}`;
  };
  window.addEventListener('resize', fit);
  fit();
}
