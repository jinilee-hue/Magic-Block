// Language of the fox and the screen (user: "게임화면에 영어와 한국어 선택할수 있는 버튼 넣어야해" → the fox's voice,
// its speech bubble and the screen's words all switch; the word blocks, word sounds and letter sounds stay English).
// The EN | 한 toggle sits in the corner bar (next to sound and exit) on the game screen; the choice is kept on the device and also applies to the
// title and the animal pick. Voice: core/audio.ts plays 'k:<line>' for 't:<line>' in Korean (tools/build_voice.py);
// bubble text: voice.json `lines` / `lines_ko`; screen words: UI below, put on elements with data-i18n / data-i18n-aria.
export type Lang = 'en' | 'ko';

const KEY = 'pj.lang.v1';
let cur: Lang = (() => { try { return localStorage.getItem(KEY) === 'ko' ? 'ko' : 'en'; } catch { return 'en'; } })();
const subs: ((l: Lang) => void)[] = [];

const UI: Record<Lang, Record<string, string>> = {
  en: {
    p1: 'Player 1', p2: 'Player 2', player: 'Player {n}',
    bunny: 'Bunny', kitty: 'Kitty', puppy: 'Puppy', panda: 'Panda',
    again: 'Play Again', home: 'Home', music: 'Music', sounds: 'Sounds', skip: 'SKIP',
    a_back: 'Back', a_exit: 'Exit', a_home: 'Home', a_said: 'I said it', a_listen: 'Listen again', a_say: 'Say the word',
    a_settings: 'Settings', a_start: 'Start', a_left: 'Turn left', a_right: 'Turn right', a_volume: 'Volume', a_reset: 'Back to the start view',
    a_strikes: 'Wrong blocks', a_lang: 'Language: English or Korean',
    pick_reset: 'Pick Again', pick_start: 'Start Game', ready: 'Ready?',
  },
  ko: {
    p1: '플레이어 1', p2: '플레이어 2', player: '플레이어 {n}',
    bunny: '토끼', kitty: '고양이', puppy: '강아지', panda: '판다',
    again: '다시 하기', home: '처음으로', music: '음악', sounds: '효과음', skip: '건너뛰기',
    a_back: '뒤로', a_exit: '나가기', a_home: '처음으로', a_said: '다 읽었어요', a_listen: '다시 듣기', a_say: '단어 읽기',
    a_settings: '설정', a_start: '시작', a_left: '왼쪽으로 돌리기', a_right: '오른쪽으로 돌리기', a_volume: '소리 크기', a_reset: '처음 방향으로',
    a_strikes: '틀린 블럭', a_lang: '언어: 영어 또는 한국어',
    pick_reset: '다시 선택', pick_start: '게임시작', ready: '준비됐니?',
  },
};

export const lang = () => cur;

/** a screen word in the current language ({n} → vars.n) */
export function t(key: string, vars: Record<string, string | number> = {}) {
  const s = UI[cur][key] ?? UI.en[key] ?? key;
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
