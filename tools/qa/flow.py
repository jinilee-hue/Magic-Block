"""Phonics Jenga flow checks (headless Chrome, never the user's browser).
usage: uv run --with playwright python tools/qa/flow.py <mode> [base] [out] [WxH]
  ending : fast-forward to the last m-block, pick it, shoot the collapse and the result book
  stt    : REAL on-device speech recognition fed with voice clips through the mic test hook:
           wrong word first (must be rejected), then the right word (must pass)
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

MODE = sys.argv[1] if len(sys.argv) > 1 else 'ending'
BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:5195/'
OUT = sys.argv[3] if len(sys.argv) > 3 else '/Users/jini/.hermes/cache/scratch/jenga/shots'
W, H = (int(v) for v in (sys.argv[4] if len(sys.argv) > 4 else '1280x800').split('x'))
os.makedirs(OUT, exist_ok=True)


async def main():
    errors = []
    async with async_playwright() as p:
        br = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await br.new_page(viewport={'width': W, 'height': H})
        pg.on('console', lambda m: errors.append(f'{m.type}: {m.text[:220]}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        fake = '&fake=1' if MODE == 'ending' else ''
        await pg.goto(f'{BASE}?nointro&seed=5{fake}&m=monkey,mug,map', wait_until='load')
        await pg.wait_for_function('window.__pj && document.querySelector("#app").dataset.screen === "title"', timeout=30000)
        await pg.evaluate('document.querySelector("#btnStart").click()')
        await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=90000)
        if MODE == 'ending':
            await pg.evaluate('window.__pj.game.debugFastForward(1)')
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=f'{OUT}/e1_before_last.png')
            await pg.evaluate('(() => { const b = window.__pj.tower.inTower().find(b => b.word.m); window.__pj.game.choose(b); })()')
            await pg.wait_for_function('window.__pj.game.state === "end"', timeout=90000)
            await pg.wait_for_function('window.__pj.game.test.log.some(l => l.includes("all m out"))', timeout=30000)
            # collapse starts after two lines; poll for blocks moving
            await pg.wait_for_function('window.__pj.tower.blocks.every(b => b.state === "gone")', timeout=60000)
            await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'{OUT}/e2_collapse.png')
            await pg.wait_for_function('!document.querySelector("#result").hidden', timeout=60000)
            await pg.wait_for_timeout(2200)
            await pg.screenshot(path=f'{OUT}/e3_result.png')
            await pg.evaluate('document.querySelector("#btnAgain").click()')
            await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=90000)
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=f'{OUT}/e4_again.png')
        else:
            ready = await pg.evaluate('''async () => { for (let i = 0; i < 240; i++) { if (window.__pj.sttState() !== 'loading') break; await new Promise(r => setTimeout(r, 500)); } return window.__pj.sttState(); }''')
            print('stt state:', ready)
            target = await pg.evaluate('(() => { const b = window.__pj.tower.inTower().find(b => b.word.m && b.word.w.length >= 3); return b.word.w; })()')
            wrong = 'sun'
            print('target', target, '· first feeding', wrong)
            await pg.evaluate(f'''(() => {{ const pj = window.__pj; pj.micTest.feed('./voice/w_{wrong}.mp3', 700); pj.micTest.feed('./voice/w_{target}.mp3', 700);
              const b = pj.tower.byWord('{target}'); pj.game.choose(b); }})()''')
            await pg.wait_for_function(f'window.__pj.game.test.log.some(l => l.includes("got {target}"))', timeout=180000)
            await pg.screenshot(path=f'{OUT}/s1_after.png')
        log = await pg.evaluate('window.__pj.game.test.log')
        print('\n'.join(log))
        await br.close()
    print('console errors:', errors if errors else 'none')

asyncio.run(main())
