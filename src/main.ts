import './style.css';
import wordData from './data/words.json';
import { sfx, startMusic, unlock } from './core/audio';
import { micTest } from './core/mic';
import { onTalk, say } from './core/speech';
import { sttPreload, sttState } from './core/stt';
import { Game } from './game/game';
import { rng } from './game/anim';
import { Stage } from './game/stage';
import { Tower, type WordInfo } from './game/tower';
import { Confetti } from './ui/confetti';
import { Fox } from './ui/fox';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const params = new URLSearchParams(location.search);
const WORDS = (wordData as { words: WordInfo[] }).words;

async function loadFonts() {
  const base = new URL('./fonts/', location.href).href;
  const faces = [
    new FontFace('Baloo', `url(${base}Baloo2.woff2) format('woff2')`, { weight: '400 800' }),
    new FontFace('ECP', `url(${base}NotoSans_ECP-Bold.ttf) format('truetype')`, { weight: '700' }),
  ];
  await Promise.all(faces.map(async (f) => { try { document.fonts.add(await f.load()); } catch (e) { console.warn('font', e); } }));
}

function playIntro(hud: Hud, done: () => void) {
  const box = $('#intro'), v = $<HTMLVideoElement>('#introVideo'), skip = $('#introSkip');
  let over = false;
  const finish = () => { if (over) return; over = true; v.pause(); done(); };
  if (params.has('nointro')) { finish(); return; }
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
  await loadFonts();
  const hud = new Hud();
  const stage = new Stage($('#stage'));
  const tower = new Tower(stage);
  const fox = new Fox($('#fox'));
  const confetti = new Confetti($<HTMLCanvasElement>('#fx'));
  onTalk((on) => fox.onTalk(on));
  void fox.load();

  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  const game = new Game(stage, tower, hud, fox, confetti, WORDS, seed);
  game.test.fake = params.has('fake');
  tower.build(WORDS, rng(seed ?? 20261104));

  // title & intro: the tower turns slowly on its table
  stage.tick((dt) => { const s = hud.app.dataset.screen; if (s === 'title' || s === 'intro') stage.rig.az += dt * 0.16; });

  const begin = () => {
    unlock(); sfx('start');
    sttPreload();
    void startMusic();
    void game.start();
  };
  $('#btnStart').addEventListener('click', begin);
  hud.onHome = () => game.toTitle();
  hud.onAgain = () => { hud.hideResult(); void game.start(); };
  hud.onResultHome = () => { hud.hideResult(); game.toTitle(); };

  playIntro(hud, () => {
    hud.screen('title');
    fox.gesture('talk', 1800);
  });

  // test / debug hooks
  Object.assign(window, { __pj: { game, tower, stage, hud, fox, confetti, say, sttState, begin, micTest } });
}

void boot();
