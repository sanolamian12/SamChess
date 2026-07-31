# HANDOFF — 세션 인수인계

> **새 대화는 이 문서부터 읽는다.** 이어서 [`Design/GDD.md`](Design/GDD.md)(구현 기준 문서)와
> [`README.md`](README.md)(폴더 구조·명령)를 본다.
>
> 최종 갱신 **2026-07-31** · 프로젝트 루트 `C:\Users\user\Documents\SamChess`

---

## 1. 무엇을 만들고 있나

**삼국 약식 체스** — 체스 6기물의 이동 규칙을 빌린 삼국지 장수 260명의 **ATB 전술 대전 게임**.
PC(웹) · Android · iOS 단일 코드베이스. 수집/육성 메타(도시·상점·가챠·랭킹) 포함.

기획 원본은 사용자가 만든 `docs/삼국 약식 체스.pptx`(19슬라이드)와 `docs/삼국지 약식체스.xlsx`(4시트).
이 둘을 통합·정규화한 것이 `Design/GDD.md`이며, **구현은 GDD를 기준으로 한다.**

### 핵심 특징 (놓치기 쉬운 것)

- **"턴제"라고 부르지만 실제로는 CTB(Count Time Battle) 스케줄러다.** 절대시간이 흐르고,
  유닛별 `waiting time`이 0이 되면 제어권을 얻으며, 제어 중에는 시간이 멈춘다.
  → 넷코드는 "수를 주고받는 턴제"가 아니라 **서버가 시계를 소유하는 권위 시뮬레이션**이어야 한다.
- 기물은 **이동 범위와 공격 범위가 분리**되어 있다. 이게 이 게임의 전술적 정체성이다.
- 크리티컬·환술 판정이 전부 확률이고 현금 가챠와 랭킹이 있다 → **모든 판정은 서버에서, 시드 기반 PRNG로.**

---

## 2. 지금까지 한 일

| 단계 | 상태 |
|---|---|
| 기획 문서 2종 검토 및 정합성 교차검증 | ✅ |
| 기술 스택 결정 | ✅ |
| `Design/GDD.md` 작성 (13장 통합 기획서) | ✅ |
| 룰 엔진 타입 계약 `packages/rules/src/types.ts` | ✅ |
| 미결 항목 12건 중 7건 확정 | ✅ |
| 모노레포 스캐폴딩 + 엑셀→JSON 추출 파이프라인 | ✅ |
| 데이터 정합성 회귀 테스트 12건 | ✅ |
| CTB 스케줄러 (`advanceTime`) + 시드 PRNG | ✅ |
| 행동 판정 (배치·이동·공격·명상·턴 종료·항복) | ✅ |
| 책략 18종 Effect DSL + 실행기 | ✅ |
| 전투 회귀 테스트 52건 (총 64건) | ✅ 전부 통과 |
| 무작위 AI 자동 대전 200판 검증 | ✅ 재현성·종료 확인 |
| **S급 30종 스크립트 핸들러** | ⬜ **다음 작업** |

---

## 3. 확정된 기술 스택

원칙은 **"룰 엔진을 서버와 클라이언트가 같은 코드로 돌린다"**. 이게 스택 선택의 1순위 기준이었다.

| 레이어 | 선택 | 비고 |
|---|---|---|
| 언어 | TypeScript (모노레포, npm workspaces) | |
| 전투 렌더 | Phaser 3 | 20×25 그리드, 줌/스크롤, 픽셀아트 |
| 메타 UI | React + CSS | 도시/상점/랭킹은 DOM이 훨씬 빠름 |
| 룰 엔진 | 순수 TS (`packages/rules`) | I/O·`Date.now()`·`Math.random()` 금지 |
| 실시간 | Colyseus | 방 기반 권위 서버, 상태 동기화·재접속 내장 |
| 메타 API | Fastify | |
| DB | Postgres + Redis | |
| 인증 | Firebase/Supabase Auth + 카카오 로그인 | |
| 패키징 | Capacitor | 웹 빌드 하나로 PC·Android·iOS |
| 런타임 | **Node 22 타입 스트리핑** | `.ts`를 빌드 없이 실행. tsc는 타입검사·`.d.ts` 전용 |

