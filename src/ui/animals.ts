// The players' animals. Art = the user's round badges (cream ring, plush animal inside), made in the tutor's
// soft 3D style: ~/Downloads/jenga_<id>.png → tools/make_animals.py → src/assets/ani_<id>.webp (512 px).
// The first four are free; the other four are bought in the title's animal shop with the blocks read right
// (ui/shop.ts, ui/rewards.ts; user 2026-11-22: "획득한 카드를 쓸곳이 없는데 보상이라 할수 없어").
import bunny from '../assets/ani_bunny.webp';
import kitty from '../assets/ani_kitty.webp';
import puppy from '../assets/ani_puppy.webp';
import panda from '../assets/ani_panda.webp';
import koala from '../assets/ani_koala.webp';
import penguin from '../assets/ani_penguin.webp';
import hamster from '../assets/ani_hamster.webp';
import lion from '../assets/ani_lion.webp';

export const ANIMALS = ['bunny', 'kitty', 'puppy', 'panda', 'koala', 'penguin', 'hamster', 'lion'] as const;
export type Animal = (typeof ANIMALS)[number];

/** image URL of each animal's badge (an <img class="ani"> fills its circle) */
export const ANI_ART: Record<string, string> = { bunny, kitty, puppy, panda, koala, penguin, hamster, lion };

/** blocks each animal costs in the shop (0 = free from the start) */
export const PRICE: Record<Animal, number> = { bunny: 0, kitty: 0, puppy: 0, panda: 0, koala: 5, penguin: 10, hamster: 15, lion: 20 };

/** a padlock (line icon) for the animals not bought yet — the picker and the shop */
export const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.6" /><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" /><path d="M12 14.6v2.2" /></svg>';
