# S급 튜토리얼 대사 더빙 (준비, 2026-10-30)

> **보류 (2026-11-11 기획자) — 지금은 쓰지 않는다. 1년쯤 뒤 다시 쓸 수 있어 지우지 않고 보관한다.**
> - 튜토리얼 대사 더빙은 하지 않는다. 대사는 글로만 띄운다.
> - S급 KR 음성(고유기술 시전 · 포커스 차례)도 새로 받지 않고 **원래 있던 음원을 쓴다**.
> - 이 폴더와 `tools/tutorial_dub_script.ts` · `tools/tutorial_dub_generate.py`는 10-30 그대로다. `lines.json` · `대본.md`는 11-11 대사보다 낡았다.
> - 다시 쓸 때는 `Design/튜토리얼_번역_더빙_인수인계.md` §2부터 본다. 특히 §2-2의 「대본 뽑기 도구 고칠 것」이 먼저다(대사를 빠뜨리고 안내 장을 대사로 센다).
>   번역은 11-11에 아홉 언어로 들어갔으므로 「번역 없음」은 0에서 시작한다.

S급 튜토리얼 30판의 등장인물 대사(`tut.s.{판}.say{n}`, 124줄 · 화자 61명)를 더빙 다섯(KR · EN · JP · PT · CA)으로 받는다.
바탕은 Neo-Luddite 공모전 영상의 `generate_narration.py`(Gemini TTS `gemini-3.8-flash-tts`)다. 거기서 바꾼 것:

- **한 테이크만** 받는다(셋 받아 고르지 않는다).
- **화자 한 명 × 언어 하나 = 호출 한 번** — 그 화자가 30판에 걸쳐 하는 대사를 한 프롬프트에 몰아 넣는다. 줄 사이에 2초 쉼을 요구해 자르는 자리를 만든다.
  최대 61 × 5 = **305번**(조조 14줄이 가장 길다. 15줄을 넘는 화자가 생기면 두 번으로 나눈다 — 길게 읽히면 뒤가 흐트러진다. 공모전에서 5줄짜리가 71초로 늘어진 테이크가 있었다).
- 대본은 손으로 옮겨 적지 않는다 — **판 파일 + 문구 파일에서 뽑는다.** 대사를 고치면 다시 뽑기만 하면 된다.

## 파일

| 파일 | 무엇 | 누가 |
|---|---|---|
| `lines.json` | 판 차례대로 모은 대사 — 열쇠 · 화자 · 다섯 언어 글 · 글의 해시 · 앞뒤 안내 문장 | `tools/tutorial_dub_script.ts`가 쓴다 |
| `대본.md` | 위의 것을 사람이 읽는 표 (판별 · 화자별 줄 수) | 같은 도구 |
| `cast.json` | 화자 → Gemini 목소리(`voice`) · 인물 프로필(`profile`, 영어) | 도구가 뼈대만 만들고 **사람이 채운다** — 다시 뽑아도 채운 값은 남는다 |
| `notes.json` | (선택) 줄마다의 연기 지시 `{"tut.s.gwan-u.say3": "Cold, quiet threat…"}` | 1단계에서 쓴다 |
| `prompts/{더빙}/{화자}.{더빙}.md` | 호출 전 검토용 프롬프트 + 자를 이름 표 | `generate.py prompts` |

음원(git 밖, `assets/`):

```
assets/Audio/voice/tutorial/raw/{더빙}/{화자}.{더빙}.wav   ← 받은 원본 (한 화자의 대사가 이어져 있다)
assets/Audio/voice/tutorial/raw/{더빙}/{화자}.{더빙}.txt   ← 몇 번째 말 → 자른 파일 이름 · 해시 · 글
assets/Audio/voice/tutorial/{더빙}/{판}.say{n}.wav         ← 자른 것 (예: KR/gwan-u.say3.wav)
```

## 순서 (번역이 끝났다는 신호를 받은 뒤)

```bash
node --experimental-strip-types tools/tutorial_dub_script.ts   # 1. 대본 다시 뽑기 — 「번역 없음」이 0인지 본다
#    + cast.json 채우기 · notes.json 쓰기
python tools/tutorial_dub_generate.py prompts                  # 2. 몰아 넣은 프롬프트 — 호출 없이 검토 (같은 판 두 화자가 같은 목소리면 경고)
python tools/tutorial_dub_generate.py run KR --only gwan-u     # 3. 한 명으로 먼저 들어 본다
python tools/tutorial_dub_generate.py run                      # 4. 전부 — 하루 한도에 걸리면 같은 명령으로 이어 간다
python tools/tutorial_dub_generate.py split                    # 5. (선택) 쉼으로 자르기 — 덩어리 수 = 줄 수인 것만 자르고 나머지는 손으로
python tools/tutorial_dub_generate.py stale                    #    대사를 고친 뒤 다시 받을 화자 찾기
```

6단계(맞추기)는 음원이 들어온 뒤 한다: `tools/build_audio.py`에 `sync_tutvoice`를 더해 `public/tutvoice/{판}.say{n}.{더빙}.mp3`로 옮기고,
대사 패널(`TutorialBattleScreen.tsx`)이 그 장을 띄울 때 `currentDubLang()`으로 틀고 다음 장으로 넘기면 끊는다 — `stewardVoice.ts`와 같은 결,
파일이 없으면 조용히 넘어간다. **파일 이름이 문구 열쇠 그대로라 「순서 맞추기」가 따로 없다.**

## 정해 둔 것 · 정할 것

**범위 (2026-10-30 기획자)** — 착수는 S급 30판 플레이테스트가 다 끝난 뒤

| 음성 | 언어 | 대사 글 |
|---|---|---|
| 튜토리얼 대사 | 5개국어 | 문구 파일 `tut.s.*.say*` |
| S급 고유기술 시전 (`assets/Audio/Specialskills`) | **KR만** 새로(나머지 4개는 그대로) | 기존 KR 음원에서 받아 적는다 |
| 포커스 받을 때 차례 음성 (`voice/battle/SE_class`, S급 30 + 헌제) | **KR만** 새로 | `assets/Audio/voice/1_삼국체스-장수대사-SE급.txt` |

S급 장수는 KR 호출 한 번에 셋을 함께 넣어 같은 목소리로 받는다(추출 도구는 아직 튜토리얼 대사만 뽑는다 — 착수할 때 차례 · 고유기술 줄을 더한다).

- 더빙 다섯의 텍스트: KR ko · EN en · JP ja · PT **pt_BR** · CA **zh_Hans**(만다린으로 읽힌다) — `tutorial_dub_script.ts`의 `DUB_TEXT`
- 같은 장수는 다섯 언어에서 **같은 목소리**(Gemini 목소리는 여러 언어를 읽는다)
- 대사만 더빙한다 — 안내 창 문장(`intro` · `skill` …)은 안 읽는다
