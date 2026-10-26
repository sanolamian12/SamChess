import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import type { RosterEntry } from '@samchess/rules';
import { U, config, entry, say, stage } from './common.ts';

// ── 방통 — 적벽 연환계 (208) ────────────────────────────────────

/**
 * 적벽. 방통 · 황개 둘이 조조 수군의 채모 · 장윤 · 우금 · 조홍과 맞선다. 조조(K)는 북쪽 끝 본진에 있다.
 * **적장 넷을 쓰러뜨리면 이긴다**(`killCount` 4) — 조조를 쓰러뜨려도 군주 격파로 이기지만, 본진에서 나오지 않는다.
 * 황개가 쓰러지면 진다(`unitLost` — 황개는 불을 지를 사람이다). 방통 퇴각으로도 지던 것은 2026-10-26에 뺐다(패배는 핵심 한 사람).
 *
 * 「연환계」(모든 적을 한 번, 이동만 하게 조종)는 적 수군의 **다음 차례 하나를 통째로 빼앗는다** — 사슬로 묶인 배처럼
 * 움직이기만 하고 치지 못한다. 적 넷은 첫 WT 10 · 12 · 14 · 16으로 방통(0) 바로 뒤에 서게 해, 기술이 없으면 그대로 몰려와
 * 황개를 친다. 쓰면 그 차례가 「다가오기만」이 되고, 황개(첫 WT 30)가 먼저 친다.
 *
 * 맞춘 값(엔진으로 적 레벨 · HP · 황개 HP를 훑었다): 적 넷은 Lv5(공격만 — AT 4)에 HP 4(황개 한 대), 황개는 Lv7(AT 4 · HP 20).
 * 기술 없이 두면 황개가 시각 251에 쓰러지고, 쓰면 시각 265에 넷을 다 쓰러뜨리고 황개 HP 8이 남는다.
 *
 * **조종당한 적의 차례는 사람이 둔다**(화면 · 회귀 모두, 2026-10-24) — 대본에 그 네 차례가 들어 있다: 채모는 그 자리에 묶어 두고,
 * 장윤 · 우금 · 조홍을 황개 앞으로 끌어온다(우금은 황개 바로 위 — Queen은 위아래를 친다). 칸은 처음 맞출 때 기준 AI가 이 차례를
 * 두며 고른 수 그대로다. 무대표의 「화계」는 넣지 않았다 — 대본의 대상이 장수뿐이라 칸을 겨누는 책략을 대본으로 둘 수 없고,
 * 화계(1일마다 HP 1)는 판을 가를 만큼 세지 않다.
 */
const BANG_TONG = U('P1-Pawn');
const HWANG_GAE = U('P1-Queen');
const AT = (n: number): Pick<RosterEntry, 'statPicks'> => ({ statPicks: Array.from({ length: n }, () => 'at' as const) });
export const bangTong = (): TutorialStage[] => stage('bang-tong', {
  config: config('bang-tong', {
    P1: [entry('bang-tong', 'Pawn', 3), entry('hwang-gae', 'Queen', 7, { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp'] })],
    P2: [
      entry('jo-jo', 'King', 5), entry('chae-mo', 'Rock', 5, AT(4)), entry('jang-yun', 'Bishop', 5, AT(4)),
      entry('u-geum', 'Knight', 5, AT(4)), entry('jo-hong', 'Pawn', 5, AT(4)),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }, { x: 12, y: 10 }],
      P2: [{ x: 12, y: 0 }, { x: 9, y: 7 }, { x: 15, y: 7 }, { x: 13, y: 7 }, { x: 11, y: 6 }],
    },
    overrides: {
      P1: [{ wt: 0 }, { wt: 30 }],
      P2: [{ wt: 200 }, { wt: 10, hp: 4 }, { wt: 12, hp: 4 }, { wt: 14, hp: 4 }, { wt: 16, hp: 4 }],
    },
    startSp: { P1: 6, P2: 0 },
    goals: {
      win: [{ kind: 'killCount', count: 4 }],
      // 패배는 핵심 한 사람 — 황개(불을 지를 사람). 방통 퇴각은 2026-10-26에 뺐다(기획자)
      lose: [{ kind: 'unitLost', unit: HWANG_GAE }],
    },
  }),
  guide: [
    { unit: BANG_TONG, phases: [
      { lines: ['tut.s.bang-tong.intro', 'tut.s.bang-tong.intro2', say('bang-tong', 1, 'jo-jo'), say('bang-tong', 2, 'bang-tong'), 'tut.s.bang-tong.skill', 'tut.s.bang-tong.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.bang-tong.chained', 'tut.s.bang-tong.chained2'], allow: ['endTurn'] },
    ] },
    // 연환계로 묶인 적 넷의 차례 — 사람이 대신 움직인다(이동만, 치지 못한다)
    { unit: U('P2-Rock'), phases: [{ lines: ['tut.s.bang-tong.drag', 'tut.s.bang-tong.hold'], allow: ['endTurn'] }] },
    { unit: U('P2-Bishop'), phases: [{ lines: ['tut.s.bang-tong.pull', 'tut.go.move'], allow: ['move'], moveTo: { x: 13, y: 9 }, until: 'moved' }] },
    { unit: U('P2-Knight'), phases: [{ lines: ['tut.s.bang-tong.front', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 9 }, until: 'moved' }] },
    { unit: U('P2-Pawn'), phases: [{ lines: ['tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 7 }, until: 'moved' }] },
    { unit: HWANG_GAE, phases: [{ lines: [say('bang-tong', 3, 'hwang-gae'), 'tut.s.bang-tong.strike'], allow: ['move', 'attack', 'endTurn'] }] },
  ] satisfies GuideTurn[],
  outro: [say('bang-tong', 4, 'bang-tong'), 'tut.s.bang-tong.done', 'tut.s.bang-tong.done2'],
});
