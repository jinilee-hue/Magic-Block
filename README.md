# Magic Jenga (Phonics Jenga)

친구와 둘이 하는 파닉스 젠가 (FPR K · 5세). 탑에서 **m으로 시작하는 단어** 블럭을 골라 빼고, 그 단어를 **소리 내어 읽어야** 내 차례가 끝나고 친구 차례로 넘어갑니다. 여우 튜터가 말로 이끌어 줍니다.

- 공개 주소(예정): https://jinilee-hue.github.io/phonics-jenga/
- 로컬 실행: `npm install` 후 `npm run dev` → http://localhost:5195/

## 게임 규칙
- 단어는 FPR K **Unit 1**(L1–5, p.9–76): m단어 20개, 다른 단어 26개(`tools/build_words.py` → `src/data/words.json`, 쪽 번호 포함).
- 한 판 30블럭(10층×3) = m단어 14개 + 다른 단어 16개(m이 안에 든 함정 단어 jam·lemon 항상 포함). m단어는 기기마다 섞어 둔 순서에서 판마다 다음 14개를 씁니다 → 연달아 두 판이면 20개가 다 나옵니다.
- m블럭을 고르면: 블럭이 빠져 크게 떠오름 → 블럭이 돌면서 그림 카드로 바뀜 → 여우가 "Now say the word." 하고 단어를 읽어 줌 → 아이가 따라 읽음(마이크) → 맞으면 카드가 다시 블럭으로 돌아 내 플레이어 카드로 날아가 쌓임 → 친구 차례. 그림 카드를 누르면 다시 들려줍니다. 그림이 없는 단어(mailbox)는 블럭 그대로.
- 못 읽으면 여우가 다시 들려주고 다시 듣습니다. 진짜로 읽은 시도가 3번 안 통하면 "Good try!"로 블럭을 줍니다(무음은 통과 안 됨).
- m이 아닌 블럭을 고르면: 안 빠지고 흔들림 → 여우가 그 단어의 첫소리를 알려 줌(FPR K 공식 낱소리 녹음) → 실수 1번(플레이어 카드에 ✕) → 친구 차례. **한 사람이 3번 틀리면 탑이 무너지고, 무너뜨린 사람이 집니다.**
- m블럭을 다 빼면 탑이 와르르 무너지고, 더 많이 모은 사람이 이깁니다.
- 탑은 드래그로 360° 돌리고 조금 기울일 수 있고, 두 손가락(또는 휠)로 가까이 볼 수 있습니다(방 그림도 같이 커짐).
  - 버튼은 아래 가운데 **원위치** 하나뿐(좌우 돌리기 버튼 없음).
  - 한동안 아무도 탑을 안 만지면: 테이블 위 탑 둘레에 흰 화살표 고리가 돌고, 할리갈리 손가락이 고리 앞을 따라 끌어 보여 줌(`src/game/spinhint.ts`). 첫 판 안내 때도 나옴.

## 화면
- 배경: `jenga_bg`(사용자 그림, 분홍 테이블)를 필터 없이 `src/assets/bg.webp`로 씀. 탑은 그림 속 둥근 테이블 위에 서도록 카메라를 맞춤(`stage.ts`의 `BG` 좌표 — 그림을 바꾸면 테이블 중심·반지름을 다시 재야 함).
  - 그림 속 햇살의 금빛 먼지 불빛 82개가 각자 박자로 계속 반짝임(`src/ui/twinkle.ts`; 위치는 `tools/find_sparkles.py` → `src/data/sparkles.json`, 그림을 바꾸면 다시 돌림).
  - 탑 그림자는 탑 가까이에만 짧고 부드럽게(멀어질수록 옅어져 테이블 끝에서 잘리지 않음).
- 첫 화면(인트로): 탑(11층 — 게임보다 1층 많음, 화면 위로 넘치면 조금 줄임) 위 가운데에 로고(`jenga_logo` → `src/assets/logo.webp`)와 START(`jenga_btn_start` → `src/assets/btn_start.webp`).
  - 탑 앞면 긴 블럭마다 m단어. 몇 초마다 m블럭 하나가 반짝이며 반쯤 빠졌다 들어감. 테이블 위에 블럭 4개가 떨어져 있음. 여우는 오른쪽에서 손을 흔듦.
- 오른쪽 위 버튼(첫 화면·게임·결과 화면 공통, `src/ui/corner.ts`): 소리 버튼(누르면 버튼과 같은 노란색 세로 볼륨 막대, 위 = 크게, 맨 아래 = 소리 끔 → 버튼에 빨간 X) · 나가기 버튼. 게임 화면에서는 그 앞에 EN|한 토글. 홈·설정 버튼은 없음.
  - 나가기: 첫 화면에서는 게임을 닫음(게임을 연 이전 페이지로). 게임·결과 화면에서는 한 번 누르면 빨갛게 흔들리고, 2.6초 안에 한 번 더 누르면 첫 화면으로(실수로 나가지 않게).
  - 버튼 그림은 사용자 그림(`jenga_btn_sound`, `jenga_btn_out` → 투명 여백을 잘라 280px `src/assets/btn_sound.webp`, `btn_out.webp`).
