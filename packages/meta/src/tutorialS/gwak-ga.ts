import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 곽가 — 하북 평정 (204~) ───────────────────────────────────

/**
 * 원소군을 쫓는 북벌 — 곽가는 병이 깊다(HP 3으로 시작). 곽가가 「유언계책」으로 고람(Queen)에게 표식을 남기고
 * (쓰러지면 2.9일 뒤 그 적이 함께 쓰러진다 — 2026-10-26부터 무작위가 아니라 지정이다) 앞에 선다. 곽가는 곧 쓰러지지만 **그것으로 지지 않는다** — 지는 것은 조조(King)를 잃을 때뿐이다.
 * 2.9일 뒤 계책이 적장 하나를 데려가고, 남은 적을 조조가 마저 친다(적 전멸 `wipeOut`).
 *
 * 초안은 원소가 King이었는데 **King이 아닌 장수(Bishop)로** 바꿨다 — 기준 AI의 King은 둘레에 아군이 있으면 뒤에서
 * 움직이지 않고, 홀로 남으면 노려지지 않는 칸으로만 다가와 판이 40차례를 넘겼다. 그래서 목표도 초안대로 「적 전멸」이다.
 * 계책의 대상은 대본이 고람으로 정한다(옛 무작위 규칙에서도 이 판은 고람이었다). 표식은 곽가 편에만 보인다는 안내를 한 장 더했다.
 * 엔진으로 맞췄다 — 조조 Lv8(HP 45) · 하후연 Lv3(공격만, AT 3 · HP 10) 대 원소 Lv2 · 곽도 Lv3(HP 20) · 고람 · 순우경 Lv4.
 * 계책이 있으면 시각 1856에 이기고 조조가 HP 21 남는다(2026-10-26 재측정 — 무작위 뽑기가 빠져 난수 소비가 달라졌다) —
 * 대본 밖 차례를 다르게 두어도 열두 손 모두 이긴다.
 * 2026-10-24에 아군을 깎았다(조조 Lv7 → 8 · 하후연 Lv5 AT 4 → Lv3 AT 3 · 곽도 Lv2 → 3) — 전에는 계책 없이도 다가가 치는 손
 * 여덟이 이겨서 기술이 판을 안 바꾸었다. 이제 계책 없이는 열두 손 중 열하나가 진다(남은 하나는 시각 2321에 조조 HP 7로 겨우 이긴다 —
 * 판이 길어 손마다 크리가 갈리는 탓이고, 더 깎으면 계책이 있는 판이 흔들린다).
 */
const GWAK_GA = U('P1-Bishop');
const GO_RAM = U('P2-Queen');
export const gwakGa = (): TutorialStage[] => stage('gwak-ga', {
  config: config('gwak-ga', {
    P1: [entry('gwak-ga', 'Bishop'), entry('jo-jo', 'King', 8), entry('ha-hu-yeon', 'Rock', 3, { statPicks: ['at', 'at'] })],
    P2: [entry('won-so', 'Bishop', 2), entry('go-ram', 'Queen', 4), entry('sun-u-gyeong', 'Knight', 4), entry('gwak-do', 'Pawn', 3)],
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
      { lines: ['tut.s.gwak-ga.intro', 'tut.s.gwak-ga.intro2', say('gwak-ga', 1, 'jo-jo'), say('gwak-ga', 2, 'gwak-ga'), 'tut.s.gwak-ga.skill', 'tut.s.gwak-ga.skill2'], allow: ['unique'], target: GO_RAM, until: 'skill' },
      { lines: ['tut.s.gwak-ga.hidden', say('gwak-ga', 3, 'gwak-ga'), 'tut.s.gwak-ga.fall', 'tut.s.gwak-ga.king', 'tut.s.gwak-ga.stay'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('gwak-ga', 4, 'jo-jo'), 'tut.s.gwak-ga.done', 'tut.s.gwak-ga.done2'],
});
