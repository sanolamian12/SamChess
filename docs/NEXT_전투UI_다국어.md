# 전투 UI 다국어 — 완료 (2026-09-11)

> **원래 이 파일은 「다음 세션 프롬프트」였다.** 2026-09-11에 1차(로그 + 상시 표시
> 화면)와 2차(커맨드 패널 등 나머지)를 같은 날 끝내면서, 「어떻게 정했고 무엇이
> 남았나」를 적는 문서로 바꿨다 — 계획서를 그대로 두면 낡는다.
>
> 그때의 사연은 [`history/2026-09-11_전투UI다국어_로그_상시화면_회귀신설.md`](../history/2026-09-11_전투UI다국어_로그_상시화면_회귀신설.md)에 있다.

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
[`packages/client/src/i18n/engineLabel.ts`](../packages/client/src/i18n/engineLabel.ts)가
id를 열쇠 삼아 화면의 문구 표에서 다시 고른다(`statusLabel(id)`·`terrainLabel(id)`·
`armyName(side)`·`outcomeLabel(o)`). `story.ts`의 `pickTacticNameById`와 같은 규약이다.
엔진의 표는 **`kind`(버프/디버프)** — 번역할 것이 없는 판정값 — 를 계속 낸다.

키를 `` t(`status.${id}.label`) `` 꼴로 부르므로 **엔진에 상태가 늘면 타입 검사가
먼저 막는다.** 아홉 언어 쪽은 타입이 없어 `battleStrings.test.ts`가 막는다.

**3. 범위 — 두 차례로 나눠 같은 날 다 했다.**

---

## 끝난 것

### 1차 — 로그 + 상시 표시 화면

| 파일 | 한 일 |
|---|---|
| `ui/eventText.ts` | 로그 전문. `TERRAIN_LABEL`·`REASON_LABEL` 제거 → 엔진 id로 재선택 |
| `ui/statusChips.ts` | 배지·오라·조종. `AURA_TEXT` → `t()` |
| `ui/statusPopup.ts` | 설명 팝업 — `STATUS_META` 직접 읽기 제거 |
| `ui/hud.ts` | 시계·단계·진영·결말. `ARMY_NAME` 상수 → `armyName()` |
| `ui/cardStrip.ts` | 퇴각 도장·대기시간·고유기술 툴팁 |
| `ui/inspectPanel.ts` | 능력치 줄·고유기술 꼬리·책략 칩·「상대 책략 가림」 |

### 2차 — 나머지 전부

| 파일 | 한 일 |
|---|---|
| `ui/controlModal.ts` | 커맨드 버튼 여덟(이름·툴팁을 `` `${key}` ``/`` `${key}.hint` `` 짝으로) · 조준 안내 · 시전 확인창 · 고유기술 물음 · 상대 차례 안내 |
| `ui/prepPanel.ts` | 배치·정찰 제목·안내·버튼 |
| `ui/systemLog.ts` | 전체 기록 제목·빈 줄·[항복]과 그 확인 물음 |
| `ui/focusToggle.ts` | 토글 이름·툴팁 |
| `screens/BattleScreen.tsx` | 제 `OUTCOME_LABEL` 표를 지우고 `outcomeLabel()`로 |
| `ui/skillFx.ts` · `battle/BattleScene.ts` | 연출 배너 자막 · 「즉사」/크리티컬 확률 |

`ko.json` **+200** (433 → 633), 아홉 언어 **전부** 채웠다 (211 → 411).

**전투 화면에 남은 한국어 리터럴은 0이다** — 남은 것은 `「」`·`×`·`—` 같은 기호와,
화면에 안 뜨는 개발자용 `throw new Error` 하나뿐이다.

### 함께 고친 것 — 회귀가 잡은 실제 버그

- **「「삼고초려」이 무산됐다」** — `uniqueSkillFizzled` 줄만 `josa()`를 안 쓰고
  「이」를 그대로 적어 두었다. 받침 없는 이름에서 틀린다.
- **「P1 승리 — 군주 격파」** — `battleEnded`가 진영 **id**를 그대로 찍었다.
  HUD는 처음부터 이름을 쓰고 있었고, 둘이 갈라져 있었다.
- **`pickSkillName`/`pickSkillText`를 안 부르던 자리 여섯** — 로그 2 · 카드 ·
  살펴보기 · 커맨드 패널 2. 그중 **연출 배너**는 「郭嘉 — 「유언계책」」으로
  장수는 일본어, 기술은 한국어로 섞여 있었다.
- **`focusToggle` 툴팁의 「(F)」** — 키보드 단축키는 2026-08-26에 전부 없어졌는데
  없는 키를 안내하고 있었다. 옮기면서 뗐다.

### 검사

`describeEvents()`를 부르는 검사가 **0건**이었다. 옮기기 **전에** 만들고, 옮긴 뒤에도
한국어가 한 글자도 안 바뀌는 것을 확인했다.

| 검사 | 무엇을 막나 |
|---|---|
| `client/test/eventText.test.ts` | 이벤트 한 벌 → 로그 28줄을 통째로 못 박는다. 언어별 줄 수·`tone` 동일. **영어 출력에 한글이 없다** |
| `client/test/battleStrings.test.ts` | 전투 키 200개가 열 언어에 다 있는가 · 한국어를 그대로 베끼지 않았는가 · 자리표시자가 같은가 |
| `tools/smoke_ui.ts` 끝 | **일본어로 전투 화면을 다시 띄워** DOM에 한글이 남았는지 본다 |

**둘의 역할이 갈린다** — 스모크는 「지금 실제로 그려진 것」만 보므로, 확인창·조준
안내처럼 특정 상태에서만 나오는 문구는 `battleStrings.test.ts`가 키 존재로 막는다.

넷 다 **일부러 깨뜨려 실패하는 것을 확인**했다(키 삭제 · 한국어 붙여넣기 ·
자리표시자 어긋냄 · 영어에 한글 심기).

---

## 남은 것

전투 화면에는 없다. **메타 화면 쪽에 예전 구멍이 남아 있다** — 아홉 언어 json에
`city`·`squad`·`records`·`market`·`result` 등 **222개**가 여전히 빠져 있다. 이번
작업과 무관한 별개의 일이고, `battleStrings.test.ts`가 전투 이름 공간만 세는 이유가
이것이다 — 섞으면 검사가 늘 빨개서 아무도 안 본다. 손대려면 별도 작업으로 잡는다.
