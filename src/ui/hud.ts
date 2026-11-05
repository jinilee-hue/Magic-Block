// DOM layer: player cards, the fox's speech bubble, read-aloud mic, the picture card, the reset-view button, result book.
import { sfx } from '../core/audio';
import { t, lang, onLang, setLang } from '../core/lang';
import { onTalk } from '../core/speech';
import type { Pastel, WordInfo } from '../game/tower';
import crownUrl from '../assets/crown.webp';
import { ANI_ART } from './animals';
import { blockImg } from './blockshot';
import { FoxSay } from './foxsay';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
export interface Got { word: WordInfo; color: Pastel }
const CHIP_MAX = 8;

export class Hud {
  readonly app = $('#app');
  private cards = [$('#p1'), $('#p2')];
  /** each player's animal (ui/animals.ts id) */
  private animals: [string, string] = ['bunny', 'kitty'];
  /** the fox's speech bubble (replaces the old "Player 1's Turn" banner) */
  readonly foxSay = new FoxSay($('#foxSay'));
  private read = $('#read');
  private mic = $('#btnMic');
  private thumb = $('#btnThumb');
  private listenBtn = $('#btnListen');
  private picCard = $('#picCard');
  onMic: () => void = () => {};
  onListen: () => void = () => {};
  onThumb: () => void = () => {};
  /** the reset-view button (user: "원위치 버튼만 하나 있으면") */
  onResetView: () => void = () => {};
  onAgain: () => void = () => {};
  onResultHome: () => void = () => {};
  onWord: (w: string) => void = () => {};

  constructor() {
    this.mic.addEventListener('click', () => this.onMic());
    this.listenBtn.addEventListener('click', () => { sfx('tap'); this.onListen(); });
    this.picCard.addEventListener('click', () => { sfx('tap'); this.onListen(); });
    this.thumb.addEventListener('click', () => { sfx('pop'); this.onThumb(); });
    $('#btnReset').addEventListener('click', () => { sfx('tick'); this.onResetView(); });
    // EN | 한: the fox's voice, its bubble and the screen words (core/lang.ts) — in the corner bar
    const langBtn = $('#btnLang');
    const syncLang = () => {
      const ko = lang() === 'ko';
      langBtn.dataset.l = ko ? 'ko' : 'en';
      langBtn.setAttribute('aria-pressed', String(ko));
      langBtn.querySelectorAll<HTMLElement>('.flag').forEach((f) => f.classList.toggle('on', f.dataset.l === langBtn.dataset.l));
    };
    langBtn.addEventListener('click', () => { sfx('tap'); setLang(lang() === 'ko' ? 'en' : 'ko'); });
    onLang(syncLang); syncLang();
    onTalk((on) => this.read.classList.toggle('saying', on));
    $('#btnAgain').addEventListener('click', () => { sfx('start'); this.onAgain(); });
    $('#btnResultHome').addEventListener('click', () => { sfx('tap'); this.onResultHome(); });
  }

  screen(name: 'intro' | 'title' | 'game' | 'result') { this.app.dataset.screen = name; }
  busy(on: boolean) { this.app.classList.toggle('busy', on); if (on) this.foxSay.release(); }

  reset() {
    this.cards.forEach((c) => { c.querySelector('.num')!.textContent = '0'; c.querySelector('.chips')!.innerHTML = ''; });
    this.cards.forEach((_, p) => this.setStrikes(p, 0));
    $('#result').hidden = true;
    this.showRead(false);
    this.hideCard();
    this.foxSay.clear();
  }

