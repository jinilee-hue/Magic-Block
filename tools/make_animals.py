"""The four player animals from the user's art (~/Downloads/jenga_<animal>.png, opened by exact name only):
round badges (cream 3D ring, plush animal inside) → src/assets/ani_<animal>.webp, 512 px, transparent outside the ring.

Some come without transparency (kitty was RGB on white): the ring is a circle touching the square, so the cut is a
circle fitted to the badge's own outline (least squares on the edge of the not-white area), drawn anti-aliased.

    uv run --with pillow --with numpy --with scipy python tools/make_animals.py
"""
import os
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(os.path.expanduser('~/Downloads'))
ANIMALS = ('bunny', 'kitty', 'puppy', 'panda')
SIZE = 512


def fit_circle(mask: np.ndarray):
    """least-squares circle through the outline of a filled mask"""
    edge = mask & ~ndi.binary_erosion(mask)
    ys, xs = np.nonzero(edge)
    A = np.c_[2 * xs, 2 * ys, np.ones(len(xs))]
    b = xs ** 2 + ys ** 2
    (cx, cy, c), *_ = np.linalg.lstsq(A, b, rcond=None)
    r = float(np.sqrt(c + cx ** 2 + cy ** 2))
    resid = np.abs(np.hypot(xs - cx, ys - cy) - r)
    return float(cx), float(cy), r, float(np.percentile(resid, 95))


def circle_alpha(h, w, cx, cy, r, ss=4):
    """anti-aliased disc (ss x ss samples per pixel)"""
    o = (np.arange(ss) + 0.5) / ss - 0.5
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    acc = np.zeros((h, w), np.float32)
    for dy in o:
        for dx in o:
            acc += (np.hypot(xx + dx - cx, yy + dy - cy) <= r)
    return acc / (ss * ss)


def main():
    out_dir = ROOT / 'src' / 'assets'
    for n in ANIMALS:
        im = Image.open(SRC / f'jenga_{n}.png')
        rgba = np.asarray(im.convert('RGBA')).astype(np.float32)
        h, w = rgba.shape[:2]
        if im.mode == 'RGBA' and (rgba[..., 3] < 8).mean() > 0.1:
            a = rgba[..., 3] / 255
            cx, cy, r, res = fit_circle(a > 0.5)
            how = 'own alpha'
        else:
            # not-white = the badge (its ring is cream, never pure white); fill the inside, keep the biggest piece
            notwhite = (255 - rgba[..., :3]).max(-1) > 10
            lab, k = ndi.label(ndi.binary_fill_holes(ndi.binary_closing(notwhite, iterations=3)))
            sizes = ndi.sum(np.ones((h, w)), lab, range(1, k + 1))
            badge = lab == 1 + int(np.argmax(sizes))
            cx, cy, r, res = fit_circle(badge)
            a = circle_alpha(h, w, cx, cy, r - 1.0)        # 1 px inside the outline: no white rim
            how = 'circle cut'
        print(f'{n:6s} {im.size} {im.mode} {how}: centre ({cx:.1f}, {cy:.1f}) r {r:.1f} edge fit p95 {res:.2f}px')
        # square crop around the circle, premultiplied resize (no white fringe from the transparent corners)
        x0, y0 = int(np.floor(cx - r)), int(np.floor(cy - r))
        side = int(np.ceil(2 * r)) + 1
        canvas = np.zeros((side, side, 4), np.float32)
        sx0, sy0 = max(0, x0), max(0, y0)
        sx1, sy1 = min(w, x0 + side), min(h, y0 + side)
        canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0, :3] = rgba[sy0:sy1, sx0:sx1, :3]
        canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0, 3] = a[sy0:sy1, sx0:sx1] * 255
        big = Image.fromarray(canvas.round().clip(0, 255).astype(np.uint8), 'RGBA').convert('RGBa')
        small = big.resize((SIZE, SIZE), Image.Resampling.LANCZOS).convert('RGBA')
        dst = out_dir / f'ani_{n}.webp'
        small.save(dst, 'WEBP', quality=90, alpha_quality=100, method=6)
        print(f'       → {dst.relative_to(ROOT)} {dst.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
