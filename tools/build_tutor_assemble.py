"""Stage 4 of tools/build_tutor.py: measure, align, paint the mouth out, write the game assets.

Per pose (its 4x cutout): the mouth (dark-red inside + pink tongue under the nose), the nose (dark blob just above),
the eyes (two dark blobs above the nose; their spacing = the head size, their slope = the head tilt), the feet.
The sheet draws its top row bigger than the bottom row: every pose is scaled to one eye spacing, then all stand on one
ground line (the jumping pose keeps its jump: it floats above the line by its own gap on the sheet) in a shared frame.
The mouth is painted out (inpaint) into a small 'muzzle' patch per pose: while the fox talks (and, for poses drawn
with an open mouth, while it rests) the game lays the patch over the mouth and draws the mouth itself (ui/fox.ts).
→ public/fox/<pose>.webp, muzzle.webp, fox.json  (+ debug sheets next to the cache)
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

# the standing fox is this tall in the frame (the frame is drawn into a canvas the CSS sizes; ~2x the on-screen size)
STAND_H = 1100
# game pose → sheet pose
MAP = {'idle': 'teach', 'talk': 'teach', 'point': 'teach', 'say': 'read', 'happy': 'jump', 'cheer': 'great'}
# which mouth the pose shows while silent: 'art' = the drawn one, else a Rhubarb shape drawn by the game over the
# painted-out muzzle (teach and read are drawn mid-word, mouth open — at rest that looked like talking)
REST = {'teach': 'X', 'read': 'X', 'jump': 'art', 'great': 'art'}
# extra lift of a pose above the ground line, in standing heights (the sheet's jump floats; kept modest)
LIFT = {'jump': 0.07}
# Face seeds read off the sheet crops (1x crop px, tools/build_tutor.py POSES boxes; the colour rules alone took the pink
# inner ears for a tongue): eyes (viewer's left, right), nose, mouth box. measure() refines each one locally.
SEEDS = {
    'teach': {'eyes': [(122, 187), (210, 189)], 'nose': (135, 211), 'mouth': (130, 236, 172, 274)},
    'read': {'eyes': [(75, 204), (182, 211)], 'nose': (110, 243), 'mouth': (105, 266, 120, 277)},
    'jump': {'eyes': [(142, 206), (265, 219)], 'nose': (180, 236), 'mouth': (162, 269, 227, 316)},
    'great': {'eyes': [(97, 156), (225, 159)], 'nose': (145, 174), 'mouth': (122, 201, 187, 246)},
}
# the heads are turned (teach and read 3/4 to the viewer's left, jump a little): the drawn mouth is narrower there,
# and its far (left) half shorter than its near half (TURN < 0 = turned to the viewer's left)
YAW = {'teach': 0.82, 'read': 0.74, 'jump': 0.9, 'great': 1.0}
TURN = {'teach': -0.4, 'read': -0.45, 'jump': -0.15, 'great': 0.0}
# which sheet row a pose is on: the rows are drawn at different sizes (jump, top row, is matched by iris height)
ROW = {'teach': 'bottom', 'read': 'bottom', 'great': 'bottom', 'jump': 'top'}
# Rig for the motion (ui/fox.ts bends the still picture with a mesh — user: "기존에 있던거처럼 자연스러운 모션을 줘.
# 위아래 점프하는거 말고"): points read off each pose on a grid (scratch tutor/rig_grid.py), in px of the POSE image
# (as placed: x/y relative to the pose's top-left) — head centre + radius, neck, ears (base, tip), tail (base, tip),
# arms that may move (shoulder, hand). Re-read them if STAND_H or a crop box changes (the pose's scale changes).
RIG = {
    'teach': {'head': [398, 360, 270], 'neck': [386, 598], 'earL': [[273, 185], [242, 23]], 'earR': [[611, 210], [723, 35]],
              'tail': [[611, 968], [996, 548]], 'armL': [[273, 648], [48, 560]]},
    'read': {'head': [308, 443, 280], 'neck': [296, 718], 'earL': [[108, 218], [46, 18]], 'earR': [[496, 205], [596, 18]],
             'tail': [[521, 918], [846, 580]]},
    'jump': {'head': [396, 371, 280], 'neck': [384, 621], 'earL': [[246, 196], [209, 9]], 'earR': [[609, 184], [721, 34]],
             'tail': [[571, 859], [796, 684]], 'armL': [[259, 684], [53, 559]], 'armR': [[546, 684], [709, 571]]},
    'great': {'head': [377, 405, 280], 'neck': [364, 643], 'earL': [[214, 180], [177, 18]], 'earR': [[577, 155], [689, 18]],
              'tail': [[539, 868], [777, 705]], 'armL': [[239, 693], [46, 543]], 'armR': [[502, 693], [664, 518]]},
}
BLINKS = {'teach': True, 'read': True, 'jump': True, 'great': False}      # great's eyes are shut


def largest(mask, k=1):
    lab, n = ndi.label(mask)
    if n == 0:
        return []
    sizes = ndi.sum(np.ones(mask.shape), lab, range(1, n + 1))
    order = np.argsort(sizes)[::-1][:k]
    return [(lab == (i + 1), int(sizes[i])) for i in order]


def lum(rgb):
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def mouth_mask(rgb, solid):
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    inside = (R > 50) & (R > 1.9 * G) & (lum(rgb) < 130)
    tongue = (R > 190) & (G < 150) & (B > 100) & (R - G > 75) & (R - B < 120)
    return (inside | tongue) & solid


def blob_near(mask, cx, cy, r):
    """the biggest piece of mask within r of (cx, cy) → (piece, size) or None"""
    win = np.zeros_like(mask)
    y0, y1, x0, x1 = max(0, int(cy - r)), int(cy + r), max(0, int(cx - r)), int(cx + r)
    win[y0:y1, x0:x1] = True
    g = largest(mask & win, 1)
    return g[0] if g else None


def measure(name, rgba):
    """face + feet of the 4x cutout, from the 1x seeds (SEEDS) refined on the image"""
    rgb = rgba[..., :3].astype(np.float32)
    a = rgba[..., 3].astype(np.float32) / 255
    solid = a > 0.9
    L = lum(rgb)
    ys, xs = np.nonzero(a > 0.5)
    top, bot, left, right = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    H = bot - top
    S = SEEDS[name]
    eyes, iris = [], []
    for ex, ey in S['eyes']:
        got = blob_near((L < (95 if name == 'great' else 60)) & solid, ex * 4, ey * 4, 22 * 4)
        if not got:
            raise SystemExit(f'{name}: no eye near {ex, ey}')
        yy, xx = np.nonzero(got[0])
        eyes.append([float(xx.mean()), float(yy.mean())])
        iris.append(float(yy.max() - yy.min()))
    got = blob_near((L < 70) & solid, S['nose'][0] * 4, S['nose'][1] * 4, 16 * 4)
    if not got:
        raise SystemExit(f'{name}: no nose near {S["nose"]}')
    ny, nx = np.nonzero(got[0])
    nose = [float(nx.mean()), float(ny.mean())]
    # the mouth: mouth colours and dark lines inside the seed box (+6 px), below the nose
    bx0, by0, bx1, by1 = [v * 4 for v in S['mouth']]
    pad = 6 * 4
    win = np.zeros_like(solid)
    win[max(int(ny.max()) + 4, by0 - pad):by1 + pad, bx0 - pad:bx1 + pad] = True
    mm = (mouth_mask(rgb, solid) | (L < 90)) & win & solid
    mm = ndi.binary_closing(mm, iterations=3)
    got = largest(mm, 1)
    if not got:
        raise SystemExit(f'{name}: no mouth in {S["mouth"]}')
    my, mx = np.nonzero(got[0][0])
    mbox = [int(mx.min()), int(my.min()), int(mx.max()), int(my.max())]
    D = float(np.hypot(eyes[1][0] - eyes[0][0], eyes[1][1] - eyes[0][1]))
    rot = float(np.degrees(np.arctan2(eyes[1][1] - eyes[0][1], eyes[1][0] - eyes[0][0])))
    fxs = np.nonzero(a[max(0, bot - int(H * 0.04)):bot + 1].max(0) > 0.5)[0]
    return {'box': [left, top, right, bot], 'mouth': mbox, 'nose': nose, 'eyes': eyes, 'D': D, 'iris': float(np.mean(iris)),
            'rot': rot, 'feet': [float(fxs.mean()), float(bot)], 'H': H}


def resize_premul(arr, W, H):
    a = arr[..., 3:4].astype(np.float32)
    pm = np.dstack([arr[..., :3].astype(np.float32) * a / 255, a])
    ch = [np.asarray(Image.fromarray(pm[..., c]).resize((W, H), Image.Resampling.LANCZOS)) for c in range(4)]
    pmr = np.dstack(ch)
    al = np.clip(pmr[..., 3], 0, 255)
    rgb = np.where(al[..., None] > 0.5, pmr[..., :3] * 255 / np.maximum(al[..., None], 1e-3), 0)
    return np.dstack([np.clip(rgb, 0, 255), al]).round().astype(np.uint8)


def run(cache: Path, out: Path, poses: dict):
    out.mkdir(parents=True, exist_ok=True)
    meas, ims = {}, {}
    for name in poses:
        ims[name] = np.asarray(Image.open(cache / f'{name}_3_x4.png').convert('RGBA'))
        meas[name] = m = measure(name, ims[name])
        print(f"{name:6s} D={m['D']:.1f} rot={m['rot']:+.1f}° H={m['H']} mouth={m['mouth']} (w {m['mouth'][2] - m['mouth'][0]}) "
              f"nose={[round(v) for v in m['nose']]} feet={[round(v) for v in m['feet']]}")
    # one size: the bottom-row poses as drawn (same row, same scale); the top-row jump matched by iris height; then the
    # standing fox = STAND_H tall. The drawn mouth: 0.42 of the frontal face's eye spacing, narrower on turned heads.
    iris_bottom = float(np.mean([meas['teach']['iris'], meas['read']['iris']]))
    row = {'bottom': 1.0, 'top': iris_bottom / meas['jump']['iris']}
    k = STAND_H / meas['teach']['H']
    w_base = 0.42 * meas['great']['D'] * k
    print(f"scale: top row x{row['top']:.3f} (iris {meas['jump']['iris']:.0f} vs {iris_bottom:.0f}) · output x{k:.3f} · mouth base {w_base:.0f}px")
    placed = {}
    for name in poses:
        m = meas[name]
        s = k * row[ROW[name]]
        l, t, r, b = m['box']
        pad = 8
        l, t = max(0, l - pad), max(0, t - pad)
        r, b = min(ims[name].shape[1], r + pad), min(ims[name].shape[0], b + pad)
        W, H = round((r - l) * s), round((b - t) * s)
        img = resize_premul(ims[name][t:b, l:r], W, H)
        f = lambda p: [(p[0] - l) * s, (p[1] - t) * s]
        mb = m['mouth']
        placed[name] = {'img': img, 'feet': f(m['feet']), 'nose': f(m['nose']), 'eyes': [f(e) for e in m['eyes']],
                        'mouth': [(mb[0] - l) * s, (mb[1] - t) * s, (mb[2] - l) * s, (mb[3] - t) * s],
                        'D': m['D'] * s, 'rot': m['rot'], 'scale': s, 'H': m['H'] * s}
    # shared frame: every pose's feet on the anchor (a lifted pose floats above it)
    ext = []
    for name, p in placed.items():
        h, w = p['img'].shape[:2]
        gx, gy = p['feet'][0], p['feet'][1] + LIFT.get(name, 0) * STAND_H
        p['ground'] = [gx, gy]
        ext.append((-gx, -gy, w - gx, h - gy))
    M = 16
    x0, y0 = min(e[0] for e in ext), min(e[1] for e in ext)
    x1, y1 = max(e[2] for e in ext), max(e[3] for e in ext)
    FW, FH = int(np.ceil(x1 - x0)) + 2 * M, int(np.ceil(y1 - y0)) + 2 * M
    ax, ay = -x0 + M, -y0 + M
    meta = {'frameW': FW, 'frameH': FH, 'anchor': {'x': round(ax, 1), 'y': round(ay, 1)}, 'map': MAP, 'poses': {}}
    patches = []
    for name, p in placed.items():
        img = p['img']
        h, w = img.shape[:2]
        px, py = ax - p['ground'][0], ay - p['ground'][1]
        rgb = np.ascontiguousarray(img[..., :3])
        solid = img[..., 3] > 230
        mx0, my0, mx1, my1 = [int(round(v)) for v in p['mouth']]
        mwid = mx1 - mx0
        # the mouth to paint out: mouth colours + dark lines around it, nothing above the mouth's top (the nose stays)
        win = np.zeros(img.shape[:2], bool)
        win[max(0, my0 - mwid // 10):my1 + mwid // 4, max(0, mx0 - mwid // 4):mx1 + mwid // 4] = True
        mpx = (mouth_mask(rgb.astype(np.float32), solid) | (lum(rgb.astype(np.float32)) < 95)) & win
        mpx = ndi.binary_closing(mpx, iterations=2)
        mpx = ndi.binary_dilation(mpx, iterations=max(4, mwid // 8)) & solid
        filled = cv2.inpaint(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), mpx.astype(np.uint8) * 255, max(6, mwid // 6), cv2.INPAINT_TELEA)
        filled = cv2.cvtColor(filled, cv2.COLOR_BGR2RGB)
        # soften the fill a little (inpaint leaves streaks on fur), then a soft-edged patch around it
        blur = cv2.GaussianBlur(filled, (0, 0), max(1.5, mwid / 30))
        filled = np.where(mpx[..., None], blur, filled)
        pm = ndi.binary_dilation(mpx, iterations=max(3, mwid // 14))
        soft = np.asarray(Image.fromarray(pm.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(max(2, mwid / 18)))).astype(np.float32) / 255
        soft = np.minimum(soft, img[..., 3].astype(np.float32) / 255)
        yy, xx = np.nonzero(soft > 0.01)
        bx0, by0, bx1, by1 = int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1
        patch = np.dstack([filled[by0:by1, bx0:bx1], (soft[by0:by1, bx0:bx1] * 255).round().astype(np.uint8)])
        patches.append((name, patch, bx0 + px, by0 + py))
        Image.fromarray(img, 'RGBA').save(out / f'{name}.webp', 'WEBP', quality=92, alpha_quality=100, method=6)
        e0, e1 = p['eyes']
        rig = {}
        for rk, rv in RIG[name].items():
            if rk == 'head':
                rig[rk] = [round(rv[0] + px, 1), round(rv[1] + py, 1), rv[2]]
            elif rk == 'neck':
                rig[rk] = [round(rv[0] + px, 1), round(rv[1] + py, 1)]
            else:
                rig[rk] = [[round(rv[0][0] + px, 1), round(rv[0][1] + py, 1)], [round(rv[1][0] + px, 1), round(rv[1][1] + py, 1)]]
        rig['eyeR'] = round(0.65 * meas[name]['iris'] * p['scale'], 1) if BLINKS[name] else 0
        meta['poses'][name] = {
            'file': f'{name}.webp', 'x': round(px, 1), 'y': round(py, 1), 'w': w, 'h': h, 'rest': REST[name], 'rig': rig,
            # the drawn mouth: centred on the art's mouth, its top at the art's mouth top; width from the head size
            'mouth': {'x': round((mx0 + mx1) / 2 + px, 1), 'y': round(my0 + py, 1), 'w': round(w_base * YAW[name], 1),
                      'art': round(mwid, 1), 'rot': round(p['rot'], 1), 'turn': TURN[name]},
            'nose': [round(p['nose'][0] + px, 1), round(p['nose'][1] + py, 1)],
            'eyes': [[round(e0[0] + px, 1), round(e0[1] + py, 1)], [round(e1[0] + px, 1), round(e1[1] + py, 1)]],
        }
    AW = sum(pt.shape[1] for _, pt, _, _ in patches) + 4 * len(patches)
    AH = max(pt.shape[0] for _, pt, _, _ in patches)
    atlas = np.zeros((AH, AW, 4), np.uint8)
    x = 0
    for name, pt, fx, fy in patches:
        atlas[:pt.shape[0], x:x + pt.shape[1]] = pt
        meta['poses'][name]['muzzle'] = {'sx': x, 'sy': 0, 'sw': int(pt.shape[1]), 'sh': int(pt.shape[0]), 'x': round(fx, 1), 'y': round(fy, 1)}
        x += pt.shape[1] + 4
    Image.fromarray(atlas, 'RGBA').save(out / 'muzzle.webp', 'WEBP', quality=94, alpha_quality=100, method=6)
    # where the standing fox's head is (fractions of the frame): the speech bubble sits above it
    t = meta['poses']['teach']
    ta = placed['teach']['img'][..., 3]
    head_top = float(np.nonzero((ta > 127).any(1))[0].min()) + t['y']
    meta['head'] = {'x': round(t['nose'][0] / FW, 4), 'top': round(head_top / FH, 4), 'feet': round(meta['anchor']['y'] / FH, 4),
                    'standH': round(placed['teach']['H'] / FH, 4)}
    (out / 'fox.json').write_text(json.dumps(meta, indent=1))
    kb = {n: (out / f'{n}.webp').stat().st_size // 1024 for n in placed}
    print('frame', FW, 'x', FH, 'anchor', meta['anchor'], 'head', meta['head'], '| KB', kb, 'muzzle', (out / 'muzzle.webp').stat().st_size // 1024)
    debug(cache.parent, out, meta)
    # the motion rig: painted part weights (arms, tail) and the eyelids of a blink (tools/build_tutor_rig.py) — copy
    # out/<pose>_w.webp along with the poses
    import build_tutor_rig
    build_tutor_rig.run(out, cache.parent)
    return meta


def debug(dst: Path, out: Path, meta: dict):
    FW, FH = meta['frameW'], meta['frameH']
    atlas = Image.open(out / 'muzzle.webp').convert('RGBA')
    cells, faces = [], []
    for name, p in meta['poses'].items():
        im = Image.open(out / p['file']).convert('RGBA')
        fr = Image.new('RGBA', (FW, FH), (236, 240, 246, 255))
        fr.alpha_composite(im, (int(round(p['x'])), int(round(p['y']))))
        mz = p['muzzle']
        patch = atlas.crop((mz['sx'], mz['sy'], mz['sx'] + mz['sw'], mz['sy'] + mz['sh']))
        painted = fr.copy()
        painted.alpha_composite(patch, (int(round(mz['x'])), int(round(mz['y']))))
        d = ImageDraw.Draw(fr)
        d.line([(0, meta['anchor']['y']), (FW, meta['anchor']['y'])], fill=(0, 160, 255, 255), width=4)
        mo = p['mouth']
        d.rectangle([mo['x'] - mo['w'] / 2, mo['y'], mo['x'] + mo['w'] / 2, mo['y'] + mo['w'] * 0.55], outline=(255, 0, 150, 255), width=3)
        for e in p['eyes']:
            d.ellipse([e[0] - 9, e[1] - 9, e[0] + 9, e[1] + 9], outline=(0, 200, 80, 255), width=4)
        n = p['nose']
        d.ellipse([n[0] - 7, n[1] - 7, n[0] + 7, n[1] + 7], fill=(255, 200, 0, 255))
        cells.append((name, fr.convert('RGB')))
        r = mo['w'] * 1.6
        box = (int(n[0] - r), int(n[1] - r * 0.9), int(n[0] + r), int(n[1] + r * 1.3))
        o = Image.new('RGBA', (FW, FH), (236, 240, 246, 255)); o.alpha_composite(im, (int(round(p['x'])), int(round(p['y']))))
        faces.append((name, o.crop(box).convert('RGB'), painted.crop(box).convert('RGB')))
    th = 600
    tw = round(FW * th / FH)
    s = Image.new('RGB', (len(cells) * (tw + 10), th + 24), (255, 255, 255))
    d = ImageDraw.Draw(s)
    for i, (name, c) in enumerate(cells):
        s.paste(c.resize((tw, th)), (i * (tw + 10), 24)); d.text((i * (tw + 10) + 4, 5), name, fill=(0, 0, 0))
    s.save(dst / 'assemble_debug.png')
    fw = max(f[1].width for f in faces)
    fh = max(f[1].height for f in faces)
    fs = Image.new('RGB', (2 * (2 * fw + 30), 2 * (fh + 26)), (255, 255, 255))
    d = ImageDraw.Draw(fs)
    for i, (name, o, pt) in enumerate(faces):
        x, y = (i % 2) * (2 * fw + 30), (i // 2) * (fh + 26)
        fs.paste(o, (x, y + 22)); fs.paste(pt, (x + fw + 8, y + 22)); d.text((x + 4, y + 4), f'{name}: art | mouth painted out', fill=(0, 0, 0))
    fs.save(dst / 'faces_painted.png')
    print('debug →', dst / 'assemble_debug.png', dst / 'faces_painted.png')
