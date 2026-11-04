// DOM layer: player cards, the fox's speech bubble, read-aloud mic, settings, rotate buttons, result book.
import { settings, setMusic, setSfx, sfx } from '../core/audio';
import type { Pastel, WordInfo } from '../game/tower';
import { FoxSay } from './foxsay';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
export interface Got { word: WordInfo; color: Pastel }
const CHIP_MAX = 8;

export class Hud {
  readonly app = $('#app');
  private cards = [$('#p1'), $('#p2')];
  /** each player's animal (symbol #ava-<id>) */
  private animals: [string, string] = ['bunny', 'kitty'];
  /** the fox's speech bubble (replaces the old "Player 1's Turn" banner) */
  readonly foxSay = new FoxSay($('#foxSay'));
  private read = $('#read');
  private mic = $('#btnMic');
  private thumb = $('#btnThumb');
  private listenBtn = $('#btnListen');
  private picCard = $('#picCard');
  private cardTimer = 0;
  private homeArmed = 0;
  onMic: () => void = () => {};
  onListen: () => void = () => {};
  onThumb: () => void = () => {};
  onHome: () => void = () => {};
  onRotate: (dir: number) => void = () => {};
  onAgain: () => void = () => {};
  onResultHome: () => void = () => {};
  onWord: (w: string) => void = () => {};

