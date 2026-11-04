"""Open the game headless and print console errors + where it got stuck (quick boot probe)."""
import asyncio
import sys

from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5195/?nointro&seed=5'


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await br.new_page(viewport={'width': 1280, 'height': 800})
        pg.on('console', lambda m: print('console', m.type, m.text[:300]) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: print('pageerror', str(e)[:500]))
        pg.on('requestfailed', lambda r: print('failed', r.url[:160], r.failure))
        await pg.goto(URL, wait_until='load')
        for _ in range(20):
            await pg.wait_for_timeout(1000)
            s = await pg.evaluate('[!!window.__pj, document.querySelector("#app")?.dataset.screen]')
            if s[0] and s[1] == 'title':
                print('ok', s)
                break
        else:
            print('stuck', s)
        await br.close()

asyncio.run(main())
