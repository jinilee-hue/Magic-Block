"""The tutor's 'muzzle' patches: each pose's own mouth painted out of its picture, so the game can draw a talking mouth
over it (ui/fox.ts drawMouth).

The hole = the mouth (its colours and dark lines, only the pieces touching the mouth box), grown over its soft rim and
shading, an ellipse round it and a disc at each corner (a smile's creases); never the nose, nothing above the mouth's
top. It is filled by Laplace interpolation from the clean ring round it: smooth like the render, and never darker or
lighter than that ring. The earlier Telea fill (OpenCV) left streaks and faint arcs of the old mouth on the muzzle (user:
"입주변도 좀 어색한데"); a biharmonic fill overshot into a yellow-green stain.

build_tutor_assemble.py (stage 4) calls paint_muzzle() for every pose; alone, this rebuilds public/fox/muzzle.webp and
the `muzzle` entries of fox.json from the pose pictures already there (their mouths are still in them):
  uv run --with pillow --with numpy --with scipy python tools/build_tutor_muzzle.py [public/fox] [debug.png]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi


def lum(rgb):
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def mouth_colours(rgb, solid):
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    inside = (R > 50) & (R > 1.9 * G) & (lum(rgb) < 130)
    tongue = (R > 190) & (G < 150) & (B > 100) & (R - G > 75) & (R - B < 120)
    return (inside | tongue) & solid


def nose_blob(rgb, solid, nose, r):
    """the nose's dark blob nearest to `nose` (pose px), or an empty mask"""
    dark = (lum(rgb) < 70) & solid
    lab, n = ndi.label(dark)
    if not n:
        return np.zeros_like(dark)
    nx, ny = nose
    best, bd = 0, r
    for i, (sy, sx) in enumerate(ndi.find_objects(lab), 1):
        yy, xx = np.nonzero(lab[sy, sx] == i)
        d = float(np.hypot(xx.mean() + sx.start - nx, yy.mean() + sy.start - ny))
        if d < bd:
            best, bd = i, d
    return lab == best if best else np.zeros_like(dark)


def find_mouth(img, x, top, wid):
    """the mouth box (pose px) near its centre x / top y and width (fox.json `mouth`)"""
    rgb = img[..., :3].astype(np.float32)
    solid = img[..., 3] > 230
    H, W = solid.shape
    yy, xx = np.mgrid[0:H, 0:W]
    win = (xx > x - wid * 0.75) & (xx < x + wid * 0.75) & (yy > top - wid * 0.15) & (yy < top + wid * 1.1)
    m = ndi.binary_closing((mouth_colours(rgb, solid) | (lum(rgb) < 95)) & win & solid, iterations=2)
    lab, n = ndi.label(m)
    if not n:
        raise SystemExit(f'no mouth near {x, top}')
    # the piece whose top and middle are nearest the seed (the biggest was the reading pose's book edge under its small
    # closed mouth)
    best, bd = 1, 1e9
    for i, (sy, sx) in enumerate(ndi.find_objects(lab), 1):
        if (lab[sy, sx] == i).sum() < 6:
            continue
        d = abs(sy.start - top) + 0.5 * abs((sx.start + sx.stop) / 2 - x)
        if d < bd:
            best, bd = i, d
    ys, xs = np.nonzero(lab == best)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def harmonic_fill(rgb, hole, known):
    """Laplace fill of `hole` from its `known` neighbours (others: no flux) — smooth, and never darker or lighter than
    the ring round it (the biharmonic fill overshot into a yellow-green stain on the cheering pose)"""
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import splu
    H, W = hole.shape
    ys, xs = np.nonzero(hole)
    n = len(ys)
    idx = -np.ones((H, W), np.int64)
    idx[ys, xs] = np.arange(n)
    rows, cols, vals = [], [], []
    diag, b = np.zeros(n), np.zeros((n, 3))
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        yy, xx = ys + dy, xs + dx
        ok = (yy >= 0) & (yy < H) & (xx >= 0) & (xx < W)
        yc, xc = np.clip(yy, 0, H - 1), np.clip(xx, 0, W - 1)
        inh = ok & hole[yc, xc]
        kn = ok & ~hole[yc, xc] & known[yc, xc]
        diag += inh | kn
        r = np.nonzero(inh)[0]
        rows.append(r); cols.append(idx[yc[r], xc[r]]); vals.append(-np.ones(len(r)))
        b[kn] += rgb[yc[kn], xc[kn]]
    rows.append(np.arange(n)); cols.append(np.arange(n)); vals.append(np.maximum(diag, 1))
    A = coo_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)).tocsc()
    lu = splu(A)
    out = rgb.copy()
    out[ys, xs] = np.stack([lu.solve(b[:, c]) for c in range(3)], -1)
    return out


