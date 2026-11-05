"""Pre-made voice clips (no device speechSynthesis: the voice must be the same on every device).

- Tutor lines + word clips: the company TTS (Qwen3-TTS, OpenAI-style /audio/speech), preset 'aiden' with a cheerful
  7-year-old-boy instruction — the one tutor voice the user picked for Phonics Island, used for everything the fox says.
  → public/voice/t_<key>.mp3, w_<word>.mp3
- First sounds: OFFICIAL FPR K letter-sound recordings copied from Phonics Island (public/fpr) → public/voice/s_<x>.mp3
  (TTS can't say a lone phoneme like /m/ reliably; the textbook recordings can.)
- The company TTS is unreliable on ONE word: a take can come back as "Ahh... meat.", "A mess.", a 7-second drawl, or
  "hat" without its h. Each take is read back with whisper-base.en (tools/qa/voice_check.ts) and retaken with the next
  instruction wording until it's heard as the word (the server caches identical requests, so a retake must change the
  instruction). Words that never pass are listed at the end — check those by ear.
- `--engine edge` = the old free prototype voice (Microsoft 'Ana' via edge-tts), for offline work.

Clips are cut 0.15 s after speech; lead-in and loudness are applied at playback from src/data/voice.json:
{key: [file, start s, gain, dur s]}.
Run (company network / VPN; TTS_BASE_URL + LLM_API_KEY live in ~/.zshrc — never printed):
  zsh -ic '/Users/jini/.hermes/bin/uv run --with numpy python tools/build_voice.py'
Offline: /Users/jini/.hermes/bin/uv run --with edge-tts --with numpy python tools/build_voice.py --engine edge
"""
import asyncio
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'voice'
JSON_OUT = ROOT / 'src' / 'data' / 'voice.json'
PI = pathlib.Path.home() / 'Documents/Jini/2026/Phonics/Phonics_island/phonics-island-3d/public'
SR = 24000
ENGINE = sys.argv[sys.argv.index('--engine') + 1] if '--engine' in sys.argv else 'qwen'
CACHE = pathlib.Path.home() / '.cache' / 'phonics-jenga' / ('voice' if ENGINE == 'edge' else 'voice_qwen')
# read-back model: whisper-base.en if it has been downloaded (much better on single words), else the game's tiny.en
CHECK_MODELS = pathlib.Path.home() / '.cache' / 'phonics-jenga' / 'models'
if not (CHECK_MODELS / 'onnx-community/whisper-base.en').exists():
    CHECK_MODELS = pathlib.Path('/Users/jini/.hermes/cache/scratch/jenga/models')

# edge (prototype)
VOICE = 'en-US-AnaNeural'
WORD_RATE, WORD_PITCH = '-10%', '+0Hz'
TUTOR_RATE, TUTOR_PITCH = '-5%', '+10Hz'
# company TTS
QWEN_URL, QWEN_KEY = os.environ.get('TTS_BASE_URL', '').rstrip('/'), os.environ.get('LLM_API_KEY', '')
QWEN_VOICE = 'aiden'
# one wording per take (measured on mad/mail/map/mat/meat/met/mess/mouth: the first two pass most often; the old
# "...for a child learning English sounds" made it act out: "Ahh... meat.")
W_INS = ['Say this one word slowly and clearly, like a cheerful 7-year-old boy.',
         'Say this one word clearly, like a cheerful 7-year-old boy.',
         'Say this one word clearly and not too fast, like a cheerful 7-year-old boy.',
         'Say this one word clearly, like a cheerful 7-year-old boy. Make the first sound clear.',
         'Like a cheerful 7-year-old boy, say just this one word, clearly, with a clear first sound.',
         'Say this one word slowly, like a cheerful 7-year-old boy showing a friend how to say it.',
         'Say this one word slowly and clearly, like a cheerful 7-year-old boy.',
         'Say this one word clearly, like a cheerful 7-year-old boy.']
# takes 7+: a pronunciation hint for words the first takes kept getting wrong ("van" came back as "vin" / "then")
HINT = {'van': 'The word is van, a small car; it rhymes with man.', 'maze': 'The word is maze; it rhymes with days.'}
# spelled the way the TTS says it right ("Van." always came back as "vin"/"then"; "Vaan." is heard as "van")
SAY = {'van': 'Vaan.'}
# tried after every instruction wording failed (cycled over the first two wordings)
SPELL_ALT = {'fit': ['Fitt.', 'Phit.', 'Fit!'], 'kit': ['Kitt.', 'Kit!', 'Khit.'], 'pan': ['Pann.', 'Pan!', 'Pæn.'],
             'maze': ['Maize.', 'Maize!', 'Mayz.']}
