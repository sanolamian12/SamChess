import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 장료 — 합비 · 소요진 (215) ───────────────────────────────────

/**
 * 손권의 십만 대군이 합비를 에워싼다. 장료가 「장료지제」(지금 즉시 모든 적을 한 번씩 — 거리와 상관없다)로 사방에 흩어진
 * 오나라 장수들을 한꺼번에 친다. 적 넷을 쓰러뜨리거나(`killCount`) 손권(King)을 쓰러뜨리면 이긴다.
 * 시전 지연(30)이 있어 기술을 건 차례가 그 자리에서 끝나고, 다음 차례가 오기 직전에 발동한다.
 *
 * 오나라 장수 넷은 판의 네 귀퉁이 쪽에 흩어져 있고 HP를 3으로 깎아 두었다 — Lv3 장료(AT 3)의 한 대에 쓰러진다.
 * 손권은 HP 그대로라 버티고 달아난다(끝맺음). 적의 첫 WT는 40 이상이라 발동(시각 31)보다 먼저 움직이지 않는다.
 * 기술 없이 하나씩 쫓으면 제한 시각 300(3일) 안에 넷을 못 채운다 — 엔진으로 확인했다(하나만 쓰러진다).
 * 이전 · 악진은 첫 WT 150 — 발동 전에는 차례가 오지 않는다.
 */
const JANG_RYO = U('P1-Queen');
export const jangRyo = (): TutorialStage[] => stage('jang-ryo', {
  config: config('jang-ryo', {
    P1: [entry('jang-ryo', 'Queen', 3, { statPicks: ['at', 'at'] }), entry('i-jeon', 'Rock'), entry('ak-jin', 'Knight')],
    P2: [
      entry('son-gwon', 'King'), entry('neung-tong', 'Rock'), entry('ju-tae', 'Knight'),
      entry('seo-seong', 'Bishop'), entry('jang-heum', 'Pawn'),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 9 }, { x: 10, y: 13 }, { x: 14, y: 13 }],
      P2: [{ x: 12, y: 2 }, { x: 5, y: 5 }, { x: 19, y: 5 }, { x: 6, y: 10 }, { x: 18, y: 10 }],
    },
    overrides: {
      P1: [{ wt: 0 }, { wt: 150 }, { wt: 150 }],
      P2: [{ wt: 60 }, { hp: 3, wt: 40 }, { hp: 3, wt: 45 }, { hp: 3, wt: 50 }, { hp: 3, wt: 55 }],
    },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killCount', count: 4 }], lose: [{ kind: 'unitLost', unit: JANG_RYO }, { kind: 'timeUp', at: 300 }] },
  }),
  guide: [
    { unit: JANG_RYO, phases: [
      { lines: ['tut.s.jang-ryo.intro', 'tut.s.jang-ryo.intro2', 'tut.s.jang-ryo.skill', 'tut.s.jang-ryo.delay', 'tut.s.jang-ryo.skill2'], allow: ['unique'], until: 'skill' },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.jang-ryo.done', 'tut.s.jang-ryo.done2', 'tut.s.jang-ryo.done3'],
});