def paint_muzzle(img, mbox, nose):
    """the pose picture (RGBA uint8) with its mouth box (x0, y0, x1, y1) and nose point (pose px) →
    (patch RGBA uint8, x, y): the painted-out muzzle and where it goes on the picture"""
    rgb = img[..., :3].astype(np.float32)
    a = img[..., 3].astype(np.float32) / 255
    solid = a > 0.9
    H, W = solid.shape
    mx0, my0, mx1, my1 = mbox
    mwid, mh = mx1 - mx0, my1 - my0
    cx, cy = (mx0 + mx1) / 2, (my0 + my1) / 2
    yy, xx = np.mgrid[0:H, 0:W]
    # the mouth: its colours and dark lines round it, only the pieces that touch its box (not a bit of the nose, an
    # eye or the book that falls in the window)
    win = (yy >= my0 - mwid * 0.1) & (yy <= my1 + mwid * 0.3) & (xx >= mx0 - mwid * 0.3) & (xx <= mx1 + mwid * 0.3)
    m = ndi.binary_closing((mouth_colours(rgb, solid) | (lum(rgb) < 95)) & win & solid, iterations=2)
    lab, n = ndi.label(m)
    box = np.zeros_like(m)
    box[my0:my1 + 1, mx0:mx1 + 1] = True
    keep = np.unique(lab[box & m])
    m = np.isin(lab, keep[keep > 0])
    # the nose stays, with a margin
    nose_m = ndi.binary_dilation(nose_blob(rgb, solid, nose, mwid * 0.8), iterations=max(3, mwid // 16))
    # the hole: the mouth grown over its rim and shading, an ellipse round it, and a disc at each corner (a smile's
    # creases curve up and out from there: on the jumping pose they stayed as two dimples beside the drawn mouth)
    ell = ((xx - cx) / (0.5 * mwid * 1.25 + 3)) ** 2 + ((yy - cy) / (0.5 * mh * 1.3 + mwid * 0.1)) ** 2 <= 1
    my_, mx_ = np.nonzero(m)
    corners = np.zeros_like(m)
    for sgn in (-1, 1):
        i = int(np.argmin(mx_)) if sgn < 0 else int(np.argmax(mx_))
        ccx, ccy = mx_[i] + sgn * mwid * 0.12, my_[i] - mwid * 0.04
        corners |= (xx - ccx) ** 2 + (yy - ccy) ** 2 <= (mwid * 0.26) ** 2
    hole = (ndi.binary_dilation(m, iterations=max(5, mwid // 7)) | ell | corners) & solid & (yy >= my0 - mwid * 0.12) & ~nose_m
    # the fill (on a crop round the hole, for speed): Laplace from the clean ring round it
    ys, xs = np.nonzero(hole)
    pad = max(12, mwid // 2)
    y0, y1, x0, x1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1), max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
    filled = rgb.copy()
    filled[y0:y1, x0:x1] = harmonic_fill(rgb[y0:y1, x0:x1], hole[y0:y1, x0:x1], solid[y0:y1, x0:x1])
    # a short feather past the hole's edge (outside the hole the patch IS the picture: no seam if the two meshes differ
    # by a sub-pixel)
    grow = ndi.binary_dilation(hole, iterations=max(2, mwid // 18))
    soft = ndi.gaussian_filter(grow.astype(np.float32), max(1.2, mwid / 30))
    soft = np.minimum(np.where(hole, 1.0, soft), a)
    ys, xs = np.nonzero(soft > 0.01)
    bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    patch = np.dstack([filled[by0:by1, bx0:bx1].round().clip(0, 255).astype(np.uint8), (soft[by0:by1, bx0:bx1] * 255).round().astype(np.uint8)])
    return patch, bx0, by0


def atlas(patches):
    """[(name, patch, frame x, frame y)] → (atlas RGBA, {name: muzzle entry})"""
    AW = sum(pt.shape[1] for _, pt, _, _ in patches) + 4 * len(patches)
    AH = max(pt.shape[0] for _, pt, _, _ in patches)
    out = np.zeros((AH, AW, 4), np.uint8)
    meta, x = {}, 0
    for name, pt, fx, fy in patches:
        out[:pt.shape[0], x:x + pt.shape[1]] = pt
        meta[name] = {'sx': x, 'sy': 0, 'sw': int(pt.shape[1]), 'sh': int(pt.shape[0]), 'x': round(float(fx), 1), 'y': round(float(fy), 1)}
        x += pt.shape[1] + 4
    return out, meta


def run(fox_dir: Path, dbg: Path | None = None):
    meta = json.loads((fox_dir / 'fox.json').read_text())
    patches, tiles = [], []
    for name, P in meta['poses'].items():
        img = np.array(Image.open(fox_dir / P['file']).convert('RGBA'))
        M = P['mouth']
        mbox = find_mouth(img, M['x'] - P['x'], M['y'] - P['y'], M['art'])
        nose = (P['nose'][0] - P['x'], P['nose'][1] - P['y'])
        patch, bx, by = paint_muzzle(img, mbox, nose)
        patches.append((name, patch, bx + P['x'], by + P['y']))
        print(f"{name}: mouth box {mbox} ({mbox[2] - mbox[0]} wide, art {M['art']}) → patch {patch.shape[1]}×{patch.shape[0]} at {bx},{by}")
        if dbg:
            # before | after, round the mouth
            pad = int(M['art'] * 0.9)
            cx, cy = (mbox[0] + mbox[2]) // 2, (mbox[1] + mbox[3]) // 2
            crop = (cx - pad, cy - pad, cx + pad, cy + pad)
            before = Image.fromarray(img).crop(crop)
            after_full = Image.fromarray(img.copy())
            after_full.alpha_composite(Image.fromarray(patch), (bx, by))
            after = after_full.crop(crop)
            bg = Image.new('RGBA', before.size, (233, 238, 246, 255))
            tiles.append((name, Image.alpha_composite(bg, before).resize((300, 300)), Image.alpha_composite(bg, after).resize((300, 300))))
    at, mz = atlas(patches)
    Image.fromarray(at, 'RGBA').save(fox_dir / 'muzzle.webp', 'WEBP', quality=94, alpha_quality=100, method=6)
    for name, e in mz.items():
        meta['poses'][name]['muzzle'] = e
    (fox_dir / 'fox.json').write_text(json.dumps(meta, indent=1))
    print('muzzle.webp', at.shape[1], '×', at.shape[0], (fox_dir / 'muzzle.webp').stat().st_size // 1024, 'KB')
    if dbg and tiles:
        sheet = Image.new('RGB', (2 * 304, len(tiles) * 320), 'white')
        d = ImageDraw.Draw(sheet)
        for i, (name, b, a2) in enumerate(tiles):
            sheet.paste(b.convert('RGB'), (0, i * 320 + 18)); sheet.paste(a2.convert('RGB'), (304, i * 320 + 18))
            d.text((4, i * 320 + 3), f'{name}: art', fill=(0, 0, 0)); d.text((308, i * 320 + 3), f'{name}: painted out', fill=(0, 0, 0))
        sheet.save(dbg)
        print('debug', dbg)


if __name__ == '__main__':
    d = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / 'public' / 'fox'
    run(d, Path(sys.argv[2]) if len(sys.argv) > 2 else None)
