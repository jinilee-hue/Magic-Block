# Magic Jenga (Phonics Jenga)

친구와 둘이 하는 파닉스 젠가 (FPR K · 5세). 탑에서 **m으로 시작하는 단어** 블럭을 골라 빼고, 그 단어를 **소리 내어 읽어야** 내 차례가 끝나고 친구 차례로 넘어갑니다. 여우 튜터가 말로 이끌어 줍니다.

- 공개 주소(예정): https://jinilee-hue.github.io/phonics-jenga/
- 로컬 실행: `npm install` 후 `npm run dev` → http://localhost:5195/

## 게임 규칙
- 한 판 30블럭(10층×3) = m단어 14개 + 다른 FPR K 단어 16개(함정 단어 jam·lamp 항상 포함).
- FPR K m단어 28개를 기기마다 한 줄로 섞어 두고 판마다 다음 14개를 씁니다 → 두 판이면 28개가 한 번씩 다 나옵니다.
- m블럭을 고르면: 블럭이 빠져 크게 떠오르고, 위에 그 단어의 그림 카드가 섭니다 → 여우가 단어를 읽어 줌 → 아이가 따라 읽음(마이크) → 맞으면 내 블럭, 친구 차례. 그림 카드를 누르면 다시 들려줍니다.
- 못 읽으면 여우가 다시 들려주고 다시 듣습니다. 진짜로 읽은 시도가 3번 안 통하면 "Good try!"로 블럭을 줍니다(무음은 통과 안 됨).
- m이 아닌 블럭을 고르면: 안 빠지고 흔들림 → 여우가 그 단어의 첫소리를 알려 줌(FPR K 공식 낱소리 녹음) → 친구 차례.
- m블럭을 다 빼면 탑이 와르르 무너지고, 더 많이 모은 사람이 이깁니다.
- 탑은 드래그로 360° 돌리고 조금 기울일 수 있고, 두 손가락(또는 휠)로 가까이 볼 수 있습니다(방 그림도 같이 커짐).
  - 첫 판에서 여우가 돌리는 법을 알려 줄 때: 테이블 위 탑 둘레에 화살표 고리가 돌고, 할리갈리 손가락이 고리 앞을 따라 끌어 보여 줌(`src/game/spinhint.ts`, 손 그림 = 할리갈리 `tap_hand.png` → `src/assets/hand.webp`).

## 화면
- 배경: `jenga_bg`(사용자 그림, 분홍 테이블)를 필터 없이 `src/assets/bg.webp`로 씀. 탑은 그림 속 둥근 테이블 위에 서도록 카메라를 맞춤(`stage.ts`의 `BG` 좌표 — 그림을 바꾸면 테이블 중심·반지름을 다시 재야 함).
  - 그림 속 햇살의 금빛 먼지 불빛 82개가 각자 박자로 계속 반짝임(`src/ui/twinkle.ts`; 위치는 `tools/find_sparkles.py` → `src/data/sparkles.json`, 그림을 바꾸면 다시 돌림).
  - 탑 그림자는 탑 가까이에만 짧고 부드럽게(멀어질수록 옅어져 테이블 끝에서 잘리지 않음).
- 첫 화면: 탑(12층 — 게임보다 2층 많음, 화면 위로 넘치면 조금 줄임) 위 가운데에 로고(`jenga_logo` → `src/assets/logo.webp`)와 START(`jenga_btn_start` → `src/assets/btn_start.webp`).
  - 탑 앞면 긴 블럭마다 m단어. 몇 초마다 m블럭 하나가 반짝이며 반쯤 빠졌다 들어감. 테이블 위에 블럭 4개가 떨어져 있음. 여우는 오른쪽에서 손을 흔듦.
  - 오른쪽 위: 소리 버튼(누르면 세로 볼륨 막대, 위 = 크게, 맨 아래 = 소리 끔 → 버튼에 빨간 X) · 나가기 버튼(게임을 연 이전 페이지로). 버튼 그림은 사용자 그림(`jenga_btn_sound`, `jenga_btn_out` → 투명 여백을 잘라 280px `src/assets/btn_sound.webp`, `btn_out.webp`).
- 캐릭터 고르기: START → 플레이어 1이 동물 4종(토끼·고양이·강아지·판다) 중 하나 → 플레이어 2(먼저 고른 동물은 P1 표시, 못 고름) → 게임. 여우가 "Player one, pick your animal!" 등으로 안내하고 고른 동물 이름을 말해 줌. 고른 동물이 게임 화면 플레이어 카드와 결과 화면에 나옴. 왼쪽 위 `<`는 첫 화면으로(`src/ui/picker.ts`).
  - 지금 동물 그림은 임시 SVG(`index.html`의 `#ava-*`). 여우 같은 3D 그림 4장이 오면 바꿈.