T_INS = ['Speak like a cheerful, energetic 7-year-old boy: bright and excited.',
         'Speak like a cheerful, energetic 7-year-old boy, bright and excited, clearly.',
         'Like a cheerful, energetic 7-year-old boy: bright, excited and clear.']

TUTOR = {
    'hello': 'Hi, friends! Welcome to Magic Jenga!',
    'pressstart': 'Press start to play!',
    'pick1': 'Player one, pick your animal!',
    'pick2': 'Player two, pick your animal!',
    'a_bunny': 'Bunny!',
    'a_kitty': 'Kitty!',
    'a_puppy': 'Puppy!',
    'a_panda': 'Panda!',
    'welcome': "Let's play Magic Jenga!",
    'howto1': 'Take turns with your friend.',
    'howto2': 'Pull it out and read the word. Then the block is yours!',
    'howto3': 'Get the most blocks to win!',
    'howto4': 'But pick a wrong block three times, and the tower falls!',
    'rule': 'Find a block that starts with m!',
    'rotate': 'Turn the tower to see all the blocks!',
    'turn1': 'Player one, your turn!',
    'turn2': 'Player two, your turn!',
    'look': 'Look for m!',
    'perfect': 'Perfect! Pull it out!',
    'sayit': 'Now say the word.',
    'great1': 'Awesome! You got the block!',
    'great2': 'Great reading!',
    'great3': 'Yes! You did it!',
    'goodtry': 'Good try! This block is yours!',
    'again': 'Try again! Listen.',
    'louder': "I can't hear you. Say it loud!",
    'tapmic': 'Tap the mic and say it!',
    'nomic': 'Say it out loud!',
    'uhoh': 'Uh-oh!',
    'startswith': 'It starts with',
    'notm': 'Not m!',
    'allout': 'Wow! All the m blocks are out!',
    'watch': 'Now watch the tower!',
    'win1': 'Player one wins!',
    'win2': 'Player two wins!',
    'tie': "It's a tie! You both did great!",
    'playagain': "Let's play again!",
    'strike2': 'Careful! One more wrong block, and the tower falls!',
    'strike3': 'Oh no! Three wrong blocks. The tower is falling!',
}

# Korean (core/lang.ts — the EN | 한 toggle next to Settings): every tutor line again, same voice, language 'ko'.
# A value is the bubble text, or (bubble text, what the voice reads) where they differ: the letter m is read 엠.
TUTOR_KO = {
    'hello': '안녕, 친구들! 매직 젠가에 온 걸 환영해!',
    'pressstart': '스타트 버튼을 눌러 봐!',
    'pick1': '플레이어 1, 동물 친구를 골라 봐!',
    'pick2': '플레이어 2, 동물 친구를 골라 봐!',
    'a_bunny': '토끼!',
    'a_kitty': '고양이!',
    'a_puppy': '강아지!',
    'a_panda': '판다!',
    'welcome': '자, 매직 젠가를 시작하자!',
    'howto1': '친구랑 번갈아 가며 하는 거야.',
    'howto2': '블럭을 빼서 단어를 읽으면, 그 블럭은 네 거야!',
    'howto3': '블럭을 더 많이 모으면 이겨!',
    'howto4': '그런데 틀린 블럭을 세 번 고르면, 탑이 와르르 무너져!',
    'rule': ('m으로 시작하는 블럭을 찾아봐!', '엠으로 시작하는 블럭을 찾아봐!'),
    'rotate': '탑을 돌려서 블럭을 모두 살펴봐!',
    'turn1': '플레이어 1, 네 차례야!',
    'turn2': '플레이어 2, 네 차례야!',
    'look': ('m을 찾아봐!', '엠을 찾아봐!'),
    'perfect': '딩동댕! 쏙 빼 봐!',
    'sayit': '이제 단어를 읽어 봐.',
    'great1': '대단해! 블럭을 얻었어!',
    'great2': '정말 잘 읽었어!',
    'great3': '해냈어! 최고야!',
    'goodtry': '잘했어! 이 블럭은 네 거야!',
    'again': '다시 해 보자! 잘 들어 봐.',
    'louder': '잘 안 들려. 크게 말해 봐!',
    'tapmic': '마이크를 누르고 말해 봐!',
    'nomic': '소리 내어 읽어 봐!',
    'uhoh': '앗!',
    'startswith': '첫소리는',
    'notm': ('m이 아니야!', '엠이 아니야!'),
    'allout': ('와! m 블럭을 모두 뺐어!', '와! 엠 블럭을 모두 뺐어!'),
    'watch': '이제 탑을 잘 봐!',
    'win1': '플레이어 1 승리!',
    'win2': '플레이어 2 승리!',
    'tie': '비겼어! 둘 다 정말 잘했어!',
    'playagain': '한 번 더 하자!',
    'strike2': '조심해! 한 번만 더 틀리면 탑이 무너져!',
    'strike3': '이런! 세 번 틀렸어. 탑이 무너진다!',
}
assert set(TUTOR_KO) == set(TUTOR), f'Korean lines missing/extra: {set(TUTOR) ^ set(TUTOR_KO)}'
ko_say = lambda v: v[1] if isinstance(v, tuple) else v
ko_show = lambda v: v[0] if isinstance(v, tuple) else v