- 게임 화면 왼쪽 위: 로고(첫 화면과 같은 그림), 그 옆에 플레이어 1·2 카드(동물, 모은 블럭 수, 실수 ✕, 모은 블럭 칩).
- 캐릭터 고르기: START → 플레이어 1이 동물 4종(토끼·고양이·강아지·판다) 중 하나 → 플레이어 2(먼저 고른 동물은 P1 표시, 못 고름) → 게임. 사용자 참고 이미지대로: 반투명 흰 판, 왼쪽 위 보라 `<`(첫 화면으로), 파란 'Player 1' 띠, 큰 동물 원 4개(이름은 동물마다 다른 색), 아래 'Player 1 VS Player 2'. 여우가 "Player one, pick your animal!" 등으로 안내하고 고른 동물 이름을 말해 줌(`src/ui/picker.ts`).
  - 동물 그림은 사용자 배지 4장(`~/Downloads/jenga_bunny|kitty|puppy|panda.png`). `tools/make_animals.py`가 원 밖을 투명하게 잘라 512px webp(`src/assets/ani_*.webp`)로 만들고, `src/ui/animals.ts`가 주소를 모아 둔다. 동물별 에셋은 사용자가 따로 만들어 줄 예정.
- EN|한 토글(`src/core/lang.ts`): 여우 대사·말풍선·화면 글이 한국어로(단어 소리는 영어 그대로). 한글 글꼴은 Jua 서브셋(`tools/make_ko_font.py` → `public/fonts/Jua-ko.woff2`, 한국어 글을 바꾸면 다시 돌림).
- 인트로 영상: 아직 없음. `public/intro.mp4`를 넣으면 첫 화면 앞에서 자동 재생(건너뛰기 버튼 포함), 없으면 바로 첫 화면.
- 블럭: 파스텔로 칠한 나무(나뭇결), 실제 젠가(0.6)보다 두꺼운 0.75에 10층 — 블럭과 글자가 크게 보이도록(사용자 선택). `?bh=`(두께), `?layers=`(층수)로 바꿔 볼 수 있음.
- 여우 말풍선: 여우가 하는 말을 머리 위 말풍선으로 보여 줌(`src/ui/foxsay.ts`; 글은 `src/data/voice.json`의 `lines`/`lines_ko` = 음성을 만든 문장 그대로).
  - 차례가 오면 그 플레이어의 동물·색으로 "Player 1, your turn!"이 블럭을 고를 때까지 떠 있음. 다른 말은 말하는 동안과 1.4초 뒤까지 보이고, 그다음 차례 말풍선이 다시 나옴.
  - 게임 화면에서만 보임. 세로 화면에서는 탑을 가리지 않게 폭을 줄여 여우 오른쪽 끝에 붙이고 긴 말은 여러 줄로.

## 여우 튜터
- 그림: 사용자 시트 `jenga_tutor.png`에서 4포즈(가르치기 teach · 읽기 read(안경) · 기쁨 jump · 환호 great)를 잘라 배경을 지우고 4배로 키운 정지 그림(`public/fox/`).
- 움직임(`src/ui/fox.ts`, WebGL 메시 + 부드러운 뼈대): 숨쉬기, 발 기준 살짝 흔들림, 머리 갸웃·끄덕임(말할 때 더), 귀 전체가 뿌리에서 기울고 가끔 쫑긋, 꼬리는 끝이 한 박자 늦게 따라오는 채찍처럼, 팔 흔들기, 포즈 사이 0.18초 크로스페이드. 위아래로 뛰지 않음(사용자).
  - 팔·꼬리·귀는 그림에서 잘라 낸 부위 가중치(`<포즈>_w.webp`, `<포즈>_e.webp`)로만 움직여 볼·가방·다리는 따라가지 않음. 들어 올린 팔 아래 꼬리가 붙어 있는 포즈(jump, great)는 꼬리가 팔에 닿은 곳 바깥만 움직임(`fox.json`의 `rig.tailFree`).
  - 깜빡임: 눈 위에 털색 눈꺼풀을 그려 덮음(teach, jump. 그림을 누르면 홍채가 번지고 안경이 휨).
- 입 모양(립싱크): Rhubarb로 음성 클립마다 입모양(A–H, X) 시간표를 만들어(`src/data/mouth.json`) 오디오 시계에 맞춰 코 아래(입을 지운 muzzle 위)에 그림.

