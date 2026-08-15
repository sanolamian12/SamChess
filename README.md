# SamChess — 삼국 약식 체스

턴제(ATB) 전술 대전 게임. PC(웹) · Android · iOS 단일 코드베이스.

기획서: [`Design/GDD.md`](Design/GDD.md) · 이어서 작업하려면 [`HANDOFF.md`](HANDOFF.md)부터 읽는다.

## 구조

```
SamChess/
├── HANDOFF.md                  세션 인수인계 — 새 대화는 여기서 시작
├── Design/GDD.md               게임 기획서 (구현 기준 문서)
├── docs/                       원천 자료 — 읽기 전용
│   ├── 삼국지 약식체스.xlsx      장수 260명, 고유기술, 기물, 도시·성장 테이블
│   ├── 삼국 약식 체스.pptx       게임 개요 (책략·경제·UI는 여기가 출처)
│   └── PROMPT.md               캐릭터 카드 생성용 Gemini 프롬프트
├── assets/                     그림·소리 원본. **git에 없다** (기획자 방침)
│   ├── Chars/                  초상화 260장 (440×540 RGBA)
│   ├── Backgrounds/            화면 배경 4장 — 간판·도시(시간대) · 자리(궁궐/병영/장터/미정)
│   └── Images/                 Gemini 원본 카드 88장 (Chars의 소스)
├── history/                   세션별 작업 기록 (결정 이유·시행착오)
├── tools/
│   ├── extract_data.py         엑셀 → JSON 추출 (Python 표준 라이브러리만, 의존성 0)
│   ├── crop_chars.py           카드 → 개별 초상화 절단
│   ├── build_portraits.py      초상화 → 웹용 96×120
│   ├── balance.ts              자동 대전 대량 실행 → 승률·결착시간 통계
│   ├── smoke_ui.ts             화면 연동 스모크 (좌표 → Intent → 판정)
│   └── shot.ts                 스크린샷
└── packages/
    ├── data/                   @samchess/data — 정적 게임 데이터
    │   ├── generated/          ★ 자동 생성. 직접 수정 금지
    │   └── src/index.ts        로더 + 조회 인덱스
    ├── rules/                  @samchess/rules — 룰 엔진 (서버·클라 공용)
    │   ├── src/types.ts        타입 계약 + 계산식(FORMULA)
    │   ├── src/rng.ts          시드 PRNG (카운터 기반, 순수 해시)
    │   ├── src/pieces.ts       기물 기하 (이동/공격/위협 범위)
    │   ├── src/state.ts        상태 원시 연산 (조회·체력·사망·승패·공격 판정)
    │   ├── src/effects.ts      Effect DSL 실행기 + 환술 판정
    │   ├── src/scripts.ts      서사형 고유기술 스크립트
    │   ├── src/battle.ts       CTB 스케줄러 · 검증 · 의도 적용
    │   ├── src/ai.ts           기준 AI + 자동 대전 (밸런스 검증용)
    │   └── test/               회귀 테스트 113건
    └── client/                 @samchess/client — 메타 화면(React) + Phaser 전투 화면 (Vite)
        ├── src/screens/              간판 · 도시 · 궁궐/병영/장터 · 편성 · 결과 · 장수 관리
        ├── src/screens/backdrop.ts   시간대·도시 레벨 → 배경 그림 (경계의 단일 출처)
        ├── src/i18n/                 다국어 5종 — 한국어 기준, 없으면 한국어로 물러난다
        ├── src/battle/playback.ts    ★ 이벤트 재생 레이어 (온라인 대전에서 재사용)
        ├── src/battle/BattleScene.ts 보드·유닛 타일·입력 (판정은 하지 않는다)
        ├── src/ui/hud.ts             상단 HUD — 절대시간 · SP · 고유기술 현황
        ├── src/ui/controlModal.ts    제어 모달 — 턴 3단계 · 시전 · 조준 (활성 여부는 validate()에)
        └── src/ui/inspectPanel.ts    장수 정보 팝업 — 아무 기물이나 눌러 보는 읽기 전용 창
```

> 이 프로젝트는 원래 DGGL의 DOS 게임 폴더(`…/DGGL/Games/SamHero/`) 안에서 시작했다가
> 2026-07-31에 분리되었다. 그 폴더에는 **삼국지 영걸전 원본만** 남아 있으며 DGGL 런처가
> 직접 참조하므로 건드리지 않는다. 이 프로젝트와는 이제 아무 의존 관계가 없다.

## 명령

