// What the blocks are for (user 2026-11-22: "획득한 카드를 쓸곳이 없는데 보상이라 할수 없어" — a reward has to be
// spent on something): every m-block a player reads right (and gets) puts one block in this device's wallet
// (game.ts right; a block lost later to a wrong block stays in the wallet), and the title's animal shop
// (ui/shop.ts) spends them on new player animals (ui/animals.ts PRICE). Also the result book's stars.
import { ANIMALS, PRICE, type Animal } from './animals';

const WALLET = 'pj.wallet.v1';        // { earned, spent }
const OWNED = 'pj.animals.v1';        // the animals bought (the free ones aren't stored)
const ALBUM = 'pj.album.v1';          // MY CARDS, the album before the shop: word → times read right (read once, to seed)

type Wallet = { earned: number; spent: number };
const n0 = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.floor(v) : 0);

function load(): Wallet {
  try {
    const raw = localStorage.getItem(WALLET);
    if (raw) { const o = JSON.parse(raw) as Partial<Wallet>; return { earned: n0(o.earned), spent: n0(o.spent) }; }
    // first time: every block already in the album counts
    const al = JSON.parse(localStorage.getItem(ALBUM) ?? '{}') as Record<string, unknown>;
    const w = { earned: Object.values(al).reduce<number>((s, v) => s + n0(v), 0), spent: 0 };
    store(w);
    return w;
  } catch { return { earned: 0, spent: 0 }; }
}
function store(w: Wallet) { try { localStorage.setItem(WALLET, JSON.stringify(w)); } catch { /* private mode */ } }

/** blocks to spend */
export function wallet() { const w = load(); return Math.max(0, w.earned - w.spent); }

/** an m-block read right: one more in the wallet */
export function earn(n = 1) { const w = load(); w.earned += n; store(w); }

/** the animals this device has: the free ones and the ones bought */
export function owned(): Animal[] {
  let got: unknown = [];
  try { got = JSON.parse(localStorage.getItem(OWNED) ?? '[]'); } catch { /* none */ }
  const set = new Set(Array.isArray(got) ? got : []);
  return ANIMALS.filter((a) => PRICE[a] === 0 || set.has(a));
}

/** buy an animal: false (nothing spent) when the wallet is short */
export function buy(a: Animal): boolean {
  if (owned().includes(a)) return true;
  const w = load();
  if (w.earned - w.spent < PRICE[a]) return false;
  w.spent += PRICE[a];
  store(w);
  const bought = owned().filter((x) => PRICE[x] > 0);
  try { localStorage.setItem(OWNED, JSON.stringify([...bought, a])); } catch { /* private mode */ }
  return true;
}

/** stars for one player's game: 0 blocks → 0, 1-2 → 1, 3-4 → 2, 5+ → 3 */
export const starsFor = (blocks: number) => (blocks >= 5 ? 3 : blocks >= 3 ? 2 : blocks >= 1 ? 1 : 0);

/** the block icon of the wallet and the prices: a little butter m-block (the tower's butter pastel: face, light top,
 *  deeper end) — a picture of the game's own block (ui/blockshot.ts) was a thin bar at this size, its m a dot */
export const BLOCK_ICON = '<svg class="blk" viewBox="0 0 44 26" aria-hidden="true"><g stroke-width="2.4" stroke-linejoin="round">'
  + '<path d="M3 8 11 2.6H41L33 8Z" fill="#fff0bd" stroke="#fff0bd" />'
  + '<path d="M33 8 41 2.6V17.6L33 23Z" fill="#e8c35a" stroke="#e8c35a" />'
  + '<path d="M3 8H33V23H3Z" fill="#f8dc80" stroke="#f8dc80" /></g>'
  + '<text x="18" y="20.2" text-anchor="middle" font-family="ECP, Baloo, system-ui, sans-serif" font-weight="700" font-size="15" fill="#86600a">m</text></svg>';
