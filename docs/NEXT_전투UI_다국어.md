# 전투 UI 다국어 — 1차 완료(2026-09-11) · 남은 것

> **원래 이 파일은 「다음 세션 프롬프트」였다.** 2026-09-11에 그 작업의 **1차 범위**
> (로그 + 상시 표시 화면)를 끝내면서, 끝난 것과 남은 것을 적는 문서로 바꿨다 —
> 계획서를 그대로 두면 낡는다(CLAUDE.md 「작업 계획의 완료 조건도 낡는다」).

---

## 정한 것 — 갈림길 셋의 답

**1. 조사(josa) — 문장은 통째로 키 하나, 조사는 값에 붙인다.**
`ko.json`에 `"log.moved": "{who} 이동했다. ({from} → {to})"`처럼 문장을 통째로 두고
각 언어가 제 어순으로 쓴다. 그러면 「유비**가**」의 조사가 갈 곳이 없어지는데,
**값**에 붙여 해결했다 — `eventText.ts`의 `subj()`·`quoted()`가 **한국어일 때만**
`josa()`를 부르고 다른 언어는 이름을 그대로 넣는다. `josa()`는 한국어 전용인 채로
남아도 된다.

**2. 엔진의 한국어 이름표 — 화면이 id로 다시 고른다.**
`packages/rules/src/types.ts`의 `STATUS_META`·`TERRAIN_META`는 **그대로 두고**,
새 파일 `packages/client/src/i18n/engineLabel.ts`가 id를 열쇠 삼아 화면의 문구 표에서
다시 고른다(`statusLabel(id)`·`terrainLabel(id)`·`armyName(side)`·`outcomeLabel(o)`).
`story.ts`의 `pickTacticNameById`와 같은 규약이다. 엔진의 표는 **`kind`(버프/디버프)**
— 번역할 것이 없는 판정값 — 를 계속 낸다.

키를 `` t(`status.${id}.label`) `` 꼴로 부르므로 **엔진에 상태가 늘면 타입 검사가
먼저 막는다.** 아홉 언어 쪽은 타입이 없어 `battleStrings.test.ts`가 막는다.

**3. 범위 — 「로그 + 상시 표시 화면」** (기획자 지정). 아래 표 참조.

---

## 끝난 것 (2026-09-11)

| 파일 | 한 일 |
|---|---|
| `ui/eventText.ts` | 로그 전문. `TERRAIN_LABEL`·`REASON_LABEL` 제거 → 엔진 id로 재선택 |
| `ui/statusChips.ts` | 배지·오라·조종. `AURA_TEXT` → `t()` |
| `ui/statusPopup.ts` | 설명 팝업 — `STATUS_META` 직접 읽기 제거 |
| `ui/hud.ts` | 시계·단계·진영·결말. `ARMY_NAME` 상수 → `armyName()` |
| `ui/cardStrip.ts` | 퇴각 도장·대기시간·고유기술 툴팁 |
| `ui/inspectPanel.ts` | 능력치 줄·고유기술 꼬리·책략 칩·「상대 책략 가림」 |
| `i18n/engineLabel.ts` | **새 파일** — 엔진 이름표를 id로 다시 고르는 자리 |

`ko.json`에 **136개**를 보태고(433 → 569) 아홉 언어를 **전부** 채웠다(211 → 347).

### 함께 고친 것 — 회귀가 잡은 실제 버그 둘

- **「「삼고초려」이 무산됐다」** — `uniqueSkillFizzled` 줄만 `josa()`를 안 쓰고
  「이」를 그대로 적어 두었다. 받침 없는 이름에서 틀린다.
- **「P1 승리 — 군주 격파」** — `battleEnded`가 진영 **id**를 그대로 찍었다.
  HUD는 처음부터 이름(`북군`/`남군`)을 쓰고 있었고, 둘이 갈라져 있었다.

`pickSkillName`/`pickSkillText`를 안 부르고 `skill.name`/`skill.text`를 직접 읽던
자리 넷(로그 2 · 카드 · 살펴보기)도 함께 고쳤다 — 「책략 칩만 혼자 한국어」(2026-09-03)와
같은 사고가 고유기술 쪽에 남아 있었던 것이다.

### 검사 — 없던 것을 먼저 만들었다

`describeEvents()`를 부르는 검사가 **0건**이었다. 옮기기 **전에** 만들고, 옮긴 뒤에도
한국어가 한 글자도 안 바뀌는 것을 확인했다.

| 검사 | 무엇을 막나 |
|---|---|
| `client/test/eventText.test.ts` | 이벤트 한 벌 → 로그 28줄을 통째로 못 박는다. 언어별 줄 수·`tone` 동일. **영어 출력에 한글이 없다** |
| `client/test/battleStrings.test.ts` | 전투 키 136개가 열 언어에 다 있는가 · 한국어를 그대로 베끼지 않았는가 · 자리표시자가 같은가 |
| `tools/smoke_ui.ts` 끝 | **일본어로 전투 화면을 다시 띄워** DOM에 한글이 남았는지 본다 (단위 검사가 못 그리는 HUD·배지·카드·살펴보기) |

넷 다 **일부러 깨뜨려 실패하는 것을 확인**했다(키 삭제 · 한국어 붙여넣기 ·
자리표시자 어긋냄 · 영어에 한글 심기).

---

## 남은 것 — 2차 범위

| 파일 | 한국어 리터럴 |
|---|---|
| `ui/controlModal.ts` | **50** |
| `ui/prepPanel.ts` | 8 |
| `ui/systemLog.ts` | 5 |
| `screens/BattleScreen.tsx` | 5 |
| `ui/focusToggle.ts` | 4 |
| `ui/skillFx.ts` · `battle/BattleScene.ts` | 각 1 |

**`smoke_ui.ts`의 일본어 훑기가 `#control`·`#focus`를 일부러 빼고 있다** — 아직
안 한 일로 검사가 늘 빨개지면 아무도 안 보기 때문이다. **2차 작업의 완료 조건은
그 두 이름을 훑는 목록에 보태는 것**이다(`querySelectorAll('#hud, #log, #inspect, .strip')`).

1차와 같은 틀을 그대로 쓰면 된다 — 문장은 통째로 키 하나, 새 키는 `ko.json`에 먼저,
`battleStrings.test.ts`의 `BATTLE` 정규식에 새 이름 공간을 보탠다.

---

## 섞지 말 것

다른 언어 json에 **메타 화면 키 222개가 여전히 빠져 있다**(`city`·`squad`·`records`·
`market`·`result` 등). 전투와 무관한 예전 구멍이고, `battleStrings.test.ts`가 전투
이름 공간만 세는 이유가 이것이다 — 섞으면 검사가 늘 빨개서 아무도 안 본다.
