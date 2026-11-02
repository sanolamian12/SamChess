import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import type { RosterEntry, Vec2 } from '@samchess/rules';
import { U, config, entry, say, stage } from './common.ts';

// ── 방통 — 적벽 연환계 (208) ────────────────────────────────────

/**
 * 적벽. 방통 · 황개 둘이 조조 수군의 조조 · 채모 · 장윤 · 우금과 맞선다(2026-11-02 다시 짬 — 기획자).
 *
 * 1. 방통이 「연환계」(모든 적을 한 번, 이동만 하게 조종)를 건다 — 적 넷의 다음 차례를 사람이 둔다.
 * 2. 그 네 차례에 적의 배를 강 한가운데 **부표 넷(2×2)** 자리로 끌어와 사슬로 묶는다.
 * 3. 마지막 배(조조)가 묶이는 순간 **장면**(`scene`)이 돈다 — 황개가 그 앞까지 배를 몰고, 묶인 배 넷이 불길에 휩싸여
 *    HP가 3으로 떨어진다(화계 성공). 엔진의 규칙이 아니라 이야기의 한 장면이라 의도로 두지 않는다(`applyTutorialScene`).
 * 4. 불길에 휩싸인 배는 움직이지 못한다(`enemy: 'idle'`) — 황개가 한 대씩 쳐서 모두 쓰러뜨리면 이긴다(적 전멸).
 *
 * 조조는 King이 아니다(조홍의 자리 · Pawn) — King이면 조조 한 사람을 쓰러뜨리는 순간 판이 끝나 「모두 불태운다」가 안 선다.
 * 적에 King이 없으니 이기는 길은 전멸 하나다(목표를 따로 안 적는다 — 전투 선택 화면이 「적 전멸」로 적는다).
 * 적 넷은 첫 WT 10 · 12 · 14 · 16으로 방통(0) 바로 뒤에 서서, 방통의 기술이 그들의 첫 차례를 통째로 가져간다.
 * 황개는 Lv7(AT 4) — 불길이 남긴 HP 3을 한 대에 끝낸다.
 */
const BANG_TONG = U('P1-Pawn');
const HWANG_GAE = U('P1-Queen');
const CHAE_MO = U('P2-Rock');
const JANG_YUN = U('P2-Bishop');
const U_GEUM = U('P2-Knight');
const JO_JO = U('P2-Pawn');

/** 강 한가운데 부표 넷 — 판(25 × 15)의 가운데 2×2 */
const BUOYS: Vec2[] = [{ x: 12, y: 7 }, { x: 13, y: 7 }, { x: 12, y: 8 }, { x: 13, y: 8 }];

const AT = (n: number): Pick<RosterEntry, 'statPicks'> => ({ statPicks: Array.from({ length: n }, () => 'at' as const) });
/** 묶인 배 하나를 부표로 끌어오는 차례 */
const drag = (unit: ReturnType<typeof U>, to: Vec2, lines: GuideTurn['phases'][number]['lines']): GuideTurn =>
  ({ unit, phases: [{ lines: [...lines, 'tut.go.move'], allow: ['move'], moveTo: to, until: 'moved' }] });
/** 방통은 지켜본다 — [대기] */
const wait = (lines: GuideTurn['phases'][number]['lines'] = []): GuideTurn =>
  ({ unit: BANG_TONG, phases: [{ lines, allow: ['endTurn'] }] });
/** 황개가 한 척씩 친다 */
const strike = (lines: GuideTurn['phases'][number]['lines'] = []): GuideTurn =>
  ({ unit: HWANG_GAE, phases: [{ lines, allow: ['move', 'attack'] }] });

export const bangTong = (): TutorialStage[] => stage('bang-tong', {
  enemy: 'idle',
  buoys: BUOYS,
  config: config('bang-tong', {
    P1: [entry('bang-tong', 'Pawn', 3), entry('hwang-gae', 'Queen', 7, { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp'] })],
    P2: [
      entry('chae-mo', 'Rock', 5, AT(4)), entry('jang-yun', 'Bishop', 5, AT(4)),
      entry('u-geum', 'Knight', 5, AT(4)), entry('jo-jo', 'Pawn', 5, AT(4)),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }, { x: 12, y: 10 }],
      P2: [{ x: 9, y: 8 }, { x: 15, y: 5 }, { x: 15, y: 7 }, { x: 12, y: 6 }],
    },
    overrides: {
      P1: [{ wt: 0 }, { wt: 30 }],
      P2: [{ wt: 10 }, { wt: 12 }, { wt: 14 }, { wt: 16 }],
    },
    startSp: { P1: 6, P2: 0 },
    // 황개(불을 지를 사람)를 잃으면 진다. 이기는 길은 적 전멸(목표 없음 = 기본)
    goals: { lose: [{ kind: 'unitLost', unit: HWANG_GAE }] },
  }),
  scene: {
    after: JO_JO,
    move: { unit: HWANG_GAE, to: { x: 12, y: 9 } },
    burn: { units: [CHAE_MO, JANG_YUN, U_GEUM, JO_JO], hp: 3 },
  },
  guide: [
    { unit: BANG_TONG, phases: [
      { lines: ['tut.s.bang-tong.intro', 'tut.s.bang-tong.intro2', say('bang-tong', 1, 'jo-jo'), say('bang-tong', 2, 'bang-tong'), 'tut.s.bang-tong.skill', 'tut.s.bang-tong.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.bang-tong.chained', 'tut.s.bang-tong.chained2'], allow: ['endTurn'] },
    ] },
    // 연환계로 묶인 적 넷의 차례 — 사람이 대신 움직인다(이동만, 치지 못한다). 한 척씩 부표 자리로
    drag(CHAE_MO, { x: 12, y: 8 }, ['tut.s.bang-tong.drag', 'tut.s.bang-tong.buoy']),
    drag(JANG_YUN, { x: 13, y: 7 }, []),
    drag(U_GEUM, { x: 13, y: 8 }, []),
    drag(JO_JO, { x: 12, y: 7 }, ['tut.s.bang-tong.last']),
    // 장면 — 황개가 배를 몰고 들어와 불을 지른다. 불길이 남긴 HP 3을 한 대씩
    strike(['tut.s.bang-tong.fire', say('bang-tong', 3, 'hwang-gae'), 'tut.s.bang-tong.strike']),
    // 방통의 차례는 지켜보기만 — 불길 속의 배는 황개가 한 척씩 끝낸다
    wait(['tut.s.bang-tong.watch']), strike(), wait(), strike(), wait(), strike(),
  ] satisfies GuideTurn[],
  outro: [say('bang-tong', 4, 'bang-tong'), 'tut.s.bang-tong.done', 'tut.s.bang-tong.done2'],
});
