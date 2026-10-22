/**
 * 기본 튜토리얼 세 판의 **판 짜임** — 누가 · 어디 · 몇 HP로 서는가 (`Design/튜토리얼_시나리오_초안.md` §2 · §3 · §3b).
 *
 * 장수는 **데이터에 고정**이다(2026-10-22 기획자) — 계정의 카드와 무관하게 언제나 같은 연출이라, 이 파일은
 * `PlayerProfile`을 받지 않는다. 시드도 고정이다: 사람의 수가 안내대로 정해져 있으므로 **판 전체가 결정적**이고,
 * 크리티컬 같은 굴림도 매번 같은 결과가 난다 — 회귀가 「안내대로 두면 이긴다」를 판마다 확인한다.
 *
 * 안내 문장 · 강조는 화면(client)의 몫이다. 여기는 `lesson` 열쇠로 그 자리를 가리킬 뿐이다.
 */

import type { BattleConfig, OfficerId, PieceType, RosterEntry, TacticId, Vec2 } from '@samchess/rules';
import { banditOfficerId } from '@samchess/rules';
import type { BasicTutorialId } from './tutorial.ts';

/** 튜토리얼 판 하나 */
export interface TutorialStage {
  /** 화면이 안내 문장을 고르는 열쇠 — `basic-1.King` 꼴 */
  readonly lesson: string;
  readonly config: BattleConfig;
  /**
   * 적의 차례 — `idle`은 곧장 턴을 넘긴다(허수아비), `standard`는 기준 AI(`takeTurn`)다.
   * 시간 흐름 · 적의 행동은 기본 3에서 처음 보여 준다.
   */
  readonly enemy: 'idle' | 'standard';
  /**
   * 정해 둔 이동 칸 (기본 1, 2026-10-22 기획자) — [이동]에서 이 칸 하나만 누를 수 있다.
   * 엉뚱한 칸으로 가 공격이 안 닿는 일이 없게. 없으면 마음대로 간다.
   */
  readonly moveTo?: Vec2;
}

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

const basic1 = (): TutorialStage[] => PIECE_LESSONS.map(({ piece, from, to, enemy }) => ({
  lesson: `basic-1.${piece}`,
  enemy: 'idle',
  moveTo: to,
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
const basic2 = (): TutorialStage[] => [{
  lesson: 'basic-2',
  enemy: 'idle',
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
const basic3 = (): TutorialStage[] => [{
  lesson: 'basic-3',
  enemy: 'standard',
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
