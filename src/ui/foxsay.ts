// The fox's speech bubble (user: "이런건 튜터인 여우가 계속 가이드 해주는게 좋지않아?" about the old "Player 1's Turn"
// banner): on the game screen whatever the fox says shows in a bubble over its head, in the words of the line it is
// speaking (voice.json `lines`, written by tools/build_voice.py from the same TUTOR texts the voice was made from).
// The turn call — that player's animal + "Player 1, your turn!" — stays up while the player looks for a block; every
// other line shows while it plays and a moment after, then the turn call comes back (or the bubble goes).
import voiceData from '../data/voice.json';
import { isTalking, onLine, onTalk, type Part } from '../core/speech';
import { ANI_ART } from './animals';

const LINES: Record<string, string> = (voiceData as { lines?: Record<string, string> }).lines ?? {};
const HOLD_MS = 1400;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** the voice says "Player one" (so the TTS reads it right); the screen says "Player 1" like the player cards */
const shown = (s: string) => s.replace(/\bPlayer one\b/g, 'Player 1').replace(/\bPlayer two\b/g, 'Player 2');

/** clip keys → bubble HTML: tutor text, words as chips, letter sounds as /m/ (a repeated part once) */
function format(keys: string[]) {
  const out: string[] = [];
  let prev = '';
  for (const k of keys) {
    if (k === prev) continue;
    prev = k;
    const kind = k.slice(0, 2), id = k.slice(2);
    if (kind === 't:' && LINES[id]) out.push(esc(shown(LINES[id])));
    else if (kind === 'w:') out.push(`<b class="fs-word">${esc(id)}</b>`);
    else if (kind === 's:') out.push(`<i class="fs-snd">/${esc(id)}/</i>`);
  }
  return out.join(' ');
}

export class FoxSay {
  animals: [string, string] = ['bunny', 'kitty'];
  private text: HTMLElement;
  private ava: HTMLImageElement;
  /** whose turn call stays up (null: none) */
  private sticky: number | null = null;
  private key = '';
  private hideT = 0;
  private offT = 0;

  constructor(private el: HTMLElement) {
    this.text = el.querySelector('.fs-text') as HTMLElement;
    this.ava = el.querySelector('.fs-ava .ani') as HTMLImageElement;
    onLine((parts) => this.line(parts));
    onTalk((on) => { if (on) clearTimeout(this.hideT); else this.later(); });
  }

  /** a turn starts: its call stays up until the player picks (release) */
  turn(p: number) { this.sticky = p; }
  /** the player picked a block: the turn call can go */
  release() { this.sticky = null; if (!isTalking()) this.later(); }
  /** new game / back to the title */
  clear() { this.sticky = null; clearTimeout(this.hideT); this.hide(true); }

  private line(parts: Part[]) {
    const keys = parts.filter((x): x is string => typeof x === 'string');
    // word replays (tapping the card) and other lines without tutor words leave the bubble as it is
    if (!keys.some((k) => k.startsWith('t:') && LINES[k.slice(2)])) return;
    clearTimeout(this.hideT);
    const p = keys.includes('t:turn1') ? 0 : keys.includes('t:turn2') ? 1 : null;
    this.show(format(keys), p);
  }

  private later() {
    clearTimeout(this.hideT);
    this.hideT = window.setTimeout(() => {
      if (this.sticky !== null) this.show(format([`t:turn${this.sticky + 1}`]), this.sticky);
      else this.hide();
    }, HOLD_MS);
  }

  /** p = the player a turn call is for (their animal + colour), null = a plain line */
  private show(html: string, p: number | null) {
    const key = `${p}|${html}`;
    clearTimeout(this.offT);
    if (key === this.key && !this.el.hidden && !this.el.classList.contains('off')) return;
    this.key = key;
    this.text.innerHTML = html;
    this.el.classList.toggle('turn', p !== null);
    this.el.classList.toggle('p2', p === 1);
    if (p !== null) this.ava.src = ANI_ART[this.animals[p]];
    this.el.hidden = false;
    this.el.classList.remove('off', 'pop'); void this.el.offsetWidth; this.el.classList.add('pop');
  }

  private hide(now = false) {
    this.key = '';
    if (this.el.hidden) return;
    if (now) { this.el.hidden = true; this.el.classList.remove('off', 'pop'); return; }
    this.el.classList.remove('pop'); this.el.classList.add('off');
    this.offT = window.setTimeout(() => { this.el.hidden = true; this.el.classList.remove('off'); }, 260);
  }
}
