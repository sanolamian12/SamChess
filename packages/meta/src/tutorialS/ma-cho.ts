import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 마초 — 가맹관 (214) ─────────────────────────────────────────

/**
 * 가맹관 앞에서 마초와 장비가 맞붙는다. 마초는 「용호상박」(시전 지연 30 → 4.9일 동안 크리티컬 100%)을 건다.
 * 장비 AI는 첫 차례에 「장판하뢰」(적 전원 WT +1.5일)를 쓴다(P2에 SP 6) — 시전 중인 마초의 차례도 밀려 기술이 늦게 선다.
 * 그래도 4.9일은 길어, 선 뒤로는 한 대 한 대가 두 배다. 무력 97 대 99라 평소 크리 확률은 18%뿐 — 기술 없이는
 * 장비를 넘기 전에 마초가 먼저 쓰러진다(엔진으로 확인했다).
 *
 * 적은 King이 없다 — 장비 격파(`killTarget`)가 판을 끝낸다. 지면 끝나는 것은 마초를 잃을 때(`unitLost`).
 * 엔진으로 맞췄다 — 마초 Lv9(AT 4 · HP 30)의 크리 넉 대(8 × 4)가 장비 Lv7(AT 3 · HP 30)을 4.9일 안에 쓰러뜨리고(시각 594)
 * 마초는 HP 15가 남는다. 요화 Lv3(AT 3)이 곁에서 거든다. 마대는 뒤에 서 있다(대본이 따로 부르지 않는다).
 */
const MA_CHO = U('P1-Knight');
const JANG_BI = U('P2-Queen');
export const maCho = (): TutorialStage[] => stage('ma-cho', {
  config: config('ma-cho', {
    P1: [entry('ma-cho', 'Knight', 9, { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp', 'hp', 'hp'] }), entry('ma-dae', 'Rock', 3)],
    P2: [entry('jang-bi', 'Queen', 7, { statPicks: ['at', 'at', 'hp', 'hp', 'hp', 'hp'] }), entry('yo-hwa', 'Pawn', 3, { statPicks: ['at', 'at'] })],
  }, {
    positions: {
      P1: [{ x: 12, y: 11 }, { x: 14, y: 12 }],
      P2: [{ x: 12, y: 3 }, { x: 10, y: 3 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 6 },
    goals: { win: [{ kind: 'killTarget', unit: JANG_BI }], lose: [{ kind: 'unitLost', unit: MA_CHO }] },
  }),
  guide: [
    { unit: MA_CHO, phases: [
      { lines: ['tut.s.ma-cho.intro', say('ma-cho', 1, 'ma-cho'), 'tut.s.ma-cho.intro2', say('ma-cho', 2, 'ma-dae'), 'tut.s.ma-cho.skill', 'tut.s.ma-cho.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: MA_CHO, phases: [
      { lines: [say('ma-cho', 3, 'jang-bi'), 'tut.s.ma-cho.thunder', 'tut.s.ma-cho.ready', 'tut.s.ma-cho.attack'], allow: ['move', 'attack'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('ma-cho', 4, 'jang-bi'), 'tut.s.ma-cho.done', 'tut.s.ma-cho.done2'],
});
