/**
 * 기본 튜토리얼 세 판의 **판 짜임** — 누가 · 어디 · 몇 HP로 서는가 (`Design/튜토리얼_시나리오_초안.md` §2 · §3 · §3b).
 *
 * 장수는 **데이터에 고정**이다(2026-10-22 기획자) — 계정의 카드와 무관하게 언제나 같은 연출이라, 이 파일은
 * `PlayerProfile`을 받지 않는다. 시드도 고정이다: 사람의 수가 안내대로 정해져 있으므로 **판 전체가 결정적**이고,
 * 크리티컬 같은 굴림도 매번 같은 결과가 난다 — 회귀가 「안내대로 두면 이긴다」를 판마다 확인한다.
 *
 * 안내 문장 · 강조는 화면(client)의 몫이다. 여기는 `lesson` 열쇠로 그 자리를 가리킬 뿐이다.
 */

import type { BattleConfig, OfficerId, PieceType, RosterEntry, TacticId, UnitId, Vec2 } from '@samchess/rules';
import { banditOfficerId } from '@samchess/rules';
import type { BasicTutorialId } from './tutorial.ts';

/** 안내가 켜 두는 명령 — 명령 판 여섯 칸 + 고유기술 물음 */
export type GuideCommand = 'move' | 'attack' | 'meditate' | 'castTactic' | 'useItem' | 'endTurn' | 'unique';

/**
 * 차례 안의 한 단계 — 안내를 띄우고(닫으면) **켜 둔 명령만** 누를 수 있다(2026-10-22 기획자: 튜토리얼 중에는
 * 스토리 밖의 명령을 막는다). `until: 'moved'`면 이동을 마치는 순간 다음 단계로, 없으면 차례가 끝날 때까지 간다.
 */
export interface GuidePhase {
  /** 이 단계 앞에 띄울 안내 — 화면의 문구 열쇠(`tut.` 이름 공간), 차례대로 한 장씩 */
  readonly lines: readonly string[];
  readonly allow: readonly GuideCommand[];
  /** [이동]에서 누를 수 있는 **단 한 칸** (기본 1 확정, 기본 2도 같은 방식) — 엉뚱한 칸으로 가 공격이 안 닿는 일이 없게 */
  readonly moveTo?: Vec2;
  /** 책략 · 아이템을 걸 대상 — 조준에서 이 장수만 고를 수 있다 */
  readonly target?: UnitId;
  readonly until?: 'moved';
}

/** 사람의 차례 하나 — 그 차례의 장수와 단계들. 대본이 다 끝나면 나머지 차례는 모든 명령이 켜진다 */
export interface GuideTurn {
  readonly unit: UnitId;
  readonly phases: readonly GuidePhase[];
}

/** 튜토리얼 판 하나 */
export interface TutorialStage {
  /** 화면이 안내 문장을 고르는 열쇠의 머리 — `basic-1.King` 꼴 */
  readonly lesson: string;
  readonly config: BattleConfig;
  /**
   * 적의 차례 — `idle`은 곧장 턴을 넘긴다(허수아비), `standard`는 기준 AI(`takeTurn`)다.
   * 시간 흐름 · 적의 행동은 기본 3에서 처음 보여 준다.
   */
  readonly enemy: 'idle' | 'standard';
  /** 사람의 차례마다의 대본 — 회귀가 **이 대본 그대로** 두어 이기는지 본다 */
  readonly guide: readonly GuideTurn[];
  /** 이 판을 이기면 띄울 안내 */
  readonly outro: readonly string[];
}

const U = (id: string): UnitId => id as UnitId;

/** 사람은 언제나 남쪽(P1)이다 — 대전 · 도적떼와 같다 */
export const TUTORIAL_HUMAN_SIDE = 'P1' as const;

const SEED = 20261022;
const SON_GYEON = 'son-gyeon' as OfficerId;
const GA_HU = 'ga-hu' as OfficerId;
const MA_DEUNG = 'ma-deung' as OfficerId;
const JEUNG_POK = 'jeung-pok' as TacticId;
const TANG_YAK = 'tang-yak';

const entry = (officer: OfficerId, piece: PieceType, extra: Partial<RosterEntry> = {}): RosterEntry =>
  ({ officer, piece, level: 1, statPicks: [], tactics: [], ...extra });

/** 도적 — 명단(`OFFICERS`) 밖 전투원이다. 넣으면 AI 상대 풀 · 가챠 · 랭킹이 뽑는다 */
const bandit = (piece: PieceType): RosterEntry => entry(banditOfficerId(piece), piece);

