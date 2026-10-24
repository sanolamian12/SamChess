import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 곽가 — 하북 평정 (204~) ───────────────────────────────────

/**
 * 원소군을 쫓는 북벌 — 곽가는 병이 깊다(HP 3으로 시작). 곽가가 「유언계책」(쓰러지면 2.9일 뒤 적 군주를 뺀 적 하나가
 * 함께 쓰러진다)을 걸고 앞에 선다. 곽가는 곧 쓰러지지만 **그것으로 지지 않는다** — 지는 것은 조조(King)를 잃을 때뿐이다.
 * 2.9일 뒤 계책이 적장 하나를 데려가고, 남은 적을 조조가 마저 친다(적 전멸 `wipeOut`).
 *
 * 초안은 원소가 King이었는데 **King이 아닌 장수(Bishop)로** 바꿨다 — 기준 AI의 King은 둘레에 아군이 있으면 뒤에서
 * 움직이지 않고, 홀로 남으면 노려지지 않는 칸으로만 다가와 판이 40차례를 넘겼다. 그래서 목표도 초안대로 「적 전멸」이다.
 * 계책의 대상은 시드 난수로 정해진다 — 이 판에서는 고람(HP 15 남은 Queen)이 쓰러진다.
 * 엔진으로 맞췄다 — 조조 Lv7(HP 40) · 하후연 Lv5(공격만, AT 4 · HP 10) 대 원소 · 곽도 Lv2 · 고람 · 순우경 Lv4.
 * 계책이 있으면 시각 1670에 이기고 조조가 HP 20 남는다. 계책 없이(곽가가 그냥 쓰러지면) 조조가 쓰러진다.
 */
const GWAK_GA = U('P1-Bishop');
export const gwakGa = (): TutorialStage[] => stage('gwak-ga', {
  config: config('gwak-ga', {
    P1: [entry('gwak-ga', 'Bishop'), entry('jo-jo', 'King', 7), entry('ha-hu-yeon', 'Rock', 5, { statPicks: ['at', 'at', 'at', 'at'] })],
    P2: [entry('won-so', 'Bishop', 2), entry('go-ram', 'Queen', 4), entry('sun-u-gyeong', 'Knight', 4), entry('gwak-do', 'Pawn', 2)],
  }, {
    positions: {
      P1: [{ x: 12, y: 9 }, { x: 12, y: 13 }, { x: 14, y: 12 }],
      P2: [{ x: 12, y: 1 }, { x: 11, y: 5 }, { x: 14, y: 5 }, { x: 12, y: 4 }],
    },
    overrides: { P1: [{ wt: 0, hp: 3 }] },
    startSp: { P1: 6, P2: 0 },
  }),
  guide: [
    { unit: GWAK_GA, phases: [
      { lines: ['tut.s.gwak-ga.intro', 'tut.s.gwak-ga.intro2', 'tut.s.gwak-ga.skill', 'tut.s.gwak-ga.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.gwak-ga.fall', 'tut.s.gwak-ga.king', 'tut.s.gwak-ga.stay'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.gwak-ga.done', 'tut.s.gwak-ga.done2'],
});
