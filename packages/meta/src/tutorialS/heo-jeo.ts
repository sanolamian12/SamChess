import type { PieceType } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 허저 — 위수 도하 (211) ───────────────────────────────────────

/**
 * 강을 건너려던 조조(King)를 마초 · 마대 · 방덕이 뒤쫓는다. 허저가 「단기도강」(1.9일 동안 반경 1칸 아군이 받는 피해 절반)을 켜고
 * 조조 곁에 붙어 선 채, 조조를 판 위쪽 **나루**(지도의 배가 닿은 물가, x 5~12 · y 3~4)까지 걸린다(`reach` — 조조가 제 발로).
 * 조조가 쓰러지면 대전 승패(군주 격파)로 진다. 엔진에 강 · 물 지형이 없어 「강을 건넌다」는 나루에 닿는 것으로 갈음했다.
 *
 * 적은 첫 WT를 짧게 주어(10 · 15 · 20) 곧장 덮친다 — 1.9일 안에 두 번씩 친다. King부터 노리는 AI라 조조에게 몰린다.
 * 엔진으로 훑어 골랐다: 기술을 켜면 조조가 HP 15 → 7로 나루에 닿고(t 191 — 마침 1.9일이 다한다), 안 켜면 t 130에 쓰러진다.
 * 방덕이 조조의 앞길(9, 5)을 막아서므로 오른쪽으로 돌아 오른다 — 허저가 먼저 (11, 6)으로 비켜 서야 둘레 1칸이 이어진다.
 * 걷는 칸은 대본이 정한다(회귀의 손은 목표 칸으로 스스로 걷지 않는다).
 *
 * 허저 자신도 절반을 받는다(설명 「자신 포함」) — 이 판을 짜다 엔진이 시전자를 빼고 재던 것이 드러나 2026-10-24에 고쳤다(`aurasOn`).
 * 고친 뒤에도 이 판은 손 12가지 모두 이긴다.
 */
const HEO_JEO = U('P1-Queen');
const JO_JO = U('P1-King');
/** 서량 기병 — Lv3 공격만 찍어 AT 3 · HP 10 */
const rider = (officer: string, piece: PieceType) => entry(officer, piece, 3, { statPicks: ['at', 'at'] });
export const heoJeo = (): TutorialStage[] => stage('heo-jeo', {
  config: config('heo-jeo', {
    P1: [entry('heo-jeo', 'Queen', 5), entry('jo-jo', 'King', 2)],
    P2: [rider('ma-cho', 'Knight'), rider('ma-dae', 'Rock'), rider('bang-deok', 'Bishop')],
  }, {
    positions: {
      P1: [{ x: 10, y: 7 }, { x: 9, y: 7 }],
      P2: [{ x: 8, y: 9 }, { x: 5, y: 7 }, { x: 6, y: 8 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 5 }], P2: [{ wt: 10 }, { wt: 15 }, { wt: 20 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'reach', unit: JO_JO, area: { x0: 5, x1: 12, y0: 3, y1: 4 } }] },
  }),
  guide: [
    { unit: HEO_JEO, phases: [
      { lines: ['tut.s.heo-jeo.intro', 'tut.s.heo-jeo.intro2', say('heo-jeo', 1, 'jo-jo'), say('heo-jeo', 2, 'heo-jeo'), 'tut.s.heo-jeo.skill', 'tut.s.heo-jeo.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.heo-jeo.guard'], allow: ['endTurn'] },
    ] },
    { unit: JO_JO, phases: [{ lines: ['tut.s.heo-jeo.run', 'tut.go.move'], allow: ['move'], moveTo: { x: 9, y: 6 }, until: 'moved' }] },
    { unit: HEO_JEO, phases: [
      { lines: ['tut.s.heo-jeo.block', 'tut.go.move'], allow: ['move'], moveTo: { x: 11, y: 6 }, until: 'moved' },
      { lines: ['tut.s.heo-jeo.wait'], allow: ['attack', 'endTurn'] },
    ] },
    { unit: JO_JO, phases: [{ lines: ['tut.s.heo-jeo.around', 'tut.go.move'], allow: ['move'], moveTo: { x: 10, y: 5 }, until: 'moved' }] },
    { unit: JO_JO, phases: [{ lines: [say('heo-jeo', 3, 'ma-cho'), 'tut.s.heo-jeo.board', 'tut.go.move'], allow: ['move'], moveTo: { x: 10, y: 4 }, until: 'moved' }] },
  ] satisfies GuideTurn[],
  outro: [say('heo-jeo', 4, 'jo-jo'), 'tut.s.heo-jeo.done', 'tut.s.heo-jeo.done2'],
});
