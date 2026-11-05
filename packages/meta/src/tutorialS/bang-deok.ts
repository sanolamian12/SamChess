import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import type { TacticId, UnitId } from '@samchess/rules';
import { U, config, entry, say, stage } from './common.ts';

// ── 방덕 — 번성 (219) ───────────────────────────────────────────

/**
 * 관우군이 번성을 에워쌌다. 조인(K)이 상처투성이로 성문 앞(판 아래 끝)에 서고 관평 · 주창 · 요화가 **붙은 채로** 친다.
 * 관우(K)는 북쪽 본진을 지킨다. 넷 다 **자리를 지키는 적**(`hold`)이다 — 움직이지 않고 닿는 상대만 친다. 기준 AI로 두면
 * 관평 · 주창이 방덕을 쫓아 본진으로 돌아가 조인 쪽 긴장이 풀렸고, 관우는 노려지는 칸을 피해 판 끝을 돌아 Rock이 못 잡았다.
 * 그래서 **방덕은 관우와 일대일**, **조인은 셋에게 둘러싸여 버틴다**(2026-10-30 기획자).
 * **관우의 HP를 절반 이하로 깎으면 이기고**(`hpBelow`), **조인이나 방덕이 퇴각하면 진다**(`unitLost`).
 *
 * 「세한지송백」(아군 하나의 최대 HP ×1.5 · **HP 가득**)을 첫 차례에 조인에게 걸고, 같은 차례에 방덕(Rock)이 관우 곁으로
 * 돌진해 친다. 조인은 **HP 4로 시작**해 기술 없이는 첫 공세(시각 108)에 쓰러진다 — 걸면 45/45가 된다.
 *
 * 맞춘 값(엔진으로 훑었다):
 *  - 방덕 Lv9(공격 여섯 · HP 둘 — HP 20)이 관우 Lv8(HP 45)을 다섯 번 쳐 시각 441에 20/45로 만든다. 관우의 반격에 방덕은 10/20.
 *  - 셋이 한 바퀴에 조인을 12쯤 깎는다 — 우금(첫 WT 230)의 「회복」 둘(+9 · +9)이 없으면 조인이 끝까지 못 간다. 끝날 때 11/45.
 *  - 차례는 방덕 · 방덕 · 조인 · 방덕 · 조인 · 우금 · 방덕 · 조인 · 우금 · 방덕 순이다.
 */
const BANG_DEOK = U('P1-Rock');
const JO_IN = U('P1-King');
const U_GEUM = U('P1-Pawn');
const GWAN_U = U('P2-King');
const ENEMY = { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp'] } as const;
const charge = (lines: readonly string[] = []): GuideTurn => ({ unit: BANG_DEOK, phases: [{ lines, allow: ['move', 'attack'], target: GWAN_U }] });
const heal = (lines: readonly string[] = []): GuideTurn => ({ unit: U_GEUM, phases: [{ lines, allow: ['castTactic'], target: JO_IN }] });
const fight = (unit: UnitId, lines: readonly string[] = []): GuideTurn => ({ unit, phases: [{ lines, allow: ['move', 'attack', 'endTurn'] }] });
export const bangDeok = (): TutorialStage[] => stage('bang-deok', {
  config: config('bang-deok', {
    P1: [
      entry('bang-deok', 'Rock', 9, { statPicks: ['at', 'at', 'at', 'at', 'at', 'at', 'hp', 'hp'] }), entry('jo-in', 'King', 5),
      entry('u-geum', 'Pawn', 4, { statPicks: ['mp', 'mp', 'hp'], tactics: ['hoe-bok' as TacticId] }),
    ],
    P2: [
      entry('gwan-u', 'King', 8), entry('gwan-pyeong', 'Queen', 7, { statPicks: [...ENEMY.statPicks] }),
      entry('ju-chang', 'Rock', 7, { statPicks: [...ENEMY.statPicks] }), entry('yo-hwa', 'Bishop', 7, { statPicks: [...ENEMY.statPicks] }),
    ],
  }, {
    positions: {
      P1: [{ x: 11, y: 6 }, { x: 12, y: 13 }, { x: 12, y: 14 }],
      P2: [{ x: 12, y: 1 }, { x: 12, y: 12 }, { x: 11, y: 12 }, { x: 13, y: 13 }],
    },
    overrides: { P1: [{ wt: 0 }, { hp: 4 }, { wt: 230 }] },
    startSp: { P1: 6, P2: 0 },
    goals: {
      win: [{ kind: 'hpBelow', unit: GWAN_U, pct: 50 }],
      lose: [{ kind: 'unitLost', unit: JO_IN }, { kind: 'unitLost', unit: BANG_DEOK }],
    },
  }),
  guide: [
    { unit: BANG_DEOK, phases: [
      { lines: ['tut.s.bang-deok.intro', 'tut.s.bang-deok.intro2', say('bang-deok', 1, 'bang-deok'), say('bang-deok', 2, 'jo-in'), 'tut.s.bang-deok.skill', 'tut.s.bang-deok.skill2'], allow: ['unique'], target: JO_IN, until: 'skill' },
      { lines: ['tut.s.bang-deok.doubled', say('bang-deok', 3, 'u-geum'), 'tut.s.bang-deok.attack'], allow: ['move', 'attack'], target: GWAN_U },
    ] },
    charge(['tut.s.bang-deok.again']),
    fight(JO_IN, ['tut.s.bang-deok.jo-in']),
    charge(),
    fight(JO_IN),
    heal(['tut.s.bang-deok.heal', 'tut.s.bang-deok.heal2']),
    charge(),
    fight(JO_IN),
    heal(['tut.s.bang-deok.heal3']),
    charge(),
  ] satisfies GuideTurn[],
  hold: [GWAN_U, U('P2-Queen'), U('P2-Rock'), U('P2-Bishop')],
  outro: [say('bang-deok', 4, 'gwan-u'), 'tut.s.bang-deok.done', 'tut.s.bang-deok.done2'],
});
