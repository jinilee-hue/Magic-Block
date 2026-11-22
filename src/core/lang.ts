// Language of the fox (user: "게임화면에 영어와 한국어 선택할수 있는 버튼 넣어야해"; 2026-11-22 "화면 글자는 모두 영어로"):
// the EN | 한 toggle switches the fox's voice and its speech bubble only; every other screen word stays English in both
// (the word blocks, word sounds and letter sounds are English anyway). The toggle sits in the corner bar on the title
// only; a first visit starts in Korean and the choice is kept on the device. Voice: core/audio.ts plays 'k:<line>' for
// 't:<line>' in Korean (tools/build_voice.py); bubble text: voice.json `lines` / `lines_ko`; screen words: UI below,
// put on elements with data-i18n / data-i18n-aria.
export type Lang = 'en' | 'ko';

const KEY = 'pj.lang.v1';
let cur: Lang = (() => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'ko'; } catch { return 'ko'; } })();
const subs: ((l: Lang) => void)[] = [];

/** screen words — English in both languages */
const UI: Record<string, string> = {
  p1: 'Player 1', p2: 'Player 2', player: 'Player {n}',
  bunny: 'Bunny', kitty: 'Kitty', puppy: 'Puppy', panda: 'Panda',
  again: 'Play Again', home: 'Home', music: 'Music', sounds: 'Sounds', skip: 'SKIP',
  a_back: 'Back', a_exit: 'Exit', a_home: 'Home', a_listen: 'Listen again', a_say: 'Say the word',
  a_settings: 'Settings', a_start: 'Start', a_left: 'Turn left', a_right: 'Turn right', a_volume: 'Volume', a_reset: 'Back to the start view',
  a_strikes: 'Wrong blocks', a_lang: 'Language: English or Korean',
  pick_reset: 'Pick Again', pick_start: 'Start Game', ready: 'Ready?',
};

export const lang = () => cur;

/** a screen word ({n} → vars.n) */
export function t(key: string, vars: Record<string, string | number> = {}) {
  const s = UI[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** put the current language on every marked element (call once at start; setLang does it again) */
export function applyLang(root: ParentNode = document) {
  document.documentElement.lang = cur;
  document.documentElement.dataset.lang = cur;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((e) => e.setAttribute('aria-label', t(e.dataset.i18nAria!)));
}

export function setLang(l: Lang) {
  if (l === cur) return;
  cur = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  applyLang();
  subs.forEach((f) => f(l));
}

export const onLang = (f: (l: Lang) => void) => { subs.push(f); };