  constructor() {
    this.mic.addEventListener('click', () => this.onMic());
    this.listenBtn.addEventListener('click', () => { sfx('tap'); this.onListen(); });
    this.picCard.addEventListener('click', () => { sfx('tap'); this.onListen(); });
    this.thumb.addEventListener('click', () => { sfx('pop'); this.onThumb(); });
    $('#rotL').addEventListener('click', () => { sfx('tick'); this.onRotate(-1); });
    $('#rotR').addEventListener('click', () => { sfx('tick'); this.onRotate(1); });
    const home = $('#btnHome');
    home.addEventListener('click', () => {
      sfx('tap');
      if (performance.now() < this.homeArmed) { this.homeArmed = 0; home.classList.remove('armed'); this.onHome(); return; }
      this.homeArmed = performance.now() + 2600;
      home.classList.remove('armed'); void home.offsetWidth; home.classList.add('armed');
      setTimeout(() => { if (performance.now() >= this.homeArmed) home.classList.remove('armed'); }, 2700);
    });
    const panel = $('#settings');
    $('#btnSettings').addEventListener('click', (e) => { sfx('tap'); panel.hidden = !panel.hidden; e.stopPropagation(); this.syncToggles(); });
    document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target as Node) && !(e.target as HTMLElement).closest('#btnSettings')) panel.hidden = true; });
    panel.querySelectorAll<HTMLButtonElement>('.tog').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k as 'music' | 'sfx'; const on = !(settings[k]);
      if (k === 'music') setMusic(on); else setSfx(on);
      this.syncToggles(); sfx('tap');
    }));
    $('#btnAgain').addEventListener('click', () => { sfx('start'); this.onAgain(); });
    $('#btnResultHome').addEventListener('click', () => { sfx('tap'); this.onResultHome(); });
    this.syncToggles();
  }

  private syncToggles() {
    document.querySelectorAll<HTMLButtonElement>('#settings .tog').forEach((b) => b.setAttribute('aria-pressed', String(settings[b.dataset.k as 'music' | 'sfx'])));
  }

  screen(name: 'intro' | 'title' | 'game' | 'result') { this.app.dataset.screen = name; }
  busy(on: boolean) { this.app.classList.toggle('busy', on); if (on) this.foxSay.release(); }

  reset() {
    this.cards.forEach((c) => { c.querySelector('.num')!.textContent = '0'; c.querySelector('.chips')!.innerHTML = ''; });
    $('#result').hidden = true;
    this.showRead(false);
    this.showCard(null);
    this.foxSay.clear();
  }

  /** whose turn: their card lights up (the fox calls it, and its bubble keeps the call up — foxTurn) */
  setTurn(p: number, animate = true) {
    this.cards.forEach((c, i) => { c.classList.toggle('active', i === p); c.classList.toggle('idle', i !== p); });
    if (animate) { const a = this.cards[p].querySelector('.avatar')!; a.classList.remove('pop'); void (a as HTMLElement).offsetWidth; a.classList.add('pop'); }
  }
  /** a turn starts: the fox's "Player N, your turn!" bubble stays up until a block is picked */
  foxTurn(p: number) { this.foxSay.turn(p); }

  /** centre of a player's score (where collected blocks fly) in CSS px */
  cardTarget(p: number) {
    const r = this.cards[p].querySelector('.mini-block')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  addWord(p: number, got: Got[], n: number) {
    const card = this.cards[p];
    const num = card.querySelector('.num')!; num.textContent = String(n);
    const sc = card.querySelector('.pscore')!; sc.classList.remove('pop'); void (sc as HTMLElement).offsetWidth; sc.classList.add('pop');
    const chips = card.querySelector('.chips')!;
    chips.innerHTML = '';
    const show = got.slice(-CHIP_MAX);
    if (got.length > CHIP_MAX) { const more = document.createElement('span'); more.className = 'chip more'; more.textContent = `+${got.length - CHIP_MAX}`; chips.append(more); }
    show.forEach((g, i) => chips.append(chip(g, i === show.length - 1)));
  }

  // ── read aloud ─────────────────────────────────────────────────────────────────────────────────────────
  showRead(on: boolean) {
    this.read.hidden = !on;
    this.app.classList.toggle('reading', on);
    if (!on) this.read.className = 'read';
    this.thumb.hidden = true; this.mic.hidden = false;
    this.listenBtn.classList.remove('pulse');
  }
  micState(s: 'idle' | 'listening' | 'thinking' | 'done' | 'miss') {
    this.read.classList.remove('listening', 'thinking', 'done', 'miss');
    if (s !== 'idle') { void this.read.offsetWidth; this.read.classList.add(s); }
  }
  micLevel(v: number) { (this.read.querySelector('.mic-wrap') as HTMLElement).style.setProperty('--lv', v.toFixed(3)); }
  noMic(on: boolean) { this.thumb.hidden = !on; this.mic.hidden = on; }
  pulseListen(on: boolean) { this.listenBtn.classList.toggle('pulse', on); }

  swipe(on: boolean) { $('#swipe').classList.toggle('on', on); this.onSwipe(on); }
  /** main.ts: the 3D ring of arrows on the table (game/spinhint.ts) */
  onSwipe: (on: boolean) => void = () => {};

  /** the animals the players picked on the title: their cards and the result book show them */
  setAnimals(a: [string, string]) {
    this.animals = a;
    this.foxSay.animals = a;
    this.cards.forEach((c, p) => c.querySelector('.avatar use')?.setAttribute('href', `#ava-${a[p]}`));
  }

  /** the picture card of the word being read, standing just above the presented block (box = its screen rect);
   *  null = put it away. Tapping it plays the word again. */
  showCard(url: string | null, box?: { x0: number; x1: number; y0: number }) {
    const el = this.picCard, img = el.querySelector('img')!;
    clearTimeout(this.cardTimer);
    if (!url || !box) {
      if (el.hidden) return;
      el.classList.remove('on'); el.classList.add('off');
      this.cardTimer = window.setTimeout(() => { el.hidden = true; el.classList.remove('off'); }, 400);
      return;
    }
    const h = this.app.clientHeight;
    const gap = Math.max(8, h * 0.018);
    const bottom = box.y0 - gap;
    const top = Math.max(...this.cards.map((e) => e.getBoundingClientRect().bottom)) + gap;
    const size = Math.max(80, Math.min(h * 0.32, (box.x1 - box.x0) * 0.55, bottom - top));
    el.style.left = `${(box.x0 + box.x1) / 2}px`; el.style.top = `${bottom}px`;
    el.style.width = el.style.height = `${size}px`;
    img.src = url;
    el.hidden = false; el.classList.remove('off', 'on'); void el.offsetWidth; el.classList.add('on');
  }

  /** wrong block: its word pops up with the first letter big (the first sound the fox says) */
  letterPop(x: number, y: number, word: string, c: Pastel) {
    const el = document.createElement('div');
    el.className = 'letter-pop';
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.setProperty('--bc', c.base); el.style.setProperty('--tc', c.ink);
    const first = document.createElement('b'); first.textContent = word[0];
    const rest = document.createElement('span'); rest.textContent = word.slice(1);
    el.append(first, rest);
    this.app.append(el);
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4200);
  }

  // ── result book ────────────────────────────────────────────────────────────────────────────────────────
  showResult(players: { got: Got[] }[], winner: number) {
    const res = $('#result');
    res.hidden = false;
    res.querySelectorAll<HTMLElement>('.page').forEach((page, p) => {
      const got = players[p].got;
      page.classList.toggle('winner', winner === p);
      page.innerHTML = `
        <div class="ava"><svg viewBox="0 0 64 64"><use href="#ava-${this.animals[p]}" /></svg>${winner === p ? CROWN : ''}</div>
        <h2>Player ${p + 1}</h2>
        <div class="big"><i class="mini-block" style="--pc: var(--p${p + 1})"></i>${got.length}</div>
        <div class="words"></div>`;
      const words = page.querySelector('.words')!;
      got.forEach((g, i) => { const c = chip(g, false); c.style.animationDelay = `${0.5 + i * 0.06}s`; c.addEventListener('click', () => this.onWord(g.word.w)); words.append(c); });
    });
  }
  hideResult() { $('#result').hidden = true; }
}

function chip(g: Got, fresh: boolean) {
  const c = document.createElement('span');
  c.className = 'chip'; c.textContent = g.word.w;
  c.style.setProperty('--bc', g.color.base); c.style.setProperty('--tc', g.color.ink); c.style.setProperty('--sc', g.color.edge);
  if (!fresh) c.style.animation = 'none';
  return c;
}

const CROWN = `<svg class="crown" viewBox="0 0 64 44"><path d="M6 14 18 26 32 6l14 20 12-12-5 26H11z" fill="#ffd34d" stroke="#e0a21b" stroke-width="3" stroke-linejoin="round"/><circle cx="6" cy="13" r="4" fill="#ff7aa8"/><circle cx="32" cy="5" r="4.4" fill="#59b7f0"/><circle cx="58" cy="13" r="4" fill="#5fd6a3"/><rect x="11" y="34" width="42" height="6" rx="3" fill="#f5b52e"/></svg>`;
