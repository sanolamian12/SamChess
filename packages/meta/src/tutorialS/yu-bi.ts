import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 유비 — 융중 초려 (207) ───────────────────────────────────────

/**
 * 세 번째로 융중의 초려를 찾은 유비가 홀로 제갈량과 마주한다(2026-10-26 기획자 — 옛 판은 면죽에서 이엄을 얻는 판이었다.
 * 삼고초려가 핵심이니 제갈량을 얻는 판으로 다시 짰다 · 유비 단신). 「삼고초려」(시전 뒤 4.9일 안에 유비에게 세 번 맞은 적은
 * 유비 편이 된다)로 제갈량을 **쓰러뜨리지 않고 세 번** 쳐서 얻으면 이긴다(`convert`). 시전 지연(30)이 있어 기술을 건 차례는
 * 그 자리에서 끝나고, 시각 31에 걸리며 유비의 차례가 다시 온다 — 그 차례부터 세 번 친다.
 *
 * 판은 옛 면죽 판의 뼈대를 그대로 썼다 — 이엄이 서던 자리(유비 대각 옆, Rock이라 서로 칠 수 있다 · 첫 WT 50)에 제갈량이 선다.
 * 세 번 다 크리티컬이어도 12라 Lv3 제갈량(HP 20)은 쓰러지지 않는다. 적은 제갈량 하나이고 King이 없다 — 대전 승패로는 끝나지
 * 않고 전향으로만 끝난다. 유비는 King이라 쓰러지면 진다. 지도는 옛 유비 지도(`튜토리얼맵-유비.jpg`)를 그대로 쓴다 — 새 그림이 오면 갈아 끼운다.
 */
const YU_BI = U('P1-King');
const JE_GAL_RYANG = U('P2-Rock');
export const yuBi = (): TutorialStage[] => stage('yu-bi', {
  config: config('yu-bi', {
    P1: [entry('yu-bi', 'King', 5)],
    P2: [entry('je-gal-ryang', 'Rock', 3)],
  }, {
    positions: {
      P1: [{ x: 12, y: 10 }],
      P2: [{ x: 11, y: 9 }],
    },
    overrides: { P1: [{ wt: 0 }], P2: [{ wt: 50 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'convert', unit: JE_GAL_RYANG }] },
  }),
  guide: [
    { unit: YU_BI, phases: [
      { lines: ['tut.s.yu-bi.intro', say('yu-bi', 1, 'je-gal-ryang'), 'tut.s.yu-bi.intro2', say('yu-bi', 2, 'yu-bi'), 'tut.s.yu-bi.skill', 'tut.s.yu-bi.delay', 'tut.s.yu-bi.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: YU_BI, phases: [{ lines: ['tut.s.yu-bi.hit1', say('yu-bi', 3, 'je-gal-ryang'), 'tut.s.yu-bi.hit1b'], allow: ['attack'] }] },
    { unit: YU_BI, phases: [{ lines: ['tut.s.yu-bi.hit2'], allow: ['attack'] }] },
    { unit: YU_BI, phases: [{ lines: ['tut.s.yu-bi.hit3'], allow: ['attack'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.yu-bi.done', say('yu-bi', 4, 'yu-bi'), 'tut.s.yu-bi.done2'],
});
