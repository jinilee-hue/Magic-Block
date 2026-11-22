// Character pick (user: "첫화면에서 플레이어1과 플레이어2의 동물 캐릭터를 선택해서 들어오게"): after START, Player 1
// picks an animal, then Player 2 (the one already taken is marked P1 and can't be picked); then Reset (both pick again)
// and Start (the game begins) — it used to start at once (user: "다시 고르고 싶을수 있어서 reset과 start버튼").
// The fox calls each step out; tapping an animal says its name. The art is the user's badges (ui/animals.ts).
// All eight animals are shown: the ones not bought yet dimmed with a lock and their price — tapping one opens the
// animal shop (ui/shop.ts) with its price lit.
import { hasClip, sfx } from '../core/audio';
import { t } from '../core/lang';
import { say } from '../core/speech';
import { ANIMALS, ANI_ART, LOCK, PRICE, type Animal } from './animals';
import type { Fox } from './fox';
import { BLOCK_ICON, owned } from './rewards';

export { ANIMALS, type Animal } from './animals';

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;

export class Picker {
  private el = $('#pick');
  private who = $('#pickWho');
  private picks: Animal[] = [];
  private resolve: ((p: [Animal, Animal] | null) => void) | null = null;
  private locked = false;
  /** a locked animal was tapped (main.ts: the shop opens with its price lit) */
  onLocked: (a: Animal) => void = () => {};

  constructor(private app: HTMLElement, private fox: Fox) {
    $('#pickReset').addEventListener('click', () => { if (!this.ready) return; sfx('tap'); this.reset(); this.fox.speakAs('point'); void say(['t:pick1']); });
    $('#pickStart').addEventListener('click', () => { if (!this.ready) return; sfx('start'); this.finish([this.picks[0], this.picks[1]]); });
  }

  private get ready() { return this.picks.length === 2; }

  get open() { return !this.el.hidden; }

  /** show the pick panel; resolves with [Player 1's animal, Player 2's animal], or null if they went back */
  pick(): Promise<[Animal, Animal] | null> {
    this.resolve?.(null);
    this.reset();
    this.el.hidden = false;
    this.app.classList.add('picking');
    this.fox.speakAs('point');
    void say(['t:pick1']);
    return new Promise((res) => { this.resolve = res; });
  }

  /** nobody has picked: Player 1's turn */
  private reset() {
    this.picks = []; this.locked = false;
    this.el.classList.remove('ready');
    this.render();
    this.setWho(0);
  }

  /** the eight slots: owned ones to pick (with P1 / P2 on the picked ones), the rest locked with their price */
  private render() {
    const row = $('#pickRow'), have = owned(), icon = BLOCK_ICON;
    row.innerHTML = '';
    for (const a of ANIMALS) {
      const b = document.createElement('button'), mine = have.includes(a), p = this.picks.indexOf(a);
      b.className = `pick-ani${mine ? '' : ' locked'}${p >= 0 ? ` p${p + 1}` : ''}`;
      b.dataset.id = a;
      b.setAttribute('aria-label', mine ? t(a) : `${t(a)}, ${PRICE[a]} blocks`);
      if (p >= 0) b.setAttribute('aria-disabled', 'true');
      b.innerHTML = `<span class="pa-art"><img class="ani" src="${ANI_ART[a]}" alt="" draggable="false" /><i class="pa-tag">${p >= 0 ? `P${p + 1}` : ''}</i>`
        + (mine ? '' : `<i class="lock">${LOCK}</i><span class="price">${icon}<b>${PRICE[a]}</b></span>`)
        + `</span><b>${t(a)}</b>`;
      b.addEventListener('click', () => {
        if (!mine) { this.onLocked(a); return; }
        this.choose(a, b);
      });
      row.append(b);
    }
  }

  /** an animal was bought in the shop: show it pickable (the picks so far stay) */
  refresh() { if (this.open) this.render(); }

  private setWho(p: number) {
    this.who.textContent = t('player', { n: p + 1 });
    this.who.classList.toggle('p2', p === 1);
    this.who.classList.remove('bump'); void this.who.offsetWidth; this.who.classList.add('bump');
  }

  private choose(id: Animal, b: HTMLButtonElement) {
    if (this.locked || this.picks.includes(id)) return;
    const p = this.picks.length;
    this.picks.push(id);
    sfx('pop');
    b.classList.add(`p${p + 1}`, 'chosen'); b.setAttribute('aria-disabled', 'true');
    (b.querySelector('.pa-tag') as HTMLElement).textContent = `P${p + 1}`;
    this.fox.gesture('happy', 1200);
    if (p === 0) {
      this.fox.speakAs('point');
      void say([...name(id), 't:pick2']);
      setTimeout(() => { if (this.picks.length === 1) this.setWho(1); }, 450);
      return;
    }
    // both picked: say the name and wait — Reset to pick again, Start to play
    this.locked = true;
    this.who.textContent = t('ready');
    this.who.classList.remove('p2', 'bump'); void this.who.offsetWidth; this.who.classList.add('bump');
    this.el.classList.add('ready');
    this.fox.speakAs('point');
    void say([...name(id), 't:pressstart']);
  }

  private finish(p: [Animal, Animal] | null) {
    this.el.hidden = true;
    this.el.classList.remove('ready');
    this.app.classList.remove('picking');
    const r = this.resolve; this.resolve = null;
    r?.(p);
  }

  /** leaving the title some other way: put the panel away */
  close() { if (this.open) this.finish(null); }
}

/** the fox says the animal's name — the first four have a line; the shop's four don't (no new voice lines) */
const name = (id: Animal) => (hasClip(`t:a_${id}`) ? [`t:a_${id}`, 0.35] : []);