Godot/Unity를 택하지 않은 이유: 룰 엔진을 서버(TS)와 클라(GDScript/C#)로 **두 번 구현**하게 된다.

---

## 4. 결정 로그 ★ 원본 문서에 없던 것들

원본 기획서에 명시가 없어 이번 세션에서 사용자와 확정한 규칙. **GDD에 반영 완료.**

| 항목 | 확정 내용 | GDD |
|---|---|---|
| **맵 크기** | `20행 × 25열` **고정**. 배치 구역만 참여 수 × 5열, 중앙 정렬 | §3.1 |
| **Bishop 공격** | 4방향(직교) 1칸. 이동은 대각 4칸 | §3.2 |
| **Knight 공격** | 4방향(직교) 1칸 (원래 8방향에서 **변경됨**) | §3.2 |
| **위협 범위** | Rock 41 / Queen 39 / Bishop 37 / Pawn 33 / King 25 / Knight 25 | §3.2 |
| **waiting time** | `WT = 190 − 통솔력` | §3.3 |
| **크리티컬** | 배수 **×2**, 확률 `clamp(0,100)`, 데미지 내림 | §3.5 |
| **탈진·질병** | 지속시간 **없음(영구)** — 「결계」로만 해제 | §3.7 |
| **환술 실패** | 저항당해도 **MP는 소모** | §3.7 |
| **동시 사망** | **먼저 행동한 쪽 승리.** DoT 동시 정산은 WT 오름차순 | §3.9 |

### `WT = 190 − 통솔력`이 왜 중요한가

이 값 하나로 여러 개가 맞물린다. 바꾸려면 파급을 확인할 것.

- 최속 유닛(관우·조조 통솔 100) → **WT 90**
- 그래서 스킬 지속시간 `time 90 / 190 / 290 / 490`이 각각 정확히 **1 / 2 / 3 / 5 사이클**
- 장비 「장판하뢰」의 `WT +110 = 한 턴 쉬는 효과`라는 원문 설명과 맞물림
- 부수 효과: **통솔이 낮으면 버프 지속 턴 수에서도 손해** (통솔의 2차 효과로 해석)

### 룰 엔진 구현 중 추가로 확정한 것 ★

전부 GDD §12 「룰 엔진 구현 중 확정」에 표로 정리했고 테스트로 고정했다. 특히 헷갈리기 쉬운 셋:

- **지속시간은 시전 시각부터** 센다. 턴이 끝나며 시간이 +1 되므로 `expiresAt`은 `턴 종료 시각 + N`이 아니다.
- **「초선」으로 조종당한 유닛은 제 편을 친다.** `legalTargetsFor`는 "적"을 유닛의 진영이 아니라
  **지시를 내리는 진영** 기준으로 판단한다. 이걸 유닛 진영 기준으로 되돌리면 초선이 무의미해진다.
- **「결계」가 가후 「좌도방술」을 이긴다.** 면역이 100% 적중보다 우선.

### 아직 안 정한 것 (룰 엔진을 막지 않음)

GDD §12 「미해결」 참조 — 레벨업 실패 시 카드 처리, 1:1 기물 구성,
헌제의 King 지정 가능 여부, AI 대전 보상, **무승부 규칙**. 전부 메타/운영 단계에서 결정하면 된다.

---

## 5. 데이터 파이프라인 ★ 반드시 알아야 할 것

### 원본 엑셀은 절대 수정하지 않는다

정규화는 전부 `tools/extract_data.py`에서 처리한다. 엑셀을 고치면 `npm run extract`만 다시 돌린다.
추출기는 Python 표준 라이브러리만 쓴다(의존성 0).

```bash
npm install
npm run extract      # docs/*.xlsx → packages/data/generated/*.json (검증 실패 시 exit 1)
npm run typecheck    # tsc --build
npm test             # node --test
```

### 자동 처리되는 정규화 (GDD §9)

| 처리 | 내용 |
|---|---|
| 이름 통일 | `관훙→관흥`, `이각→이곽`, `장노→장로`, `장료→장요` — **표준은 `assets/Chars/` 파일명** |
| 소속 통일 | `장노군→장로군` |
| 중복 행 해소 | 스킬 시트에 한 장수가 여러 번 나오면 **장수 시트의 등급과 일치하는 행**만 채택 (하드코딩 아님) |
| id 부여 | 한글→로마자 슬러그. `관우`→`gwan-u`, `제갈량`→`je-gal-ryang`. 표시명이 바뀌어도 참조 유지 |
| WT 계산 | `wtBase = 190 − 통솔력` |

> 참고: `이곽`은 역사 표기 `이각(李傕)`의 오탈자지만, "Chars 폴더 기준" 규칙에 따라 표준으로 삼았다.
> 되돌리려면 `assets/Chars/이곽.png`의 파일명만 바꾸고 추출기의 `NAME_FIXES`를 수정하면 된다.

### 검증된 사실

- 장수 **260명** = 초상화 **260장** 완전 대응 (정규화 후)
- 등급 분포 **S 30 / A 40 / B 55 / C 90 / D 44 / E 1**
- 고유기술 **40종** — S급 30종은 1인 전용, A급 4종·B급 5종은 공유, E급 1종(헌제)
- SP 코스트 B 4 / A 5 / S 6 / E 7
- 능력치 합계·최고점 계산 오류 0건
- 팀 등급 점수표 13행 전부 재계산 일치

### 데이터의 단일 출처

기물 마스크는 `packages/data/generated/pieces.json`이 유일한 출처다.
**Python 추출기와 TS 테스트가 각각 독립적으로 위협 범위를 재계산해 확정치와 대조**하므로,
마스크를 잘못 건드리면 양쪽에서 잡힌다.

---

## 6. 현재 상태

```
npm run extract   →  검증 통과 — 문제 없음
npm run typecheck →  exit 0
npm test          →  64/64 pass
```

생성물(`packages/data/generated/*.json`)은 **커밋 대상**이다. 엑셀 없이도 빌드가 되어야 하므로.

`tactics.json`의 `effects`는 **18종 전부 채워졌다.** `uniqueSkills.json`의 `effects`는 아직 비어 있다.

### 룰 엔진 구조

```
packages/rules/src/
  types.ts      타입 계약 — Effect DSL, BattleState, Intent, FORMULA
  rng.ts        시드 PRNG. (seed, cursor) → 값 인 순수 해시 (카운터 기반)
  pieces.ts     기물 기하 — legalMoves / attackCells / threatRange
  state.ts      상태 원시 연산 — 조회 · 체력 · 사망 · 승패 · 공격 판정
  effects.ts    Effect DSL 실행기 + 환술 판정
  battle.ts     CTB 스케줄러 · 검증 · 의도 적용. RulesEngine 계약 구현체 `engine`
```

`state.ts`는 `battle.ts`/`effects.ts`를 import하지 않는다 — **순환 참조를 막는 경계**다.
새 기능이 이 경계를 넘으려 하면 원시 연산은 `state.ts`로 내린다.

### 밟은 지뢰 ★ 다시 밟지 말 것

- **`BattleState.log`를 deep clone하면 안 된다.** `apply`/`advanceTime`은 사본을 만드는데,
  로그까지 `structuredClone`에 태우면 호출 비용이 로그 길이에 비례해 전투가 **O(턴²)**이 된다.
  실측으로 자동 대전 3판에 152초 → 로그만 얕게 복사하도록 고쳐 **1.7초**(약 90배).
  `battle.ts`의 `cloneState()`와 이를 고정하는 테스트(「로그는 얕게 복사한다」)를 지우지 말 것.
- 이벤트는 만들고 나면 바뀌지 않는 값이라 참조를 나눠 가져도 안전하다. 이 전제가 깨지면 위 최적화도 깨진다.

---

## 7. 다음 할 일

```
1. CTB 스케줄러             ✅ advanceTime() — WT 최소값까지 진행, SP 충전, DoT/지속시간 만료 정산
2. 행동 판정                ✅ 이동/공격/명상/턴종료 + 시드 PRNG (rngCursor로 재현성 확보)
3. Effect DSL              ✅ 책략 18종   ⬜ A/B/E급 공유 스킬 10종
4. S급 30종 스크립트 핸들러   ⬜ ← 서사형, 개별 구현 + 유닛 테스트
5. 콘솔 핫시트 대전          ⬜ 자동 대전 수천 판 → 승률 통계
─────────────────────────── 여기까지가 밸런스 검증 ───────────────────────────
6. Phaser 전투 씬 + AI 대전
7. Colyseus 온라인 대전
8. 메타 (도시/상점/랭킹/결제)
```

**대전은 이미 굴러간다.** 무작위 AI로 3:3 자동 대전 200판을 돌려 확인했다
(평균 1364턴, 20판은 결착이 안 남 — GDD §12-13 무승부 규칙 필요).
같은 시드 → 완전히 같은 결과까지 확인.

### 바로 이어서 할 것 — 고유기술

`castUniqueSkill`은 지금 `validate`에서 `no('아직 구현되지 않았다')`를 돌려준다. 붙일 때 필요한 것:

1. **틀 부분** (`battle.ts`) — SP 코스트 차감(B4/A5/S6/E7), `uniqueSkillUses` 소모,
   행동과 별개라 `activeTurn.acted`를 소비하지 않음(GDD §3.6), `usedUniqueSkill` 플래그.
2. **A/B/E급 10종** — `tools/extract_data.py`의 `TACTIC_EFFECTS` 옆에 `SKILL_EFFECTS`를 두고
   같은 방식으로 데이터에 적는다. **엔진에 하드코딩하지 않는다.**
3. **S급 30종** — `scriptId` 핸들러. 「화용도 의석조조」(사망 후 부활), 「삼고초려」(3회 피격 시 적 아군화),
   「연환계」(전 적군 조종)처럼 판을 뒤집는 것들이라 데이터로 접히지 않는다.
   `effects.ts`의 `attackAllEnemiesOnce`는 지금 일부러 던지게 해 뒀다 — 여기서 채운다.

`StatusId`에는 이미 자리를 잡아 뒀지만 **아직 아무도 쓰지 않는 상태**가 있다:
`untargetable` · `illusionAlways` · `freeMove` · `counterattack` · `zeroMpCost` · `damageRedirect` · `mustTarget`.
조회·판정 지점은 배선돼 있으나(예: `legalTargetsFor`가 `untargetable`을 거른다)
**부여하는 쪽이 없어 실제로 걸리지는 않는다.** S급 스킬이 이것들의 첫 사용처가 된다.
`damageRedirect`(고육지책)와 `counterattack`(장합)은 `resolveAttack`에 아직 배선이 없다 — 그때 넣는다.

**5번을 강조하는 이유** — 이 프로젝트의 리스크는 기술이 아니라 밸런스다.
260명 × 6기물 × 8단계 빌드 조합이라, 렌더링을 붙이기 전에 콘솔에서 자동 대전을 돌리는 게 훨씬 싸다.

### 밸런스 관찰 대상 (GDD §11에 전체)

구현하면서 확인할 것. **원본을 바꾸지 않았고, 검토 의견이다.**

1. **부저추신(B, SP4)** — SP 4를 써서 적 SP를 1 깎는다. 교환비가 불리하다.
2. **크리티컬 공식의 스윙** — `30 + 무력차`. 관우(98) vs 조식(15)이면 113% → 항상 발동.
3. **Queen** — 이동 최광역(24칸)인데 공격이 상하 1칸뿐.
4. **Knight** — 위협 범위 25로 King과 동률 최하. 유일한 강점이 경로 무시(도약).
5. **A급 「용맹전진」 14명** — A급 40명 중 35%가 같은 스킬.
6. **헌제(E급)** — 능력치 1/1/1에 SP 7로 `time 990` 무적. King 지정 가능 여부 결정 필요.
7. **탈진·질병 영구 지속** — 해제 수단이 「결계」 하나뿐. 질병은 HP 10 유닛을 10턴에 죽인다.

---

## 8. 주의사항

- **`packages/data/generated/`를 직접 수정하지 말 것.** 엑셀을 고치고 `npm run extract`.
- **룰 엔진에서 `Date.now()` / `Math.random()` 금지.** 전투 재현성이 깨진다. 난수는 `BattleState.rng` 경유.
- **클라이언트는 판정 결과를 보내지 않는다.** `Intent`(의도)만 보내고 서버가 검증→적용→`BattleEvent[]` 브로드캐스트.
- **원래 있던 DOS 게임 폴더는 건드리지 말 것.**
  `c:\Users\user\Documents\Hackers_IELTS_Listening_Basic_MP3_free\DGGL\Games\SamHero\` 에
  삼국지 영걸전(KOEI, 1993) 원본이 있고 **DGGL 런처가 직접 참조**한다.
  `autoexec.conf`가 `HERO.COM`을 경로 없이 실행하므로 파일을 옮기면 실행이 깨진다.
  2026-07-31에 이 프로젝트를 그 폴더에서 분리했고, **이제 아무 의존 관계가 없다.**

---

## 9. 파일 지도

| 경로 | 내용 |
|---|---|
| `HANDOFF.md` | 이 문서 |
| `README.md` | 폴더 구조, 명령, 파이프라인 설명 |
| `Design/GDD.md` | **구현 기준 문서** — 13장. 전투/캐릭터/메타/데이터모델/밸런스/미결 |
| `docs/삼국지 약식체스.xlsx` | 원천 데이터 (장수·스킬·기물·도시·성장). 읽기 전용 |
| `docs/삼국 약식 체스.pptx` | 원천 기획 (책략·경제·UI의 출처). 읽기 전용 |
| `docs/PROMPT.md` | 캐릭터 카드 생성용 Gemini 프롬프트 (2단계 티칭 방식) |
| `assets/Chars/*.png` | 초상화 260장 (440×540 RGBA) |
| `assets/Images/` | Gemini 원본 카드 88장 (Chars의 소스, 1376×768 3인 카드) |
| `tools/extract_data.py` | 엑셀→JSON 추출 + 검증. 의존성 0 |
| `tools/crop_chars.py` | 카드→개별 초상화 절단 |
| `packages/data/generated/` | 자동 생성 JSON 9종 (커밋 대상) |
| `packages/data/src/index.ts` | 로더 + 조회 인덱스(`officerById`, `skillById`, …) |
| `packages/rules/src/types.ts` | **타입 계약** — Effect DSL, BattleState, Intent, FORMULA |
| `packages/rules/src/rng.ts` | 시드 PRNG (카운터 기반, 순수 해시) |
| `packages/rules/src/pieces.ts` | 기물 기하 — `legalMoves`, `attackCells`, `threatRange` |
| `packages/rules/src/state.ts` | 상태 원시 연산 — 조회·체력·사망·승패·공격 판정 |
| `packages/rules/src/effects.ts` | Effect DSL 실행기 + 환술 판정 |
| `packages/rules/src/battle.ts` | CTB 스케줄러 · 검증 · 의도 적용 · `engine` |
| `packages/rules/test/data.test.ts` | 데이터 정합성 회귀 12건 |
| `packages/rules/test/battle.test.ts` | 스케줄러·행동·재현성 회귀 29건 |
| `packages/rules/test/tactics.test.ts` | 책략 18종 회귀 23건 |
| `packages/rules/test/fixtures.ts` | 테스트 공용 픽스처 (러너가 직접 실행하지 않음) |