WORDS = json.loads((ROOT / 'src/data/words.json').read_text())['words']
words = [w['w'] for w in WORDS]
letters = sorted({w[0] for w in words})
fname = lambda s: re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')
tag = lambda *p: hashlib.md5('|'.join(p).encode()).hexdigest()[:8]

# (key, what to read it as) — w: words, t: tutor lines, k: the tutor lines in Korean
JOBS = [(f'w:{w}', w) for w in words] + [(f't:{k}', t) for k, t in TUTOR.items()] + [(f'k:{k}', ko_say(v)) for k, v in TUTOR_KO.items()]


def take_of(key, text, take):
    """input text, instruction and cache file of one take (None = no take this round)"""
    if key[0] == 'k':
        if take >= len(T_INS):
            return None
        ins = T_INS[take]
        return text, ins, CACHE / f'k_{fname(key[2:])}_{tag(QWEN_VOICE, ins, text, "ko")}.mp3'
    if key[0] == 'w':
        if take >= len(W_INS):
            # last resort: respellings the TTS may say right ("Maize." is how "maze" sounds)
            alts = SPELL_ALT.get(text)
            if not alts:
                return None
            k = take - len(W_INS)
            inp, ins = alts[k % len(alts)], W_INS[k % 2]
            return inp, ins, CACHE / f'w_{fname(text)}_{tag(QWEN_VOICE, ins, inp)}.mp3'
        ins = W_INS[take % len(W_INS)]
        if take >= 7 and text in HINT:
            ins = f'{ins} {HINT[text]}'
        # takes 1-4 "Word.", 5-6 "Word!", 7 plain "word" (no punctuation: what finally worked for "maze"), 8 "Word." + hint
        inp = f'{text.capitalize()}.' if take < 4 or take >= 7 else f'{text.capitalize()}!' if take < 6 else text
        inp = SAY.get(text, inp)
        return inp, ins, CACHE / f'w_{fname(text)}_{tag(QWEN_VOICE, ins, inp)}.mp3'
    if take >= len(T_INS):
        return None
    ins = T_INS[take % len(T_INS)]
    # take 0 keeps the first build's file names (already in the cache)
    return text, ins, CACHE / (f't_{fname(text)}_{tag(QWEN_VOICE, ins)}.mp3' if take == 0 else f't_{fname(text)}_{tag(QWEN_VOICE, ins, str(take))}.mp3')


# ── engines ────────────────────────────────────────────────────────────────────────────────────────────────
async def fetch_edge(todo):
    import edge_tts
    sem = asyncio.Semaphore(6)

    async def one(j):
        key, text, dst = j
        rate, pitch = (WORD_RATE, WORD_PITCH) if key[0] == 'w' else (TUTOR_RATE, TUTOR_PITCH)
        async with sem:
            for attempt in range(5):
                try:
                    tmp = dst.with_suffix('.part')
                    await edge_tts.Communicate(text, VOICE, rate=rate, pitch=pitch).save(str(tmp))
                    tmp.rename(dst)
                    return
                except Exception as e:  # the service drops connections now and then
                    if attempt == 4:
                        raise RuntimeError(f'{key}: {e}')
                    await asyncio.sleep(1.5 * (attempt + 1))
    await asyncio.gather(*(one(j) for j in todo))


