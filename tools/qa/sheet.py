"""Contact sheet of PNG shots (2 columns) for a quick visual review.
usage: uv run --with pillow python tools/qa/sheet.py out.png a.png b.png ...
"""
import sys
from PIL import Image, ImageDraw

out, files = sys.argv[1], sys.argv[2:]
ims = [Image.open(f).convert('RGB') for f in files]
w = 960
ims = [im.resize((w, int(im.height * w / im.width)), Image.LANCZOS) for im in ims]
cols = 2
rows = (len(ims) + cols - 1) // cols
h = max(im.height for im in ims)
S = Image.new('RGB', (cols * w + (cols - 1) * 8, rows * (h + 26)), 'white')
d = ImageDraw.Draw(S)
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = (i % cols) * (w + 8), (i // cols) * (h + 26)
    d.text((x + 4, y + 6), f.split('/')[-1], fill=(0, 0, 0))
    S.paste(im, (x, y + 22))
S.save(out)
print(out, S.size)
