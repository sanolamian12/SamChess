import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 유비 — 면죽 (214) ───────────────────────────────────────────

/**
 * 촉으로 들어온 유비 앞을 이엄이 막아선다. 「삼고초려」(시전 뒤 4.9일 안에 유비에게 세 번 맞은 적은 유비 편이 된다)로
 * 이엄을 **죽이지 않고 세 번** 쳐서 얻으면 이긴다(`convert`). 시전 지연(30)이 있어 기술을 건 차례는 그 자리에서 끝나고,
 * 시각 31에 걸리며 유비의 차례가 다시 온다 — 그 차례부터 세 번(시각 31 · 131 · 231) 친다.
 *
 * 이엄은 처음부터 유비 곁(대각, Rock이라 서로 칠 수 있다)에 서 있어 자리를 뜨지 않고 맞받아친다. 세 번 다 크리티컬이어도
 * 12라 Lv3 이엄(HP 20)은 쓰러지지 않는다 — 엔진으로 HP 12가 남는 것을 확인했다. 유비의 공격이 이엄에게만 닿도록 장임 · 오의는
 * 판 양 끝 멀리, 유장(King)은 맨 뒤에 세웠다. 법정 · 황충은 첫 WT 300이라 세 번째 공격 전에는 움직이지 않는다(대본 차례가 유비만).
 * 기술 없이는 얻을 수 없고, 유장까지 뚫고 가기 전에 유비가 쓰러진다(시각 855).
 */
const YU_BI = U('P1-King');
const I_EOM = U('P2-Rock');
export const yuBi = (): TutorialStage[] => stage('yu-bi', {
  config: config('yu-bi', {
    P1: [entry('yu-bi', 'King', 5), entry('beop-jeong', 'Pawn', 3), entry('hwang-chung', 'Knight', 3)],
    P2: [entry('yu-jang', 'King', 3), entry('i-eom', 'Rock', 3), entry('jang-im', 'Knight'), entry('o-ui', 'Bishop')],
  }, {
    positions: {
      P1: [{ x: 12, y: 10 }, { x: 10, y: 13 }, { x: 14, y: 13 }],
      P2: [{ x: 12, y: 0 }, { x: 11, y: 9 }, { x: 2, y: 1 }, { x: 22, y: 1 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 300 }, { wt: 300 }], P2: [undefined, { wt: 50 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'convert', unit: I_EOM }] },
  }),
  guide: [
    { unit: YU_BI, phases: [
      { lines: ['tut.s.yu-bi.intro', 'tut.s.yu-bi.intro2', 'tut.s.yu-bi.skill', 'tut.s.yu-bi.delay', 'tut.s.yu-bi.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: YU_BI, phases: [{ lines: ['tut.s.yu-bi.hit1', 'tut.s.yu-bi.hit1b'], allow: ['attack'] }] },
    { unit: YU_BI, phases: [{ lines: ['tut.s.yu-bi.hit2'], allow: ['attack'] }] },
    { unit: YU_BI, phases: [{ lines: ['tut.s.yu-bi.hit3'], allow: ['attack'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.yu-bi.done', 'tut.s.yu-bi.done2'],
});
