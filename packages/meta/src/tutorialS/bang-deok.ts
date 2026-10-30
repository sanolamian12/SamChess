import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import type { TacticId, UnitId } from '@samchess/rules';
import { U, config, entry, say, stage } from './common.ts';

// ── 방덕 — 번성 (219) ───────────────────────────────────────────

/**
 * 관우군이 번성을 에워쌌다. 조인(K)이 상처투성이로 성문 앞(판 아래 끝)에 서고 관평 · 주창 · 요화가 붙어 친다. 관우(K)는 북쪽
 * 본진에서 꿈쩍하지 않는다(차례를 안 받는다 — King AI는 다가오는 적을 피해 판 끝을 돌아, 대각선으로 치는 Rock이 못 잡았다).
 * **관우의 HP를 절반 이하로 깎으면 이기고**(`hpBelow`, 2026-10-30 기획자), **조인이나 방덕이 퇴각하면 진다**(`unitLost`).
 *
 * 「세한지송백」(아군 하나의 최대 HP ×1.5 · **HP 가득**)을 첫 차례에 조인에게 걸고, 같은 차례에 방덕(Rock)이 관우 곁으로
 * 돌진해 친다. 조인은 **HP 4로 시작**해 기술 없이는 첫 공세(시각 108)에 쓰러진다 — 걸면 45/45가 된다.
 * 관평 · 주창은 본진을 지키러 돌아가고 요화가 조인을 친다. 우금은 조인이 깎인 뒤(첫 WT 230)에 「회복」을 한 번 건다.
 *
 * 맞춘 값(엔진으로 훑었다):
 *  - 방덕 Lv9(공격 여섯 · HP 둘 — HP 20)이 관우 Lv8(HP 45)을 한 대 5(크리 10)씩, 네 번 쳐 시각 331에 20/45로 만든다.
 *  - 차례는 방덕 · 방덕 · 조인 · 방덕 · 조인 · 우금 · 방덕 순이다. 끝날 때 조인 41/45 · 방덕 20/20.
 */
const BANG_DEOK = U('P1-Rock');
const JO_IN = U('P1-King');
const U_GEUM = U('P1-Pawn');
const GWAN_U = U('P2-King');
const ENEMY = { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp'] } as const;
const charge = (lines: readonly string[] = []): GuideTurn => ({ unit: BANG_DEOK, phases: [{ lines, allow: ['move', 'attack'], target: GWAN_U }] });
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
    overrides: { P1: [{ wt: 0 }, { hp: 4 }, { wt: 230 }], P2: [{ wt: 5000 }] },
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
    { unit: U_GEUM, phases: [{ lines: ['tut.s.bang-deok.heal', 'tut.s.bang-deok.heal2'], allow: ['castTactic'], target: JO_IN }] },
    charge(),
  ] satisfies GuideTurn[],
  outro: [say('bang-deok', 4, 'gwan-u'), 'tut.s.bang-deok.done', 'tut.s.bang-deok.done2'],
});
