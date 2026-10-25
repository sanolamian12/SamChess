import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 주유 — 적벽 전야 (208) ───────────────────────────────────────

/**
 * 채모 · 장윤 · 모개의 수군이 오나라 진채(지도 아래 나루)에 몰래 올라 주유(King)를 둘러쌌다. 주유가 「고육지책」으로 황개를
 * 지정하면 2.9일 동안 **적의 공격이 전부 황개에게 가고 절반만 들어간다** — 주유 · 감택은 다치지 않고 함께 싸운다.
 * 적 전멸로 이긴다(적에 King이 없다 — 대전 승패 `wipeOut`). 황개가 쓰러지면 진다(`unitLost`), 주유가 쓰러져도 진다(King).
 *
 * 적은 공격만 찍어 AT 3 · HP 10 — 처음부터 주유 곁에 붙어 있다. 엔진으로 확인했다: 기술 없이 같은 수를 두면 주유(HP 10)가
 * t 285에 쓰러지고, 기술을 쓰면 황개(HP 30)가 한 대 1씩만 받아 26으로 셋을 다 물리친다.
 */
const JU_YU = U('P1-King');
const HWANG_GAE = U('P1-Rock');
/** Lv3 공격만 찍어 AT 3 · HP 10 — 주유 · 감택 · 수군 장수 */
const AT2 = { statPicks: ['at', 'at'] } as const;
export const juYu = (): TutorialStage[] => stage('ju-yu', {
  config: config('ju-yu', {
    P1: [
      entry('ju-yu', 'King', 3, AT2),
      entry('hwang-gae', 'Rock', 7, { statPicks: ['hp', 'hp', 'hp', 'hp', 'at', 'at'] }),
      entry('gam-taek', 'Bishop', 3, AT2),
    ],
    P2: [entry('chae-mo', 'Rock', 3, AT2), entry('jang-yun', 'Knight', 3, AT2), entry('mo-gae', 'Pawn', 3, AT2)],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }, { x: 10, y: 11 }, { x: 14, y: 13 }],
      P2: [{ x: 13, y: 11 }, { x: 11, y: 12 }, { x: 12, y: 10 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { lose: [{ kind: 'unitLost', unit: HWANG_GAE }] },
  }),
  guide: [
    { unit: JU_YU, phases: [
      { lines: ['tut.s.ju-yu.intro', 'tut.s.ju-yu.intro2', say('ju-yu', 1, 'chae-mo'), say('ju-yu', 2, 'ju-yu'), say('ju-yu', 3, 'hwang-gae'), 'tut.s.ju-yu.skill', 'tut.s.ju-yu.skill2'], allow: ['unique'], target: HWANG_GAE, until: 'skill' },
      { lines: ['tut.s.ju-yu.redirect', 'tut.s.ju-yu.attack'], allow: ['move', 'attack', 'endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('ju-yu', 4, 'ju-yu'), 'tut.s.ju-yu.done', 'tut.s.ju-yu.done2'],
});
