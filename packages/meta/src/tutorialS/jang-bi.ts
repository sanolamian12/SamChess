import type { Vec2 } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { BOARD, U, config, entry, say, stage } from './common.ts';

// ── 장비 — 장판교 (208) ─────────────────────────────────────────

/**
 * 조운이 유비의 아들 아두를 품고 조조의 대군을 뚫고 나온다. 장비는 장판교 앞에서 기다리고, 유비는 강 건너에서 기다린다
 * (2026-11-10 기획자 — 옛 판은 「장비 혼자 2.8일 버티기」였다). **조운이 부표(T13)까지 살아서 가면 이긴다**(`reach`).
 *
 * 강(8줄)은 다리 한 칸(M8)만 남기고 처음부터 막혀 있다(`ScenarioSetup.terrain` — 그림 없는 수계, 지도에 강이 그려져 있다).
 * 조운(Knight)은 M4 → L6 → M8(다리) → N10으로 건너고, 장비가 「장판하뢰」(모든 적 WT +1.5일)로 조조군을 얼린 뒤 M9로 건넌다.
 * 고함이 풀리기 직전인 장비의 다음 차례에 다리를 부숴(`scene.terrain` — 바위) 8줄이 통째로 막힌다. 깨어난 조조군은 강가까지 와서 멈춘다.
 * 조운은 O12 → Q13으로 유비에게 간다(11-10 기획자).
 *
 * 적의 기물은 Knight를 뺐다 — Knight는 칸을 뛰어넘어 강을 건넌다. 장료의 「장료지제」(맵 전체 공격)는 이야기 밖이라 막았다.
 * 유비(King)는 판에 서 있기만 한다(첫 WT 5000 — 판이 끝날 때까지 차례가 안 온다).
 */
const JANG_BI = U('P1-Rock');
const JO_UN = U('P1-Knight');
/** 장판교 — 강(8줄)에서 유일하게 건널 수 있는 칸 */
const BRIDGE: Vec2 = { x: 12, y: 7 };
/** 조운이 닿을 곳 — 유비 바로 앞(Q13, 11-10 기획자) */
const GOAL: Vec2 = { x: 16, y: 12 };
/** 강 — 다리를 뺀 8줄 전부 */
const RIVER = Array.from({ length: BOARD.x }, (_, x) => ({ x, y: BRIDGE.y })).filter((p) => p.x !== BRIDGE.x);

export const jangBi = (): TutorialStage[] => stage('jang-bi', {
  config: config('jang-bi', {
    P1: [entry('yu-bi', 'King', 5), entry('jang-bi', 'Rock', 5), entry('jo-un', 'Knight', 5)],
    P2: [
      entry('jo-jo', 'King', 5), entry('jang-ryo', 'Queen', 3), entry('seo-hwang', 'Rock', 3),
      entry('u-geum', 'Pawn', 3), entry('ha-hu-geol', 'Bishop', 3),
    ],
  }, {
    positions: {
      P1: [{ x: 16, y: 13 }, { x: 12, y: 6 }, { x: 12, y: 3 }],
      P2: [{ x: 12, y: 1 }, { x: 10, y: 2 }, { x: 14, y: 2 }, { x: 11, y: 1 }, { x: 13, y: 1 }],
    },
    overrides: {
      P1: [{ wt: 5000 }, { wt: 230 }, { wt: 0, hp: 15 }],
      // 장료의 「장료지제」(맵 전체 공격)는 이야기 밖이라 막는다
      P2: [{ wt: 40 }, { wt: 50, uniqueSkillUses: 0 }, { wt: 60 }, { wt: 70 }, { wt: 80 }],
    },
    startSp: { P1: 6, P2: 0 },
    // 강 — 지도에 이미 그려져 있어 그림 없이 판정만(11-10 기획자: 물 아이콘이 예쁘지 않았다)
    terrain: RIVER.map((pos) => ({ pos, terrain: 'water' as const, hidden: true })),
    goals: {
      win: [{ kind: 'reach', unit: JO_UN, area: { x0: GOAL.x, x1: GOAL.x, y0: GOAL.y, y1: GOAL.y } }],
      lose: [{ kind: 'unitLost', unit: JO_UN }, { kind: 'unitLost', unit: JANG_BI }],
    },
  }),
  buoys: [GOAL],
  // 장비가 고함을 쓴 **다음** 차례(장판하뢰가 풀리기 직전)에 다리를 부순다 — 바위가 다리 칸에 놓인다(11-10 기획자)
  scene: { after: JANG_BI, afterTurn: 2, terrain: { at: [BRIDGE], terrain: 'rock' } },
  guide: [
    { unit: JO_UN, phases: [
      { lines: ['tut.s.jang-bi.intro', 'tut.s.jang-bi.intro2', say('jang-bi', 1, 'jo-jo'), say('jang-bi', 2, 'jo-un'), 'tut.s.jang-bi.run', 'tut.go.move'], allow: ['move'], moveTo: { x: 11, y: 5 }, until: 'moved' },
    ] },
    // 조운이 다리에 서면 장비와 맞닿는다 — 그 차례 뒤 장비가 한마디
    { unit: JO_UN, phases: [
      { lines: ['tut.s.jang-bi.bridge', 'tut.go.move'], allow: ['move'], moveTo: BRIDGE, until: 'moved' },
    ], after: [say('jang-bi', 3, 'jang-bi')] },
    { unit: JO_UN, phases: [
      { lines: ['tut.s.jang-bi.cross', 'tut.go.move'], allow: ['move'], moveTo: { x: 13, y: 9 }, until: 'moved' },
    ] },
    { unit: JANG_BI, phases: [
      { lines: ['tut.s.jang-bi.turn', say('jang-bi', 4, 'jang-bi'), 'tut.s.jang-bi.skill', 'tut.s.jang-bi.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.jang-bi.roared', say('jang-bi', 5, 'ha-hu-geol'), 'tut.s.jang-bi.follow', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 8 }, until: 'moved' },
      { lines: ['tut.s.jang-bi.wait'], allow: ['endTurn'] },
    ] },
    { unit: JO_UN, phases: [{ lines: ['tut.s.jang-bi.home', 'tut.go.move'], allow: ['move'], moveTo: { x: 14, y: 11 }, until: 'moved' }] },
    { unit: JANG_BI, phases: [{ lines: ['tut.s.jang-bi.boulder'], allow: ['endTurn'] }], after: ['tut.s.jang-bi.blocked'] },
    { unit: JO_UN, phases: [{ lines: ['tut.s.jang-bi.last', 'tut.go.move'], allow: ['move'], moveTo: GOAL, until: 'moved' }] },
  ] satisfies GuideTurn[],
  outro: [say('jang-bi', 6, 'jo-un'), 'tut.s.jang-bi.throw', say('jang-bi', 7, 'yu-bi'), say('jang-bi', 8, 'jo-un'), 'tut.s.jang-bi.done', 'tut.s.jang-bi.done2'],
});
