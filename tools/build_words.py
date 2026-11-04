"""Build src/data/words.json — the 54 Jenga block words, all from FPR K (From Phonics to Reading K).

Source: SAD·FPR 단어 연구 자료집 v1.0 → ~/dev/sadfpr-studio/data/b2_book_FPRK.json (words: lemma → printed/picture pages).
- M: every lemma in FPR K that starts with m (28), minus picture-description phrases ("man digging"…) and the
  character names Max · Meg · Mike (user's choice: 28 m-words + 26 other FPR K words = 54 blocks, a real Jenga set).
  'meet' appears in the book only as 'met', so the block shows 'met'.
- OTHER: 26 FPR K words that do NOT start with m. Most rhyme with an m-word (pan/man, cap/map, cat/mat …) so a child
  has to look at the FIRST letter, not the word shape; jam and lamp have an m inside but not at the start.

Run: python3 tools/build_words.py   (prints the table; writes src/data/words.json)
Only words, Korean glosses and page numbers are written — no textbook sentences (internal material).
"""
import json
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path(os.path.expanduser('~/dev/sadfpr-studio/data/b2_book_FPRK.json'))
B = json.loads(SRC.read_text(encoding='utf-8'))
W, GM, LP = B['words'], B['gm'], B['lp']

M_WORDS = ['mad', 'mail', 'mailbox', 'make', 'man', 'map', 'mask', 'mat', 'match', 'maze', 'meat', 'met', 'mess',
           'milk', 'mirror', 'mitt', 'mitten', 'mix', 'mom', 'monkey', 'moon', 'mop', 'mouse', 'mouth', 'mud', 'mug',
           'mushroom', 'my']
LEMMA = {'met': 'meet'}                       # block text → lemma in the ledger
EXCLUDED = {'max': '이름(Max)', 'meg': '이름(Meg)', 'mike': '이름(Mike)', 'man digging': '그림 설명 구절',
            'man juggling': '그림 설명 구절', 'man with hats': '그림 설명 구절', 'mom with popcorn': '그림 설명 구절'}
OTHER = [  # rhyme partner in the comment
    'pan', 'van',      # man
    'cap', 'nap',      # map
    'cat', 'hat',      # mat
    'top', 'hop',      # mop
    'rug', 'bug',      # mug
    'sad', 'bad',      # mad
    'six', 'fix',      # mix
    'net', 'jet',      # met
    'cake', 'lake',    # make
    'nail', 'tail',    # mail
    'kit', 'fit',      # mitt
    'sun', 'dog',      # everyday picture words
    'jam', 'lamp',     # an m inside, not at the start
]
# read-aloud check (src/core/sttCheck.ts): other spellings the recogniser may write for the same word, and the same
# word with another first sound — common words only (the check asks: does it start with m, or with one of these?)
ALTS = {'mail': ['male'], 'meat': ['meet'], 'maze': ['maize'], 'mom': ['mum'], 'mailbox': ['mail box']}
RIVALS = {
    'mad': ['bad', 'dad', 'had', 'pad', 'sad', 'lad', 'fad'], 'mail': ['bail', 'fail', 'jail', 'nail', 'pail', 'rail', 'sail', 'tail', 'hail'],
    'mailbox': [], 'make': ['bake', 'cake', 'fake', 'lake', 'rake', 'take', 'wake'], 'man': ['ban', 'can', 'fan', 'pan', 'ran', 'tan', 'van'],
    'map': ['cap', 'gap', 'lap', 'nap', 'rap', 'tap', 'zap'], 'mask': ['task', 'bask', 'cask'], 'mat': ['bat', 'cat', 'fat', 'hat', 'pat', 'rat', 'sat'],
    'match': ['batch', 'catch', 'hatch', 'latch', 'patch', 'watch'], 'maze': ['daze', 'gaze', 'haze'], 'meat': ['beat', 'feet', 'heat', 'neat', 'seat'],
    'met': ['bet', 'get', 'jet', 'let', 'net', 'pet', 'set', 'wet', 'yet'], 'mess': ['less', 'yes', 'guess'], 'milk': ['silk'],
    'mirror': [], 'mitt': ['bit', 'fit', 'hit', 'kit', 'lit', 'pit', 'sit'], 'mitten': ['kitten', 'bitten'], 'mix': ['fix', 'six', 'nix'],
    'mom': ['tom', 'bomb'], 'monkey': ['donkey'], 'moon': ['noon', 'soon', 'june', 'tune'], 'mop': ['top', 'hop', 'pop', 'cop', 'bop'],
    'mouse': ['house', 'louse'], 'mouth': ['south'], 'mud': ['bud', 'dud', 'cud'], 'mug': ['bug', 'hug', 'jug', 'rug', 'tug', 'dug'],
    'mushroom': [], 'my': ['by', 'pie', 'tie', 'die', 'lie', 'hi', 'why', 'guy'],
}


def lesson_of(p):
    for L, (a, b) in LP.items():
        if a <= p <= b:
            return int(L)
    return None


def entry(text, kind):
    lemma = LEMMA.get(text, text)
    v = W.get(lemma)
    assert v is not None, f'{lemma} not in FPR K'
    pages = sorted(set(v.get('printed', []) + v.get('picture', []) + v.get('tg', [])))
    lessons = sorted({L for L in (lesson_of(p) for p in pages) if L is not None})
    ko, pos = GM.get(lemma, ['', ''])
    e = {'w': text, 'lemma': lemma, 'm': kind == 'm', 'first': text[0], 'ko': ko, 'pos': pos,
         'pages': pages[:8], 'lessons': lessons, 'cat': v.get('cat', '')}
    if kind == 'm':
        e['alts'], e['rivals'] = ALTS.get(text, []), RIVALS[text]
    return e


# every m-lemma in the book is either used or excluded with a reason
all_m = sorted(k for k in W if k.lower().startswith('m'))
for k in all_m:
    t = next((t for t, l in LEMMA.items() if l == k), k)
    assert t in M_WORDS or k.lower() in EXCLUDED, f'm-word not handled: {k}'
assert len(M_WORDS) == 28 and len(set(M_WORDS)) == 28
assert len(OTHER) == 26 and len(set(OTHER)) == 26 and not any(w.startswith('m') for w in OTHER)

words = [entry(w, 'm') for w in M_WORDS] + [entry(w, 'other') for w in OTHER]
out = {
    'book': 'FPR K (From Phonics to Reading K)',
    'source': 'SAD·FPR 단어 연구 자료집 v1.0 (2026-10-05) · b2_book_FPRK.json',
    'target': 'm',
    'excluded': EXCLUDED,
    'words': words,
}
dst = ROOT / 'src' / 'data' / 'words.json'
dst.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
for e in words:
    print(f"{'M' if e['m'] else ' '} {e['w']:9s} {e['ko'][:12]:12s} L{e['lessons'][:4]} p{e['pages'][:4]}")
print('m', sum(e['m'] for e in words), 'other', sum(not e['m'] for e in words), '→', dst)
