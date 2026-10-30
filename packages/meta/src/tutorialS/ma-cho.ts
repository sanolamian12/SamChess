import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 마초 — 가맹관 (214) ─────────────────────────────────────────

/**
 * 가맹관 앞에서 마초와 장비가 맞붙는다(2026-10-30 기획자 다시 짬). 둘 다 Lv6 · 성장은 전부 HP — 한 번씩 움직이면 닿는 거리에서
 * 시작한다. 마초는 「용호상박」(시전 지연 30 → 4.9일 동안 크리티컬 100%)을 걸고 싸운다. 장비는 SP가 없어 「장판하뢰」를 안 쓴다.
 * 장비의 HP가 **절반 이하**가 되는 순간 판이 끝나고(`hpBelow`), 끝 장면에 두 장수가 각자 본진으로 물러난 뒤 유비 · 제갈량이 말한다.
 *
 * 마대는 우리 본진, 유비 · 제갈량은 적 본진에 서 있다 — 대본이 부르지 않는 장수라 첫 WT를 길게 두어 판이 끝날 때까지 안 움직인다.
 * 적은 King이 없다(유비가 King이면 그 격파가 판을 끝낼 수 있다). 지면 끝나는 것은 마초를 잃을 때(`unitLost`).
 *
 * 엔진으로 맞췄다 — 마초가 시전(시각 0) → 기술이 서는 차례(30)에 한 칸 다가가고, 장비(첫 WT 107)가 한 번 다가오면 마초가
 * 다가가 친다. 끝나는 시각은 장비의 레벨이 정한다(HP 50% 문턱) — Lv5 4.4일 · **Lv6 5.5일** · Lv7 8.0일 · Lv9 11.1일
 * (기획자: 5일쯤에 끝나게). Lv6이면 HP 35 · AT 2(크리 4)로, 대본대로 두면 시각 547에 장비 17/35 · 마초 23/35가 남는다.
 */
const MA_CHO = U('P1-Knight');
const JANG_BI = U('P2-Queen');
/** 본진의 장수가 판이 끝날 때까지 서 있는 첫 WT — 판은 여기 훨씬 못 미쳐 끝난다 */
const STAND = 5000;
export const maCho = (): TutorialStage[] => stage('ma-cho', {
  config: config('ma-cho', {
    P1: [entry('ma-cho', 'Knight', 6), entry('ma-dae', 'Rock', 3)],
    P2: [entry('jang-bi', 'Queen', 6), entry('yu-bi', 'Rock', 3), entry('je-gal-ryang', 'Bishop', 3)],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }, { x: 12, y: 14 }],
      P2: [{ x: 13, y: 5 }, { x: 11, y: 0 }, { x: 13, y: 0 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: STAND }], P2: [undefined, { wt: STAND }, { wt: STAND }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'hpBelow', unit: JANG_BI, pct: 50 }], lose: [{ kind: 'unitLost', unit: MA_CHO }] },
  }),
  guide: [
    { unit: MA_CHO, phases: [
      { lines: ['tut.s.ma-cho.intro', say('ma-cho', 1, 'ma-cho'), 'tut.s.ma-cho.intro2', say('ma-cho', 2, 'ma-dae'), 'tut.s.ma-cho.skill', 'tut.s.ma-cho.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    // 시전이 끝나 기술이 서는 차례(시각 30) — 장비(첫 WT 107)보다 먼저 온다. 한 번 다가가 두고, 장비가 한 번 다가와 친다
    { unit: MA_CHO, phases: [
      { lines: ['tut.s.ma-cho.ready', 'tut.s.ma-cho.wait'], allow: ['move'], moveTo: { x: 13, y: 10 }, until: 'moved' },
      { lines: [], allow: ['endTurn'] },
    ] },
    { unit: MA_CHO, phases: [
      { lines: [say('ma-cho', 3, 'jang-bi'), 'tut.s.ma-cho.attack'], allow: ['move', 'attack'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.ma-cho.done', say('ma-cho', 4, 'yu-bi'), say('ma-cho', 5, 'je-gal-ryang')],
  finale: {
    appear: [],
    retreat: [{ unit: MA_CHO, to: { x: 12, y: 13 } }, { unit: JANG_BI, to: { x: 12, y: 1 } }],
  },
});