def qwen_one(key, inp, ins, dst):
    body = json.dumps({'model': 'qwen-tts', 'input': inp, 'voice': QWEN_VOICE, 'language': 'ko' if key[0] == 'k' else 'en',
                       'response_format': 'wav', 'instructions': ins}).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request(QWEN_URL + '/audio/speech', data=body, method='POST',
                                         headers={'Authorization': 'Bearer ' + QWEN_KEY, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=120) as r:
                wav = r.read()
            with tempfile.NamedTemporaryFile(suffix='.wav') as f:
                f.write(wav); f.flush()
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f.name, '-ac', '1', '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', '64k', str(dst)], check=True)
            return
        except Exception as e:  # 503 = the GPU is busy (one request at a time): wait and retry
            if attempt == 5:
                raise RuntimeError(f'{key}: {type(e).__name__} {getattr(e, "code", "")}')
            time.sleep(4 + 3 * attempt)


def read_back(items):
    """[(file, target, start, dur)] → {file: (ok, heard, seconds of sound)} via whisper (tools/qa/voice_check.ts)"""
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump([{'file': str(p), 'target': t, 'start': s, 'dur': d} for p, t, s, d in items], f)
    env = {**os.environ, 'STT_MODEL': 'onnx-community/whisper-base.en', 'STT_MODELS_DIR': f'{CHECK_MODELS}/'} \
        if (CHECK_MODELS / 'onnx-community/whisper-base.en').exists() else dict(os.environ)
    r = subprocess.run(['node', str(ROOT / 'tools/qa/voice_check.ts'), f.name], capture_output=True, text=True, env=env, cwd=ROOT)
    os.unlink(f.name)
    last = [l for l in r.stdout.splitlines() if l.startswith('[')]
    if r.returncode or not last:
        print('  read-back failed:', r.stderr[-400:]); return {}
    return {o['file']: (o['ok'], o['text'], o['sound']) for o in json.loads(last[-1])}


def read_back_ko(items):
    """Korean lines: [(file, target, start, dur)] → {file: (ok, heard, seconds)} via a multilingual whisper
    (tools/qa/ko_check.py, faster-whisper small). Very short lines ("앗!") pass on a sane length alone."""
    if not items:
        return {}
    norm = lambda s: ''.join(ch for ch in s if ch.isalnum())
    out, todo = {}, []
    for p, t, s, d in items:
        if len(norm(t)) <= 2:
            out[str(p)] = (0.15 < d < 2.0, f'({d:.2f}s)', d)
        else:
            todo.append({'file': str(p), 'target': t, 'dur': d})
    if todo:
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump(todo, f, ensure_ascii=False)
        uv = os.environ.get('UV', '/Users/jini/.hermes/bin/uv')
        r = subprocess.run([uv, 'run', '--with', 'faster-whisper', 'python', str(ROOT / 'tools/qa/ko_check.py'), '--json', f.name],
                           capture_output=True, text=True, cwd=ROOT)
        res = pathlib.Path(f.name.replace('.json', '_out.json'))
        if r.returncode or not res.exists():
            print('  Korean read-back failed:', r.stderr[-400:])
            return {**out, **{o['file']: (True, '?', o['dur']) for o in todo}}
        for o in json.loads(res.read_text()):
            out[o['file']] = (o['sim'] >= 0.75, o['heard'], o['dur'])
        os.unlink(f.name); res.unlink()
    return out


LEAD, TAIL = .10, .25
FR = int(SR * .01)


def decode(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(p), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def speech(x, floor_db=-50):
    n = len(x) // FR
    rms = np.sqrt((x[:n * FR].reshape(n, FR) ** 2).mean(1) + 1e-12)
    return rms, np.nonzero(rms > rms.max() * 10 ** (floor_db / 20))[0]


def trim(raw, dst, target_db=-17, floor_db=-50):
    """the clip as the game plays it: cut 0.25 s after the speech → dst; returns (start, gain, dur) for voice.json"""
    _, act = speech(decode(raw), floor_db)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-t', f'{(act[-1] + 1) * FR / SR + TAIL:.3f}',
                    '-c:a', 'copy', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '0', str(dst)],
                   check=True)
    y = decode(dst)
    rms, act = speech(y, floor_db)
    voiced = rms[act[0]:act[-1] + 1]
    loud = np.sqrt((voiced[voiced > voiced.max() * .1] ** 2).mean())
    g = min(10 ** (target_db / 20) / loud, 10 ** (-1 / 20) / np.abs(y).max())
    start = max(0., act[0] * FR / SR - LEAD)
    return round(start, 3), round(float(g), 3), round(len(y) / SR - start, 3)


