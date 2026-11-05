import './style.css';
import wordData from './data/words.json';
import { sfx, startMusic, unlock, voiceLevel } from './core/audio';
import { applyLang, onLang } from './core/lang';
import { micTest } from './core/mic';
import { isTalking, onTalk, said, say } from './core/speech';
import { sttPreload, sttState } from './core/stt';
import { Game } from './game/game';
import { SpinHint } from './game/spinhint';
import { Stage } from './game/stage';
import { Tower, type WordInfo } from './game/tower';
import { Confetti } from './ui/confetti';
import { Fox } from './ui/fox';
import { Hud } from './ui/hud';
import { Title } from './ui/title';
import { Picker } from './ui/picker';
import { twinkle } from './ui/twinkle';
import { cornerControls } from './ui/corner';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const params = new URLSearchParams(location.search);
const WORDS = (wordData as { words: WordInfo[] }).words;

async function loadFonts() {
  const base = new URL('./fonts/', location.href).href;
  const faces = [
    new FontFace('Baloo', `url(${base}Baloo2.woff2) format('woff2')`, { weight: '400 800' }),
    new FontFace('ECP', `url(${base}NotoSans_ECP-Bold.ttf) format('truetype')`, { weight: '700' }),
    // Korean screen words + the fox's Korean bubble (core/lang.ts): Jua, cut to the syllables the game uses
    // (tools/make_ko_font.py); Baloo has no Hangul, so the browser takes these glyphs from here
    new FontFace('Jua', `url(${base}Jua-ko.woff2) format('woff2')`, { weight: '400 900', unicodeRange: 'U+1100-11FF, U+3130-318F, U+AC00-D7A3' }),
  ];
  await Promise.all(faces.map(async (f) => { try { document.fonts.add(await f.load()); } catch (e) { console.warn('font', e); } }));
}

/** The intro film plays before the title only when there is one (public/intro.mp4 — to be made from the finished
 *  title and game screens). Without it the game opens on the title. */
async function hasIntro() {
  if (params.has('nointro')) return false;
  try {
    const r = await fetch(new URL('./intro.mp4', location.href), { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('video');
  } catch { return false; }
}

function playIntro(hud: Hud, done: () => void) {
  const box = $('#intro'), v = $<HTMLVideoElement>('#introVideo'), skip = $('#introSkip');
  let over = false;
  const finish = () => { if (over) return; over = true; v.pause(); done(); };
  hud.screen('intro');
  v.src = new URL('./intro.mp4', location.href).href;
  v.addEventListener('ended', finish);
  v.addEventListener('error', finish);
  setTimeout(() => box.classList.add('skippable'), 1200);
  skip.addEventListener('click', (e) => { e.stopPropagation(); unlock(); sfx('tap'); finish(); });
  // autoplay with sound is often blocked: play muted, and the first tap turns the sound on
  box.addEventListener('pointerdown', () => { unlock(); if (v.muted) { v.muted = false; } });
  v.play().catch(() => { v.muted = true; v.play().catch(finish); });
}

async function boot() {
  const intro = hasIntro();
  applyLang();                     // the language kept on this device (EN | 한 toggle, core/lang.ts)
  await loadFonts();
  const hud = new Hud();
  const stage = new Stage($('#stage'));
  stage.bg = $('.sky'); stage.resize();
  // the game screen: a closer view and a light on the tower (user: "젠가에 좀 집중이 되게 하고싶어") — on and off with
  // the screen
  new MutationObserver(() => stage.setGameView(hud.app.dataset.screen === 'game'))
    .observe(hud.app, { attributes: true, attributeFilter: ['data-screen'] });
  twinkle($('.sky'));
  const tower = new Tower(stage);
  const spin = new SpinHint(stage, $('#swipe'));
  hud.onSwipe = (on) => spin.show(on);
  const fox = new Fox($('#fox'));
  fox.level = voiceLevel;          // lip sync fallback for clips without mouth cues (src/data/mouth.json)
  const confetti = new Confetti($<HTMLCanvasElement>('#fx'));
  onTalk((on) => fox.onTalk(on));
  void fox.load();

  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  const game = new Game(stage, tower, hud, fox, confetti, WORDS, seed);
  // switching EN | 한 while a player is looking for a block: the fox calls the turn again in the new language
  onLang(() => { if (game.state === 'choose' && !isTalking()) void say([game.turn ? 't:turn2' : 't:turn1']); });
  game.test.fake = params.has('fake');
  game.forceM = (params.get('m') ?? '').split(',').filter(Boolean);
  game.buildTower(false);
  // the title screen (the game's tower with the logo and START over it, blocks lying on the table, the fox waving)
  const title = new Title(hud.app, stage, tower, fox, confetti);
  game.onTitle = () => title.enter();
  // START → Player 1 and Player 2 pick their animals → the game (?nopick: straight in, for the QA scripts)
  const picker = new Picker(hud.app, fox);
  // the corner bar (sound, exit) is on the title and in the game: in a game, exit goes back to the title
  cornerControls({ leave: () => { picker.close(); hud.hideResult(); game.toTitle(); } });

  const go = () => { sfx('start'); void game.start(); };
  const begin = async () => {
    unlock();
    sttPreload();
    void startMusic();
    if (params.has('nopick')) { go(); return; }
    if (picker.open) return;
    sfx('tap');
    const p = await picker.pick();
    if (!p || hud.app.dataset.screen !== 'title') return;
    game.animals = p;
    go();
  };
  $('#btnStart').addEventListener('click', () => { void begin(); });
  hud.onAgain = () => { hud.hideResult(); void game.start(); };
  hud.onResultHome = () => { hud.hideResult(); game.toTitle(); };

  const toTitle = () => {
    hud.screen('title'); title.enter(); fox.gesture('talk', 1800);
    // where the browser lets sound start without a touch (an installed app, a kiosk, a skipped intro film), greet now
    const c = unlock();
    if (c.state === 'running') hello();
    else void c.resume().then(() => { if (c.state === 'running') hello(); }).catch(() => {});
  };
  // Title sound (user: "첫화면과 게임에 들어갈 배경음악 · 튜터의 인사말"): the music and the fox's hello start with the
  // first touch on the title — browsers keep sound off until then. A first touch on START goes straight to the game's
  // own welcome and how-to instead. The music then plays on through the game.
  let greeted = false;
  function hello() {
    if (greeted || hud.app.dataset.screen !== 'title') return;
    greeted = true;
    void startMusic();
    fox.speakAs('talk');
    void say(['t:hello', 0.4, 't:pressstart']);
  }
  const firstTouch = (e: Event) => {
    window.removeEventListener('pointerdown', firstTouch, true);
    window.removeEventListener('keydown', firstTouch, true);
    unlock();
    if ((e.target as Element | null)?.closest?.('#btnStart')) { greeted = true; return; }
    if ((e.target as Element | null)?.closest?.('#btnExit')) return;     // leaving: no hello
    hello();
  };
  window.addEventListener('pointerdown', firstTouch, true);
  window.addEventListener('keydown', firstTouch, true);
  if (await intro) playIntro(hud, toTitle); else toTitle();

  // test / debug hooks
  Object.assign(window, { __pj: { game, tower, stage, hud, fox, confetti, say, said, sttState, begin, micTest, voiceLevel } });
}

void boot();