const config = (id: string, rosters: BattleConfig['rosters'], setup: NonNullable<BattleConfig['setup']>): BattleConfig => ({
  matchId: `tutorial-${id}`,
  seed: SEED,
  // 튜토리얼에서 `mode`는 뜻이 없다 — 보상 · 전적 · 전투력 어디에도 안 들어간다
  mode: '3v3',
  scenario: 'tutorial',
  rosters,
  setup,
});

// ── 기본 1 — 기물 여섯 ──────────────────────────────────────────

/**
 * 9 × 9 판, 손견 하나 vs **HP 1 도적** 하나. 적은 「한 번 이동하면 공격 범위에 들어오는」 칸에 선다 —
 * 이동 → 공격 두 걸음이 꼭 필요하다(제자리에서는 안 닿는다는 것을 회귀가 확인한다).
 */
const PIECE_LESSONS: readonly { piece: PieceType; from: Vec2; to: Vec2; enemy: Vec2 }[] = [
  { piece: 'King', from: { x: 4, y: 6 }, to: { x: 4, y: 5 }, enemy: { x: 4, y: 4 } },
  // Rock — 십자로 멀리 가서 대각으로 친다
  { piece: 'Rock', from: { x: 4, y: 7 }, to: { x: 4, y: 3 }, enemy: { x: 5, y: 2 } },
  // Bishop — 대각으로 멀리 가서 십자로 친다
  { piece: 'Bishop', from: { x: 2, y: 7 }, to: { x: 5, y: 4 }, enemy: { x: 5, y: 3 } },
  // Knight — 앞으로 둘 + 옆으로 하나를 뛰어넘는다
  { piece: 'Knight', from: { x: 4, y: 7 }, to: { x: 5, y: 5 }, enemy: { x: 5, y: 4 } },
  // Queen — 8방향 3칸, 위아래만 친다
  { piece: 'Queen', from: { x: 4, y: 7 }, to: { x: 4, y: 4 }, enemy: { x: 4, y: 3 } },
  // Pawn — 한 칸 가서 마름모 2칸 거리를 쏜다
  { piece: 'Pawn', from: { x: 4, y: 7 }, to: { x: 5, y: 6 }, enemy: { x: 5, y: 4 } },
];

const basic1 = (): TutorialStage[] => PIECE_LESSONS.map(({ piece, from, to, enemy }, i) => ({
  lesson: `basic-1.${piece}`,
  enemy: 'idle',
  guide: [{
    unit: U(`P1-${piece}`),
    phases: [
      // 첫 판(King)만 머리말 — 판 · 차례 · 승패를 먼저 말한다
      { lines: [...(i === 0 ? ['tut.b1.welcome', 'tut.b1.board'] : []), `tut.b1.${piece}.move`], allow: ['move'], moveTo: to, until: 'moved' },
      { lines: [`tut.b1.${piece}.attack`], allow: ['attack'] },
    ],
  }],
  outro: i === PIECE_LESSONS.length - 1 ? ['tut.b1.done'] : [`tut.b1.${piece}.done`],
  config: config(`basic-1-${piece}`, { P1: [entry(SON_GYEON, piece)], P2: [bandit('King')] }, {
    board: { x: 9, y: 9 },
    positions: { P1: [from], P2: [enemy] },
    overrides: { P1: [{ wt: 0 }], P2: [{ hp: 1 }] },
  }),
}));

// ── 기본 2 — 증폭 · 탕약 · 협동 ─────────────────────────────────

/**
 * 2:2. 가후(Lv2, 증폭, 탕약)가 돕고 손견이 친다. 도적 HP는 **손견의 보통 공격 × 2**(4) — 보통 한 대로는 안 쓰러지고
 * 크리(×2) 한 대면 쓰러진다. 손견은 **다친 채**(HP 4) 시작해 탕약을 쓸 이유가 있다.
 * 차례는 가후 → 손견으로 시작한다(첫 WT). 둘의 통솔이 같아(81) 그 뒤로도 번갈아 돈다.
 */
const GA_HU_UNIT = U('P1-Bishop');
const SON_UNIT = U('P1-Knight');

