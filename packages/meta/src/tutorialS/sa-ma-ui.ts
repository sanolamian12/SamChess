import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 사마의 — 오장원 (234) ───────────────────────────────────────

/**
 * 오장원의 대치. 사마의(K) · 사마사 · 사마소가 진을 지키고, 촉군의 위연 · 왕평 · 마대가 몰려온다. 제갈량(K)은 북쪽 끝 본진에서
 * 나오지 않는다 — 「먹는 것은 적고 일은 많으니」 이미 병이 깊어 **HP 4/30로 시작**한다. 적 King을 쓰러뜨리면 이긴다(군주 격파).
 *
 * 「식소사번」(적 하나에게 판이 끝날 때까지 1.1일마다 HP 1)을 제갈량에게 걸면, 손을 대지 않아도 시각 440에 쓰러진다 —
 * 「싸우지 않고 이긴다 · 지키며 깎는다」. 기술 없이 두면 제갈량은 본진에서 내려오지 않고, 촉군 셋(Lv5, HP만 올려 30)은
 * 사마씨 셋이 쳐서 깎기에 너무 단단해 판이 끝나지 않는다(엔진으로 두어 보니 시각 1237에 사마의가 쓰러졌다).
 *
 * 사마의는 Lv5(HP 30), 아들 둘은 Lv4(HP 25) — 4.4일을 버티며 HP가 넉넉히 남는다(끝에 26 · 23 · 23).
 * 기술은 대상을 고르는 것이라 대본이 제갈량만 고르게 한다. 시전한 차례에는 [대기]만 켠다 — 나서지 않는 것이 요점이다.
 */
const SA_MA_UI = U('P1-King');
const JE_GAL_RYANG = U('P2-King');
export const saMaUi = (): TutorialStage[] => stage('sa-ma-ui', {
  config: config('sa-ma-ui', {
    P1: [entry('sa-ma-ui', 'King', 5), entry('sa-ma-sa', 'Rock', 4), entry('sa-ma-so', 'Pawn', 4)],
    P2: [entry('je-gal-ryang', 'King', 5), entry('wi-yeon', 'Queen', 5), entry('wang-pyeong', 'Bishop', 5), entry('ma-dae', 'Knight', 5)],
  }, {
    positions: {
      P1: [{ x: 12, y: 13 }, { x: 11, y: 12 }, { x: 13, y: 12 }],
      P2: [{ x: 12, y: 0 }, { x: 12, y: 6 }, { x: 9, y: 6 }, { x: 15, y: 6 }],
    },
    overrides: { P1: [{ wt: 0 }], P2: [{ hp: 4 }] },
    startSp: { P1: 6, P2: 0 },
  }),
  guide: [
    { unit: SA_MA_UI, phases: [
      { lines: ['tut.s.sa-ma-ui.intro', 'tut.s.sa-ma-ui.intro2', say('sa-ma-ui', 1, 'je-gal-ryang'), say('sa-ma-ui', 2, 'sa-ma-sa'), say('sa-ma-ui', 3, 'sa-ma-ui'), 'tut.s.sa-ma-ui.skill', 'tut.s.sa-ma-ui.skill2'], allow: ['unique'], target: JE_GAL_RYANG, until: 'skill' },
      { lines: ['tut.s.sa-ma-ui.cast', 'tut.s.sa-ma-ui.hold'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('sa-ma-ui', 4, 'sa-ma-ui'), 'tut.s.sa-ma-ui.done', 'tut.s.sa-ma-ui.done2'],
});
