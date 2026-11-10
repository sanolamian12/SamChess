import type { PieceType } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 하후돈 — 하비 (198) ──────────────────────────────────────────

/**
 * 하후돈(King) 앞을 여포군 장수 셋(조성 · 후성 · 고순)이 위에서 가로막았다. 조성의 화살을 맞은 첫 차례에 「발시담정」(4.9일 동안
 * 받는 피해 절반)을 쓰고 **적을 모두** 쓰러뜨린다(적에 King이 없어 전멸 — `wipeOut`). 하후연(Rock) · 이전(Knight)이 아래에서 함께 싸운다.
 * (2026-11-11 기획자 — 적 다섯이 아군 사이에 섞여 서서 피아가 안 갈렸다. 적은 위 · 아군은 아래로 가르고, 「3명」 대신 전멸로)
 *
 * 여포군 장수는 공격만 찍어 AT 5 · HP 10 — King을 먼저 노리는 AI라 하후돈에게 몰린다. 절반이면 한 대 2, 아니면 5다.
 * 셋이면 기술이 풀리기 전에 끝난다 — 회귀의 손으로 t 416(4.2일)에 전멸, 손을 바꿔 두면 3.2 ~ 7.1일(열둘 다 이긴다).
 * 하후돈이 쓰러지면 진다(King · `unitLost`).
 */
const HA_HU_DON = U('P1-King');
/** 여포군 장수 — Lv7 공격만 찍어 AT 5 · HP 10 */
const raider = (officer: string, piece: PieceType) => entry(officer, piece, 7, { statPicks: ['at', 'at', 'at', 'at', 'at', 'at'] });
export const haHuDon = (): TutorialStage[] => stage('ha-hu-don', {
  config: config('ha-hu-don', {
    P1: [entry('ha-hu-don', 'King', 7, { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp'] }), entry('ha-hu-yeon', 'Rock', 3), entry('i-jeon', 'Knight', 3)],
    P2: [raider('jo-seong', 'Pawn'), raider('hu-seong', 'Bishop'), raider('go-sun', 'Rock')],
  }, {
    positions: {
      P1: [{ x: 12, y: 7 }, { x: 11, y: 9 }, { x: 14, y: 8 }],
      // 조성 M6 · 후성 J7 · 고순 P7 — 적은 위에서 내려오고 아군(하후돈 M8 · 하후연 L10 · 이전 O9)은 아래에 선다
      P2: [{ x: 12, y: 5 }, { x: 9, y: 6 }, { x: 15, y: 6 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 0 },
    // 적 전멸로 이긴다(적에 King이 없다 — `wipeOut`)
    goals: { lose: [{ kind: 'unitLost', unit: HA_HU_DON }] },
  }),
  guide: [
    { unit: HA_HU_DON, phases: [
      { lines: ['tut.s.ha-hu-don.intro', 'tut.s.ha-hu-don.intro2', say('ha-hu-don', 1, 'jo-seong'), 'tut.s.ha-hu-don.arrow', say('ha-hu-don', 2, 'ha-hu-yeon'), say('ha-hu-don', 3, 'ha-hu-don'), 'tut.s.ha-hu-don.skill', 'tut.s.ha-hu-don.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.ha-hu-don.fight', 'tut.s.ha-hu-don.fight2'], allow: ['move', 'attack', 'endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('ha-hu-don', 4, 'ha-hu-don'), 'tut.s.ha-hu-don.done', 'tut.s.ha-hu-don.done2'],
});
