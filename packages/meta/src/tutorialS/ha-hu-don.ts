import type { PieceType } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 하후돈 — 하비 (198) ──────────────────────────────────────────

/**
 * 하후돈(King)이 여포군 다섯에게 둘러싸였다. 조성의 화살을 맞은 첫 차례에 「발시담정」(4.9일 동안 받는 피해 절반)을 쓰고
 * 포위 속에서 버티며 **적 3명**을 쓰러뜨린다(`killCount`). 하후연 · 이전이 바로 곁에서 함께 싸운다.
 *
 * 여포군 장수는 공격만 찍어 AT 5 · HP 10 — King을 먼저 노리는 AI라 하후돈에게 몰린다. 절반이면 한 대 2, 아니면 5다.
 * 엔진으로 훑어 골랐다: 기술을 쓰면 하후돈이 HP 20 → 12로 3명을 쓰러뜨리고(4.9일 안에 끝난다), 안 쓰면 t 255에 쓰러진다.
 * 적에 King이 없다 — 대전 승패(군주 격파)가 목표보다 먼저 판을 끝내지 않게. 하후돈이 쓰러지면 진다(King · `unitLost`).
 */
const HA_HU_DON = U('P1-King');
/** 여포군 장수 — Lv7 공격만 찍어 AT 5 · HP 10 */
const raider = (officer: string, piece: PieceType) => entry(officer, piece, 7, { statPicks: ['at', 'at', 'at', 'at', 'at', 'at'] });
export const haHuDon = (): TutorialStage[] => stage('ha-hu-don', {
  config: config('ha-hu-don', {
    P1: [entry('ha-hu-don', 'King', 7, { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp'] }), entry('ha-hu-yeon', 'Knight', 3), entry('i-jeon', 'Rock', 3)],
    P2: [raider('go-sun', 'Queen'), raider('jo-seong', 'Pawn'), raider('song-heon', 'Rock'), raider('wi-sok', 'Knight'), raider('hu-seong', 'Bishop')],
  }, {
    positions: {
      P1: [{ x: 12, y: 7 }, { x: 11, y: 9 }, { x: 14, y: 8 }],
      P2: [{ x: 12, y: 4 }, { x: 9, y: 7 }, { x: 15, y: 9 }, { x: 14, y: 5 }, { x: 10, y: 10 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killCount', count: 3 }], lose: [{ kind: 'unitLost', unit: HA_HU_DON }] },
  }),
  guide: [
    { unit: HA_HU_DON, phases: [
      { lines: ['tut.s.ha-hu-don.intro', 'tut.s.ha-hu-don.intro2', 'tut.s.ha-hu-don.arrow', 'tut.s.ha-hu-don.skill', 'tut.s.ha-hu-don.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.ha-hu-don.fight', 'tut.s.ha-hu-don.fight2'], allow: ['move', 'attack', 'endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.ha-hu-don.done', 'tut.s.ha-hu-don.done2'],
});
