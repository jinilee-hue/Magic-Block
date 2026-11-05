// Character pick (user: "첫화면에서 플레이어1과 플레이어2의 동물 캐릭터를 선택해서 들어오게"): after START, Player 1
// picks an animal, then Player 2 (the one already taken is marked P1 and can't be picked); then Reset (both pick again)
// and Start (the game begins) — it used to start at once (user: "다시 고르고 싶을수 있어서 reset과 start버튼").
// The fox calls each step out; tapping an animal says its name. The art is the user's badges (ui/animals.ts).
import { sfx } from '../core/audio';
import { t } from '../core/lang';
import { say } from '../core/speech';
import { type Animal } from './animals';
import type { Fox } from './fox';

export { ANIMALS, type Animal } from './animals';

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;

export class Picker {
  private el = $('#pick');
  private who = $('#pickWho');
  private picks: Animal[] = [];
  private resolve: ((p: [Animal, Animal] | null) => void) | null = null;
  private locked = false;

  constructor(private app: HTMLElement, private fox: Fox) {
    this.el.querySelectorAll<HTMLButtonElement>('.pick-ani').forEach((b) => b.addEventListener('click', () => this.choose(b.dataset.id as Animal, b)));
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
    this.el.querySelectorAll('.pick-ani').forEach((b) => { b.classList.remove('p1', 'p2', 'chosen'); b.removeAttribute('aria-disabled'); (b.querySelector('.pa-tag') as HTMLElement).textContent = ''; });
    this.setWho(0);
  }

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
      void say([`t:a_${id}`, 0.35, 't:pick2']);
      setTimeout(() => { if (this.picks.length === 1) this.setWho(1); }, 450);
      return;
    }
    // both picked: say the name and wait — Reset to pick again, Start to play
    this.locked = true;
    this.who.textContent = t('ready');
    this.who.classList.remove('p2', 'bump'); void this.who.offsetWidth; this.who.classList.add('bump');
    this.el.classList.add('ready');
    this.fox.speakAs('point');
    void say([`t:a_${id}`, 0.35, 't:pressstart']);
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
