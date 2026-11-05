"""Rig data for the tutor's motion (ui/fox.ts), made from the built poses (public/fox/<pose>.webp + fox.json `rig`):

* <pose>_w.webp — painted part weights at half size: R = left arm, G = right arm, B = tail; <pose>_e.webp — R = left
  ear, G = right ear. Arms and tail are cut out by a watershed on the picture, seeded on the rig points (head, body,
  arm, tail); the body is seeded on everything behind both shoulders and the tail's root (torso, legs, feet) and on
  what the fox wears or holds (the teal bag and its strap, the book), and no part reaches back past its own joint.
  The ears are the parts sticking out of the skull (its radius = the head's top at the centre column). Every weight
  ramps up from where the part joins its parent (distance from the body / the skull), so nothing creases at the
  joint; head and body pixels are always 0; the see-through margin around a part goes with it.
  User: "인트로에 손움직일때 볼까지 따라 움직이면서 늘어나는 오류가 있어" (capsule weights reached into the face), then
  "가방같은게 같이 찌그러졌다가 펴졌다가 꼬리랑 같이 움직이고 왼쪽 귀 끝은 고정인지 넓이만 넓어졌다줄었다" (the bag was flooded
  into the tail; the ear capsule missed the ear's tip), then "환호할때 튜터의 팔 이상해 꼬리랑 겹쳐지면서 찌글어들었다
  펴졌다해" (in jump / great an arm's flood ran down the orange fur into the torso and the legs, which swung with it
  against the tail).
* rig.tailFree — where a raised arm lies against the tail (t along the tail's root → tip): ui/fox.ts moves the tail
  only beyond it, so the two never pull the picture between them apart.
* rig.lids — each eye's outline and the fur colours around it (tools/tutor_eyes.py): ui/fox.ts draws the eyelids of a
  blink over them (squashing the picture smeared the iris and bent the glasses). teach + jump only (read wears glasses,
  great has its eyes shut).

build_tutor_assemble.py runs it at the end; alone:
  uv run --with pillow --with numpy --with scipy --with opencv-python-headless python tools/build_tutor_rig.py [public/fox] [debug_dir]
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).parent))
import tutor_eyes  # noqa: E402

K = 0.5                                   # weight-map scale
BLINK = ('teach', 'jump')
EYE_BELOW = {'jump': (0.76, None)}        # the far side of jump's near eye: pale skin under it (tutor_eyes)
# parts cut by the watershed: (rig key, label, channel in _w, ramp length from the body as a fraction of the part)
PARTS = [('armL', 4, 0, 0.3), ('armR', 5, 1, 0.3), ('tail', 6, 2, 0.32)]
BACK = {'armL': -0.05, 'armR': -0.05, 'tail': -0.15}   # how far behind its joint (in t) a part may reach
FWD = {'armL': 1.4, 'armR': 1.4, 'tail': 9.0}          # … and past its tip point (a paw's fingers)


def side_of(key, t):
    """how far off its axis a part may reach, a fraction of its length: an arm is thin along the forearm and wide at
    the paw (0.3 all along still took a band of the tail under great's raised arm); the tail is wide"""
    return np.interp(t, (0.65, 0.9), (0.17, 0.3)) if key != 'tail' else 0.75


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def seed_line(mk, p0, p1, f0, f1, lab, r):
    for t in np.linspace(f0, f1, 48):
        x, y = (p0[0] + (p1[0] - p0[0]) * t) * K, (p0[1] + (p1[1] - p0[1]) * t) * K
        cv2.circle(mk, (int(round(x)), int(round(y))), r, int(lab), -1)


def axis(R, key, xx, yy):
    """t along the part's pivot → tip (0 at the pivot, 1 at the tip), the distance off that line, its length (pose px)"""
    (sx, sy), (ex, ey) = R[key]
    dx, dy = ex - sx, ey - sy
    L = float(np.hypot(dx, dy))
    return ((xx - sx) * dx + (yy - sy) * dy) / (L * L), np.abs((xx - sx) * dy - (yy - sy) * dx) / L, L


def half(rgba):
    small = cv2.resize(rgba, None, fx=K, fy=K, interpolation=cv2.INTER_AREA)
    a = small[..., 3].astype(np.float32) / 255
    comp = (small[..., :3].astype(np.float32) * a[..., None] + 128 * (1 - a[..., None])).astype(np.uint8)
    return a, comp


def parts(a, comp, R, H):
    """watershed labels at K scale: 1 background, 2 head, 3 body, 4 left arm, 5 right arm, 6 tail (-1 = borders)"""
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) / K
    mk = np.zeros(a.shape, np.int32)
    hx, hy, hr = R['head']
    cv2.circle(mk, (int(hx * K), int(hy * K)), int(hr * 0.42 * K), 2, -1)
    for ear in ('earL', 'earR'):
        seed_line(mk, R[ear][0], R[ear][1], 0.15, 0.8, 2, 2)
    nx, ny = R['neck']
    seed_line(mk, (nx, ny + 0.05 * H), (nx, ny + 0.5 * (H - ny)), 0, 1, 3, 3)
    # the body = everything behind both shoulders and the tail's root (torso, legs, feet): seeded only on the belly,
    # an arm's flood ran down the same orange fur into the torso and the legs (jump, great)
    behind = (a > 0.6) & (yy > ny + 0.04 * H) & (np.hypot(xx - hx, yy - hy) > hr * 1.05)
    for key in ('armL', 'armR'):
        if key in R:
            behind &= axis(R, key, xx, yy)[0] < -0.15
    t, lat, L = axis(R, 'tail', xx, yy)
    behind &= (t < -0.1) | (lat > 0.6 * L)
    mk[ndi.binary_erosion(behind, iterations=3) & (mk == 0)] = 3
    for key, lab, _, _ in PARTS:
        if key in R:
            # arms: seeded along the whole forearm (from 0.2) — seeded on the paw only, the dark wrist line stopped the
            # flood there and the forearm stayed with the body (great); the tail from its middle
            seed_line(mk, R[key][0], R[key][1], 0.2 if key != 'tail' else 0.45, 0.97, lab, 3)
    # what the fox wears or holds — the teal bag and strap, the book's green / blue — is body: it must not wag
    hsv = cv2.cvtColor(comp, cv2.COLOR_RGB2HSV).astype(np.float32)
    hue, sat, val = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    gear = ndi.binary_opening((a > 0.6) & (hue > 110) & (hue < 215) & (sat > 0.22) & (val > 0.12), iterations=1)
    mk[gear & (mk == 0)] = 3
    mk[a < 0.16] = 1
    cv2.watershed(cv2.cvtColor(comp, cv2.COLOR_RGB2BGR), mk)
    # no part reaches back past its own joint or far off its own line — an arm is a capsule round its axis: where the
    # tail lies right under a raised arm (great; the same orange fur, no edge between them) the arm's flood took the
    # tail's upper half. What's cut off goes to the nearest other part (there: the tail).
    for key, lab, _, _ in PARTS:
        if key not in R:
            continue
        t, lat, L = axis(R, key, xx, yy)
        bad = (mk == lab) & ((t < BACK[key]) | (t > FWD[key]) | (lat > side_of(key, t) * L))
        if bad.any():
            keep = (mk >= 2) & (mk != lab)
            _, (iy, ix) = ndi.distance_transform_edt(~keep, return_indices=True)
            mk[bad] = mk[iy[bad], ix[bad]]
    return mk, gear, xx, yy


