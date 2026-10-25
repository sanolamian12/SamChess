import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import type { TacticId, UnitId } from '@samchess/rules';
import { U, config, entry, say, stage } from './common.ts';

// ── 방덕 — 번성 (219) ───────────────────────────────────────────

/**
 * 관우군이 번성을 에워쌌다. 조인(K)이 성문 앞(판 아래 끝)에 서고 관평 · 주창 · 요화가 붙어 친다. 관우(K)는 북쪽 끝 본진에서
 * 움직이지 않는다(기준 AI가 지키는 King이라 내려오지 않는다 — 엔진으로 확인했다). **4일(시각 400)을 버티면 이긴다**(`survive`).
 * 조인은 King이라 쓰러지면 그대로 진다(군주 격파).
 *
 * 「세한지송백」(아군 하나의 최대 HP ×2, 지금 HP는 그대로)은 혼자서는 HP를 한 칸도 채우지 않는다 — **채우는 손은 우금의
 * 「회복」(최대 HP의 20%)**이다. 조인(Lv5, 최대 30)에게 걸면 회복이 6 → 12가 되고 30을 넘어 채울 수 있다. 그래서 첫 차례에
 * 「지킬 사람을 고른다」 — 조인을 고르는 것이 이 판의 요점이다.
 *
 * 맞춘 값(엔진으로 훑었다):
 *  - 적 셋은 Lv7(공격 넷 · HP 둘 — AT 4, HP 20)이라 조인과 방덕이 쳐도 4일 안에 한 명쯤만 쓰러진다.
 *  - 우금은 Lv4(MP 둘 — MP 9, 「회복」 네 번), 첫 WT 60으로 당겨 4일 안에 세 번 선다.
 *  - 기술 없이 두면 조인은 시각 338에 쓰러지고, 쓰면 가장 낮을 때도 HP 22/60이 남는다.
 * 우금의 차례는 대본이 「회복」만 켜 둔다(대본 밖 차례의 손은 치기만 하므로 — 회복을 쓰게 하려면 대본에 적어야 한다).
 */
const BANG_DEOK = U('P1-Knight');
const JO_IN = U('P1-King');
const U_GEUM = U('P1-Pawn');
const ENEMY = { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp'] } as const;
const heal = (lines: readonly string[] = []): GuideTurn => ({ unit: U_GEUM, phases: [{ lines, allow: ['castTactic'], target: JO_IN }] });
const fight = (unit: UnitId, lines: readonly string[] = []): GuideTurn => ({ unit, phases: [{ lines, allow: ['move', 'attack', 'endTurn'] }] });
export const bangDeok = (): TutorialStage[] => stage('bang-deok', {
  config: config('bang-deok', {
    P1: [
      entry('bang-deok', 'Knight', 3), entry('jo-in', 'King', 5),
      entry('u-geum', 'Pawn', 4, { statPicks: ['mp', 'mp', 'hp'], tactics: ['hoe-bok' as TacticId] }),
    ],
    P2: [
      entry('gwan-u', 'King', 8), entry('gwan-pyeong', 'Queen', 7, { statPicks: [...ENEMY.statPicks] }),
      entry('ju-chang', 'Rock', 7, { statPicks: [...ENEMY.statPicks] }), entry('yo-hwa', 'Bishop', 7, { statPicks: [...ENEMY.statPicks] }),
    ],
  }, {
    positions: {
      P1: [{ x: 14, y: 10 }, { x: 12, y: 13 }, { x: 12, y: 14 }],
      P2: [{ x: 12, y: 1 }, { x: 12, y: 12 }, { x: 11, y: 12 }, { x: 13, y: 13 }],
    },
    overrides: { P1: [{ wt: 0 }, undefined, { wt: 60 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'survive', until: 400 }] },
  }),
  guide: [
    { unit: BANG_DEOK, phases: [
      { lines: ['tut.s.bang-deok.intro', 'tut.s.bang-deok.intro2', say('bang-deok', 1, 'bang-deok'), say('bang-deok', 2, 'jo-in'), 'tut.s.bang-deok.skill', 'tut.s.bang-deok.skill2'], allow: ['unique'], target: JO_IN, until: 'skill' },
      { lines: ['tut.s.bang-deok.doubled', say('bang-deok', 3, 'u-geum'), 'tut.s.bang-deok.attack'], allow: ['move', 'attack', 'endTurn'] },
    ] },
    heal(['tut.s.bang-deok.heal', 'tut.s.bang-deok.heal2']),
    fight(BANG_DEOK),
    fight(JO_IN, ['tut.s.bang-deok.jo-in']),
    heal(['tut.s.bang-deok.again']),
    fight(BANG_DEOK), fight(JO_IN), heal(), fight(BANG_DEOK), fight(JO_IN),
  ] satisfies GuideTurn[],
  outro: [say('bang-deok', 4, 'gwan-u'), 'tut.s.bang-deok.done', 'tut.s.bang-deok.done2'],
});
