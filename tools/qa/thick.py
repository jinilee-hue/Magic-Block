"""Side-by-side looks of the game screen (turn 1) for several URL variants → one labelled sheet.
usage: uv run --with playwright --with pillow python tools/qa/thick.py "bh=0.6|bh=0.75|bh=0.6&wood=natural" [WxH] [labels]
labels: '|'-separated captions (default: the queries)
"""
import asyncio
import os
import sys

from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:5195/'
OUT = '/Users/jini/.hermes/cache/scratch/jenga/shots'
VARS = (sys.argv[1] if len(sys.argv) > 1 else 'bh=0.6|bh=0.75').split('|')
W, H = (int(v) for v in (sys.argv[2] if len(sys.argv) > 2 else '1280x800').split('x'))
LABELS = sys.argv[3].split('|') if len(sys.argv) > 3 else VARS
os.makedirs(OUT, exist_ok=True)


async def main():
    files = []
    async with async_playwright() as p:
        br = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        for i, q in enumerate(VARS):
            pg = await br.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(f'{BASE}?nointro&nopick&fake=1&seed=3&{q}', wait_until='load')
            await pg.wait_for_function('window.__pj && document.querySelector("#app").dataset.screen === "title"', timeout=30000)
            await pg.click('#btnStart', force=True)
            await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=60000)
            await pg.wait_for_timeout(1500)
            f = f'{OUT}/look_{i}.png'
            await pg.screenshot(path=f)
            files.append(f)
            print(q, 'errors:', errs or 'none')
            await pg.close()
        await br.close()
    ims = [Image.open(f) for f in files]
    s = 0.5
    tw, th = int(W * s), int(H * s)
    sheet = Image.new('RGB', (tw * len(ims), th + 40), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 24)
    except OSError:
        font = ImageFont.load_default()
    for i, im in enumerate(ims):
        sheet.paste(im.resize((tw, th), Image.Resampling.LANCZOS), (i * tw, 40))
        d.text((i * tw + 12, 7), LABELS[i], fill=(40, 40, 60), font=font)
    sheet.save(f'{OUT}/look_sheet.png')
    print('sheet', sheet.size)

asyncio.run(main())
