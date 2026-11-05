"""Eye outlines for the tutor's drawn blinks (ui/fox.ts draws eyelids over the eyes — squashing the picture smeared the
iris and bent the glasses). For each eye: the eye as drawn (white, iris, pupil, lash line) segmented around the iris
centre and fitted with an ellipse; plus the fur colours just above and below it (the lids' colours) and the lash colour.

Used by build_tutor_assemble.py (fox.json rig.lids). Standalone: check the fits on the built frame images —
  uv run --with pillow --with numpy --with scipy --with opencv-python-headless python tools/tutor_eyes.py public/fox out.png
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage as ndi


def _hsv(rgb):
    f = rgb.astype(np.float32) / 255
    mx, mn = f.max(-1), f.min(-1)
    s = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return s, mx


def eye_ellipse(rgba, cx, cy, iris_h, nose=None, below=None):
    """rgba: HxWx4 uint8 (pose image), (cx, cy) the iris centre in it, iris_h its height, nose the nose centre (the far
    eye of a turned head touches the nose, which is in front of it: cut out), below: the eye's lowest point under the
    iris centre (x iris_h) where the skin under it is as pale as the eye white. → dict or None"""
    R = int(round(1.45 * iris_h))
    x0, y0 = max(0, int(cx) - R), max(0, int(cy) - R)
    x1, y1 = min(rgba.shape[1], int(cx) + R + 1), min(rgba.shape[0], int(cy) + R + 1)
    win = rgba[y0:y1, x0:x1]
    s, v = _hsv(win[..., :3])
    solid = win[..., 3] > 128
    # the eye: everything that is not lit fur — fur is orange / cream / pink (S > 0.145, bright); the eye white is a
    # warm white (S 0.03-0.14), the iris and lash line are dark (lower iris a mid brown, V ~0.5); the pale skin under
    # the far eye of the jumping pose is S 0.15-0.16 (not eye)
    eye = solid & ~((s > 0.145) & (v > 0.6))
    # no further from the iris centre than the eye can reach (the white is beside the iris, never a whole iris away)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    eye &= np.hypot(xx - cx, yy - cy) < 1.08 * iris_h
    if below is not None:
        eye &= (yy - cy) < below * iris_h
    nose_cut = np.zeros_like(eye)
    if nose is not None:
        nx, ny = int(round(nose[0])) - x0, int(round(nose[1])) - y0
        if 0 <= ny < eye.shape[0] and 0 <= nx < eye.shape[1]:
            nl, _ = ndi.label(solid & (v < 0.42))
            if nl[ny, nx]:
                # the nose's dark blob can run into the far eye's iris: split the blob between the two centres, by
                # distance relative to each one's size (iris radius ~iris_h/2, nose ~0.3 iris_h)
                d_n = np.hypot(xx - nose[0], yy - nose[1]) / (0.3 * iris_h)
                d_i = np.hypot(xx - cx, yy - cy) / (0.5 * iris_h)
                blob = (nl == nl[ny, nx]) & (d_n < d_i)
                nose_cut = ndi.binary_dilation(blob, iterations=max(3, int(iris_h * 0.05)))
                eye &= ~nose_cut
    eye = ndi.binary_closing(eye, iterations=2)
    eye = ndi.binary_opening(eye, iterations=max(2, int(iris_h * 0.04)))
    lab, n = ndi.label(eye)
    c = lab[int(cy) - y0, int(cx) - x0]
    if c == 0:
        # centre on a highlight hole: nearest component
        d = ndi.distance_transform_edt(lab == 0, return_indices=True)[1]
        c = lab[d[0][int(cy) - y0, int(cx) - x0], d[1][int(cy) - y0, int(cx) - x0]]
    if c == 0:
        return None
    m = ndi.binary_fill_holes(lab == c)
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None
    cnt = max(cs, key=cv2.contourArea)
    if len(cnt) < 6:
        return None
    (ex, ey), (w, h), ang = cv2.fitEllipse(cnt)
    # cv2: w along the angle direction; express as rx (horizontal-ish) / ry and a small tilt
    if w < h:
        rx, ry, rot = w / 2, h / 2, ang
    else:
        rx, ry, rot = h / 2, w / 2, ang - 90
    rot = ((rot + 90) % 180) - 90
    if abs(rot) > 45:
        rx, ry, rot = ry, rx, rot - 90 * np.sign(rot)
    return {'x': ex + x0, 'y': ey + y0, 'rx': rx, 'ry': ry, 'rot': float(rot), 'mask': (m, x0, y0), 'nose': (nose_cut, x0, y0)}


def ring_colour(rgba, e, a0, a1, d0=1.12, d1=1.32):
    """median fur colour on the ring d0..d1 x the ellipse between angles a0..a1 (deg, 0 = right, 90 = down)"""
    pts = []
    th = np.radians(e['rot'])
    for a in np.linspace(np.radians(a0), np.radians(a1), 24):
        for d in np.linspace(d0, d1, 5):
            px, py = e['rx'] * d * np.cos(a), e['ry'] * d * np.sin(a)
            x = e['x'] + px * np.cos(th) - py * np.sin(th)
            y = e['y'] + px * np.sin(th) + py * np.cos(th)
            xi, yi = int(round(x)), int(round(y))
            if 0 <= yi < rgba.shape[0] and 0 <= xi < rgba.shape[1] and rgba[yi, xi, 3] > 200:
                pts.append(rgba[yi, xi, :3])
    if not pts:
        return [214, 120, 64]
    a = np.array(pts, np.float32)
    s, v = _hsv(a[None].astype(np.uint8))
    keep = (v[0] > 0.45) & (s[0] > 0.12)           # fur, not lashes / glasses / white
    a = a[keep] if keep.sum() >= 5 else a
    return [int(c) for c in np.median(a, 0)]


def lash_colour(rgba, e):
    m, x0, y0 = e['mask']
    rgb = rgba[y0:y0 + m.shape[0], x0:x0 + m.shape[1], :3][m]
    v = rgb.max(-1)
    dark = rgb[v <= np.percentile(v, 8)]
    return [int(c) for c in np.median(dark, 0)] if len(dark) else [52, 30, 24]


def lids_for(rgba, eyes, iris_h, nose=None, below=(None, None), ox=0.0, oy=0.0):
    """eyes: iris centres in the image; nose: its centre; below: per eye (see eye_ellipse);
    → list of lid dicts in image px + (ox, oy)"""
    out = []
    for (cx, cy), lim in zip(eyes, below):
        e = eye_ellipse(rgba, cx, cy, iris_h, nose, lim)
        if e is None:
            return None
        out.append({'x': round(e['x'] + ox, 1), 'y': round(e['y'] + oy, 1), 'rx': round(e['rx'], 1), 'ry': round(e['ry'], 1),
                    'rot': round(e['rot'], 1), 'top': ring_colour(rgba, e, 200, 340), 'low': ring_colour(rgba, e, 40, 140),
                    'lash': lash_colour(rgba, e), '_e': e})
    return out


def debug_sheet(items, path):
    """items: [(label, rgba, lids)] → crops with the fitted ellipses"""
    from PIL import Image, ImageDraw
    tiles = []
    for label, rgba, lids in items:
        for i, L in enumerate(lids):
            pad = 1.7
            x0, y0 = int(L['x'] - L['rx'] * pad), int(L['y'] - L['ry'] * pad)
            x1, y1 = int(L['x'] + L['rx'] * pad), int(L['y'] + L['ry'] * pad)
            im = Image.fromarray(rgba).crop((x0, y0, x1, y1))
            bg = Image.new('RGBA', im.size, (233, 238, 246, 255)); bg.alpha_composite(im)
            k = 3
            bg = bg.resize((im.width * k, im.height * k), Image.Resampling.LANCZOS).convert('RGB')
            d = ImageDraw.Draw(bg)
            # the segmented eye (red tint) and the cut-out nose (blue tint)
            for key, col in (('mask', (255, 0, 0, 70)), ('nose', (0, 80, 255, 70))):
                mk, mx0, my0 = L['_e'][key]
                tint = Image.new('RGBA', bg.size, (0, 0, 0, 0))
                mimg = Image.fromarray((mk * 255).astype(np.uint8)).resize((mk.shape[1] * k, mk.shape[0] * k))
                lay = Image.new('RGBA', mimg.size, col)
                tint.paste(lay, ((mx0 - x0) * k, (my0 - y0) * k), mimg)
                bg = Image.alpha_composite(bg.convert('RGBA'), tint).convert('RGB')
            d = ImageDraw.Draw(bg)
            th = np.radians(L['rot'])
            pts = []
            for a in np.linspace(0, 2 * np.pi, 90):
                px, py = L['rx'] * np.cos(a), L['ry'] * np.sin(a)
                pts.append(((L['x'] + px * np.cos(th) - py * np.sin(th) - x0) * k, (L['y'] + px * np.sin(th) + py * np.cos(th) - y0) * k))
            d.line(pts + [pts[0]], fill=(0, 220, 90), width=2)
            for j, key in enumerate(('top', 'low', 'lash')):
                d.rectangle([4 + j * 34, 4, 34 + j * 34, 30], fill=tuple(L[key]), outline=(0, 0, 0))
            d.text((4, bg.height - 14), f"{label} {i} rx{L['rx']:.0f} ry{L['ry']:.0f} rot{L['rot']:.0f}", fill=(0, 0, 0))
            tiles.append(bg)
    H = max(t.height for t in tiles)
    sheet = Image.new('RGB', (sum(t.width + 6 for t in tiles), H), (255, 255, 255))
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0)); x += t.width + 6
    sheet.save(path)


if __name__ == '__main__':
    from PIL import Image
    BELOW = {'jump': (0.76, None)}       # same table as build_tutor_assemble.EYE_BELOW
    d, out = Path(sys.argv[1]), sys.argv[2]
    meta = json.loads((d / 'fox.json').read_text())
    items = []
    for name, P in meta['poses'].items():
        if name not in ('teach', 'jump'):
            continue
        rgba = np.array(Image.open(d / P['file']).convert('RGBA'))
        eyes = [(ex - P['x'], ey - P['y']) for ex, ey in P['eyes']]
        iris_h = P['rig']['eyeR'] / 0.65
        lids = lids_for(rgba, eyes, iris_h, (P['nose'][0] - P['x'], P['nose'][1] - P['y']), BELOW.get(name, (None, None)))
        if lids is None:
            print(name, 'FAILED'); continue
        for L in lids:
            print(name, {k: v for k, v in L.items() if k != '_e'})
        items.append((name, rgba, lids))
    debug_sheet(items, out)
    print('→', out)
