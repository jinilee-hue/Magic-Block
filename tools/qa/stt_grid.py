"""Grid search for the read-aloud rule on stt_eval*.json.
usage: python3 tools/qa/stt_grid.py eval.json [eval2.json ...]
rule = exact OR (gap < G AND rgap_X < V)
  exact : the free transcript is the word (or a homophone / same-sound spelling)
  gap   : log P(free transcript) - log P(target)
  rgap_X: best rival (same word, another first sound; rivals starting with a letter in X are left out) - target
"""
import json
import re
import sys

SAME = {'mail': ['male'], 'meat': ['meet'], 'mitt': ['mit'], 'maze': ['maize', 'mays'], 'mix': ['mics'], 'mom': ['mum', 'mam', 'mama', 'mommy'],
        'my': ['mi', 'mai'], 'mailbox': ['mail box'], 'mouse': ['mice'], 'man': ['men']}


def key(w):
    w = w.replace('ph', 'f').replace('ck', 'k').replace('c', 'k').replace('q', 'k').replace('x', 'ks')
    w = re.sub(r'(.)\1+', r'\1', w)
    return re.sub(r'^(.{2,})e$', r'\1', w)


def exact(t, text):
    ws = re.findall(r"[a-z0-9']+", text.lower().replace("'", ''))
    cands = ws + [''.join(ws)] + [' '.join(ws)]
    return any(h == t or key(h) == key(t) or h in SAME.get(t, []) for h in cands if h)


def load(p):
    R = json.load(open(p))
    for r in R:
        r['exact'] = exact(r['target'], r['text'])
        r['gap'] = r['sFree'] - r['sT']
    return R


def rgap(r, X):
    v = [s for w, s in r['rv'].items() if w[0] not in X]
    return (max(v) - r['sT']) if v else -99


POS = ['clean', 'bgm', 'room', 'cut']
NEG = ['swap-clean', 'swap-bgm', 'other', 'korean', 'music', 'noise']


def report(R, label):
    def rate(rule, sel):
        xs = [r for r in R if sel(r)]
        return 100 * sum(1 for r in xs if rule(r)) / max(1, len(xs))
    print(f'\n== {label}')
    print(f"{'rule':30s} " + ' '.join(f'{k[:7]:>7s}' for k in POS) + ' |' + ' '.join(f'{k[:8]:>8s}' for k in NEG) + ' | worst voice')
    rules = {'base (now: fuzzy text)': lambda r: r['base'], 'exact text': lambda r: r['exact']}
    for X in ('', 'b', 'bn', 'bnp'):
        for V in (0, 1, 2):
            for G in (6, 8, 10):
                rules[f'ex|gap<{G}&rgap[-{X}]<{V}'] = (lambda X, V, G: lambda r: r['exact'] or (r['gap'] < G and rgap(r, X) < V))(X, V, G)
    voices = sorted({r['voice'] for r in R if r['should']})
    rows = []
    for name, rule in rules.items():
        p = [rate(rule, lambda r, k=k: r['should'] and r['kind'] == k) for k in POS]
        n = [rate(rule, lambda r, k=k: (not r['should']) and r['kind'] == k) for k in NEG]
        pv = {v: rate(rule, lambda r, v=v: r['should'] and r['voice'] == v and r['kind'] != 'cut') for v in voices}
        wv = min(pv, key=pv.get)
        rows.append((name, p, n, wv, pv[wv]))
    for name, p, n, wv, x in rows:
        print(f'{name:30s} ' + ' '.join(f'{v:6.0f}%' for v in p) + ' |' + ' '.join(f'{v:7.0f}%' for v in n) + f' | {wv} {x:.0f}%')


for path in sys.argv[1:]:
    report(load(path), path.split('/')[-1])
