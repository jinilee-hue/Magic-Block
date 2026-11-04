# Phonics Jenga

친구와 둘이 하는 파닉스 젠가 (FPR K · 5세). 탑에서 **m으로 시작하는 단어** 블럭을 골라 빼고, 그 단어를 **소리 내어 읽어야** 내 차례가 끝나고 친구 차례로 넘어갑니다. 여우 튜터가 말로 이끌어 줍니다.

- 공개 주소: https://jinilee-hue.github.io/phonics-jenga/
- 로컬 실행: `npm install` 후 `npm run dev` → http://localhost:5195/

## 게임 규칙
- 54블럭(18층×3) = FPR K의 m단어 28개 + 다른 FPR K 단어 26개. 판마다 섞입니다.
- m블럭을 고르면: 블럭이 빠져 크게 떠오름 → 여우가 단어를 읽어 줌 → 아이가 따라 읽음(마이크) → 맞으면 내 블럭, 친구 차례.
- 못 읽으면 여우가 다시 들려주고 다시 듣습니다(읽어야만 통과).
- m이 아닌 블럭을 고르면: 안 빠지고 흔들림 → 여우가 그 단어의 첫소리를 알려 줌(FPR K 공식 낱소리 녹음) → 친구 차례.
- m블럭을 다 빼면 탑이 와르르 무너지고, 더 많이 모은 사람이 이깁니다.
- 탑은 드래그로 360° 돌리고 위아래로 기울일 수 있고, 두 손가락(또는 휠)로 확대합니다.

## 만든 방법
- three.js(WebGL) 탑·테이블, 마지막 붕괴는 cannon-es 물리.
- 음성 인식: 기기 안에서만 처리(whisper-tiny.en, transformers.js). 아이 목소리는 어디로도 보내지 않습니다. 마이크가 없으면 👍 버튼으로 확인.
- 목소리: 단어·튜터 대사 = Microsoft 'Ana'(edge-tts, 시제품용) / 첫소리 = FPR K 공식 녹음.
- 단어 출처: `tools/build_words.py` (SAD·FPR 단어 연구 자료집 → `src/data/words.json`, 쪽 번호 포함).
- 여우·인트로: 사용자가 만든 Gemini 영상에서 잘라 씀(제미나이 마크 제거).
- 배경음악: `tools/make_bgm.py`로 만든 오르골 루프(영상에는 음악 트랙이 없음).

## 도구
| 파일 | 하는 일 |
|---|---|
| `tools/build_words.py` | 단어 목록 만들기 |
| `tools/build_voice.py` | 단어·튜터 음성, 공식 첫소리 복사 → `public/voice/`, `src/data/voice.json` |
| `tools/make_bgm.py` | 배경음악 → `public/bgm.mp3` |
| `tools/qa/*.py` | 헤드리스 화면·흐름 검사 (`?fake=1`, `?seed=`, `?nointro`) |