## 소리
- 배경음악: `tools/make_bgm.py`로 직접 만든 신나는 루프(C장조 128 BPM, 30초: 마림바 멜로디 · 통통 튀는 베이스 · 우쿨렐레 반주 · 킥/박수/하이햇). 첫 화면부터 게임 끝까지 이어지고, 아이가 읽는 동안은 꺼짐.
- 브라우저는 화면을 한 번 누르기 전에는 소리를 못 냄 → 첫 화면에서 처음 누르면 음악과 여우 인사("Hi, friends! Welcome to Magic Jenga!" · "Press start to play!")가 시작. 처음 누른 곳이 START면 바로 게임 안내로.
- 첫 판 시작 때 게임 안내: "Let's play Magic Jenga!" → "Take turns with your friend." → "Find a block that starts with m!" /m/ /m/ → "Pull it out and read the word. Then the block is yours!" → "Get the most blocks to win!" → "But pick a wrong block three times, and the tower falls!" → 탑 돌리기 안내. 다음 판부터는 짧게.
- 마이크: 차례마다 한 번 열고, 듣기 시작할 때 부드러운 '딩' 한 번(처음 0.3초는 판정 안 함). 반향 제거(echoCancellation)는 끔 — 여우가 말하는 동안은 듣지 않고, 켜 두면 마이크가 열리는 순간 크롬이 소리 출력을 반향 제거 쪽으로 돌려 여우 목소리에 딸꾹질 같은 소리가 낄 수 있음. 잡음 제거·자동 음량은 켬.
- 말이 중간에 끊길 때는 40ms 동안 줄여 끔(딸깍 소리 없음). 블럭을 뺄 때의 "Perfect! Pull it out!"은 끝까지 말한 뒤 읽기 안내로.

## 만든 방법
- three.js(WebGL) 탑, 마지막 붕괴는 cannon-es 물리.
- 음성 인식: 기기 안에서만 처리(whisper-tiny.en, transformers.js). 아이 목소리는 어디로도 보내지 않습니다. 마이크가 없으면 👍 버튼으로 확인.
- 목소리: 단어·튜터 대사(영어·한국어 각 39줄) = 사내 TTS(Qwen3-TTS `aiden`, 7살 남자아이 말투 — Phonics Island와 같은 목소리) / 첫소리 = FPR K 공식 녹음.
  만들 때 whisper로 다시 들어 보고, 단어로 안 들리면 말투 지시를 바꿔 다시 만듭니다(`tools/build_voice.py`).
- 그림 카드: FPR K 공식 그림(Phonics Island에서 가져온 512px webp) → `public/cards/`. Unit 1 m단어 20개 중 19개(mailbox 없음 — `public/cards/mailbox.webp`로 넣고 `tools/import_cards.py`를 다시 돌리면 나옵니다).
- 여우: `tools/build_tutor.py`(포즈 자르기 · 배경 지우기 · 4배 확대) → `tools/build_tutor_assemble.py`(포즈 프레임, 입을 지운 muzzle, 뼈대 점) → `tools/build_tutor_rig.py`(부위 가중치, 눈꺼풀) → `public/fox/`.

## 도구
| 파일 | 하는 일 |
|---|---|
| `tools/build_words.py` | 단어 목록 만들기 (Unit 1) |
| `tools/build_voice.py` | 단어·튜터 음성(사내 TTS, 사내망에서), 공식 첫소리 복사 → `public/voice/`, `src/data/voice.json` |
| `tools/build_mouth_cues.py` | 음성 클립마다 입 모양 시간표(Rhubarb) → `src/data/mouth.json` |
| `tools/build_tutor.py`, `tools/build_tutor_assemble.py` | 여우 포즈 그림 만들기 → `public/fox/` |
| `tools/build_tutor_rig.py`, `tools/tutor_eyes.py` | 여우 부위 가중치·눈꺼풀 → `public/fox/*_w.webp`, `*_e.webp`, `fox.json` |
| `tools/make_animals.py` | 동물 배지 → `src/assets/ani_*.webp` |
| `tools/make_ko_font.py` | 한글 글꼴 서브셋 → `public/fonts/Jua-ko.woff2` |
| `tools/import_cards.py` | 그림 카드 가져오기 → `public/cards/`, `src/data/cards.json` |
| `tools/make_bgm.py` | 배경음악 → `public/bgm.mp3` |
| `tools/find_sparkles.py` | 배경 그림의 반짝이 불빛 위치 → `src/data/sparkles.json` |
| `tools/qa/*.py` | 헤드리스 화면·흐름 검사 (`?fake=1`, `?seed=`, `?nointro`, `?nopick` = 캐릭터 고르기 건너뛰기, `?m=map,mug` = 그 m단어를 탑에 넣기), `ko_check.py` = 한국어 글 넘침 |
| `tools/qa/voice_check.ts` | 음성 파일을 whisper로 다시 들어 단어가 맞는지 확인 |