  /** wrong blocks so far (✕ marks on the player's card; the newest pops in) */
  setStrikes(p: number, n: number, animate = false) {
    this.cards[p].querySelectorAll<HTMLElement>('.strikes i').forEach((m, i) => {
      m.classList.toggle('on', i < n);
      m.classList.remove('pop');
      if (animate && i === n - 1) { void m.offsetWidth; m.classList.add('pop'); }
    });
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

  /** collected blocks beside the card (Player 1 on the right, Player 2 on the left), oldest at the bottom; `landing` keeps the newest hidden */
  private renderChips(p: number, got: Got[], landing: boolean) {
    const chips = this.cards[p].querySelector('.chips')!;
    chips.innerHTML = '';
    const show = got.slice(-CHIP_MAX);
    if (got.length > CHIP_MAX) { const more = document.createElement('span'); more.className = 'chip more'; more.textContent = `+${got.length - CHIP_MAX}`; chips.append(more); }
    show.forEach((g, i) => { const last = i === show.length - 1, c = chip(g, last && !landing); if (last && landing) c.classList.add('landing'); chips.append(c); });
  }
  private setCount(p: number, n: number) {
    const card = this.cards[p];
    card.querySelector('.num')!.textContent = String(n);
    const sc = card.querySelector('.pscore')!; sc.classList.remove('pop'); void (sc as HTMLElement).offsetWidth; sc.classList.add('pop');
  }
  addWord(p: number, got: Got[], n: number) { this.setCount(p, n); this.renderChips(p, got, false); }
  /** where a collected block lands (CSS px): the end of the player's pile, where its chip waits hidden */
  chipSlot(p: number, got: Got[]) {
    this.renderChips(p, got, true);
    const r = this.cards[p].querySelector('.chip.landing')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /** the block got there: its chip drops onto the pile and the count goes up (user: "블럭이 플레이어한테 가서 쌓이면") */
  land(p: number, n: number) {
    const c = this.cards[p].querySelector<HTMLElement>('.chip.landing');
    if (c) { c.classList.remove('landing'); c.style.animation = ''; c.classList.add('drop'); }
    this.setCount(p, n);
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
  get swipeOn() { return $('#swipe').classList.contains('on'); }
  /** main.ts: the 3D ring of arrows on the table (game/spinhint.ts) */
  onSwipe: (on: boolean) => void = () => {};

  /** the animals the players picked on the title: their cards and the result book show them */
  setAnimals(a: [string, string]) {
    this.animals = a;
    this.foxSay.animals = a;
    this.cards.forEach((c, p) => { const im = c.querySelector<HTMLImageElement>('.avatar .ani'); if (im) im.src = ANI_ART[a[p]]; });
  }

  /** The picture card of the word being read takes the presented block's place — the block turns into it (game.ts):
   *  the picture over the word, framed in the block's colours, centred on the block between the top bar and the
   *  mic. prepCard sets it up and loads the picture (call it before the block turns away), cardIn turns it to the
   *  child, cardOut away again (then the block turns back in its place). Tapping it plays the word again. */
  /** the picture card's size (CSS px) on this screen */
  cardSize() {
    const W = this.app.clientWidth, H = this.app.clientHeight;
    const top = H * 0.04, bottom = H * 0.78;                 // the mic's row starts at ~81 % of the height
    const h = Math.max(120, Math.min(bottom - top, H * 0.54, W * 0.72 * 1.24));
    return { w: h / 1.24, h, top, bottom };
  }
  prepCard(url: string, word: string, c: Pastel, at: { x: number; y: number }) {
    const el = this.picCard, img = el.querySelector('img')!, wd = el.querySelector('.pc-word') as HTMLElement;
    this.hideCard();
    const { w, h, top, bottom } = this.cardSize();
    const cy = Math.min(Math.max(at.y, top + h / 2), bottom - h / 2);
    Object.assign(el.style, { left: `${at.x}px`, top: `${cy}px`, width: `${w}px`, height: `${h}px` });
    el.style.setProperty('--cw', `${w}px`);     // the card's own width: its padding follows it (style.css .pic-card)
    el.style.setProperty('--bc', c.base); el.style.setProperty('--tc', c.ink); el.style.setProperty('--sc', c.edge);
    el.style.setProperty('--wf', `${Math.min(h * 0.12, (w * 0.84) / (0.56 * Math.max(3, word.length)))}px`);
    wd.textContent = word;
    img.src = url;
    return img.decode().catch(() => {});
  }
  async cardIn() {
    const el = this.picCard;
    el.hidden = false;
    await el.animate([
      { transform: 'perspective(1600px) rotateY(-90deg) scale(.92)' },
      { transform: 'perspective(1600px) rotateY(10deg) scale(1.03)', offset: 0.72 },
      { transform: 'perspective(1600px) rotateY(0deg) scale(1)' },
    ], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).finished.catch(() => {});
  }
  async cardOut() {
    const el = this.picCard;
    if (el.hidden) return;
    await el.animate([{ transform: 'perspective(1600px) rotateY(0deg)' }, { transform: 'perspective(1600px) rotateY(90deg) scale(.94)' }],
      { duration: 260, easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'forwards' }).finished.catch(() => {});
    this.hideCard();
  }
  hideCard() { const el = this.picCard; el.getAnimations().forEach((a) => a.cancel()); el.hidden = true; }

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
  showResult(players: { got: Got[]; strikes?: number }[], winner: number) {
    const res = $('#result');
    res.hidden = false;
    res.querySelectorAll<HTMLElement>('.page').forEach((page, p) => {
      const got = players[p].got, n = Math.min(3, players[p].strikes ?? 0);
      page.classList.toggle('winner', winner === p);
      page.innerHTML = `
        <div class="ava"><img class="ani" src="${ANI_ART[this.animals[p]]}" alt="" draggable="false" />${winner === p ? CROWN : ''}</div>
        <h2>${t('player', { n: p + 1 })}</h2>
        <div class="big"><i class="mini-block" style="--pc: var(--p${p + 1})"></i>${got.length}</div>
        ${n ? `<span class="strikes" aria-label="wrong blocks">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(3 - n)}</span>` : ''}
        <div class="words"></div>`;
      const words = page.querySelector('.words')!;
      // the words as the game's own blocks (ui/blockshot.ts; user: "결과 화면에 나오는 단어블럭들도 정말 젠가 블럭형태로
      // 넣어줘"), three to a row (four, smaller, only for 13-14: 12 still fit the page); a chip if there is no WebGL
      words.classList.add('blocks'); words.classList.toggle('many', got.length > 12);
      got.forEach((g, i) => {
        const c = blockImg(g.word.w, g.color) ?? chip(g, false);
        c.style.animationDelay = `${0.5 + i * 0.06}s`; c.addEventListener('click', () => this.onWord(g.word.w)); words.append(c);
      });
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

const CROWN = `<img class="crown" src="${crownUrl}" alt="" draggable="false" />`;
