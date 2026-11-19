"""Picture cards for the m-words: the lesson pack's pictures (FP.K.U1L1 = the representative images) where it has the
word, else the official FPR K images imported for Phonics Island (phonics-island-3d/public/cards2/) — see fit_cards.py.
usage: /Users/jini/.hermes/bin/uv run --with pillow --with numpy python tools/import_cards.py
→ public/cards/<word>.webp + src/data/cards.json (the words that have a card; the game shows a card only for those)
  and prints which m-words still have no picture. To add one: save it as public/cards/<word>.webp (square, transparent
  or white background) and re-run this script.
"""
import json
import pathlib
import shutil

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PI = pathlib.Path.home() / 'Documents/Jini/2026/Phonics/Phonics_island/phonics-island-3d/public'
OUT = ROOT / 'public' / 'cards'
OUT.mkdir(parents=True, exist_ok=True)

from fit_cards import source as fit_source  # noqa: E402

words = [w['w'] for w in json.loads((ROOT / 'src/data/words.json').read_text())['words'] if w['m']]
have, missing = [], []
for w in words:
    src = PI / 'cards2' / f'{w}.webp'
    dst = OUT / f'{w}.webp'
    if dst.exists():
        have.append(w)                      # already here (imported before, or added by hand); fit_all re-fits it
    elif src.exists() or fit_source(w).exists():
        if src.exists():
            shutil.copyfile(src, dst)
        else:                               # pack only: a placeholder that fit_all replaces from the pack picture
            Image.open(fit_source(w)).convert('RGBA').resize((512, 532)).save(dst, 'WEBP')
        have.append(w)
    else:
        missing.append(w)
sizes = {w: Image.open(OUT / f'{w}.webp').size for w in have}
(ROOT / 'src/data/cards.json').write_text(json.dumps(sorted(have)) + '\n')
print(f'{len(have)} cards → {OUT}')
print('sizes', sorted(set(sizes.values())))
print('no picture yet:', ', '.join(missing) or '-')
# every card fitted alike in the card's picture box (tools/fit_cards.py: cut to its outline, as big as the box allows,
# capped at one common visual size)
from fit_cards import fit_all  # noqa: E402

fit_all()
