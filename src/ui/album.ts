// Where the rewards go (user 2026-11-22: rewards per game, and every game has a place where what was collected goes):
// MY CARDS, a card album on this device. Every m-block a player reads right (and gets) adds its word's picture card
// (game.ts right; a block lost later to a wrong block stays in the album). The title's album button opens it: the
// lesson pack's 18 m-word cards in the game's card style, "×N" on the collected ones, a '?' slot for the rest;
// tapping a collected card, the fox says its word. Also the result book's stars (0-3 by blocks collected).
import { sfx, unlock } from '../core/audio';
import { say, stopSpeech } from '../core/speech';
import cardList from '../data/cards.json';
import { PASTELS } from '../game/tower';
import type { Fox } from './fox';

const KEY = 'pj.album.v1';
const WORDS = cardList as string[];
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

/** the cards collected on this device: word → how many times */
export function albumGet(): Record<string, number> {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).filter(([w, n]) => WORDS.includes(w) && typeof n === 'number' && n > 0)) as Record<string, number>;
  } catch { return {}; }
}
/** a block read right: one more of its card */
export function albumAdd(w: string) {
  if (!WORDS.includes(w)) return;
  const a = albumGet();
  a[w] = (a[w] ?? 0) + 1;
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode */ }
}

/** stars for one player's game: 0 blocks → 0, 1-2 → 1, 3-4 → 2, 5+ → 3 */
export const starsFor = (blocks: number) => (blocks >= 5 ? 3 : blocks >= 3 ? 2 : blocks >= 1 ? 1 : 0);

export class Album {
  private el = $('#album');
  private grid = $('#albumGrid');

  constructor(private fox: Fox) {
    $('#btnAlbum').addEventListener('click', (e) => { e.stopPropagation(); this.show(); });
    $('#albumClose').addEventListener('click', (e) => { e.stopPropagation(); sfx('tap'); this.hide(); });
    // a tap beside the panel closes it too
    this.el.addEventListener('click', (e) => { if (e.target === this.el) { sfx('tap'); this.hide(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.hide(); });
  }

  get open() { return !this.el.hidden; }

  show() {
    unlock(); sfx('tap'); stopSpeech();
    const got = albumGet(), url = (w: string) => new URL(`./cards/${w}.webp`, location.href).href;
    this.grid.innerHTML = '';
    WORDS.forEach((w, i) => {
      const n = got[w] ?? 0;
      if (!n) {
        const s = document.createElement('div');
        s.className = 'acard empty'; s.textContent = '?'; s.setAttribute('aria-label', 'not found yet');
        this.grid.append(s);
        return;
      }
      const c = PASTELS[i % PASTELS.length], b = document.createElement('button');
      b.className = 'acard';
      b.setAttribute('aria-label', w);
      b.style.setProperty('--bc', c.base); b.style.setProperty('--tc', c.ink); b.style.setProperty('--sc', c.edge);
      b.style.setProperty('--wl', String(Math.max(4, w.length)));     // a long word gets a smaller size (style.css .ac-word)
      b.innerHTML = `<img src="${url(w)}" alt="" draggable="false" /><b class="ac-word">${w}</b><i class="ac-n">×${n}</i>`;
      b.addEventListener('click', () => {
        b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
        this.fox.speakAs('talk');
        void say([`w:${w}`]);
      });
      this.grid.append(b);
    });
    this.el.hidden = false;
  }

  hide() {
    stopSpeech();
    this.el.hidden = true;
  }
}