def tail_free(mk, R, xx, yy):
    """t along the tail beyond which it may move: past where an arm lies against it (None: no arm touches it)"""
    touch = (mk == 6) & ndi.binary_dilation((mk == 4) | (mk == 5), iterations=3)
    if touch.sum() < 6:
        return None
    t = axis(R, 'tail', xx, yy)[0][touch]
    return float(min(0.7, max(0.0, np.percentile(t, 95) + 0.05)))


def weights(mk, R):
    h, w = mk.shape
    out = np.zeros((h, w, 3), np.float32)
    body, head = mk == 3, mk == 2
    other = body | head
    d_other = ndi.distance_transform_edt(~other)
    d_body = ndi.distance_transform_edt(~body)
    protect = ndi.binary_dilation(other, iterations=1)
    for key, lab, ch, ramp in PARTS:
        if key not in R:
            continue
        (sx, sy), (ex, ey) = R[key]
        length = np.hypot(ex - sx, ey - sy) * K
        part = mk == lab
        reg = part | ((mk == -1) & ndi.binary_dilation(part, iterations=1))
        d_part = ndi.distance_transform_edt(~reg)
        margin = (mk == 1) & (d_part < 9) & (d_part < d_other)
        wgt = (reg | margin).astype(np.float32) * smooth(0, ramp * length, d_body)
        wgt = cv2.GaussianBlur(wgt, (0, 0), 1.5)
        wgt[protect & ~reg] = 0
        out[..., ch] = wgt
    return out


def ear_weights(a, R):
    """the ears = what sticks out of the skull, split between the two ear axes; ramp from the skull's edge outwards"""
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) / K
    hx, hy, hr = R['head']
    col = np.nonzero(a[:, int(round(hx * K))] > 0.5)[0]
    r_top = float(hy - col.min() / K) if len(col) else float(hr)
    dist = np.hypot(xx - hx, yy - hy)
    axes = [axis(R, key, xx, yy) for key in ('earL', 'earR')]
    solid = a > 0.16
    out = np.zeros((h, w, 2), np.float32)
    for i in range(2):
        t, lat, L = axes[i]
        near = (lat < axes[1 - i][1]) & (t > 0)
        reg = solid & near & (dist > r_top)
        margin = ~solid & near & (ndi.distance_transform_edt(~reg) < 9)
        wgt = (reg | margin).astype(np.float32) * smooth(r_top, r_top + 0.4 * L, dist)
        out[..., i] = cv2.GaussianBlur(wgt, (0, 0), 1.5)
    return out, r_top


