# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 지침이다.

## 시작하기 전에

**[`HANDOFF.md`](HANDOFF.md)를 먼저 읽는다.** 프로젝트 개요, 확정된 규칙, 진행 상황, 다음 할 일이
전부 거기에 있다. 그다음 [`Design/GDD.md`](Design/GDD.md)(구현 기준 문서)를 참조한다.

## 무엇인가

**삼국 약식 체스** — 체스 6기물의 이동 규칙을 빌린 삼국지 장수 260명의 ATB 전술 대전 게임.
TypeScript 모노레포(npm workspaces). PC(웹) · Android · iOS 단일 코드베이스 목표.

"턴제"라고 부르지만 실제로는 **CTB 스케줄러**다 — 절대시간이 흐르고, 유닛별 `waiting time`이 0이
되면 제어권을 얻으며, 제어 중에는 시간이 멈춘다. 서버가 시계의 유일한 기준점이다.

## 명령

```bash
npm install
npm run extract      # docs/*.xlsx → packages/data/generated/*.json (검증 실패 시 exit 1)
npm run backgrounds  # assets/Backgrounds/ → 화면 배경 14장
npm run typecheck    # tsc --build
npm test             # node --test
```

Node 22.6+ 필요. `.ts`를 타입 스트리핑으로 그대로 실행하므로 번들 단계가 없다.
TypeScript는 타입 검사와 `.d.ts` 생성에만 쓴다(`emitDeclarationOnly`). 소스에서 import 확장자는 `.ts`로 명시한다.

## 지켜야 할 규칙

- **`docs/*.xlsx` / `docs/*.pptx`는 읽기 전용.** 정규화는 전부 `tools/extract_data.py`에서 한다.
- **`packages/data/generated/`를 직접 수정하지 않는다.** 엑셀을 고치고 `npm run extract`.
  생성물은 커밋 대상이다(엑셀 없이도 빌드가 되어야 하므로).
- **룰 엔진에서 `Date.now()` / `Math.random()` 금지.** 전투 재현성이 깨진다.
  난수는 `BattleState`의 시드 PRNG를 경유하고 `rngCursor`로 소비 순서를 기록한다.
- **클라이언트는 판정 결과를 보내지 않는다.** `Intent`(의도)만 보내고, 서버가 검증 → 적용 →
  `BattleEvent[]`를 브로드캐스트한다. 현금 가챠와 랭킹이 있어 치팅 유인이 크다.
- 기물 마스크의 단일 출처는 `packages/data/generated/pieces.json`이다.
  Python 추출기와 TS 테스트가 각각 독립적으로 위협 범위를 재계산해 검증한다.
- **책략·고유기술의 효과는 데이터(Effect DSL)로 적는다.** 사양의 출처는
  `tools/extract_data.py`의 `TACTIC_EFFECTS`이고, `packages/rules/src/effects.ts`는 해석기일 뿐이다.
  엔진에 개별 스킬을 하드코딩하는 것은 데이터로 접히지 않는 S급 `scriptId` 핸들러뿐이다.
- **`BattleState.log`를 deep clone하지 않는다.** `battle.ts`의 `cloneState()` 참조 —
  로그까지 복사하면 긴 전투가 O(턴²)이 된다 (실측 90배 차이).
- **화면이 미리 보여 주는 숫자는 엔진이 낸다.** 공격 확인창은 `forecastAttack()`,
  책략 확인창은 `illusionChance()`. 화면이 공식을 다시 적으면 **표시만** 조용히 어긋난다.
  미리보기는 난수를 쓰지 않는다 — 굴리면 `rngCursor`가 밀려 리플레이가 깨진다.
- **`state`는 이미 적용이 끝난 상태다.** 「맞기 전」을 보여 주려면 연출 층이 그 차이를
  들고 있어야 한다 (`PoseDirector`의 `hpPending` · `holdAt`). 화면이 이전 상태를
  기억하게 만들지 말 것 — 온라인 재접속에서 무너진다.
- **연출은 카메라가 도착한 뒤에 시작한다.** `poses.ts`의 `look()`이 커서를 밀므로
  각 `case`에서 **`show()`보다 먼저** 불러야 한다. 뒤집으면 자세가 이미 시작된
  자리에 큐가 놓여 「줌인 도는 동안 이미 때리고 있는」 어긋남이 돌아온다.
- **스모크 검사는 화면 글자가 아니라 `data-*` 속성으로 건다.** 「적 책략은 가린다」를
  「적군」이라는 **글자**로 골라내고 있다가, 그 글자를 빼자 검사가 조용히 무력화됐다.
- **「오라(aura)」와 「시각 효과(visualEffect)」는 다른 것이다.** `aurasOn()` ·
  `auraIncomingHalf`는 여포·허저의 **반경 판정**이고, `assets/SpecialStatus/`의 그림은
  화면에 겹쳐 그리는 **연출**이다. 엑셀 시트 이름만 「오라매핑」으로 남아 있다 —
  코드에서 `aura`가 보이면 언제나 반경 판정 쪽이다.
- **카드 액자의 9분할 자리는 두 곳에 있다.** `tools/build_frames.py`의 `SLICE`와
  `style.css`의 `.uc-frame` `border-image-slice`가 **같은 값이어야** 카드가 흰 종이
  안에 앉는다. 한쪽만 고치면 카드가 나무 위로 넘친다 — 도구가 돌 때마다 CSS 한 줄을
  찍어 주고, 스모크가 「카드가 종이 안에 있는가」를 좌표로 잡는다.
