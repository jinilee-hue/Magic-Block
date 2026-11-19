"""The phonics-api key button in the user's corner-button style (tools for src/assets/btn_key.webp):
the exit button's blue rounded square (jenga_btn_out) with its white door painted out (each row of the face
re-filled from the face colour just left and right of the icon), turned pink, with a white key drawn like the
other buttons' icons (rounded, a faint shade under it).
usage: uv run --with pillow --with numpy python tools/make_key_btn.py
"""
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = Image.open(ROOT / 'src/assets/btn_out.webp').convert('RGBA')
a = np.asarray(src).astype(np.float32)
W, H = src.size
rgb, al = a[..., :3], a[..., 3]
# the white icon: bright, unsaturated pixels inside the face
mx, mn = rgb.max(-1), rgb.min(-1)
icon = (mn > 200) & ((mx - mn) < 40) & (al > 200)
# only the middle of the face: the rim's highlights are white too
yy, xx = np.mgrid[0:H, 0:W]
icon &= (xx > W * .2) & (xx < W * .86) & (yy > H * .18) & (yy < H * .82)
ys, xs = np.nonzero(icon)
x0, x1, y0, y1 = xs.min() - 6, xs.max() + 7, ys.min() - 6, ys.max() + 7
out = a.copy()
for y in range(y0, y1):
    L, R = out[y, x0 - 3, :3], out[y, x1 + 3, :3]
    t = np.linspace(0, 1, x1 - x0)[:, None]
    out[y, x0:x1, :3] = L * (1 - t) + R * t
# soften the seam of the painted block
face = Image.fromarray(out.astype(np.uint8), 'RGBA')
patch = face.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4)).filter(ImageFilter.GaussianBlur(2.2))
face.paste(patch, (x0 - 4, y0 - 4))
# blue -> pink (hue turn), keeping light and shade
hsv = np.asarray(face.convert('RGB').convert('HSV')).astype(np.int16)
hsv[..., 0] = (hsv[..., 0] + 98) % 256          # ~205° -> ~343°
hsv[..., 1] = np.clip(hsv[..., 1] * 0.92, 0, 255)
pink = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB').convert('RGBA')
pink.putalpha(face.getchannel('A'))
# the white key, drawn 4x and scaled down (round caps like the speaker / door icons)
S = 4
k = Image.new('L', (W * S, H * S), 0)
d = ImageDraw.Draw(k)
cx, cy, r, sw = 0.355 * W * S, 0.5 * H * S, 0.135 * W * S, 0.07 * W * S
d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=255, width=round(sw))
d.line((cx + r - sw * .2, cy, 0.79 * W * S, cy), fill=255, width=round(sw))
for x, l in ((0.665, 0.115), (0.765, 0.085)):
    d.line((x * W * S, cy, x * W * S, cy + l * H * S), fill=255, width=round(sw))
for (px, py) in ((0.79 * W * S, cy), (0.665 * W * S, cy + 0.115 * H * S), (0.765 * W * S, cy + 0.085 * H * S)):
    d.ellipse((px - sw / 2, py - sw / 2, px + sw / 2, py + sw / 2), fill=255)
k = k.resize((W, H), Image.Resampling.LANCZOS)
shade = Image.new('RGBA', (W, H), (150, 40, 80, 0))
shade.putalpha(k.filter(ImageFilter.GaussianBlur(3)).point(lambda v: v * 0.35))
pink.alpha_composite(shade, (0, 4))
# a soft top-to-bottom shade on the icon (the speaker and door icons look puffy, not flat)
g = np.linspace(255, 242, H)[:, None].repeat(W, 1)
white = Image.merge('RGBA', [Image.fromarray(g.astype(np.uint8)), Image.fromarray((g * .97).astype(np.uint8)),
                             Image.fromarray((g * .985).astype(np.uint8)), k])
pink.alpha_composite(white)
pink.save(ROOT / 'src/assets/btn_key.webp', 'WEBP', quality=92, method=6)
print('btn_key.webp', pink.size, 'icon box', (x0, y0, x1, y1))
