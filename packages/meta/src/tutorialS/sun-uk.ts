import type { PieceType } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 순욱 — 서주 · 이호경식 (196) ─────────────────────────────────

/**
 * 서주에 유비와 여포, 두 호랑이가 함께 있다. 순욱이 「구호탄랑」(차례가 가장 가까운 적 둘을 한 번 내 장수처럼 — 이동 + 공격)으로
 * 두 호랑이를 **서로 물게** 한다. 유비 · 여포를 쓰러뜨리면 이긴다(`killCount` 2 — 장비 · 진궁은 두꺼워 그 전에 안 쓰러진다.
 * 목표는 「하나라도」라 「둘 다 격파」를 바로 적을 수 없어 수로 적었다). 적에게 King이 없다 — 하나 쓰러뜨렸다고 판이 끝나지 않게.
 *
 * 유비 · 여포는 첫 WT 10 · 15로 차례가 가장 가깝고(기술이 둘을 고른다), 서로 붙어 서 있다. 이빨은 날카롭고(Lv9 AT 6)
 * 가죽은 얇게(HP 7) 깎아 두었다 — 서로 한 대씩 물면 1이 남아, 조조 · 순욱의 한 대에 쓰러진다(시각 130).
 * 기술 없이 맞서면 두 호랑이에게 조조가 쓰러진다 — 엔진으로 확인했다. 장비 · 진궁은 판 위 양 끝 멀리 서 있다(SP 0 —
 * 판이 시각 600 전에 끝나 장판하뢰 · 삼고초려가 안 나온다).
 *
 * ⚠ 조종한 두 적의 차례는 대본에 적지 않는다 — 화면에서는 사람이 두지만 회귀의 손(`tutorialPlay.ts`)은 그 차례를
 * 적 차례로 보고 AI(`takeTurn`, 조종한 쪽 편으로)가 둔다. 대본은 순욱의 첫 차례 하나뿐이다.
 */
const SUN_UK = U('P1-Pawn');
/** 두 호랑이 — 이빨(AT 6)은 날카롭다 */
const tiger = (officer: string, piece: PieceType) => entry(officer, piece, 9, { statPicks: Array.from({ length: 8 }, () => 'at' as const) });
export const sunUk = (): TutorialStage[] => stage('sun-uk', {
  config: config('sun-uk', {
    P1: [entry('sun-uk', 'Pawn', 5), entry('jo-jo', 'King', 5)],
    P2: [tiger('yu-bi', 'Rock'), tiger('yeo-po', 'Queen'), entry('jang-bi', 'Knight', 5), entry('jin-gung', 'Bishop', 5)],
  }, {
    positions: {
      P1: [{ x: 13, y: 9 }, { x: 12, y: 10 }],
      P2: [{ x: 12, y: 7 }, { x: 12, y: 6 }, { x: 3, y: 1 }, { x: 21, y: 1 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 30 }], P2: [{ hp: 7, wt: 10 }, { hp: 7, wt: 15 }, { wt: 60 }, { wt: 70 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killCount', count: 2 }] },
  }),
  guide: [
    { unit: SUN_UK, phases: [
      { lines: ['tut.s.sun-uk.intro', 'tut.s.sun-uk.intro2', say('sun-uk', 1, 'jo-jo'), say('sun-uk', 2, 'sun-uk'), 'tut.s.sun-uk.skill', 'tut.s.sun-uk.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.sun-uk.tigers', say('sun-uk', 3, 'jin-gung'), 'tut.s.sun-uk.wait'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('sun-uk', 4, 'jo-jo'), 'tut.s.sun-uk.done', 'tut.s.sun-uk.done2'],
});
