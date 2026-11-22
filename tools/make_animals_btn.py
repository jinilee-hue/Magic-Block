"""The animal shop button in the user's corner-button style (src/assets/btn_animals.webp), made like btn_key
(tools/make_key_btn.py): the exit button's blue rounded square (jenga_btn_out) with its white door painted out,
turned lavender, with a white paw print drawn on it (it was the MY CARDS album's two picture cards).
usage: uv run --with pillow --with numpy python tools/make_animals_btn.py
"""
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

# the icon, drawn 4x and scaled down: a paw print — a round-cornered main pad and four toe beans fanned over it
S = 4


def bean(cx, cy, rx, ry, deg):
    """an ellipse's mask, turned by deg about its centre (fractions of the button)"""
    m = Image.new('L', (W * S, H * S), 0)
    x, y, a_, b_ = cx * W * S, cy * H * S, rx * W * S, ry * H * S
    ImageDraw.Draw(m).ellipse((x - a_, y - b_, x + a_, y + b_), fill=255)
    return m.rotate(deg, resample=Image.Resampling.BICUBIC, center=(x, y))


# main pad: a wide oval with two lobes below (a soft heart upside down)
icon_m = bean(0.5, 0.6, 0.165, 0.125, 0)
icon_m = ImageChops.lighter(icon_m, bean(0.435, 0.665, 0.105, 0.095, 0))
icon_m = ImageChops.lighter(icon_m, bean(0.565, 0.665, 0.105, 0.095, 0))
for cx, cy, deg in ((0.3, 0.435, 28), (0.415, 0.325, 10), (0.585, 0.325, -10), (0.7, 0.435, -28)):
    icon_m = ImageChops.lighter(icon_m, bean(cx, cy, 0.06, 0.077, deg))
k = icon_m.resize((W, H), Image.Resampling.LANCZOS)

shade = Image.new('RGBA', (W, H), (70, 40, 140, 0))
shade.putalpha(k.filter(ImageFilter.GaussianBlur(3)).point(lambda v: v * 0.35))
btn.alpha_composite(shade, (0, 4))
# a soft top-to-bottom shade on the icon (the speaker and door icons look puffy, not flat)
g = np.linspace(255, 242, H)[:, None].repeat(W, 1)
white = Image.merge('RGBA', [Image.fromarray((g * .985).astype(np.uint8)), Image.fromarray((g * .97).astype(np.uint8)),
                             Image.fromarray(g.astype(np.uint8)), k])
btn.alpha_composite(white)
btn.save(ROOT / 'src/assets/btn_animals.webp', 'WEBP', quality=92, method=6)
print('btn_animals.webp', btn.size, 'icon box', (x0, y0, x1, y1))
