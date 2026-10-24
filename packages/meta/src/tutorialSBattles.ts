/**
 * S급 튜토리얼 판 — 그 장수의 고유기술을 써 보는 판 (`Design/튜토리얼_시나리오_초안.md` §4, 2026-10-24~).
 *
 * 판은 **전부 25 × 15**다(도적떼 판과 같은 크기, 2026-10-22 확정) — 지도(`public/ui/tutorial/{id}.jpg`)가 판마다 따로 그려져 있다.
 * 기본 튜토리얼과 같은 틀이다: 장수 · 자리 · 시작 값은 데이터에 고정, 시드 고정, 대본(`guide`)을 그대로 두면 이기는지
 * 회귀(`tutorialSBattles.test.ts`)가 판마다 본다. 대본이 끝난 차례는 모든 명령이 켜진다.
 *
 * 30판은 차례로 선다 — 여기 없는 장수의 판은 목록에서 「준비 중」이다(`tutorialReady`).
 *
 * 이 파일은 `tutorialBattles.ts`를 **값으로** import하지 않는다(그쪽이 이쪽을 부른다 — 타입만 빌린다).
 */

import type { BattleConfig, OfficerId, PieceType, RosterEntry, UnitId, Vec2 } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from './tutorialBattles.ts';

const SEED = 20261024;
const BOARD: Vec2 = { x: 25, y: 15 };

const O = (id: string): OfficerId => id as OfficerId;
const U = (id: string): UnitId => id as UnitId;

const entry = (officer: string, piece: PieceType, level = 1, extra: Partial<RosterEntry> = {}): RosterEntry => ({
  officer: O(officer), piece, level,
  // 성장은 HP로만 — 레벨은 버티는 힘을 맞추는 손잡이다(책략은 판마다 따로 적는다)
  statPicks: Array.from({ length: level - 1 }, () => 'hp' as const),
  tactics: [],
  ...extra,
});

const config = (officer: string, rosters: BattleConfig['rosters'], setup: Omit<NonNullable<BattleConfig['setup']>, 'board'>): BattleConfig => ({
  matchId: `tutorial-s-${officer}`,
  seed: SEED,
  mode: '3v3',
  scenario: 'tutorial',
  rosters,
  setup: { board: BOARD, ...setup },
});

const stage = (officer: string, s: Omit<TutorialStage, 'lesson' | 'map' | 'enemy'> & { enemy?: TutorialStage['enemy'] }): TutorialStage[] =>
  [{ lesson: `s.${officer}`, map: officer, enemy: s.enemy ?? 'standard', ...s }];

// ── 조조 — 청매자주 영웅론 (199, 허도 승상부 정원의 육각정) ────────────────

/**
 * 1:1. 유비가 먼저 「삼고초려」(세 번 맞힌 적을 제 편으로)를 건다 — 시전 지연 30 동안 조조 차례가 끼고(통솔 98 > 91),
 * 「영웅론」으로 **시전을 무산시키고 봉인한다.** 못 막으면 세 대를 맞고 조조가 유비 편이 된다 — 그러면 진다(`unitLost`).
 * 유비 AI는 첫 차례에 삼고초려를 쓴다(SP를 넉넉히 준다 — 엔진으로 확인했다). 첫 WT로 유비를 먼저 세운다.
 */
