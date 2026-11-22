// The animal shop (title only, the paw button top left; it replaced the MY CARDS album — collected cards had nothing
// to be spent on): the blocks in the wallet (ui/rewards.ts) buy new player animals. The free four and the ones bought
// look normal; the rest are dimmed with a lock and their price. A locked one: the first tap lights its price, the
// second buys it (wallet − price, the badge pops out of its lock with sparkles); short of blocks, the price and the
// wallet shake and nothing is spent. A locked animal tapped in the picker opens the shop with its price lit.
import { sfx, unlock } from '../core/audio';
import { t } from '../core/lang';
import { ANIMALS, ANI_ART, LOCK, PRICE, type Animal } from './animals';
import { Confetti } from './confetti';
import type { Fox } from './fox';
import { BLOCK_ICON, buy, owned, wallet } from './rewards';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

export class Shop {
  private el = $('#shop');
  private grid = $('#shopGrid');
  private purse = $('#shopWallet');
  /** the locked animal whose price is lit (the next tap on it buys) */
  private armed: Animal | null = null;
  /** an animal was bought (the picker shows it as pickable) */
  onChange = () => {};
  /** the panel closed */
  onClose = () => {};
  /** the sparkles of a purchase: their own canvas over the panel (the title's sparkles stay under it) */
  private confetti = new Confetti($<HTMLCanvasElement>('#shopFx'));

  constructor(private app: HTMLElement, private fox: Fox) {
    $('#btnAnimals').addEventListener('click', (e) => { e.stopPropagation(); this.show(); });
    $('#shopClose').addEventListener('click', (e) => { e.stopPropagation(); sfx('tap'); this.hide(); });
    // a tap beside the panel closes it too; one on the panel (not on a locked animal) puts a lit price out
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) { sfx('tap'); this.hide(); return; }
      if (!(e.target as Element).closest('.shop-ani')) this.arm(null);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.hide(); });
  }

  get open() { return !this.el.hidden; }

  /** open the shop (lit: that locked animal's price already lit — tapped in the picker) */
  show(lit?: Animal) {
    unlock(); sfx('tap');
    this.render();
    this.setPurse(false);
    this.arm(lit && !owned().includes(lit) ? lit : null);
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
    this.arm(null);
    this.onClose();
  }

  private render() {
    const have = owned(), icon = BLOCK_ICON;
    this.grid.innerHTML = '';
    for (const a of ANIMALS) {
      const b = document.createElement('button'), mine = have.includes(a);
      b.className = `shop-ani${mine ? '' : ' locked'}`;
      b.dataset.id = a;
      b.setAttribute('aria-label', mine ? t(a) : `${t(a)}, ${PRICE[a]} blocks`);
      b.innerHTML = `<span class="pa-art"><img class="ani" src="${ANI_ART[a]}" alt="" draggable="false" />`
        + (mine ? '' : `<i class="lock">${LOCK}</i><span class="price">${icon}<b>${PRICE[a]}</b></span>`)
        + `</span><b>${t(a)}</b>`;
      b.addEventListener('click', () => this.tap(a, b));
      this.grid.append(b);
    }
    this.purse.querySelector('.wl-icon')!.innerHTML = icon;
  }

  private setPurse(bump: boolean) {
    const n = this.purse.querySelector('b')!;
    n.textContent = String(wallet());
    this.purse.setAttribute('aria-label', `${wallet()} blocks`);
    if (bump) again(this.purse, 'bump');
  }

  private arm(a: Animal | null) {
    this.armed = a;
    this.grid.querySelectorAll<HTMLElement>('.shop-ani').forEach((b) => b.classList.toggle('armed', b.dataset.id === a));
  }

  private tap(a: Animal, b: HTMLElement) {
    if (!b.classList.contains('locked')) {
      // one of the player's own: a little hop
      this.arm(null);
      sfx('pop'); again(b, 'bump');
      return;
    }
    if (wallet() < PRICE[a]) {
      // not enough blocks: the price and the wallet shake, nothing is spent
      this.arm(a);
      sfx('wrong');
      again(b.querySelector('.price')!, 'shake'); again(this.purse, 'shake');
      return;
    }
    if (this.armed !== a) { this.arm(a); sfx('tap'); return; }
    if (!buy(a)) return;
    // bought: out of its lock with a pop and sparkles
    this.arm(null);
    b.classList.remove('locked'); b.classList.add('bought');
    b.setAttribute('aria-label', t(a));
    b.querySelector('.lock')?.remove(); b.querySelector('.price')?.remove();
    sfx('success');
    this.setPurse(true);
    const r = b.querySelector('.pa-art')!.getBoundingClientRect(), box = this.app.getBoundingClientRect();
    const x = r.left - box.left + r.width / 2, y = r.top - box.top + r.height / 2;
    this.confetti.sparkle(x, y, 26, true);
    setTimeout(() => this.confetti.sparkle(x, y - r.height * 0.2, 16, true), 260);
    this.fox.gesture('happy', 1400);
    this.onChange();
  }
}

/** restart a one-shot animation class */
function again(el: Element, cls: string) { el.classList.remove(cls); void (el as HTMLElement).offsetWidth; el.classList.add(cls); }
