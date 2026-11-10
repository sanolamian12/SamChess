import type { Vec2 } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { O, U, config, entry, say, stage } from './common.ts';

// ── 제갈량 — 적벽 (208) ──────────────────────────────────────────

/**
 * 동남풍이 이미 분다(2026-11-10 기획자 — 옛 판은 정봉의 「일격필살」을 되살려 조조 하나를 치는 판이었다. 화선은 정사 · 연의 모두
 * 황개의 것이라 다시 짰다). 황개가 화선을 몰아 M4에 닿고 한마디 하면 조조 함대(H2 ~ Q3 두 줄)에 불이 붙는다. 황개 · 주태 · 능통이
 * 차례대로 「용맹전진」(1.9일 받는 피해 절반)을 걸고 조조 · 장료 · 허저 · 우금(Bishop) · 악진(Pawn — Bishop일 때 주유 쪽으로 빠져나가듯 내달렸다)과 3 : 5로 맞붙는다. 기술이 풀릴 즈음
 * 제갈량이 「차동풍」(쓴 고유기술을 되살린다)을 쓰고 셋이 다시 건다. 그 뒤 부표(J13)가 서고 제갈량이 거기 닿으면 이긴다(`reach`).
 * 끝 장면 — 정봉이 L14에 나타났다가, 조운이 K13에 나타나 제갈량과 함께 제자리에서 흐려지며 떠난다(`finale.steps`).
 *
 * 엔진으로 훑어 골랐다 — 적 Lv9(공격 5 · HP 3 몫)는 불길 속에서 화선 곁의 황개부터 친다. 두 번째 용맹전진이
 * 있으면 셋이 버텨 제갈량이 닿고(시각 484, 황개 HP 9/40), 차동풍만 쓰고 다시 걸지 않으면 황개가 시각 469에 쓰러진다.
 *
 * **SP는 장면이 채운다** — 용맹전진 셋(15) + 차동풍(6) + 다시 셋(15)은 36인데 상한은 25(5명 × 5)이고 하루 1씩 찬다. 차동풍을 쓴 차례 뒤
 * 「칠성단의 바람이 장수들의 기세를 되살린다」로 SP를 15로 채운다(`scene.sp`). 적의 고유기술(장료지제 · 단기도강 · 일격필살)은 막았다 —
 * 이야기 밖에서 판이 갈리지 않게. 주유(U7, King — 11-10 기획자가 주태와 바꿨다)는 서 있기만 한다(첫 WT 5000). 넷 중 누가 쓰러져도 진다.
 */
const JE_GAL_RYANG = U('P1-Queen');
const HWANG_GAE = U('P1-Rock');
const JU_TAE = U('P1-Pawn');
const NEUNG_TONG = U('P1-Knight');
/** 제갈량이 닿을 곳 — J13 (두 번째 용맹전진이 풀릴 즈음 닿는다, 11-10 기획자 — 처음엔 N14였다) */
const GOAL: Vec2 = { x: 9, y: 12 };
/** 화선의 불 — H2 ~ Q3 두 줄 */
const FIRE: Vec2[] = [1, 2].flatMap((y) => Array.from({ length: 10 }, (_, i) => ({ x: 7 + i, y })));
const hp = (n: number, at = 0) => ({ statPicks: [...Array.from({ length: n }, () => 'hp' as const), ...Array.from({ length: at }, () => 'at' as const)] });
/** 조조군 — 공격 5 · HP 3 */
const foe = { statPicks: [...Array.from({ length: 5 }, () => 'at' as const), ...Array.from({ length: 3 }, () => 'hp' as const)] };
/** 칸을 정하지 않은 싸움 차례 */
const brawl = (unit: ReturnType<typeof U>): GuideTurn => ({ unit, phases: [{ lines: [], allow: ['move', 'attack', 'endTurn'] }] });
/** 용맹전진을 거는 차례 — 걸고 나서 싸운다 */
const brave = (unit: ReturnType<typeof U>, lines: GuideTurn['phases'][number]['lines']): GuideTurn => ({ unit, phases: [
  { lines, allow: ['unique'], until: 'skill' },
  { lines: [], allow: ['move', 'attack', 'endTurn'] },
] });
const walk = (to: Vec2, lines: GuideTurn['phases'][number]['lines'] = []): GuideTurn =>
  ({ unit: JE_GAL_RYANG, phases: [{ lines, allow: ['move'], moveTo: to, until: 'moved' }] });

