// The players' animals. Art = the user's round badges (cream ring, plush animal inside), made in the tutor's
// soft 3D style: ~/Downloads/jenga_<id>.png → tools/make_animals.py → src/assets/ani_<id>.webp (512 px).
import bunny from '../assets/ani_bunny.webp';
import kitty from '../assets/ani_kitty.webp';
import puppy from '../assets/ani_puppy.webp';
import panda from '../assets/ani_panda.webp';

export const ANIMALS = ['bunny', 'kitty', 'puppy', 'panda'] as const;
export type Animal = (typeof ANIMALS)[number];

/** image URL of each animal's badge (an <img class="ani"> fills its circle) */
export const ANI_ART: Record<string, string> = { bunny, kitty, puppy, panda };
