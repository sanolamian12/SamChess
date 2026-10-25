import type { TacticId } from '@samchess/rules';
import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 가후 — 완성 (197) ─────────────────────────────────────────

/**
 * 장수가 항복을 뒤집고 완성의 조조 진영을 친다. 가후가 「가후지책」(시전 지연 30 → 1.9일 동안 아군이 거는 환술이 100% 발동)을
 * 걸고, 책사 둘(가후 · 괴월)이 「공포」(2일 동안 공격력 절반)를 적장마다 **빠짐없이** 꽂는다. 조조는 지력 94라 평소엔
 * 가후의 환술도 22%, 괴월(지력 74)의 것은 0%다 — 기술 없이는 조조의 칼이 그대로 장수를 벤다. 조조를 쓰러뜨리면 이긴다(`killTarget`).
 *
 * 초안의 「책사 둘」은 가후 + 괴월(유표의 책사 — 이때 장수는 유표와 손잡았다)로 읽었다. 장수가 King이라 쓰러지면 진다.
 * 책략은 레벨 규칙대로다(Lv2 환술 = 「공포」 하나). 대본은 가후지책이 서 있는 1.9일 동안 공포 넷을 정해 준다 —
 * 가후 → 조조, 괴월 → 조홍, (장수가 조조를 친다), 가후 → 우금, 괴월 → 조조(다시 걸어 늘린다 — 시각 405까지).
 *
 * **조조는 King이 아니라 Queen이다** (2026-10-24 손질). 기준 AI의 King은 둘레에 아군이 있으면 뒤로 물러나 있다가 홀로 남아서야
 * 나서서, 장수와 조조의 맞대결이 공포가 다 풀린 시각 470 이후에 벌어졌다 — 기술이 판을 안 바꾸었고(책사들이 공포 대신 치기만 해도
 * 이겼다), 맞대결이 크리 몇 번에 갈려 다르게 두면 열두 손 중 넷을 졌다. 이제 조조가 첫 차례(시각 40)부터 장수에게 달려들어 맞대결이
 * 공포가 서 있는 동안 벌어진다. 조홍 · 우금은 진채 양 끝(3,1 · 21,1)에서 달려오느라 맞대결이 끝날 무렵에야 닿는다(조조 곁에 두면
 * 셋이 한꺼번에 장수를 쳐 공포를 걸어도 졌다). 조조를 칠 장수는 대본이 고정한다(`target`).
 * 엔진으로 맞췄다 — 장수 Lv9(AT 4 · HP 30) · 책사 둘 Lv2 대 조조 Lv9(AT 4.5 · HP 25) · 조홍 · 우금 Lv4(AT 3.5 · HP 10).
 * 대본대로면 시각 492에 이기고 장수가 HP 16 남는다 — 대본 밖 차례를 어떻게 두어도 같다(`tools/tutorial_robust.ts` 12/12).
 * 기술 없이(SP 0) 책사들이 차례마다 공포를 걸든 치기만 하든 장수가 시각 371~464에 쓰러진다(조조 HP 9~13 남음).
 * 적은 SP 0으로 시작한다 — 시각 370쯤 조홍이 「일격필살」에 닿는다(그때는 조조가 거의 다 깎였다).
 */
const GONG_PO = 'gong-po' as TacticId;
const GA_HU = U('P1-Bishop');
const GOE_WOL = U('P1-Pawn');
const JANG_SU = U('P1-King');
const JO_JO = U('P2-Queen');
const JO_HONG = U('P2-Rock');
const U_GEUM = U('P2-Knight');
export const gaHu = (): TutorialStage[] => stage('ga-hu', {
  config: config('ga-hu', {
    P1: [
      entry('ga-hu', 'Bishop', 2, { statPicks: ['hp'], tactics: [GONG_PO] }),
      entry('jang-su', 'King', 9, { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp', 'hp', 'hp'] }),
      entry('goe-wol', 'Pawn', 2, { statPicks: ['hp'], tactics: [GONG_PO] }),
    ],
    P2: [
      entry('jo-jo', 'Queen', 9, { statPicks: ['at', 'at', 'at', 'at', 'at', 'hp', 'hp', 'hp'] }),
      entry('jo-hong', 'Rock', 4, { statPicks: ['at', 'at', 'at'] }),
      entry('u-geum', 'Knight', 4, { statPicks: ['at', 'at', 'at'] }),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }, { x: 12, y: 10 }, { x: 14, y: 11 }],
      P2: [{ x: 12, y: 8 }, { x: 3, y: 1 }, { x: 21, y: 1 }],
    },
    // 괴월은 통솔 26(WT 164)이라 늦다 — 가후 다음에 서게 첫 WT를 당긴다
    overrides: { P1: [{ wt: 0 }, undefined, { wt: 40 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killTarget', unit: JO_JO }] },
  }),
  guide: [
    { unit: GA_HU, phases: [
      { lines: ['tut.s.ga-hu.intro', 'tut.s.ga-hu.intro2', say('ga-hu', 1, 'jang-su'), say('ga-hu', 2, 'ga-hu'), 'tut.s.ga-hu.wall', 'tut.s.ga-hu.skill', 'tut.s.ga-hu.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: GA_HU, phases: [{ lines: [say('ga-hu', 3, 'ga-hu'), 'tut.s.ga-hu.ready', 'tut.s.ga-hu.fear'], allow: ['castTactic'], target: JO_JO }] },
    { unit: GOE_WOL, phases: [{ lines: ['tut.s.ga-hu.fear2'], allow: ['castTactic'], target: JO_HONG }] },
    { unit: JANG_SU, phases: [{ lines: [say('ga-hu', 4, 'jo-jo'), 'tut.s.ga-hu.strike'], allow: ['move', 'attack'], target: JO_JO }] },
    { unit: GA_HU, phases: [{ lines: ['tut.s.ga-hu.fear3'], allow: ['castTactic'], target: U_GEUM }] },
    { unit: GOE_WOL, phases: [{ lines: ['tut.s.ga-hu.fear4', 'tut.s.ga-hu.fear5'], allow: ['castTactic'], target: JO_JO }] },
  ] satisfies GuideTurn[],
  outro: [say('ga-hu', 5, 'jang-su'), 'tut.s.ga-hu.done', 'tut.s.ga-hu.done2'],
});
