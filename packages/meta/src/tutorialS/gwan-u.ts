import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 관우 — 사수관 (190) ─────────────────────────────────────────

/**
 * 화웅이 연합군 장수들을 잇달아 베고 사수관 앞에 버틴다. 관우는 「온주참화웅」(시전 지연 30 → 그 뒤 1.9일 안에
 * **처음 친 상대는 반드시 죽는다**)을 걸고, 술이 식기 전(제한 시각) 화웅을 벤다. 화웅은 HP가 커서 기술 없이는
 * 제한 시각 안에 못 쓰러뜨린다 — 첫 일격을 호진 · 이숙에게 쓰면 끝이다(대본이 화웅 곁 칸 하나만 연다).
 *
 * 적은 King이 없다 — 화웅 격파(`killTarget`)가 판을 끝낸다. 아군은 관우 · 유비(K). 관우는 통솔 100(WT 90)이라
 * 시전 지연 30이 끝나면 적보다 먼저 다시 차례가 온다 — 그 사이 적은 안 움직인다(엔진으로 확인했다).
 * 엔진으로 맞췄다 — 화웅 Lv9(HP 50)는 관우(AT 2)가 25대를 쳐야 쓰러지고, 술이 식는 시각 200 안에는 두 대도 못 친다.
 * 대본대로면 시각 32에 화웅 곁(12,5 — 대각선으로 화웅만 닿는다)으로 가 한 칼에 벤다.
 */
const GWAN_U = U('P1-Rock');
const HWA_UNG = U('P2-Queen');
export const gwanU = (): TutorialStage[] => stage('gwan-u', {
  config: config('gwan-u', {
    P1: [entry('gwan-u', 'Rock', 3), entry('yu-bi', 'King')],
    P2: [entry('hwa-ung', 'Queen', 9), entry('ho-jin', 'Pawn'), entry('i-suk', 'Bishop')],
  }, {
    positions: {
      P1: [{ x: 12, y: 9 }, { x: 12, y: 13 }],
      P2: [{ x: 13, y: 4 }, { x: 10, y: 4 }, { x: 15, y: 5 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killTarget', unit: HWA_UNG }], lose: [{ kind: 'timeUp', at: 200 }] },
  }),
  guide: [
    { unit: GWAN_U, phases: [
      { lines: ['tut.s.gwan-u.intro', 'tut.s.gwan-u.intro2', 'tut.s.gwan-u.skill', 'tut.s.gwan-u.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: GWAN_U, phases: [
      { lines: ['tut.s.gwan-u.ready', 'tut.s.gwan-u.choose', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 5 }, until: 'moved' },
      { lines: ['tut.s.gwan-u.strike'], allow: ['attack'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.gwan-u.done', 'tut.s.gwan-u.done2'],
});
