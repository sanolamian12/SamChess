import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 장합 — 가정 (228) ───────────────────────────────────────────

/**
 * 마속이 산 위에 진을 쳤다가 물길을 끊기고 내려온다. 장합이 「변화무쌍」(2.9일 동안 공격받으면 되받아친다)을 걸고 **서서
 * 기다리면** 몰려온 촉군이 칠 때마다 되맞는다. 적을 모두 쓰러뜨리면 이긴다(`wipeOut`), 장합이 쓰러지면 진다.
 *
 * 적에게 King이 없다 — 마속이 King이면 성채를 지키고 서 있어(AI) 「몰려오게 둔다」가 안 된다. 장합이 King이라 적 AI가 전부
 * 장합에게 달려든다. 촉군 다섯은 한 걸음에 장합을 칠 칸에 서고 첫 WT를 20~40으로 당겨, 장합이 기술을 건 직후 한꺼번에 친다.
 *
 * 엔진으로 훑어 골랐다 — Lv9 장합(AT 3 · HP 40)은 기술을 쓰면 시각 309에 다섯을 다 쓰러뜨리고 HP 18이 남는다.
 * 기술 없이 같은 자리에서 맞서면 둘밖에 못 쓰러뜨리고 쓰러진다. 조진은 뒤에 서 있는 아군 하나다(초안의 「아군 하나」).
 */
const JANG_HAP = U('P1-King');
export const jangHap = (): TutorialStage[] => stage('jang-hap', {
  config: config('jang-hap', {
    P1: [entry('jang-hap', 'King', 9, { statPicks: ['at', 'at', 'hp', 'hp', 'hp', 'hp', 'hp', 'hp'] }), entry('jo-jin', 'Rock')],
    P2: [
      entry('ma-sok', 'Queen'), entry('wang-pyeong', 'Rock'), entry('jin-sik', 'Knight'),
      entry('ma-chung', 'Bishop'), entry('jang-nam', 'Pawn'),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 10 }, { x: 16, y: 12 }],
      P2: [{ x: 12, y: 6 }, { x: 11, y: 6 }, { x: 10, y: 8 }, { x: 16, y: 7 }, { x: 13, y: 7 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 120 }], P2: [{ wt: 20 }, { wt: 25 }, { wt: 30 }, { wt: 35 }, { wt: 40 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { lose: [{ kind: 'unitLost', unit: JANG_HAP }] },
  }),
  guide: [
    { unit: JANG_HAP, phases: [
      { lines: ['tut.s.jang-hap.intro', 'tut.s.jang-hap.intro2', 'tut.s.jang-hap.skill', 'tut.s.jang-hap.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.jang-hap.wait', 'tut.s.jang-hap.wait2'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.jang-hap.done', 'tut.s.jang-hap.done2'],
});