def debug_img(rgba, mk, wts, ews, gear, path):
    small = cv2.resize(rgba, None, fx=K, fy=K, interpolation=cv2.INTER_AREA).astype(np.float32)
    a = small[..., 3:] / 255
    base = small[..., :3] * a + 236 * (1 - a)
    tint = np.array([[255, 40, 40], [40, 200, 60], [40, 90, 255], [255, 200, 0], [0, 210, 230]], np.float32)
    layers = [wts[..., 0], wts[..., 1], wts[..., 2], ews[..., 0], ews[..., 1]]
    for ch, lw in enumerate(layers):
        wv = lw[..., None] * 0.6
        base = base * (1 - wv) + tint[ch] * wv
    base[mk == -1] = (255, 255, 255)
    for lab, col in ((2, (150, 0, 200)), (3, (0, 0, 0))):
        reg = mk == lab
        base[reg ^ ndi.binary_erosion(reg, iterations=2)] = col
    base[gear & (np.indices(gear.shape).sum(0) % 6 == 0)] = (0, 0, 0)
    Image.fromarray(base.clip(0, 255).astype(np.uint8)).save(path)


def run(fox_dir: Path, dbg: Path | None = None):
    meta = json.loads((fox_dir / 'fox.json').read_text())
    for name, P in meta['poses'].items():
        rgba = np.array(Image.open(fox_dir / P['file']).convert('RGBA'))
        ox, oy = P['x'], P['y']
        R = P['rig']
        loc = {}
        for k, v in R.items():
            if k == 'head':
                loc[k] = [v[0] - ox, v[1] - oy, v[2]]
            elif k == 'neck':
                loc[k] = [v[0] - ox, v[1] - oy]
            elif k in ('earL', 'earR', 'tail', 'armL', 'armR'):
                loc[k] = [[v[0][0] - ox, v[0][1] - oy], [v[1][0] - ox, v[1][1] - oy]]
        a, comp = half(rgba)
        mk, gear, xx, yy = parts(a, comp, loc, rgba.shape[0])
        wts = weights(mk, loc)
        ews, r_top = ear_weights(a, loc)
        free = tail_free(mk, loc, xx, yy)
        Image.fromarray((wts * 255).round().clip(0, 255).astype(np.uint8), 'RGB').save(fox_dir / f'{name}_w.webp', 'WEBP', lossless=True, method=6)
        e3 = np.dstack([ews, np.zeros(ews.shape[:2], np.float32)])
        Image.fromarray((e3 * 255).round().clip(0, 255).astype(np.uint8), 'RGB').save(fox_dir / f'{name}_e.webp', 'WEBP', lossless=True, method=6)
        R['wmap'], R['emap'], R['wscale'] = f'{name}_w.webp', f'{name}_e.webp', K
        if free is None:
            R.pop('tailFree', None)
        else:
            R['tailFree'] = round(free, 3)
        if name in BLINK:
            eyes = [(ex - ox, ey - oy) for ex, ey in P['eyes']]
            lids = tutor_eyes.lids_for(rgba, eyes, R['eyeR'] / 0.65, (P['nose'][0] - ox, P['nose'][1] - oy), EYE_BELOW.get(name, (None, None)), ox, oy)
            R['lids'] = [{k: (round(float(v), 1) if isinstance(v, (float, np.floating)) else v) for k, v in L.items() if k != '_e'} for L in lids] if lids else []
        else:
            R.pop('lids', None)
        if dbg:
            debug_img(rgba, mk, wts, ews, gear, dbg / f'rigw_{name}.png')
        cover = {key: int((wts[..., ch] > 0.5).sum()) for key, _, ch, _ in PARTS if key in loc}
        cover.update(earL=int((ews[..., 0] > 0.5).sum()), earR=int((ews[..., 1] > 0.5).sum()))
        print(name, 'px > .5 (half size):', cover, '| skull r', round(r_top), '| gear px', int(gear.sum()),
              '| tailFree', R.get('tailFree'), '| lids', len(R.get('lids', [])))
    (fox_dir / 'fox.json').write_text(json.dumps(meta, indent=1))


if __name__ == '__main__':
    d = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / 'public' / 'fox'
    run(d, Path(sys.argv[2]) if len(sys.argv) > 2 else None)