const JO_JO = U('P1-King');
const YU_BI = U('P2-King');
const joJo = (): TutorialStage[] => stage('jo-jo', {
  config: config('jo-jo', { P1: [entry('jo-jo', 'King', 3)], P2: [entry('yu-bi', 'King')] }, {
    positions: { P1: [{ x: 12, y: 10 }], P2: [{ x: 12, y: 6 }] },
    overrides: { P1: [{ wt: 5 }], P2: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 6 },
    goals: { win: [{ kind: 'killTarget', unit: YU_BI }], lose: [{ kind: 'unitLost', unit: JO_JO }] },
  }),
  guide: [
    { unit: JO_JO, phases: [
      { lines: ['tut.s.jo-jo.intro', 'tut.s.jo-jo.casting', 'tut.s.jo-jo.seal'], allow: ['unique'], target: YU_BI, until: 'skill' },
      { lines: ['tut.s.jo-jo.sealed'], allow: ['move', 'attack', 'endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.jo-jo.done'],
});

// ── 여포 — 호로관 (190) ─────────────────────────────────────────

/**
 * 여포 하나가 「인중여포 마중적토」(맵 어디든 **한 번** 이동 + 2.9일 동안 반경 2칸 적 공격력 절반)로 연합군 진영 한복판에
 * 뛰어들어 적들을 물리친다. 장비의 HP가 **절반 이하**가 되는 순간 판이 끝나고(`hpBelow`), 끝 장면에 유비 · 관우가 나타나
 * 여포가 호로관 쪽으로 물러난다(2026-10-24 기획자 — 자유이동은 한 번이라 걸어 돌아오는 목표를 뺐다).
 *
 * 적은 King이 없다 — 원소가 King이면 쓰러뜨리는 순간 대전 승패(군주 격파)가 먼저 판을 끝낸다. 연합군 장수 셋은 HP를 깎아 두어
 * 한 대에 쓰러진다. 여포는 King(8방향 공격) — 뛰어내린 자리에서 둘레를 다 친다.
 */
const YEO_PO = U('P1-King');
const JANG_BI = U('P2-Queen');
const yeoPo = (): TutorialStage[] => stage('yeo-po', {
  config: config('yeo-po', {
    // 엔진으로 훑어 골랐다 — 연합군 셋을 다 쓰러뜨린 뒤 장비가 절반이 되고, 여포는 HP 절반쯤 남는다(반경 2칸
    // 「공격력 절반」은 2.9일 뒤 풀린다 — 그 뒤 셋에게 둘러싸이면 Lv3 여포는 쓰러졌다)
    P1: [entry('yeo-po', 'King', 6, { statPicks: ['at', 'at', 'hp', 'hp', 'hp'] })],
    P2: [entry('jang-bi', 'Queen', 2), entry('won-so', 'Rock'), entry('gong-son-chan', 'Bishop'), entry('gong-son-wol', 'Knight')],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }],
      P2: [{ x: 12, y: 1 }, { x: 11, y: 4 }, { x: 13, y: 4 }, { x: 12, y: 5 }],
    },
    overrides: { P1: [{ wt: 0 }], P2: [undefined, { hp: 2 }, { hp: 2 }, { hp: 2 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'hpBelow', unit: JANG_BI, pct: 50 }], lose: [{ kind: 'unitLost', unit: YEO_PO }] },
  }),
  guide: [
    { unit: YEO_PO, phases: [
      { lines: ['tut.s.yeo-po.intro', 'tut.s.yeo-po.skill'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.yeo-po.leap'], allow: ['move'], moveTo: { x: 12, y: 4 }, until: 'moved' },
      { lines: ['tut.s.yeo-po.attack'], allow: ['attack'] },
    ] },
    { unit: YEO_PO, phases: [{ lines: ['tut.s.yeo-po.zhangfei'], allow: ['move', 'attack', 'endTurn'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.yeo-po.reinforce', 'tut.s.yeo-po.done'],
  finale: {
    appear: [
      { officer: O('yu-bi'), piece: 'Pawn', at: { x: 9, y: 1 } },
      { officer: O('gwan-u'), piece: 'Rock', at: { x: 15, y: 1 } },
    ],
    retreat: { unit: YEO_PO, to: { x: 12, y: 13 } },
  },
});

/** 판이 선 S급 — 장수 id → 판. 여기 없으면 「준비 중」 */
export const S_STAGES: Readonly<Record<string, () => TutorialStage[]>> = {
  'jo-jo': joJo,
  'yeo-po': yeoPo,
};
