import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 황충 — 정군산 (219) ─────────────────────────────────────────

/**
 * 하후연(King)은 판 맨 위 깊숙이 서 있고, 그 앞을 하후상 · 하후덕 · 한호가 막는다. 황충은 「백보천양」(1.9일 동안 **아무 위치의
 * 적 하나**를 공격 + 크리티컬 100%)으로 호위 너머의 하후연을 곧장 쏜다 — King이 쓰러지면 대전 승패(군주 격파)로 판이 끝난다.
 * 시전 지연이 30이라 **쓴 차례는 그대로 끝나고**, 30 뒤 황충 차례가 돌아오는 순간 효과가 걸린다(그 사이 적은 아무도 못 움직인다 —
 * 통솔이 낮아 WT가 길다). 1.9일 동안 황충 차례가 두 번 — 크리 6 두 대가 하후연(HP 10)을 넘는다.
 *
 * 기술 없이 맞붙으면 Lv3 호위 셋에게 진다(엔진으로 확인했다). 사람의 공격은 「HP가 가장 낮은 적」을 고르므로(회귀의 손),
 * 하후연을 Lv1로 두어 처음부터 가장 약한 적이 되게 했다 — 화면의 조준도 하후연을 가리킨다.
 */
const HWANG_CHUNG = U('P1-Pawn');
export const hwangChung = (): TutorialStage[] => stage('hwang-chung', {
  config: config('hwang-chung', {
    P1: [entry('hwang-chung', 'Pawn', 4, { statPicks: ['at', 'at', 'hp'] }), entry('beop-jeong', 'Bishop', 2)],
    P2: [entry('ha-hu-yeon', 'King'), entry('ha-hu-sang', 'Rock', 3), entry('ha-hu-deok', 'Queen', 3), entry('han-ho', 'Knight', 3)],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }, { x: 14, y: 13 }],
      P2: [{ x: 12, y: 1 }, { x: 10, y: 3 }, { x: 12, y: 3 }, { x: 14, y: 3 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { lose: [{ kind: 'unitLost', unit: HWANG_CHUNG }] },
  }),
  guide: [
    { unit: HWANG_CHUNG, phases: [
      { lines: ['tut.s.hwang-chung.intro', 'tut.s.hwang-chung.intro2', 'tut.s.hwang-chung.skill', 'tut.s.hwang-chung.delay', 'tut.s.hwang-chung.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: HWANG_CHUNG, phases: [{ lines: ['tut.s.hwang-chung.aim', 'tut.s.hwang-chung.aim2'], allow: ['attack'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.hwang-chung.done', 'tut.s.hwang-chung.done2'],
});
