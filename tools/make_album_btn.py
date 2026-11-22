"""The card album button in the user's corner-button style (src/assets/btn_album.webp), made like btn_key
(tools/make_key_btn.py): the exit button's blue rounded square (jenga_btn_out) with its white door painted out,
turned lavender, with two white picture cards drawn on it (the back one an outline, the front one solid with a
star cut out of it).
usage: uv run --with pillow --with numpy python tools/make_album_btn.py
"""
import math
import pathlib

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = Image.open(ROOT / 'src/assets/btn_out.webp').convert('RGBA')
a = np.asarray(src).astype(np.float32)
W, H = src.size
rgb, al = a[..., :3], a[..., 3]
# the white icon: bright, unsaturated pixels inside the face (the rim's highlights are white too)
mx, mn = rgb.max(-1), rgb.min(-1)
icon = (mn > 200) & ((mx - mn) < 40) & (al > 200)
yy, xx = np.mgrid[0:H, 0:W]
icon &= (xx > W * .2) & (xx < W * .86) & (yy > H * .18) & (yy < H * .82)
ys, xs = np.nonzero(icon)
x0, x1, y0, y1 = xs.min() - 6, xs.max() + 7, ys.min() - 6, ys.max() + 7
out = a.copy()
for y in range(y0, y1):
    L, R = out[y, x0 - 3, :3], out[y, x1 + 3, :3]
    t = np.linspace(0, 1, x1 - x0)[:, None]
    out[y, x0:x1, :3] = L * (1 - t) + R * t
face = Image.fromarray(out.astype(np.uint8), 'RGBA')
patch = face.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4)).filter(ImageFilter.GaussianBlur(2.2))
face.paste(patch, (x0 - 4, y0 - 4))
# blue -> lavender (hue turn, ~205° -> ~258°, the START button's purple family), keeping light and shade
hsv = np.asarray(face.convert('RGB').convert('HSV')).astype(np.int16)
hsv[..., 0] = (hsv[..., 0] + 38) % 256
hsv[..., 1] = np.clip(hsv[..., 1] * 0.95, 0, 255)
btn = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB').convert('RGBA')
btn.putalpha(face.getchannel('A'))

# the icon, drawn 4x and scaled down: two picture cards, the back one tilted left, the front one tilted right
S = 4
CW, CH, R = 0.34 * W * S, 0.44 * H * S, 0.07 * W * S
sw = round(0.062 * W * S)


def card(cx, cy, deg, fill, grow=0.0):
    """a rounded card's mask (filled, or an outline when fill is False), turned by deg about its centre"""
    m = Image.new('L', (W * S, H * S), 0)
    d = ImageDraw.Draw(m)
    w, h = CW / 2 + grow, CH / 2 + grow
    box = (cx - w, cy - h, cx + w, cy + h)
    if fill:
        d.rounded_rectangle(box, radius=R + grow, fill=255)
    else:
        d.rounded_rectangle(box, radius=R, outline=255, width=sw)
    return m.rotate(deg, resample=Image.Resampling.BICUBIC, center=(cx, cy))


def star(cx, cy, r_out, r_in, round_w):
    m = Image.new('L', (W * S, H * S), 0)
    d = ImageDraw.Draw(m)
    pts = []
    for k in range(10):
        r = r_out if k % 2 == 0 else r_in
        ang = math.radians(-90 + 36 * k)
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    d.polygon(pts, fill=255)
    d.line(pts + [pts[0]], fill=255, width=round(round_w), joint='curve')
    for p in pts[::2]:
        d.ellipse((p[0] - round_w / 2, p[1] - round_w / 2, p[0] + round_w / 2, p[1] + round_w / 2), fill=255)
    return m


bx, by, fx, fy = 0.41 * W * S, 0.47 * H * S, 0.585 * W * S, 0.535 * H * S
back = card(bx, by, 13, False)
front = card(fx, fy, -9, True)
gap = card(fx, fy, -9, True, grow=0.045 * W * S)      # a gap round the front card where the back card's outline stops
icon_m = ImageChops.subtract(back, gap)
icon_m = ImageChops.lighter(icon_m, front)
icon_m = ImageChops.subtract(icon_m, star(fx, fy - 0.01 * H * S, 0.105 * W * S, 0.05 * W * S, 0.03 * W * S))
k = icon_m.resize((W, H), Image.Resampling.LANCZOS)

shade = Image.new('RGBA', (W, H), (70, 40, 140, 0))
shade.putalpha(k.filter(ImageFilter.GaussianBlur(3)).point(lambda v: v * 0.35))
btn.alpha_composite(shade, (0, 4))
# a soft top-to-bottom shade on the icon (the speaker and door icons look puffy, not flat)
g = np.linspace(255, 242, H)[:, None].repeat(W, 1)
white = Image.merge('RGBA', [Image.fromarray((g * .985).astype(np.uint8)), Image.fromarray((g * .97).astype(np.uint8)),
                             Image.fromarray(g.astype(np.uint8)), k])
btn.alpha_composite(white)
btn.save(ROOT / 'src/assets/btn_album.webp', 'WEBP', quality=92, method=6)
print('btn_album.webp', btn.size, 'icon box', (x0, y0, x1, y1))
