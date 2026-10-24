import type { PieceType } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 조운 — 장판 단기 (208) ───────────────────────────────────────

/**
 * 조운 하나가 조조군 한가운데(판 위쪽)에서 **남쪽 끝 구역**(y 12~14)까지 뚫고 나간다(`reach` — 제 발로 들어서야 한다).
 * 「간뇌도지」(2.9일 동안 크리티컬 100% + 받는 피해 절반)는 시전 지연이 30이라 **쓴 차례는 그대로 끝나고**, 30 뒤 차례가
 * 돌아오는 순간 걸린다 — 그동안 적은 아무도 못 움직인다(통솔이 낮아 WT가 길다).
 *
 * 길을 막는 하후은(청강검) · 이전은 HP 10이고, 조운의 평타는 5 · 크리는 10이다 — **크리 100%라야 한 칼에 베고 그 칸으로 지나간다.**
 * 못 베면 길이 막혀 대본의 칸으로 못 간다. 둘러싼 장수들(AT 4)의 공격은 절반(2)으로 들어온다 — 버프가 풀리는 넷째 차례에는
 * 이미 길이 열려 있다. 엔진으로 훑어 자리를 골랐다(조운 HP 20 → 14). 적은 King이 없다 — King을 베면 대전 승패가 먼저 끝낸다.
 *
 * 남쪽으로 걷는 칸은 대본이 정한다(회귀의 손은 목표 칸으로 스스로 걷지 않는다).
 */
const JO_UN = U('P1-Queen');
/** 둘러싼 장수 — Lv5 공격만 찍어 AT 4 · HP 10 */
const fierce = (officer: string, piece: PieceType) => entry(officer, piece, 5, { statPicks: ['at', 'at', 'at', 'at'] });
export const joUn = (): TutorialStage[] => stage('jo-un', {
  config: config('jo-un', {
    P1: [entry('jo-un', 'Queen', 9, { statPicks: ['at', 'at', 'at', 'at', 'at', 'at', 'hp', 'hp'] })],
    P2: [
      entry('ha-hu-eun', 'Rock'),
      fierce('jo-hong', 'Knight'),
      fierce('ak-jin', 'Bishop'),
      fierce('i-jeon', 'Queen'),
      fierce('u-geum', 'Pawn'),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 3 }],
      P2: [{ x: 12, y: 7 }, { x: 9, y: 9 }, { x: 15, y: 9 }, { x: 12, y: 11 }, { x: 14, y: 12 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'reach', unit: JO_UN, area: { x0: 0, x1: 24, y0: 12, y1: 14 } }], lose: [{ kind: 'unitLost', unit: JO_UN }] },
  }),
  guide: [
    { unit: JO_UN, phases: [
      { lines: ['tut.s.jo-un.intro', 'tut.s.jo-un.intro2', 'tut.s.jo-un.skill', 'tut.s.jo-un.delay', 'tut.s.jo-un.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    // 하후은을 베고 그 칸 앞으로
    { unit: JO_UN, phases: [
      { lines: ['tut.s.jo-un.eun', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 6 }, until: 'moved' },
      { lines: ['tut.s.jo-un.cut'], allow: ['attack'] },
    ] },
    // 이전이 길을 막는다 — 베고 그 칸을 지나간다
    { unit: JO_UN, phases: [
      { lines: ['tut.s.jo-un.block', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 7 }, until: 'moved' },
      { lines: ['tut.s.jo-un.cut2'], allow: ['attack'] },
    ] },
    { unit: JO_UN, phases: [{ lines: ['tut.s.jo-un.open', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 10 }, until: 'moved' }] },
    { unit: JO_UN, phases: [{ lines: ['tut.s.jo-un.last', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 13 }, until: 'moved' }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.jo-un.done', 'tut.s.jo-un.done2'],
});
