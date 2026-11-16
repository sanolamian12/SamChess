# 2026-11-16 · 튜토리얼 대사 더빙 — 다시 시작, AI Studio 작업판

## 무엇을 했나

S급 튜토리얼 30판이 끝나 11-11의 「더빙 보류」를 걷었다(기획자). 이번에는 API 호출이 아니라 **Google AI Studio에 손으로 붙여 넣어** 받는다.
범위는 튜토리얼 대사(`tut.s.*.say*`) 다섯 언어(KR · EN · JP · PT=pt_BR · CA=zh_Hans 만다린)뿐이다. 안내 창 문장은 안 읽는다.

1. **대본 뽑기 고침** (`tools/tutorial_dub_script.ts`, 인수인계서 §2-2) — meta의 `stageLines()` · `isSay()`를 쓴다.
   안내 장(`{note}`)을 대사로 세던 것, 차례 뒤 · 끝 장면 · 여는 안내 · 대결 안의 대사를 빠뜨리던 것이 풀렸다. 판에서만 다른 이름(`alias`)은 화자를 따로 둔다(주유 판의 장간 → `jang-gan`).
   결과 **152줄 = 문구 파일의 대사 키 152개 · 화자 63명**, 다섯 언어 번역 없음 0. 배역표는 더는 말하지 않는 화자를 뺀다.
2. **배역 분석** — 63명 모두 남성. Gemini 남성 목소리 16개를 나눠 주되 **한 판 안에 같은 목소리 둘은 없게**(`voice_clashes` 0).
   주역은 겹치지 않게 했다(조조 Algieba · 유비 Achird · 제갈량 Iapetus · 조운 Orus · 주유 Puck · 관우 Alnilam · 서서 Schedar · 장비 Fenrir …).
   병든 곽가 · 목마른 사마소 · 질식하는 하후걸은 숨 섞인 Enceladus, 노장(황개 · 황충 · 정보)과 거친 무장(여포 · 하후돈 · 허저)은 Algenib.
   `cast.json`에 영어 프로필 · 한국어 배역 메모(`ko`), `notes.json`에 줄마다 연기 지시 152줄.
3. **프롬프트** (`tools/tutorial_dub_generate.py`) — 언어마다 말투 한 줄(`LANG_STYLE`: 사극 · 시대극 · 브라질 더빙 · 만다린 고장극)을 지시문에 더했다.
   지시문은 영어 한 벌, TRANSCRIPT만 그 언어 글이다.
4. **작업판** `python tools/tutorial_dub_generate.py html` → `Design/튜토리얼더빙/더빙작업판.html`(틀은 `tools/tutorial_dub_board.html`).
   언어 탭 · 화자 목록(목소리 · 나오는 판) · 목소리 / 저장 이름 / 프롬프트 복사 · 줄마다 「한 줄 다시」(그 줄만의 프롬프트) · 「받았다」 표시(브라우저 저장).
   프롬프트는 `build_prompt` 하나가 낸다 — API(`run`)와 같은 글이다.
5. **`split`이 AI Studio 원본도 자른다** — 표(`.txt`)가 없으면 지금 대본에서 만들고, 24kHz · 16-bit · 모노가 아니면 말하고 건너뛴다.

## 받는 길

AI Studio Generate speech · 단일 화자 · 표의 목소리 → 프롬프트를 본문에 통째로 → 받은 파일을 `assets/Audio/voice/tutorial/raw/{언어}/{화자}.{언어}.wav`
→ `python tools/tutorial_dub_generate.py split` → `assets/Audio/voice/tutorial/{언어}/{판}.say{n}.wav`.

## 남은 것

- 한 명(조조 KR)으로 먼저 들어 보고 프로필 · 지시 · 2초 쉼이 지켜지는지 본다 — 목소리 배정은 들어 본 뒤 바꿀 수 있다(`cast.json`의 `voice`만 고치고 `html`).
- 맞추기(게임에서 틀기)는 음원이 들어온 뒤 — `build_audio.py`의 `sync_tutvoice` · 대사 패널에서 `currentDubLang()`(README 「순서」 6단계).

## 이어서 — Style · 본문 나누기, 게임 차례 음성 함께 받기

- 한 덩어리 프롬프트를 본문 칸에 붙이자 **대사와 상관없는 말을 지어냈다**(기획자). 작업판은 이제 **① Style instructions**(`build_style` — 인물 · 장면 · 말투 · 줄마다 감정)와
  **② 본문**(`build_text` — 대사만)을 따로 복사한다. 「한 줄 다시」도 둘로. API의 `run` · `prompts`는 한 덩어리 그대로다.
- **게임 차례 음성 추적** — `tools/tutorial_dub_game_voice.py` → `game_voice.json` · `게임음성_추적.md`. 고유 목소리 80명(S 30 · E 1 · A 40 · 이름난 B~D 9).
  S·E·A 71명의 글은 `assets/Audio/voice/*.txt`, B~D 아홉은 기획자가 알려 준 것을 `game_voice_text.json`에 적었다.
  고유기술 음성은 맞추지 않는다(기획자 — 차례 음성만). A급 기술의 음성은 어차피 여럿이 함께 쓰는 공용이다.
- **KR 프롬프트 맨 앞에 차례 음성 한 줄** — 튜토리얼에 나오는 45명(`turn_lines`). 잘린 이름은 `turn.{장수}.wav`, 작업판이 게임에서 갈아 끼울 자리
  (`voice/battle/{SE_class|A_class|BCD_speical}/KR/{이름}_KR.mp3`)를 보여 준다. 튜토리얼에 안 나오는 35명은 지금 음성 그대로. `MAX_LINES` 16(조조 15 + 1).

## 이어서 — 기획자 목소리 지침 18명

조조 Iapetus(카랑카랑) · 주유 Puck · 사마의 Rasalgethi · 정욱 Enceladus · 유비 Algieba · 제갈량 Achird · 서서 Schedar · 노숙 Umbriel · 조운 Orus · 관우 Alnilam ·
장비 Algenib · 조인 · 장합 Fenrir · 마초 · 여포 Sadachbia · 방통 Charon · 장수 Sadaltager(선비) · 육손 Zubenelgenubi. 18명의 영어 프로필도 지침대로 다시 썼다.
나머지 45명은 그대로 두어도 한 판 안에서 안 겹쳤다. 조조는 처음 받았을 때 「들뜬 사람처럼 읽는다」 — 프로필에 「들뜨지 않는다 · 느리고 신중 · 차가운 미소 ·
놀람도 지휘관의 호령」을 넣고 조조의 줄별 감정 14줄에서 당황 · 놀림을 걷자 기획자가 「퍼펙트」. **줄별 감정이 들뜬 단어면 목소리보다 그쪽이 먼저 연기를 끈다.**
