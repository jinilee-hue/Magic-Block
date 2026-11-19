"""Expected phonemes for the phonics-api read check -> src/data/phonemes.json {word: [ARPABET]}.
Every word of src/data/words.json and every rival / one-word alt (the same word with another first sound), from the
company phonics-api's own G2P (phonics-kit/tools/papi.py g2p, cached). Re-run after tools/build_words.py.
usage: python3 tools/build_phonemes.py      (key: ~/.config/phonics-api/key — never printed)
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit/tools'))
import papi  # noqa: E402

words = json.loads((ROOT / 'src/data/words.json').read_text())['words']
need = []
for w in words:
    need += [w['w'], *w.get('rivals', []), *[a for a in w.get('alts', []) if ' ' not in a]]
table = papi.g2p(need)
(ROOT / 'src/data/phonemes.json').write_text(json.dumps(dict(sorted(table.items())), separators=(',', ':')) + '\n')
print(f'{len(table)} words -> src/data/phonemes.json')
