"""Layout check at several screen sizes: game screen (turn) and the read-aloud moment.
usage: uv run --with playwright python tools/qa/sizes.py [base] [out]
Prints element boxes that overlap (HUD cards / the fox's speech bubble / fox / tower) and saves shots size_<W>x<H>_{turn,read}.png
"""
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5195/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/Users/jini/.hermes/cache/scratch/jenga/shots'
SIZES = [(1280, 800), (1024, 768), (1180, 820), (1920, 1080), (1366, 1024), (820, 1180)]
os.makedirs(OUT, exist_ok=True)

BOXES = '''() => {
  const r = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null; };
  const { tower, stage } = window.__pj;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const b of tower.inTower()) { const p = stage.project(b.mesh.getWorldPosition(b.mesh.position.clone())); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { p1: r('#p1'), p2: r('#p2'), say: r('#foxSay:not([hidden]) .fs-bubble'), bar: r('.sysbar'), reset: r('#btnReset'), fox: r('#fox canvas'), dock: r('#dock'), read: r('#read'), tower: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)] };
}'''


def overlap(a, b):
    return a and b and a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        for W, H in SIZES:
            pg = await br.new_page(viewport={'width': W, 'height': H})
            await pg.goto(f'{BASE}?nointro&nopick&fake=1&seed=3', wait_until='load')
            await pg.wait_for_function('window.__pj && document.querySelector("#app").dataset.screen === "title"', timeout=30000)
            await pg.wait_for_timeout(1500)
            await pg.screenshot(path=f'{OUT}/size_{W}x{H}_title.png')
            await pg.evaluate('document.querySelector("#btnStart").click()')
            await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=90000)
            await pg.evaluate('window.__pj.game.debugFastForward(20)')
            await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'{OUT}/size_{W}x{H}_turn.png')
            bx = await pg.evaluate(BOXES)
            await pg.evaluate('(() => { const b = window.__pj.tower.inTower().find(b => b.word.m); window.__pj.game.test.heard = [null, null]; window.__pj.game.choose(b); })()')
            await pg.wait_for_function('!document.querySelector("#read").hidden', timeout=60000)
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path=f'{OUT}/size_{W}x{H}_read.png')
            bx2 = await pg.evaluate(BOXES)
            bad = []
            for a in ('p1', 'p2', 'say', 'bar'):
                for b in ('p1', 'p2', 'say', 'bar'):
                    if a < b and overlap(bx[a], bx[b]):
                        bad.append(f'{a}~{b}')
            if overlap(bx['fox'], bx['tower']):
                bad.append('fox~tower')
            if not bx['say']:
                bad.append('no-turn-bubble')
            if overlap(bx['say'], bx['tower']):
                bad.append('say~tower')
            for k in ('dock', 'read'):
                if overlap(bx2['say'], bx2[k]):
                    bad.append(f'say~{k}(read moment)')
            print(f'{W}x{H}', json.dumps(bx), 'read', bx2['read'], 'say(read)', bx2['say'], 'OVERLAP:' if bad else 'ok', ' '.join(bad))
            await pg.close()
        await br.close()

asyncio.run(main())