export const jeGalRyang = (): TutorialStage[] => stage('je-gal-ryang', {
  config: config('je-gal-ryang', {
    P1: [
      entry('je-gal-ryang', 'Queen', 5), entry('hwang-gae', 'Rock', 7, hp(6)), entry('ju-tae', 'Pawn', 5),
      entry('neung-tong', 'Knight', 7, hp(6)), entry('ju-yu', 'King', 5),
    ],
    P2: [
      entry('jo-jo', 'King', 9, foe), entry('jang-ryo', 'Queen', 9, foe), entry('heo-jeo', 'Rock', 9, foe),
      entry('u-geum', 'Bishop', 9, foe), entry('ak-jin', 'Pawn', 9, foe),
    ],
  }, {
    positions: {
      // 제갈량은 칠성단(D13), 황개 · 주태 · 능통은 6줄, 주유는 U7
      P1: [{ x: 3, y: 12 }, { x: 12, y: 5 }, { x: 11, y: 5 }, { x: 13, y: 5 }, { x: 20, y: 6 }],
      P2: [{ x: 12, y: 1 }, { x: 10, y: 2 }, { x: 14, y: 2 }, { x: 11, y: 1 }, { x: 13, y: 1 }],
    },
    overrides: {
      P1: [{ wt: 290 }, { wt: 0 }, { wt: 120 }, { wt: 130 }, { wt: 5000 }],
      P2: [60, 70, 80, 90, 100].map((wt) => ({ wt, uniqueSkillUses: 0 })),
    },
    startSp: { P1: 21, P2: 0 },
    goals: {
      win: [{ kind: 'reach', unit: JE_GAL_RYANG, area: { x0: GOAL.x, x1: GOAL.x, y0: GOAL.y, y1: GOAL.y } }],
      lose: [{ kind: 'unitLost', unit: JE_GAL_RYANG }, { kind: 'unitLost', unit: HWANG_GAE }, { kind: 'unitLost', unit: NEUNG_TONG }, { kind: 'unitLost', unit: JU_TAE }],
    },
  }),
  // 우금(Bishop)은 대각선으로 멀리 뛰어 King(주유) 쪽으로 빠져나갔다 — 제자리에서 곁의 적만 친다(11-10 기획자)
  hold: [U('P2-Bishop')],
  scene: [
    // 황개가 M4에 닿아 차례를 마치면 조조 함대에 불이 붙는다
    { after: HWANG_GAE, terrain: { at: FIRE, terrain: 'fire' } },
    // 차동풍을 쓴 차례 뒤 — 칠성단의 바람이 장수들의 기세(SP)를 되살린다
    { after: JE_GAL_RYANG, sp: 15 },
  ],
  guide: [
    { unit: HWANG_GAE, phases: [
      { lines: ['tut.s.je-gal-ryang.intro', 'tut.s.je-gal-ryang.intro2', say('je-gal-ryang', 1, 'ju-yu'), 'tut.s.je-gal-ryang.sail', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 3 }, until: 'moved' },
      { lines: [say('je-gal-ryang', 2, 'hwang-gae'), 'tut.s.je-gal-ryang.ignite'], allow: ['endTurn'] },
    ], after: ['tut.s.je-gal-ryang.fire', say('je-gal-ryang', 3, 'jo-jo')] },
    brave(HWANG_GAE, ['tut.s.je-gal-ryang.skill', 'tut.s.je-gal-ryang.skill2']),
    brave(JU_TAE, ['tut.s.je-gal-ryang.jutae']),
    brave(NEUNG_TONG, ['tut.s.je-gal-ryang.neungtong', 'tut.s.je-gal-ryang.brawl']),
    brawl(JU_TAE), brawl(HWANG_GAE), brawl(NEUNG_TONG),
    { unit: JE_GAL_RYANG, phases: [
      { lines: ['tut.s.je-gal-ryang.wear', 'tut.s.je-gal-ryang.wind', 'tut.s.je-gal-ryang.wind2'], allow: ['unique'], until: 'skill' },
      // 바람을 빌려 주고 떠날 채비 — 뒤에 주유가 정봉을 보내는 것을 미리 아는 듯이(11-10 기획자)
      { lines: [say('je-gal-ryang', 9, 'je-gal-ryang'), 'tut.s.je-gal-ryang.pass'], allow: ['endTurn'] },
    ], after: ['tut.s.je-gal-ryang.gust'] },
    brave(JU_TAE, ['tut.s.je-gal-ryang.again']),
    brave(HWANG_GAE, []),
    brave(NEUNG_TONG, []),
    // 부표가 서고 주유가 정봉에게 사람을 보낸다 — 주유를 비추고 말한 뒤, 부표를 비추고, 창을 닫으면 제갈량에게 돌아온다
    { ...walk({ x: 6, y: 12 }, [say('je-gal-ryang', 4, 'ju-yu', undefined, true), { note: 'tut.s.je-gal-ryang.escape', focus: GOAL }, 'tut.go.move']), buoys: [GOAL] },
    brawl(JU_TAE), brawl(HWANG_GAE),
    walk(GOAL, ['tut.s.je-gal-ryang.last']),
  ] satisfies GuideTurn[],
  finale: {
    appear: [],
    steps: [
      { appear: [{ officer: O('jeong-bong'), piece: 'Knight', at: { x: 11, y: 13 } }], lines: [say('je-gal-ryang', 5, 'jeong-bong', true)] },
      {
        appear: [{ officer: O('jo-un'), piece: 'Knight', at: { x: 10, y: 12 } }],
        lines: [say('je-gal-ryang', 6, 'jo-un', false), say('je-gal-ryang', 7, 'je-gal-ryang')],
        // 제자리에서 흐려지며 떠난다(11-10 기획자 — 왼쪽으로 걸어 나가던 것을 바꿨다)
        vanish: [{ unit: JE_GAL_RYANG }, { officer: O('jo-un') }],
      },
    ],
  },
  outro: [say('je-gal-ryang', 8, 'jeong-bong', true), 'tut.s.je-gal-ryang.done', 'tut.s.je-gal-ryang.done2'],
});