- 인트로 영상: 아직 없음. `public/intro.mp4`를 넣으면 첫 화면 앞에서 자동 재생(건너뛰기 버튼 포함), 없으면 바로 첫 화면.
- 블럭: 파스텔로 칠한 나무(나뭇결), 실제 젠가(0.6)보다 두꺼운 0.75에 10층 — 블럭과 글자가 크게 보이도록(사용자 선택). `?bh=`(두께), `?layers=`(층수)로 바꿔 볼 수 있음.

## 소리
- 배경음악: `tools/make_bgm.py`로 직접 만든 신나는 루프(C장조 128 BPM, 30초: 마림바 멜로디 · 통통 튀는 베이스 · 우쿨렐레 반주 · 킥/박수/하이햇). 첫 화면부터 게임 끝까지 이어지고, 아이가 읽는 동안은 꺼짐.
- 브라우저는 화면을 한 번 누르기 전에는 소리를 못 냄 → 첫 화면에서 처음 누르면 음악과 여우 인사("Hi, friends! Welcome to Magic Jenga!" · "Press start to play!")가 시작. 처음 누른 곳이 START면 바로 게임 안내로.
- 첫 판 시작 때 게임 안내: "Let's play Magic Jenga!" → "Take turns with your friend." → "Find a block that starts with m!" /m/ /m/ → "Pull it out and read the word. Then the block is yours!" → "Get the most blocks to win!" → 탑 돌리기 안내. 다음 판부터는 짧게.

## 만든 방법
- three.js(WebGL) 탑, 마지막 붕괴는 cannon-es 물리.
- 음성 인식: 기기 안에서만 처리(whisper-tiny.en, transformers.js). 아이 목소리는 어디로도 보내지 않습니다. 마이크가 없으면 👍 버튼으로 확인.
- 목소리: 단어·튜터 대사 = 사내 TTS(Qwen3-TTS `aiden`, 7살 남자아이 말투 — Phonics Island와 같은 목소리) / 첫소리 = FPR K 공식 녹음.
  만들 때 whisper-base.en으로 다시 들어 보고, 단어로 안 들리면 말투 지시를 바꿔 다시 만듭니다(`tools/build_voice.py`).
- 그림 카드: FPR K 공식 그림(Phonics Island에서 가져온 512px webp) → `public/cards/`. 지금 19개. 그림이 없는 m단어
  (mad, mailbox, make, maze, met, mess, mix, mom, mud)는 카드 없이 블럭만 보입니다 — `public/cards/<단어>.webp`로 넣고 `tools/import_cards.py`를 다시 돌리면 나옵니다.
- 단어 출처: `tools/build_words.py` (SAD·FPR 단어 연구 자료집 → `src/data/words.json`, 쪽 번호 포함).
- 여우: 사용자가 만든 Gemini 영상에서 잘라 씀(제미나이 마크 제거).
  - 꼬리가 턱 밑까지 올라오는 프레임은 재생하지 않음: 원본 영상에서 크림색 꼬리 끝과 옅은 살구색 배경이 거의 같은 색이라 잘라내기가 턱과 꼬리 사이를 납작한 살색 면으로 남김. `public/fox/fox.json`의 클립별 `use: [처음, 끝]` 범위만 왕복 재생(talk 0–9, point 2–14, happy 0–13, idle 2–10, say 1–9, cheer 전체).
  - 입 모양(립싱크): 3D 모델 없이, 여우가 말할 때 목소리 크기(Web Audio AnalyserNode)에 따라 닫힘·조금 벌림·크게 벌림 3단계 입 그림을 코 아래에 덮어 그림. 입 그림은 영상 프레임에서 뽑음(`tools/build_fox_mouth.py` → `public/fox/mouth.webp`, 위치는 `public/fox/fox.json`의 `mouth`).

## 도구
| 파일 | 하는 일 |
|---|---|
| `tools/build_words.py` | 단어 목록 만들기 |
| `tools/build_voice.py` | 단어·튜터 음성(사내 TTS, 사내망에서), 공식 첫소리 복사 → `public/voice/`, `src/data/voice.json` |
| `tools/import_cards.py` | 그림 카드 가져오기 → `public/cards/`, `src/data/cards.json` |
| `tools/make_bgm.py` | 배경음악 → `public/bgm.mp3` |
| `tools/find_sparkles.py` | 배경 그림의 반짝이 불빛 위치 → `src/data/sparkles.json` |
| `tools/build_fox_mouth.py` | 여우 영상에서 입 모양 3단계 뽑기 → `public/fox/mouth.webp`, `fox.json` |
| `tools/qa/*.py` | 헤드리스 화면·흐름 검사 (`?fake=1`, `?seed=`, `?nointro`, `?nopick` = 캐릭터 고르기 건너뛰기, `?m=map,mug` = 그 m단어를 탑에 넣기) |
| `tools/qa/voice_check.ts` | 음성 파일을 whisper로 다시 들어 단어가 맞는지 확인 |
