"""Picture cards fitted alike (user: "카드속 이미지들 크기가 제각각인데 잘보이게 크기 전체적으로 잘 넣어줘").

The pictures came as 512² squares, each trimmed to 93 % on its longest side: a flat map, a thin man and a round moon
all got the same longest side, so in the card's picture box the flat and thin ones looked small and the box's room went
unused. Now each picture is cut to its outline and drawn into a canvas shaped like the box (512 × 532), as big as the box
allows — but no bigger than one common visual size (√(width × height) ≤ TARGET card widths), so the full, round pictures
don't tower over the thin ones.

usage: /Users/jini/.hermes/bin/uv run --with pillow --with numpy python tools/fit_cards.py   (import_cards.py runs it too)
Source = Phonics Island's cards2 originals when there, else a hand-added 512² card here (fitted once: a fitted card is
512 × 532, so a re-run leaves it as it is).
"""
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PI = pathlib.Path.home() / 'Documents/Jini/2026/Phonics/Phonics_island/phonics-island-3d/public/cards2'
OUT = ROOT / 'public' / 'cards'
# the card's picture box (hud.prepCard + style.css .pic-card): a w × 1.24w card, padding 7 % of its width (5.5 % below),
# gap 3.5 % of the inner height, the word's line 1.15 × 0.12 h → a box 0.86w wide, 0.905w tall
BOX_W, BOX_H = 0.86, 0.905
CW = 512
CH = round(CW * BOX_H / BOX_W)
PX_PER_W = CW / BOX_W              # canvas px per card width
TARGET = 0.76                      # the common visual size, in card widths


def outline(im: Image.Image):
    ys, xs = np.nonzero(np.asarray(im.getchannel('A')) > 12)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit(src: Image.Image) -> Image.Image:
    im = src.convert('RGBA')
    c = im.crop(outline(im))
    cw, ch = c.size
    s = min(CW / cw, CH / ch, TARGET * PX_PER_W / (cw * ch) ** 0.5)
    w, h = max(1, round(cw * s)), max(1, round(ch * s))
    out = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    # premultiplied while scaling: no dark fringe from the transparent pixels' colour
    out.paste(c.convert('RGBa').resize((w, h), Image.Resampling.LANCZOS).convert('RGBA'), ((CW - w) // 2, (CH - h) // 2))
    return out


def shown(im: Image.Image):
    """the picture's size in the card (card widths): the image is contained in the box"""
    x0, y0, x1, y1 = outline(im.convert('RGBA'))
    W, H = im.size
    k = min(BOX_W / W, BOX_H / H)
    return (x1 - x0) * k, (y1 - y0) * k


def fit_all():
    rows = []
    for dst in sorted(OUT.glob('*.webp')):
        src = PI / dst.name
        if src.exists():
            im = Image.open(src)
        elif Image.open(dst).size == (512, 512):
            im = Image.open(dst)              # hand-added, not fitted yet
        else:
            continue
        b = shown(im)
        out = fit(im)
        out.save(dst, 'WEBP', quality=90, method=6)
        a = shown(out)
        rows.append((dst.stem, b, a))
    va = lambda d: (d[0] * d[1]) ** 0.5
    for w, b, a in rows:
        print(f'{w:9} before {b[0]:.2f}×{b[1]:.2f} (√A {va(b):.2f})  →  after {a[0]:.2f}×{a[1]:.2f} (√A {va(a):.2f})  {100 * (va(a) / va(b) - 1):+.0f} %')
    if rows:
        bs, as_ = [va(b) for _, b, _ in rows], [va(a) for _, _, a in rows]
        print(f'{len(rows)} cards fitted · visual size min/max before {min(bs):.2f}/{max(bs):.2f} (×{max(bs) / min(bs):.2f})'
              f' → after {min(as_):.2f}/{max(as_):.2f} (×{max(as_) / min(as_):.2f})')


if __name__ == '__main__':
    fit_all()
