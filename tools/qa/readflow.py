"""Read-aloud check in the real game (headless Chrome, never the user's browser): the microphone is fed with voice
clips (micTest.feed → the same voice detector and resampling as a real child), one turn each.
usage: uv run --with playwright python tools/qa/readflow.py [api|device] [base]
  api (default): the phonics-api key (~/.config/phonics-api/key, never printed) goes into this browser's localStorage
  → the company server judges; device: no key → the on-device whisper judges.
Clips: phonics-api TTS (cached in phonics-kit/cache/qa/readflow/); Korean voices reading Hangul = a Korean accent.
Cases: Korean-accented / child readings that must pass, the wrong first sound, silence, and non-readings (the 2nd
wrong try → "Good try!", the turn ends without the block). Prints the game log + each check from the dev log.
"""
import asyncio
import json
import pathlib
import sys
import urllib.parse

from playwright.async_api import async_playwright

MODE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ('api', 'device') else 'api'
BASE = next((a for a in sys.argv[1:] if a.startswith('http')), 'http://127.0.0.1:5195/')
KIT = pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit'
sys.path.insert(0, str(KIT / 'tools'))
import papi  # noqa: E402

RAW = KIT / 'cache' / 'qa' / 'readflow'
RAW.mkdir(parents=True, exist_ok=True)
KEY = (pathlib.Path.home() / '.config/phonics-api/key').read_text().strip() if MODE == 'api' else ''
CASES = [  # (target, [clips fed in order: (voice, text) or None = silence], expected end of the turn)
    # the last clip of a 'read' case is a clear adult reading: a fallback so the turn always ends
    ('map', [('en-US-AnaNeural', 'cap'), ('en-US-AnaNeural', 'map'), ('en-US-GuyNeural', 'map')], 'read'),
    ('mug', [('ko-KR-SunHiNeural', '머그'), ('en-US-GuyNeural', 'mug')], 'read'),
    ('milk', [None, ('ko-KR-InJoonNeural', '밀크'), ('en-US-GuyNeural', 'milk')], 'read'),
    ('mitten', [('en-US-AnaNeural', 'kitten'), ('en-US-GuyNeural', 'kitten'), ('ko-KR-SunHiNeural', '키튼')], 'tried'),
    ('mouse', [('en-US-GuyNeural', 'house'), ('en-GB-MaisieNeural', 'mouse'), ('en-US-GuyNeural', 'mouse')], 'read'),
]


def clip_name(c):
    voice, text = c
    f = RAW / f'{voice}_{text}.wav'
    if not f.exists():
        f.write_bytes(papi.tts(text, voice))
    return f.name


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
            await route.fulfill(body=(RAW / name).read_bytes(), content_type='audio/wav')
        await pg.route('**/qa-clip/**', clip)
        await pg.add_init_script("localStorage.%s" % (f"setItem('phonics_api_key', {json.dumps(KEY)})" if KEY else "removeItem('phonics_api_key')"))
        await pg.goto(f'{BASE}?nointro&nopick&seed=5&m=' + ','.join(t for t, _, _ in CASES), wait_until='load')
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
        print('recogniser:', st, '| phonics-api:', await pg.evaluate('window.PhonicsAPI.status()'), f'({MODE})')
        for target, clips, want in CASES:
            await pg.wait_for_function('window.__pj.game.state === "choose"', timeout=120000)
            feeds = json.dumps([None if c is None else f'./qa-clip/{urllib.parse.quote(clip_name(c))}' for c in clips])
            n = await pg.evaluate('window.__pj.game.test.log.length')
            await pg.evaluate(f'''(() => {{ const pj = window.__pj; for (const u of {feeds}) pj.micTest.feed(u, 500);
              pj.game.choose(pj.tower.byWord('{target}')); }})()''')
            try:
                await pg.wait_for_function(f'window.__pj.game.test.log.slice({n}).some(l => l.includes("got {target}") || l.includes("no block {target}"))', timeout=90000)
            except Exception:
                st = await pg.evaluate('({ state: window.__pj.game.state, read: document.querySelector("#read").className, stt: window.__pj.sttState() })')
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
            if d.get('by') == 'phonics-api':
                print(f"  {d.get('target'):8s} {d.get('result'):7s} phonics-api heard [{d.get('heard')}] {d.get('ms')} ms d={d.get('d')}")
            else:
                print(f"  {d.get('target'):8s} {d.get('result'):7s} heard={d.get('text', '')!r:14} sT={d.get('sT')} gap={d.get('gap')} rgap={d.get('rgap')} rival={d.get('rival')} pNo={d.get('pNo')} {d.get('ms')} ms {d.get('why', '')}")
        except Exception:
            pass
    print('console:', errors if errors else 'clean')

asyncio.run(main())
