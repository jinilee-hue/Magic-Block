"""Build src/data/words.json — the 46 Jenga block words, all from FPR K Unit 1 (Lessons 1-5, pages 9-76).

Source: SAD·FPR 단어 연구 자료집 v1.0 → ~/dev/sadfpr-studio/data/b2_book_FPRK.json (words: lemma → printed/picture pages;
rows: lemma → page + lesson; lu: lesson → unit; cards: picture-card pages).
- Unit 1 = a word on a page of lessons 1-5, or on the Unit 1 picture cards (p387, \"Lesson 1-5\") — user: \"지금 나오는 m
  단어가 FPR K Unit1에 나오는 단어로 구성된건지 확인해줘\" → only Unit 1.
- M: every m-word of Unit 1 (20): 17 on the lesson pages + mail, mailbox, mask from the p387 picture cards.
  The m-words outside Unit 1 (mad, make, maze, met, mess, mix, mom, mud: lessons 11-24) are no longer blocks.
- OTHER: 26 Unit 1 words that do NOT start with m. Most rhyme with an m-word (pan/man, cap/map, cat/mat …) so a child
  has to look at the FIRST letter, not the word shape; jam and lemon have an m inside but not at the start.

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
LU = {int(k): v for k, v in B['lu'].items()}
UNIT1_ROWS = {r['lemma'] for r in B['rows'] if r.get('lesson') and LU.get(r['lesson']) == 1}
UNIT1_CARDS = set(B['cards']['387']['cards'])            # "Picture Cards p387 (Lesson 1 … Lesson 5)"


def in_unit1(lemma):
    return lemma in UNIT1_ROWS or lemma in UNIT1_CARDS


M_WORDS = ['man', 'map', 'mat', 'match', 'meat', 'milk', 'mirror', 'mitt', 'mitten', 'monkey', 'moon', 'mop', 'mouse',
           'mouth', 'mug', 'mushroom', 'my',      # on the lesson pages
           'mail', 'mailbox', 'mask']             # on the Unit 1 picture cards
LEMMA = {}                                       # block text → lemma in the ledger (none differ in Unit 1)
EXCLUDED = {}                                    # Unit 1 m-lemmas that are not blocks (none)
OTHER = [  # rhyme partner in the comment
    'pan', 'van', 'fan',   # man
    'cap', 'tap',          # map
    'cat', 'hat', 'bat',   # mat
    'hop', 'pop',          # mop
    'rug',                 # mug
    'tail',                # mail
    'turkey',              # monkey
    'spoon',               # moon
    'sit',                 # mitt
    'pie', 'tie',          # my
    'box',                 # mailbox
    'sun', 'dog', 'sock', 'six', 'ten', 'bag',   # everyday picture words
    'jam', 'lemon',        # an m inside, not at the start
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


# every m-lemma of Unit 1 is a block (or excluded with a reason), and every block word is from Unit 1
all_m = sorted(k for k in W if k.lower().startswith('m') and in_unit1(k) and k.lower() not in {n.lower() for n in B['names']})
for k in all_m:
    t = next((t for t, l in LEMMA.items() if l == k), k)
    assert t in M_WORDS or k.lower() in EXCLUDED, f'Unit 1 m-word not handled: {k}'
for t in M_WORDS + OTHER:
    assert in_unit1(LEMMA.get(t, t)), f'not in FPR K Unit 1: {t}'
assert len(M_WORDS) == 20 and len(set(M_WORDS)) == 20
assert len(OTHER) == 26 and len(set(OTHER)) == 26 and not any(w.startswith('m') for w in OTHER)

words = [entry(w, 'm') for w in M_WORDS] + [entry(w, 'other') for w in OTHER]
out = {
    'book': 'FPR K (From Phonics to Reading K) · Unit 1 (Lessons 1-5)',
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