CACHE.mkdir(parents=True, exist_ok=True)
chosen = {}
if ENGINE == 'edge':
    todo = []
    for key, text in JOBS:
        if key[0] == 'k':
            continue                       # the prototype voice is English only: no Korean lines offline
        rate, pitch = (WORD_RATE, WORD_PITCH) if key[0] == 'w' else (TUTOR_RATE, TUTOR_PITCH)
        dst = CACHE / f'{key[0]}_{fname(text)}_{rate}{pitch}.mp3'
        chosen[key] = dst
        if not dst.exists():
            todo.append((key, f'{text}.' if key[0] == 'w' else text, dst))
    asyncio.run(fetch_edge(todo))
else:
    if not (QWEN_URL and QWEN_KEY):
        sys.exit('TTS_BASE_URL / LLM_API_KEY not set: run inside `zsh -ic` on the company network (or use --engine edge)')
    pending, first, verdicts, gave_up = list(JOBS), {}, {}, []
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='pj_voice_'))
    for take in range(len(W_INS) + 4):
        batch = []
        for key, text in pending:
            got = take_of(key, text, take)
            if got is None:
                # out of wordings for this one: keep its first take (it never passed the read-back)
                if key in first:
                    chosen[key] = first[key]; gave_up.append(key)
                continue
            inp, ins, dst = got
            if not dst.exists():
                qwen_one(key, inp, ins, dst)
            first.setdefault(key, dst)
            batch.append((key, text, dst))
        if not batch:
            break
        # judge exactly what the game will play: the trimmed clip from its start offset
        checks = []
        for key, text, dst in batch:
            cut = tmp / f'{key[0]}_{fname(key[2:])}_{take}.mp3'
            start, _, dur = trim(dst, cut)
            checks.append((cut, text, start, dur))
        heard = read_back([c for c, (k, *_r) in zip(checks, batch) if k[0] != 'k'])
        heard.update(read_back_ko([c for c, (k, *_r) in zip(checks, batch) if k[0] == 'k']))
        still = []
        for (key, text, dst), (cut, *_rest) in zip(batch, checks):
            ok, got, snd = heard.get(str(cut), (True, '?', 0))     # no read-back possible: keep the take
            verdicts[key] = (got, snd)
            if ok:
                chosen[key] = dst
            else:
                still.append((key, text))
        print(f'take {take + 1}: {len(batch) - len(still)}/{len(batch)} heard right', flush=True)
        pending = still
        if not pending:
            break
    for key, _ in pending:
        chosen[key] = first[key]
    never = list(dict.fromkeys([k for k, _ in pending] + gave_up))
    if never:
        print('never heard right (kept take 1 — check by ear):', [(k, verdicts[k][0]) for k in never])
print('clips', len(chosen), '· engine', ENGINE)

OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('*.mp3'):
    f.unlink()
manifest = {}


def place(key, raw, dst, target_db=-17, floor_db=-50):
    manifest[key] = [dst.name, *trim(raw, dst, target_db, floor_db)]


for key, _ in JOBS:
    if key in chosen:
        place(key, chosen[key], OUT / f'{key[0]}_{fname(key[2:])}.mp3')

# official letter sounds (FPR K) — the clips carry ~0.5 s of silence before the sound; trim + level them too
fpr = json.loads((PI / 'fpr/manifest.json').read_text())['clips']
for L in sorted(set(letters) | {'m'}):
    src = PI / fpr[f'sound:{L}']
    place(f's:{L}', src, OUT / f's_{L}.mp3', target_db=-18, floor_db=-40)

voice = {'engine': 'edge', 'voice': VOICE, 'word': [WORD_RATE, WORD_PITCH], 'tutor': [TUTOR_RATE, TUTOR_PITCH]} if ENGINE == 'edge' \
    else {'engine': 'company-tts', 'voice': QWEN_VOICE}
# 'lines' = what each tutor line says, for the fox's speech bubble (ui/foxsay.ts); 'lines_ko' = the same in Korean
JSON_OUT.write_text(json.dumps({**voice, 'clips': manifest, 'lines': TUTOR, 'lines_ko': {k: ko_show(v) for k, v in TUTOR_KO.items()}},
                               indent=0, ensure_ascii=False), encoding='utf-8')
d = sorted((v[3], k) for k, v in manifest.items())
size = sum((OUT / v[0]).stat().st_size for v in manifest.values())
print(f'{len(manifest)} clips · {size / 1024:.0f} KB · shortest {d[:3]} · longest {d[-3:]}')
