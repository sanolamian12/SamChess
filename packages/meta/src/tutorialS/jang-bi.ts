import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 장비 — 장판교 (208) ─────────────────────────────────────────

/**
 * 장비 하나가 다리 앞을 막고 조조군 다섯을 맞는다. 적이 먼저 달려들어 한 번씩 치고, 장비 차례에 「장판하뢰」(모든 적 WT +1.5일 —
 * 한 턴 쉰다)로 **시간을 번다.** 지정 시각(`survive`)까지 장비가 서 있으면 이긴다. 기술 없이 버티면 적이 한 바퀴 더 돌아
 * 다섯이 두 바퀴를 더 친다 — 그것을 장비는 못 견딘다.
 *
 * 엔진으로 훑어 골랐다 — 적 다섯은 한 걸음에 장비를 칠 자리에 서고 첫 WT를 0~20으로 당겨 먼저 한 바퀴(−10)를 친다.
 * Lv4 장비(HP 25)는 기술을 쓰면 15가 남고, 안 쓰면 시각 273에 쓰러진다(버티는 시각 280 = 2.8일).
 *
 * 엔진에는 다리 · 벽 같은 막는 지형이 없다 — 「다리 칸을 지킨다」(§4 초안)를 「시각까지 장비가 버틴다」로 바꿨다.
 * 장비는 King(8방향 공격)이라 쓰러지면 대전 규칙으로도 진다. 적에게는 King이 없다 — 하나를 쓰러뜨렸다고 판이 끝나지 않게.
 */
const JANG_BI = U('P1-King');
export const jangBi = (): TutorialStage[] => stage('jang-bi', {
  config: config('jang-bi', {
    P1: [entry('jang-bi', 'King', 4)],
    P2: [
      entry('ha-hu-eun', 'Queen'), entry('ha-hu-geol', 'Rock'), entry('jo-sun', 'Bishop'),
      entry('u-geum', 'Knight'), entry('jo-hong', 'Pawn'),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 9 }],
      P2: [{ x: 12, y: 5 }, { x: 11, y: 5 }, { x: 16, y: 6 }, { x: 10, y: 7 }, { x: 13, y: 6 }],
    },
    overrides: { P1: [{ wt: 40 }], P2: [{ wt: 0 }, { wt: 5 }, { wt: 10 }, { wt: 15 }, { wt: 20 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'survive', until: 280 }], lose: [{ kind: 'unitLost', unit: JANG_BI }] },
  }),
  guide: [
    { unit: JANG_BI, phases: [
      { lines: ['tut.s.jang-bi.intro', 'tut.s.jang-bi.intro2', say('jang-bi', 1, 'ha-hu-eun'), say('jang-bi', 2, 'jang-bi'), 'tut.s.jang-bi.skill', 'tut.s.jang-bi.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.jang-bi.roared', say('jang-bi', 3, 'ha-hu-geol'), 'tut.s.jang-bi.attack'], allow: ['attack'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('jang-bi', 4, 'jang-bi'), 'tut.s.jang-bi.done', 'tut.s.jang-bi.done2'],
});
