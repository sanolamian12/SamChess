import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 조조 — 청매자주 영웅론 (199, 허도 승상부 정원의 육각정) ────────────────

/**
 * 1:1. 술자리 대화 두 마디 뒤 유비가 먼저 「삼고초려」(세 번 맞힌 적을 제 편으로)를 건다 — 시전 지연 30 동안 조조 차례가 끼고,
 * 「영웅론」으로 **시전을 무산시키고 봉인한다**(이미 걸린 고유기술에는 안 통한다 — 시전 중일 때가 유일한 기회다).
 * 그 뒤 조조가 한 걸음 다가가 친다 — 공격만 찍은 조조라 한두 대에 유비의 HP가 절반 아래로 떨어지면 이긴다(`hpBelow`).
 * 오래 끌 판이 아니다(2026-11-10 기획자 — 옛 판은 유비를 쓰러뜨릴 때까지 싸웠고, 설명 없이 유비가 기술부터 썼다).
 * 유비 AI는 첫 차례에 삼고초려를 쓴다(SP를 넉넉히 준다). 첫 WT로 유비를 먼저 세운다. 둘은 두 칸 떨어져 있다.
 */
const JO_JO = U('P1-King');
const YU_BI = U('P2-King');
export const joJo = (): TutorialStage[] => stage('jo-jo', {
  config: config('jo-jo', {
    P1: [entry('jo-jo', 'King', 9, { statPicks: ['at', 'at', 'at', 'at', 'at', 'at', 'at', 'at'] })],
    P2: [entry('yu-bi', 'King')],
  }, {
    positions: { P1: [{ x: 12, y: 8 }], P2: [{ x: 12, y: 6 }] },
    overrides: { P1: [{ wt: 5 }], P2: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 6 },
    goals: { win: [{ kind: 'hpBelow', unit: YU_BI, pct: 50 }], lose: [{ kind: 'unitLost', unit: JO_JO }] },
  }),
  // 유비가 먼저 둔다 — 전장 · 자리 · 형편 · 술자리 대화 두 마디를 그 앞에(11-10 기획자: 설명 없이 유비가 고유기술부터 써서 헷갈렸다)
  opening: ['tut.s.jo-jo.intro', 'tut.s.jo-jo.place', 'tut.s.jo-jo.intro2', say('jo-jo', 1, 'jo-jo'), say('jo-jo', 2, 'yu-bi')],
  guide: [
    { unit: JO_JO, phases: [
      { lines: ['tut.s.jo-jo.casting', 'tut.s.jo-jo.seal', 'tut.s.jo-jo.seal2'], allow: ['unique'], target: YU_BI, until: 'skill' },
      { lines: [say('jo-jo', 3, 'jo-jo'), 'tut.s.jo-jo.sealed', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 7 }, until: 'moved' },
      { lines: ['tut.s.jo-jo.strike'], allow: ['attack'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('jo-jo', 4, 'yu-bi'), 'tut.s.jo-jo.done', 'tut.s.jo-jo.done2'],
});
