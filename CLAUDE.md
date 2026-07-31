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
