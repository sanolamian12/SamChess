import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 조조 — 청매자주 영웅론 (199, 허도 승상부 정원의 육각정) ────────────────

/**
 * 1:1. 유비가 먼저 「삼고초려」(세 번 맞힌 적을 제 편으로)를 건다 — 시전 지연 30 동안 조조 차례가 끼고(통솔 98 > 91),
 * 「영웅론」으로 **시전을 무산시키고 봉인한다.** 못 막으면 세 대를 맞고 조조가 유비 편이 된다 — 그러면 진다(`unitLost`).
 * 유비 AI는 첫 차례에 삼고초려를 쓴다(SP를 넉넉히 준다 — 엔진으로 확인했다). 첫 WT로 유비를 먼저 세운다.
 */
const JO_JO = U('P1-King');
const YU_BI = U('P2-King');
export const joJo = (): TutorialStage[] => stage('jo-jo', {
  config: config('jo-jo', { P1: [entry('jo-jo', 'King', 3)], P2: [entry('yu-bi', 'King')] }, {
    positions: { P1: [{ x: 12, y: 10 }], P2: [{ x: 12, y: 6 }] },
    overrides: { P1: [{ wt: 5 }], P2: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 6 },
    goals: { win: [{ kind: 'killTarget', unit: YU_BI }], lose: [{ kind: 'unitLost', unit: JO_JO }] },
  }),
  guide: [
    { unit: JO_JO, phases: [
      { lines: ['tut.s.jo-jo.intro', 'tut.s.jo-jo.intro2', 'tut.s.jo-jo.casting', 'tut.s.jo-jo.seal', 'tut.s.jo-jo.seal2'], allow: ['unique'], target: YU_BI, until: 'skill' },
      { lines: ['tut.s.jo-jo.sealed'], allow: ['move', 'attack', 'endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.jo-jo.done', 'tut.s.jo-jo.done2'],
});
