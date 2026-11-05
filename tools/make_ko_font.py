"""Korean font for the EN/KO toggle (core/lang.ts): Jua (Google Fonts, SIL OFL 1.1 — rounded, child-friendly, goes with
Baloo), cut down to the Hangul syllables the game shows → public/fonts/Jua-ko.woff2 (main.ts loads it for Hangul only).
The syllables are collected from the sources that hold Korean text: src/core/lang.ts (screen words) and
tools/build_voice.py (TUTOR_KO, the fox's Korean lines). Re-run after changing either.

    uv run --with fonttools --with brotli python tools/make_ko_font.py
"""
import pathlib
import re
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC_URL = 'https://github.com/google/fonts/raw/main/ofl/jua/Jua-Regular.ttf'
CACHE = pathlib.Path.home() / '.cache' / 'phonics-jenga' / 'fonts' / 'Jua-Regular.ttf'
OUT = ROOT / 'public' / 'fonts' / 'Jua-ko.woff2'
SOURCES = [ROOT / 'src' / 'core' / 'lang.ts', ROOT / 'tools' / 'build_voice.py']

if not CACHE.exists():
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(SRC_URL, CACHE)
chars = sorted({c for p in SOURCES for c in re.findall(r'[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]', p.read_text(encoding='utf-8'))})
if not chars:
    sys.exit('no Korean text found')
subprocess.run([sys.executable, '-m', 'fontTools.subset', str(CACHE), f'--unicodes={",".join(f"U+{ord(c):04X}" for c in chars)}',
                '--flavor=woff2', f'--output-file={OUT}', '--layout-features=*', '--no-hinting'], check=True)
print(f'{len(chars)} syllables → {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB)')
