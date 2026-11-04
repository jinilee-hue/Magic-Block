"""Accept rates of speech-check rules on stt_eval.json (from tools/qa/stt_eval.ts).
usage: python3 tools/qa/stt_rules.py [eval.json]
gap  = log P(free transcript) - log P(target)        (small: the audio fits the target about as well as what was heard)
rgap = max log P(rival with another first sound) - log P(target)   (negative: the target's first sound wins)
"""
import json
import sys
from collections import defaultdict

R = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/Users/jini/.hermes/cache/scratch/jenga/stt_eval.json'))
for r in R:
    r['gap'] = r['sFree'] - r['sT']
    r['rgap'] = (max(r['rv'].values()) - r['sT']) if r['rv'] else -99


def rate(rule, sel):
    xs = [r for r in R if sel(r)]
    return sum(1 for r in xs if rule(r)) / max(1, len(xs)), len(xs)


POS = ['clean', 'bgm', 'cut', 'room']
NEG = ['swap-clean', 'swap-bgm', 'other', 'korean', 'music', 'noise']
RULES = {'base (now)': lambda r: r['base']}
for d in (1, 2, 3, 4, 5, 6):
    RULES[f'base|gap<{d}'] = (lambda d: lambda r: r['base'] or r['gap'] < d)(d)
for d1 in (0, 1, 2):
    for d2 in (4, 6, 8, 10):
        RULES[f'rgap<{d1}&gap<{d2}'] = (lambda d1, d2: lambda r: r['rgap'] < d1 and r['gap'] < d2)(d1, d2)
        RULES[f'(base|gap<2|rgap<{d1}&gap<{d2})'] = (lambda d1, d2: lambda r: r['base'] or r['gap'] < 2 or (r['rgap'] < d1 and r['gap'] < d2))(d1, d2)

print(f"{'rule':34s} " + ' '.join(f'{k[:9]:>9s}' for k in POS) + ' | ' + ' '.join(f'{k[:9]:>9s}' for k in NEG))
for name, rule in RULES.items():
    p = [rate(rule, lambda r, k=k: r['should'] and r['kind'] == k)[0] for k in POS]
    n = [rate(rule, lambda r, k=k: (not r['should']) and r['kind'] == k)[0] for k in NEG]
    print(f'{name:34s} ' + ' '.join(f'{x * 100:8.0f}%' for x in p) + ' | ' + ' '.join(f'{x * 100:8.0f}%' for x in n))

print('\nby voice (clean+bgm+cut+room), base vs best candidates:')
voices = sorted({r['voice'] for r in R if r['should']})
for name in ('base (now)', 'base|gap<3', 'base|gap<5', '(base|gap<2|rgap<1&gap<8)'):
    print(f'{name:28s}', ' '.join(f"{v[:9]}={rate(RULES[name], lambda r, v=v: r['should'] and r['voice'] == v)[0] * 100:.0f}%" for v in voices))

if '-v' in sys.argv:
    for r in R:
        if r['should'] and not r['base'] and r['kind'] == 'clean':
            print(f"MISS {r['voice']:10s} {r['target']:9s} said={r['said']:6s} heard={r['text']!r:18s} gap={r['gap']:5.1f} rgap={r['rgap']:5.1f}")