- **전역 CSS에 흔한 이름을 새로 쓰지 않는다.** `.panel`은 전투 화면의 플로팅 커맨드
  패널이 이미 쓰고 있고 `position: absolute`에 폭이 `--board`의 배수다 — 메타 화면의
  판때기에 같은 이름을 붙였더니 오른쪽 아래에 좁게 붙었다. CSS는 이름이 겹쳐도 오류가
  없어 **화면을 봐야만 안다.** 새 화면의 것은 `.place-panel`처럼 접두사를 붙인다.
  **접두사를 붙여도 같은 파일 안에서 겹칠 수 있다** — `.ofc-head`를 표 머리(grid)와
  상세 머리(flex)에 함께 붙여 한쪽이 무너졌다(`.ofc-thead` / `.ofc-bio`로 갈랐다).
  그리고 `.scr .foot`처럼 **선택자가 둘인 기존 규칙은 새 한 클래스를 이긴다.**
- **배경 위에 놓는 화면에서 팝업은 「내용을 올리는」 규칙에서 빼야 한다.**
  `.scr-bg > *` · `.scr-dim > *`가 자식 **전부**에 `position: relative`를 걸어
  `.modal-back`의 `absolute`를 덮으면, 팝업이 화면 한가운데가 아니라 **내용 맨 아래에
  흘러 붙는다.** 스모크가 「떠 있는가」만 보면 못 잡는다 — **「있는가」와 「제자리에
  있는가」는 다른 검사다.**
- **띠로 이어 그린 그림은 등분해 자르지 않는다.** `assets/Backgrounds/`의 진짜 칸
  경계는 등분한 자리에서 1~2px 어긋나 있어, 등분하면 **옆 칸이 딸려 온다**
  (`build_backgrounds.py`의 `cut_points()` 참조). 화면에서는 「끝에 이상한 줄이
  있네」로만 보인다.
- **화면 배경의 시간대·도시 레벨 경계는 `screens/backdrop.ts` 하나가 정한다.**
  `bandForHour()`는 시계를 스스로 읽지 않는다 — 밤 그림은 밤에 접속해야 보여서,
  시각을 밖에서 넣을 수 있어야 테스트로 고정된다. **출력 확장자(`.jpg`)는 그 파일과
  `tools/build_backgrounds.py`가 함께 바뀌어야 한다** — 한쪽만 고치면 그림만 조용히 404다.
- **화면을 꽉 채우는 그림은 프레임이 가장 클 때(700px)로 확인한다.** 480px 스크린샷에서는
  300px짜리를 늘려도 안 깨져 보인다 — 배경을 저해상도로 붙여 놓고 못 알아챘던 자리다.
- **움직이는 배경은 제 층(`.scr-art`)에 있고, 쌓임 순서 셋은 함께 본다.** 그림을 화면
  div(`.scr-bg`)의 배경으로 되돌리면 `transform`에 **제목·단추까지 딸려 흔들린다.**
  순서는 **그림 0 → 어둠(`::before`) 1 → 내용 2**이고, 하나만 지우면 어둠이 글자를
  덮거나 그림이 어둠을 덮는다. 확대(`DRIFT_ZOOM`)는 장식이 아니라 **밀어낼 여백**이라
  `밀리는 거리 < (배율−1)/2`를 자세마다 지켜야 한다 — 넘으면 반대쪽에 바탕색 띠가 뜬다.
- **지형 그림은 「칸」에, 지속형 링은 「유닛」에 붙는다.** `battle/terrain.ts`는 판에
  붙박이로 깔리고(`state.terrain`을 그대로 따라간다), `battle/visualEffect.ts`의 링은
  유닛 컨테이너 안에 있어 같이 움직인다. 성지 칸에서는 **둘 다** 뜨는데 뜻이 다르다 —
  칸은 「여기가 성지다」, 링은 「이 유닛이 그 효과를 받는 중이다」.

## 기획 수치를 바꿀 때

GDD의 「§12 미결 항목」에 결정 이력이 있다. 아래는 이미 확정된 것이라 임의로 바꾸지 않는다.

- 맵 `20행 × 25열` 고정
- `WT = 190 − 통솔력` — 스킬 지속시간 `time 90/190/290/490`이 1/2/3/5 사이클로 떨어지는 근거
- 크리티컬 ×2, 확률 `clamp(0,100)`
- 위협 범위 Rock 41 / Queen 39 / Bishop 37 / Pawn 33 / King 25 / Knight 25

수치를 바꾸면 `packages/rules/test/data.test.ts`가 먼저 깨진다. 테스트를 고치기 전에
그 변경이 의도된 것인지 확인한다.

## 무관한 폴더

`c:\Users\user\Documents\Hackers_IELTS_Listening_Basic_MP3_free\DGGL\Games\SamHero\` 에
**삼국지 영걸전**(KOEI, 1993) DOS 게임 원본이 있다. 이 프로젝트는 원래 거기서 시작했으나
2026-07-31에 분리되었고 **이제 아무 의존 관계가 없다.** DGGL 런처가 그 폴더를 직접 참조하므로
파일을 옮기거나 수정하지 않는다.
