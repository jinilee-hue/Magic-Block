"""Fox lip-sync parts, cut from the fox's own video frames (public/fox/<clip>.webp sprite sheets).

For the talking clips (talk, say, point): find the nose in every frame (the small dark-brown blob under the eyes) and
measure how open the mouth is (dark mouth-interior pixels in a box under the nose). From each clip take three mouth
patches — closed, half open, open — from its own frames, with a feathered oval mask big enough to cover any mouth
of that clip. At play time the game draws the clip as before and lays the patch that matches the voice over the
mouth, placed from that frame's nose (public/fox/mouth.webp + fox.json "mouth").
run from the project root: /Users/jini/.hermes/bin/uv run --with pillow --with numpy --with scipy python tools/build_fox_mouth.py [preview.png]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

FOX = Path('public/fox')
CLIPS = ('talk', 'say', 'point')
meta = json.loads((FOX / 'fox.json').read_text())
FW, FH = meta['frameW'], meta['frameH']
PW, PH = 84, 58                 # patch box (frame px)
OX, OY = -42, 6                 # patch box top-left relative to the nose centre
RX, RY, FEATHER = 31, 19, 9     # opaque oval (around the mouth centre) + soft edge


def frames(clip):
    c = meta['clips'][clip]
    sheet = Image.open(FOX / c['file']).convert('RGBA')
    for i in range(c['frames']):
        x, y = (i % c['cols']) * FW, (i // c['cols']) * FH
        yield np.asarray(sheet.crop((x, y, x + FW, y + FH))).astype(np.float32) / 255


def lum_of(a):
    return a[..., :3] @ np.array([.299, .587, .114], np.float32)


# the nose, as it looks in say frame 0 (found by hand: dark-brown blob at 137, 232) — matched in every frame
TPL = np.zeros((1, 1), np.float32)
TW, TH = 34, 24


def nose_of(a, prev=None):
    """best normalised cross-correlation of the nose template, near the previous frame's nose (or anywhere on the face)"""
    from numpy.lib.stride_tricks import sliding_window_view
    lum = lum_of(a)
    if prev is None:
        x0, x1, y0, y1 = 70, 290, 150, 290
    else:
        x0, x1, y0, y1 = int(prev[0]) - 30, int(prev[0]) + 30, int(prev[1]) - 24, int(prev[1]) + 24
    reg = lum[y0 - TH // 2:y1 + TH // 2, x0 - TW // 2:x1 + TW // 2]
    win = sliding_window_view(reg, (TH, TW))
    t = (TPL - TPL.mean()) / (TPL.std() + 1e-6)
    wm = win.mean(axis=(2, 3), keepdims=True); ws = win.std(axis=(2, 3), keepdims=True) + 1e-6
    ncc = (((win - wm) / ws) * t).mean(axis=(2, 3))
    iy, ix = np.unravel_index(np.argmax(ncc), ncc.shape)
    return (float(x0 + ix), float(y0 + iy)), float(ncc.max())


def openness(a, nose):
    rgb = a[..., :3]
    lum = rgb @ np.array([.299, .587, .114], np.float32)
    nx, ny = int(round(nose[0])), int(round(nose[1]))
    box = (slice(ny + 8, ny + 46), slice(nx - 34, nx + 34))
    inner = (lum[box] < 0.33) & (rgb[box][..., 0] > rgb[box][..., 2] * 1.15)     # dark red-brown mouth inside
    lab, n = ndi.label(inner)
    if not n:
        return 0, (nx, ny + 22)
    sizes = ndi.sum(inner, lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    yy, xx = np.nonzero(lab == k)
    return int(sizes[k - 1]), (nx - 34 + xx.mean(), ny + 8 + yy.mean())


def mask_for(mc_x, mc_y):
    """feathered oval in patch coords"""
    yy, xx = np.mgrid[0:PH, 0:PW].astype(np.float32)
    d = np.sqrt(((xx - mc_x) / RX) ** 2 + ((yy - mc_y) / RY) ** 2)      # 1 at the oval's edge
    edge = FEATHER / min(RX, RY)
    return np.clip((1 + edge - d) / edge, 0, 1)


out = {'box': [PW, PH, OX, OY], 'clips': {}}
patches = []
report = {}
_say0 = next(frames('say'))
TPL = lum_of(_say0)[232 - TH // 2:232 + TH // 2, 137 - TW // 2:137 + TW // 2].copy()
for clip in CLIPS:
    fr = list(frames(clip))
    noses, opens, centres, fits = [], [], [], []
    prev = None
    for a in fr:
        n, fit = nose_of(a, prev)
        prev = n
        o, c = openness(a, n)
        noses.append(n); opens.append(o); centres.append(c); fits.append(round(fit, 2))
    print(clip, 'nose fit (NCC)', fits)
    order = np.argsort(opens)
    mx = max(opens)
    half_i = int(np.argmin([abs(o - 0.45 * mx) for o in opens]))
    pick = {'closed': int(order[0]), 'half': half_i, 'open': int(order[-1])}
    report[clip] = {'open': opens, 'pick': pick}
    # mouth centre (patch coords) shared by the clip: the mean mouth centre relative to the nose
    rel = np.array([(c[0] - n[0] - OX, c[1] - n[1] - OY) for c, n in zip(centres, noses)])
    mcx, mcy = float(np.median(rel[:, 0])), float(np.median(rel[:, 1]))
    msk = mask_for(mcx, mcy)
    idx = {}
    for state, fi in pick.items():
        nx, ny = noses[fi]
        x0, y0 = int(round(nx + OX)), int(round(ny + OY))
        p = fr[fi][y0:y0 + PH, x0:x0 + PW].copy()
        p[..., 3] *= msk
        idx[state] = len(patches)
        patches.append(p)
    out['clips'][clip] = {'nose': [[round(n[0], 1), round(n[1], 1)] for n in noses], 'patch': idx, 'from': pick,
                          # frames where the nose match is weak (the head turned away): leave their own mouth
                          'skip': [i for i, f in enumerate(fits) if f < 0.95]}

# one sheet, patches side by side
sheet = np.zeros((PH, PW * len(patches), 4), np.float32)
for i, p in enumerate(patches):
    sheet[:, i * PW:(i + 1) * PW] = p
Image.fromarray((sheet * 255).round().astype(np.uint8), 'RGBA').save(FOX / 'mouth.webp', 'WEBP', lossless=True)
meta['mouth'] = out
(FOX / 'fox.json').write_text(json.dumps(meta, indent=1))
for clip, r in report.items():
    print(clip, 'openness per frame', r['open'], '→ picked', r['pick'])
print('mouth.webp', sheet.shape[1], 'x', sheet.shape[0])

# preview: every frame of each clip × (as is | closed | half | open)
if len(sys.argv) > 1:
    rows = []
    for clip in CLIPS:
        fr = list(frames(clip)); c = out['clips'][clip]
        for fi, a in enumerate(fr):
            base = Image.fromarray((a * 255).astype(np.uint8), 'RGBA')
            nx, ny = c['nose'][fi]
            cells = [base]
            for state in ('closed', 'half', 'open'):
                im = base.copy()
                p = Image.fromarray((patches[c['patch'][state]] * 255).astype(np.uint8), 'RGBA')
                im.alpha_composite(p, (int(round(nx + OX)), int(round(ny + OY))))
                cells.append(im)
            row = Image.new('RGB', (4 * 120, 120), (236, 226, 242))
            for k, im in enumerate(cells):
                if k == 0:
                    ImageDraw.Draw(im).ellipse((nx - 2, ny - 2, nx + 2, ny + 2), outline=(0, 200, 255))
                cx, cy = int(nx), int(ny)
                cr = im.crop((cx - 60, cy - 50, cx + 60, cy + 70))
                bg = Image.new('RGB', cr.size, (236, 226, 242)); bg.paste(cr, (0, 0), cr)
                row.paste(bg, (k * 120, 0))
            ImageDraw.Draw(row).text((3, 3), f'{clip} {fi}', fill=(0, 0, 0))
            rows.append(row)
    cols = 3
    n = len(rows); rws = (n + cols - 1) // cols
    s = Image.new('RGB', (cols * (480 + 12), rws * 124), (255, 255, 255))
    for i, r in enumerate(rows):
        s.paste(r, ((i % cols) * (480 + 12), (i // cols) * 124))
    s.save(sys.argv[1]); print('preview', sys.argv[1], s.size)
