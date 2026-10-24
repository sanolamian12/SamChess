import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 손견 — 양인 (191) ───────────────────────────────────────────

/**
 * 손견(K) · 정보 · 한당 · 황개가 판 위쪽 끝에 몰린 호진(K)을 친다. 동탁군의 여포가 남서쪽 끝에서 달려오고,
 * 여포가 닿기 전(시각 230 — `timeUp`)에 호진을 쓰러뜨려야 한다. 여포는 이길 상대가 아니라 **시계**다.
 *
 * 「강동지호」(시전 지연 30, 1.9일 동안 아군 전원 크리티컬 100%)가 발동하면 아군 넷의 한 대가 2 → 4가 된다.
 * 호진은 Lv5(HP 30) — 크리티컬로 몰아치면 여덟 대(시각 172)에 쓰러지고, 기술 없이 두면 시각 230에 HP가 남는다
 * (엔진으로 확인했다 — 평소에도 무력 차로 크리티컬이 꽤 터지지만 모자란다).
 *
 * 첫 WT — 손견 0으로 먼저 걸고, 아군 셋은 35 · 40 · 45로 **발동(시각 31) 뒤에** 서게 해 첫 공격부터 크리티컬이 실린다.
 * 셋은 한 걸음이면 호진을 칠 수 있는 자리에 선다(판 위쪽 끝이라 호진이 멀리 못 달아난다).
 */
const SON_GYEON = U('P1-King');
export const sonGyeon = (): TutorialStage[] => stage('son-gyeon', {
  config: config('son-gyeon', {
    P1: [entry('son-gyeon', 'King', 3), entry('jeong-bo', 'Rock', 2), entry('han-dang', 'Pawn', 2), entry('hwang-gae', 'Knight', 2)],
    P2: [entry('ho-jin', 'King', 5), entry('yeo-po', 'Queen', 6)],
  }, {
    positions: {
      P1: [{ x: 13, y: 2 }, { x: 11, y: 4 }, { x: 12, y: 3 }, { x: 14, y: 2 }],
      P2: [{ x: 12, y: 0 }, { x: 0, y: 14 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 35 }, { wt: 40 }, { wt: 45 }], P2: [{ wt: 50 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { lose: [{ kind: 'timeUp', at: 230 }] },
  }),
  guide: [
    { unit: SON_GYEON, phases: [
      { lines: ['tut.s.son-gyeon.intro', 'tut.s.son-gyeon.intro2', 'tut.s.son-gyeon.skill', 'tut.s.son-gyeon.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: SON_GYEON, phases: [{ lines: ['tut.s.son-gyeon.fired', 'tut.s.son-gyeon.fired2'], allow: ['move', 'attack', 'endTurn'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.son-gyeon.done', 'tut.s.son-gyeon.done2'],
});
