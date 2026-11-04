"""Read-aloud check in the real game (headless Chrome, never the user's browser): the microphone is fed with voice
clips (micTest.feed → the same voice detector, resampling and on-device recogniser as a real child), one turn each.
usage: uv run --with playwright python tools/qa/readflow.py [base] [clip_dir]
Cases: Korean-accented / child readings that must pass, the wrong first sound, silence, and 3 non-readings
("Good try!" ends the turn). Prints the game log + how long each check took in the browser.
"""
import asyncio
import json
import pathlib
import sys
import urllib.parse

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5195/'
RAW = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/Users/jini/.hermes/cache/scratch/jenga/sttset/raw')
CASES = [  # (target, [clips fed in order: file name in RAW or None = silence], expected end of the turn)
    # the last clip of a 'read' case is the fox's own clear reading: a fallback so the turn always ends
    ('map', ['en-US-AnaNeural_-10%_cap.mp3', 'ko-KR-SunHiNeural_+0%_맵.mp3', 'en-US-AnaNeural_-10%_map.mp3'], 'read'),
    ('mug', ['en-US-AnaNeural_-10%_mug.mp3'], 'read'),
    ('milk', [None, 'ko-KR-InJoonNeural_+0%_밀크.mp3', 'en-US-AnaNeural_-10%_milk.mp3'], 'read'),
    ('mitten', ['en-US-AnaNeural_-10%_kitten.mp3', 'en-US-GuyNeural_+0%_kitten.mp3', 'ko-KR-SunHiNeural_+0%_키튼.mp3'], 'tried'),
    ('mouse', ['en-US-GuyNeural_+0%_house.mp3', 'en-GB-MaisieNeural_-5%_mouse.mp3', 'en-US-AnaNeural_-10%_mouse.mp3'], 'read'),
]


async def main():
    errors, logs = [], []
    async with async_playwright() as p:
        br = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
        pg = await br.new_page(viewport={'width': 1280, 'height': 800})
        pg.on('console', lambda m: print('console', m.type, m.text[:220]) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: print(f'pageerror: {e}'))
        pg.on('request', lambda r: logs.append(r.post_data) if r.url.endswith('/__pjlog') else None)

        async def clip(route):
            name = urllib.parse.unquote(route.request.url.split('/qa-clip/')[1])
            await route.fulfill(body=(RAW / name).read_bytes(), content_type='audio/mpeg')
        await pg.route('**/qa-clip/**', clip)
        await pg.goto(f'{BASE}?nointro&seed=5', wait_until='load')
        for _ in range(90):
            await pg.wait_for_timeout(1000)
            s = await pg.evaluate('[!!window.__pj, document.querySelector("#app")?.dataset.screen]')
            if s[0] and s[1] == 'title':
                break
        else:
            print('stuck at', s)
            return
        await pg.evaluate('document.querySelector("#btnStart").click()')
        await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=90000)
        st = await pg.evaluate('''async () => { for (let i = 0; i < 240 && window.__pj.sttState() === 'loading'; i++) await new Promise(r => setTimeout(r, 500)); return window.__pj.sttState(); }''')
        print('recogniser:', st)
        for target, clips, want in CASES:
            await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=120000)
            feeds = json.dumps([None if c is None else f'./qa-clip/{urllib.parse.quote(c)}' for c in clips])
            n = await pg.evaluate('window.__pj.game.test.log.length')
            await pg.evaluate(f'''(() => {{ const pj = window.__pj; for (const u of {feeds}) pj.micTest.feed(u, 500);
              pj.game.choose(pj.tower.byWord('{target}')); }})()''')
            try:
                await pg.wait_for_function(f'window.__pj.game.test.log.slice({n}).some(l => l.includes("got {target}"))', timeout=90000)
            except Exception:
                st = await pg.evaluate('({ state: window.__pj.game.state, read: document.querySelector("#read").className, thumb: !document.querySelector("#btnThumb").hidden, stt: window.__pj.sttState() })')
                print(f'{target}: STUCK', st, await pg.evaluate(f'window.__pj.game.test.log.slice({n})'))
                break
            lines = await pg.evaluate(f'window.__pj.game.test.log.slice({n})')
            await pg.evaluate('window.__pj.micTest.clear()')   # clips this turn didn't need must not leak into the next
            hears = [l.split(' ', 1)[1] for l in lines if ' hear ' in l]
            print(f'{target:8s} want {want:5s} |', ' · '.join(hears))
        await pg.wait_for_timeout(500)
        await br.close()
    print('\nchecks (from the dev log):')
    for raw in logs:
        try:
            d = json.loads(raw)
            print(f"  {d.get('target'):8s} {d.get('result'):7s} heard={d.get('text', '')!r:14} sT={d.get('sT')} gap={d.get('gap')} rgap={d.get('rgap')} rival={d.get('rival')} pNo={d.get('pNo')} {d.get('ms')} ms {d.get('why', '')}")
        except Exception:
            pass
    print('console:', errors if errors else 'clean')

asyncio.run(main())
