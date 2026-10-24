import type { PieceType } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 여몽 — 형주 기습 · 백의도강 (219) ───────────────────────────

/**
 * 여몽이 흰 옷의 상인으로 꾸며 강을 건넌다. 「백의도강」(1.9일 동안 공격 대상이 되지 않음)을 쓰고 수비대 사이를 곧장
 * 걸어 강릉성(맨 위 가운데 7 × 2칸)에 들어서면 이긴다(`reach`). 1.9일은 여몽(WT 110)의 차례 둘이라 **두 걸음**(퀸 3칸씩)에
 * 닿게 세웠다 — 첫 걸음 뒤 수비대 넷이 둘러싸지만 겨누지 못하고, 둘째 걸음은 그 틈(왼쪽 위 대각)으로 빠져나간다.
 *
 * 엔진으로 확인했다 — 수비대는 Lv5 AT 4(공격만 올렸다)이고 첫 걸음 자리를 한 번에 칠 수 있는 칸에 섰다. 기술 없이 같은
 * 길을 가면 시각 36에 여몽(Lv2, HP 15)이 쓰러진다. 육손은 뒤에서 계책만 낸다(첫 WT 400 — 판이 끝날 때까지 안 움직인다).
 * 미방은 King이라 성을 비우지 않는다.
 */
const YEO_MONG = U('P1-Queen');
/** 수비대 — 공격만 올린다(AT 4) */
const guard = (officer: string, piece: PieceType) => entry(officer, piece, 5, { statPicks: ['at', 'at', 'at', 'at'] });
export const yeoMong = (): TutorialStage[] => stage('yeo-mong', {
  config: config('yeo-mong', {
    P1: [entry('yeo-mong', 'Queen', 2), entry('yuk-son', 'Rock')],
    P2: [
      entry('mi-bang', 'King'), guard('wang-bo', 'Rock'), guard('jo-ru', 'Knight'),
      guard('jin-sik', 'Bishop'), guard('yu-bong', 'Pawn'),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 7 }, { x: 20, y: 13 }],
      P2: [{ x: 12, y: 0 }, { x: 8, y: 3 }, { x: 14, y: 6 }, { x: 14, y: 1 }, { x: 14, y: 4 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 400 }], P2: [{ wt: 60 }, { wt: 20 }, { wt: 25 }, { wt: 30 }, { wt: 35 }] },
    startSp: { P1: 6, P2: 0 },
    goals: {
      win: [{ kind: 'reach', unit: YEO_MONG, area: { x0: 9, x1: 15, y0: 0, y1: 1 } }],
      lose: [{ kind: 'unitLost', unit: YEO_MONG }],
    },
  }),
  guide: [
    { unit: YEO_MONG, phases: [
      { lines: ['tut.s.yeo-mong.intro', 'tut.s.yeo-mong.intro2', 'tut.s.yeo-mong.skill', 'tut.s.yeo-mong.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.yeo-mong.walk', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 4 }, until: 'moved' },
    ] },
    { unit: YEO_MONG, phases: [
      { lines: ['tut.s.yeo-mong.gate', 'tut.go.move'], allow: ['move'], moveTo: { x: 9, y: 1 }, until: 'moved' },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.yeo-mong.done', 'tut.s.yeo-mong.done2'],
});