```bash
npm install
npm run portraits           # assets/Chars → 웹용 96×120 (그림은 git에 없다)
npm run actions             # assets/CharsAction → 액션 스프라이트시트 260장
npm run vfx                 # assets/SpecialStatus → 시각 효과 30장 (링 23 + 일회성 7)
npm run terrain             # assets/map → 지형 그림 3종 (화계·수계·성지)
npm run frames              # assets/map → 판 지도 · 카드 벽보 액자 · 산수 배경
npm run audio               # assets/Audio/bgm → 배경음악 6곡
npm run backgrounds         # assets/Backgrounds → 화면 배경 14장 (간판·도시의 시간대 3 · 자리 4×2)

npm run extract             # 엑셀 → packages/data/generated/*.json (검증 실패 시 종료 코드 1)
npm run typecheck           # tsc --build
npm test                    # node --test (타입 스트리핑) — 113건

npm run dev                 # http://localhost:5173 — 간판 화면부터. 전투만 보려면 ?demo=1
npm run balance -- 5000     # 자동 대전 5000판 승률 통계 (약 20초)
npm run smoke:ui            # 화면 연동 스모크 (dev 서버가 떠 있어야 한다)
npm run shot -- --zoom 2.4  # 스크린샷 (dev 서버 필요). --zoom은 제어권 유닛에 카메라를 붙인다
```

Node 22.6+ 필요 — `.ts`를 빌드 없이 그대로 실행한다. TypeScript는 타입 검사와 `.d.ts` 생성에만 쓴다.

전투 화면 URL 쿼리: `?seed=3&mode=5v5&side=P2` · `?auto=1`(양쪽 AI 관전) · `?sp=15`(시작 SP)

## 데이터 파이프라인

**원본 엑셀은 절대 수정하지 않는다.** 정규화는 전부 `extract_data.py`에서 처리하므로,
엑셀을 고치고 `npm run extract`만 다시 돌리면 된다.

추출 시 자동 처리되는 것 (GDD §9):

| 처리 | 내용 |
|---|---|
| 이름 통일 | `관훙→관흥`, `장노→장로`, `장요→장료` (표준 = `Chars/` 파일명) |
| 소속 통일 | `장노군→장로군` |
| 중복 행 해소 | 스킬 시트에 한 장수가 여러 번 나오면 **장수 시트의 등급과 일치하는 행**만 채택 |
| id 부여 | 한글 이름 → 로마자 슬러그 (`관우` → `gwan-u`). 표시명이 바뀌어도 참조가 유지된다 |
| WT 계산 | `wtBase = 190 − 통솔력` |
| 책략 효과 | `TACTIC_EFFECTS`(추출기 안)의 Effect DSL을 그대로 실어 보낸다 — 엔진에 하드코딩하지 않는다 |

추출과 동시에 검증한다 — 하나라도 실패하면 JSON을 쓰되 종료 코드 1을 반환한다.

- 능력치 합계·최고점 재계산
- 장수 260 ↔ 초상화 260 양방향 대조
- 고유기술 40종 ↔ `assets/SpecialSkills/` 연출 이미지 40장 (경고만, 빌드는 막지 않는다)
- S/A/B/E급 전원 고유기술 보유, C/D급 미보유
- 스킬 시트 티어 ↔ 장수 시트 등급 일치
- 슬러그 충돌
- 기물 위협 범위 (마스크로부터 재계산 → 확정치와 대조)
- 팀 등급 점수표 (조합 문자열 → 점수 재계산)

생성물은 **커밋한다**. 엑셀 없이도 빌드가 되어야 하기 때문.

## 현재 상태

- [x] 모노레포 골격, 추출 파이프라인, 데이터 검증
- [x] 룰 엔진 — CTB 스케줄러, 행동 판정, 책략 18종, 고유기술 40종 (113/113 통과)
- [x] 기준 AI + 밸런스 하네스 (5000판 실측), 무승부 규칙 `time 6000`
- [x] Phaser 전투 씬 — 1차(보드·타일·입력) + 2차(바·HUD·제어 모달·시전 UI·배지·정보 팝업)
- [ ] Colyseus 온라인 대전 ← **다음**
- [ ] 메타 (도시/상점/랭킹/결제)

책략 18종과 고유기술 40종의 효과는 전부 데이터(Effect DSL)로 기술돼 있다.
데이터로 접히지 않아 코드 핸들러가 필요한 것은 「소패왕전」과 「차동풍」 둘뿐이다 (GDD §10).
