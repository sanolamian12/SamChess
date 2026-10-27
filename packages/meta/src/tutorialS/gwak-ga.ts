import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 곽가 — 하북 평정 (204~) ───────────────────────────────────

/**
 * 원소군을 쫓는 북벌 — 곽가는 병이 깊다(HP 3으로 시작). 곽가가 「유언계책」으로 고람(Queen)에게 표식을 남기고 앞에 선다 —
 * **다음 적 차례에 순우경이 곽가를 벤다**(1.2일). 2.9일 뒤 계책이 고람을 데려가고(3.7일), 원소를 지키던 고람이 사라진 길로
 * 조조 · 하후연이 원소를 친다. **원소를 쓰러뜨리면 이긴다**(`killTarget`), 조조(King)를 잃으면 진다.
 *
 * 2026-10-27 다시 짰다(기획자) — 옛 판은 「적 전멸」이라 원소가 쓰러져도 판이 안 끝났고, 곽가가 3.2일에야 쓰러져
 * 판이 15~18일까지 늘어지며 적 고유기술이 셋이나 터졌다. 곽도를 빼고, 원소(Lv1)를 맨 뒤 · 고람을 그 바로 앞에 세우고,
 * 곽가를 앞으로 내었다. 원소가 King이 아닌(Bishop) 까닭은 그대로다 — 기준 AI의 King은 홀로 남으면 노려지지 않는 칸으로만
 * 다가와 판이 끝나지 않았다.
 * 엔진으로 맞췄다 — 대본대로 두면 시각 836에 이기고 조조 HP 22가 남는다. 열두 손 모두 이기고 4.2~10.2일에 끝난다.
 * 계책 없이 두면 열두 손 중 다섯이 진다(고람이 원소 앞을 막는다) — 더 갈라 놓으면 판이 다시 길어져 빠른 쪽을 골랐다.
 */
const GWAK_GA = U('P1-Bishop');
const GO_RAM = U('P2-Queen');
const WON_SO = U('P2-Bishop');
export const gwakGa = (): TutorialStage[] => stage('gwak-ga', {
  config: config('gwak-ga', {
    P1: [entry('gwak-ga', 'Bishop'), entry('jo-jo', 'King', 5), entry('ha-hu-yeon', 'Rock', 3, { statPicks: ['at', 'at'] })],
    P2: [entry('won-so', 'Bishop', 1), entry('go-ram', 'Queen', 6), entry('sun-u-gyeong', 'Knight', 3)],
  }, {
    positions: {
      P1: [{ x: 12, y: 7 }, { x: 12, y: 12 }, { x: 14, y: 11 }],
      P2: [{ x: 12, y: 1 }, { x: 12, y: 3 }, { x: 14, y: 5 }],
    },
    overrides: { P1: [{ wt: 0, hp: 3 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killTarget', unit: WON_SO }] },
  }),
  guide: [
    { unit: GWAK_GA, phases: [
      { lines: ['tut.s.gwak-ga.intro', 'tut.s.gwak-ga.intro2', say('gwak-ga', 1, 'jo-jo'), say('gwak-ga', 2, 'gwak-ga'), 'tut.s.gwak-ga.goal', 'tut.s.gwak-ga.skill', 'tut.s.gwak-ga.skill2'], allow: ['unique'], target: GO_RAM, until: 'skill' },
      { lines: ['tut.s.gwak-ga.hidden', say('gwak-ga', 3, 'gwak-ga'), 'tut.s.gwak-ga.fall', 'tut.s.gwak-ga.king', 'tut.s.gwak-ga.stay'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('gwak-ga', 4, 'jo-jo'), 'tut.s.gwak-ga.done', 'tut.s.gwak-ga.done2'],
});