const basic2 = (): TutorialStage[] => [{
  lesson: 'basic-2',
  enemy: 'idle',
  // 이동 칸은 엔진으로 훑어 고른 것이다 — 회귀가 이 대본 그대로 두어 이기는지 본다
  guide: [
    { unit: GA_HU_UNIT, phases: [{ lines: ['tut.b2.welcome', 'tut.b2.tactic'], allow: ['castTactic'], target: SON_UNIT }] },
    { unit: SON_UNIT, phases: [
      { lines: ['tut.b2.son.move'], allow: ['move'], moveTo: { x: 3, y: 4 }, until: 'moved' },
      { lines: ['tut.b2.son.attack'], allow: ['attack'] },
    ] },
    { unit: GA_HU_UNIT, phases: [
      { lines: ['tut.b2.item', 'tut.b2.item.move'], allow: ['move'], moveTo: { x: 4, y: 5 }, until: 'moved' },
      { lines: ['tut.b2.item.use'], allow: ['useItem'], target: SON_UNIT },
    ] },
    { unit: SON_UNIT, phases: [
      { lines: ['tut.b2.son.approach'], allow: ['move'], moveTo: { x: 4, y: 2 }, until: 'moved' },
      { lines: [], allow: ['endTurn'] },
    ] },
    { unit: GA_HU_UNIT, phases: [{ lines: ['tut.b2.again'], allow: ['castTactic'], target: SON_UNIT }] },
    { unit: SON_UNIT, phases: [
      { lines: ['tut.b2.finish'], allow: ['move'], moveTo: { x: 6, y: 3 }, until: 'moved' },
      { lines: [], allow: ['attack'] },
    ] },
  ],
  outro: ['tut.b2.done'],
  config: config('basic-2', {
    P1: [
      entry(GA_HU, 'Bishop', { level: 2, statPicks: ['mp'], tactics: [JEUNG_POK], held: TANG_YAK }),
      entry(SON_GYEON, 'Knight'),
    ],
    P2: [bandit('Queen'), bandit('Rock')],
  }, {
    board: { x: 9, y: 9 },
    positions: { P1: [{ x: 2, y: 7 }, { x: 4, y: 6 }], P2: [{ x: 3, y: 3 }, { x: 6, y: 2 }] },
    overrides: { P1: [{ wt: 0 }, { wt: 1, hp: 4 }], P2: [{ hp: 4 }, { hp: 4 }] },
  }),
}];

// ── 기본 3 — 일당백 · 시간 · SP ─────────────────────────────────

/**
 * 1:1. 마등(일당백 — SP 5, 시전 지연 30, 1.9일 동안 크리 100%)이 도적 두목을 쓰러뜨린다. 적은 **처음으로 움직이고 친다**.
 * SP는 3에서 시작한다 — 0이면 5일을 기다려야 해서 1:1 판이 늘어진다(2026-10-22 기획자).
 *
 * **판은 7 × 7이다** — 11 × 11에서는 도적 두목(King, 한 칸씩)이 닿기 전에 일당백(1.9일)이 끝났다. 엔진으로 자리를 훑어
 * 고른 짜임: 1일째 기다림 → 2일째 시전 → 그사이 두목이 다가와 한 대 → 시전이 터진 뒤 두 차례 크리로 HP 8을 깎는다.
 */
const MA_UNIT = U('P1-Knight');

const basic3 = (): TutorialStage[] => [{
  lesson: 'basic-3',
  enemy: 'standard',
  // 적이 움직이므로 칸을 정하지 않는다 — 대본이 끝난 뒤의 차례는 모든 명령이 켜진다
  guide: [
    { unit: MA_UNIT, phases: [{ lines: ['tut.b3.welcome', 'tut.b3.time', 'tut.b3.sp', 'tut.b3.wait'], allow: ['endTurn'] }] },
    { unit: MA_UNIT, phases: [{ lines: ['tut.b3.ready', 'tut.b3.cast'], allow: ['unique'] }] },
    { unit: MA_UNIT, phases: [{ lines: ['tut.b3.crit'], allow: ['move', 'attack', 'endTurn'] }] },
  ],
  outro: ['tut.b3.done', 'tut.b3.next'],
  config: config('basic-3', { P1: [entry(MA_DEUNG, 'Knight')], P2: [bandit('King')] }, {
    board: { x: 7, y: 7 },
    positions: { P1: [{ x: 3, y: 5 }], P2: [{ x: 3, y: 3 }] },
    // 크리(4) 두 대 = 8 — 보통 공격으로는 네 대가 든다
    overrides: { P2: [{ hp: 8 }] },
    startSp: { P1: 3 },
  }),
}];

/** 한 튜토리얼의 판들 — 기본 1은 여섯 판을 **차례로** 잇는다(화면이 이어 붙인다) */
export function tutorialStages(id: BasicTutorialId): TutorialStage[] {
  switch (id) {
    case 'basic-1': return basic1();
    case 'basic-2': return basic2();
    case 'basic-3': return basic3();
  }
}
