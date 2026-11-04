"""Headless look at Phonics Jenga (never touches the user's browser).
usage: uv run --with playwright python tools/qa/shot.py [base_url] [out_dir] [WxH]
Takes: title, game start, wrong pick, right pick (pull / present+mic / success), next turn. Uses ?fake=1 (scripted mic).
"""
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5195/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/Users/jini/.hermes/cache/scratch/jenga/shots'
W, H = (int(v) for v in (sys.argv[3] if len(sys.argv) > 3 else '1280x800').split('x'))
os.makedirs(OUT, exist_ok=True)

FIND = '''(want) => {
  const { tower, stage } = window.__pj;
  const cands = tower.inTower().filter(b => b.word.m === want && tower.visible(b));
  const out = cands.map(b => { const p = stage.project(b.mesh.getWorldPosition(b.mesh.position.clone())); return { w: b.word.w, x: p.x, y: p.y }; });
  out.sort((a, b) => Math.abs(a.x - stage.size.w / 2) - Math.abs(b.x - stage.size.w / 2));
  return out[0] || null;
}'''


async def main():
    errors = []
    async with async_playwright() as p:
        br = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await br.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        pg.on('console', lambda m: errors.append(f'{m.type}: {m.text[:200]}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        await pg.goto(BASE + '?nointro&fake=1&seed=3' + os.environ.get('Q', ''), wait_until='load')
        await pg.wait_for_function('window.__pj && document.querySelector("#app").dataset.screen === "title"', timeout=30000)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/01_title.png')
        await pg.click('#btnStart', force=True)
        await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=60000)
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'{OUT}/02_turn1.png')
        # wrong pick (a block that doesn't start with m)
        t = await pg.evaluate(FIND, False)
        print('wrong target', t)
        await pg.mouse.click(t['x'], t['y'])
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=f'{OUT}/03_wrong.png')
        await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=60000)
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=f'{OUT}/04_turn2.png')
        # right pick
        t = await pg.evaluate(FIND, True)
        print('right target', t)
        await pg.mouse.click(t['x'], t['y'])
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=f'{OUT}/05_pull.png')
        await pg.wait_for_function('!document.querySelector("#read").hidden', timeout=30000)
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/06_read.png')
        await pg.wait_for_function('document.querySelector("#read").classList.contains("done")', timeout=60000)
        await pg.wait_for_timeout(250)
        await pg.screenshot(path=f'{OUT}/07_success.png')
        await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=60000)
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f'{OUT}/08_next.png')
        log = await pg.evaluate('window.__pj.game.test.log')
        print('\n'.join(log))
        await br.close()
    print('console:', json.dumps(errors, indent=1) if errors else 'clean')

asyncio.run(main())
