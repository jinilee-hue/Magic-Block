"""The painted sparkle lights (warm dust motes floating in the window's sunbeam) of the playroom background
→ src/data/sparkles.json as [x, y, r] in background-image px (the title/game make each one twinkle).
White top-hat on luminance inside the sunbeam region, small round warm blobs only; debug overlay in scratch.
run from the project root: /Users/jini/.hermes/bin/uv run --with pillow --with numpy --with scipy python tools/find_sparkles.py
Re-run (and look at the overlay) whenever src/assets/bg.webp changes.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

SRC = Path('src/assets/bg.webp')
OUT = Path('src/data/sparkles.json')
DBG = Path(sys.argv[1]) if len(sys.argv) > 1 else None
REGION = (470, 60, 1360, 1160)          # x0, y0, x1, y1: the sunbeam from the window and the bookshelf beside it
                                         # (left of 470 = the bright window and its frame; below 1160 = the table rim's glare)
EXCLUDE = [(702, 941)]                   # the teddy's sunlit forehead
EXTRA = [[912, 1172.5, 6.5]]             # the big glowing dot by the table (too big for the dot filter)

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float32) / 255
lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
bgnd = ndi.uniform_filter(ndi.grey_opening(lum, size=(21, 21)), 7)   # the picture without anything smaller than ~20 px
top = lum - bgnd
mask = (top > 0.055) & (lum > 0.70)
x0, y0, x1, y1 = REGION
keep = np.zeros_like(mask); keep[y0:y1, x0:x1] = True
lab, n = ndi.label(mask & keep)
spots = []
for i, sl in enumerate(ndi.find_objects(lab), 1):
    if sl is None: continue
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    blob = lab[sl] == i
    area = int(blob.sum())
    if area < 2 or area > 120 or max(h, w) > 16 or max(h, w) > 2.6 * min(h, w) + 1: continue   # dots, not edges or toy highlights
    yy, xx = np.nonzero(blob)
    cy, cx = yy.mean() + ys.start, xx.mean() + xs.start
    r, g, b = a[int(round(cy)), int(round(cx))]
    if b > r + 0.02: continue                                    # warm light only
    peak = float(top[sl][blob].max())
    if any(abs(cx - ex) < 8 and abs(cy - ey) < 8 for ex, ey in EXCLUDE): continue
    spots.append([round(float(cx), 1), round(float(cy), 1), round(max(1.2, (area / np.pi) ** 0.5), 1), round(peak, 3)])
spots += [e + [1.0] for e in EXTRA]
spots.sort(key=lambda s: (s[1], s[0]))
json.dump([s[:3] for s in spots], open(OUT, 'w'), separators=(',', ':'))
print(f'{len(spots)} sparkle lights → {OUT}  (r px: min {min(s[2] for s in spots)}, max {max(s[2] for s in spots)})')
if DBG:
    c = im.crop(REGION)
    d = ImageDraw.Draw(c)
    for x, y, r, p in spots:
        x, y, rr = x - x0, y - y0, r + 6
        d.ellipse((x - rr, y - rr, x + rr, y + rr), outline=(255, 0, 90), width=2)
    c.save(DBG)
    print('overlay', DBG, c.size)
