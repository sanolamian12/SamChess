import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 육손 — 이릉 (222) ───────────────────────────────────────────

/**
 * 유비가 칠백 리에 걸쳐 진채를 늘어세웠다. 육손이 「화소연영」(전 적군이 곧장 최대 HP의 10%, 이어서 2.9일 동안 하루마다
 * 10%씩)으로 진채 전체에 불을 지르고, 타들어 가는 촉군을 맞받아 유비(King)를 쓰러뜨린다 — 대전 규칙 그대로(King 격파).
 * 시전 지연(30)이 있어 기술을 건 차례는 그 자리에서 끝나고, 시각 31에 불이 붙으며 육손의 차례가 다시 온다.
 *
 * 불은 **최대 HP의 %**라 두꺼운 적일수록 크게 탄다 — 촉군은 전부 Lv9(최대 HP 50)이고, 긴 원정에 지쳐 HP가 깎여 있다
 * (장수 넷 15 · 유비 20). 곧장 −5 · 하루마다 −5씩이라 장수 넷은 시각 231에 다 타 쓰러지고, 유비는 홀로 남아 나섰다가
 * 주태 · 서성에게 쓰러진다(시각 456, 사람 차례 14번). 기술 없이 맞서면 셋이 모두 쓰러진다 — 엔진으로 확인했다.
 * 유비의 「삼고초려」는 SP 6이 차기(시각 600) 전에 판이 끝나 나오지 않는다.
 */
const YUK_SON = U('P1-King');
export const yukSon = (): TutorialStage[] => stage('yuk-son', {
  config: config('yuk-son', {
    P1: [
      entry('yuk-son', 'King', 5),
      entry('ju-tae', 'Rock', 5, { statPicks: ['at', 'at', 'hp', 'hp'] }),
      entry('seo-seong', 'Bishop', 5, { statPicks: ['at', 'at', 'hp', 'hp'] }),
    ],
    P2: [
      // 촉군은 두껍게(최대 HP 50) — 불은 최대 HP의 %라 두꺼울수록 크게 탄다
      entry('yu-bi', 'King', 9), entry('jang-po', 'Rock', 9), entry('ma-ryang', 'Pawn', 9),
      entry('o-ui', 'Knight', 9), entry('sa-ma-ga', 'Queen', 9),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }, { x: 11, y: 11 }, { x: 16, y: 11 }],
      P2: [{ x: 12, y: 5 }, { x: 6, y: 6 }, { x: 10, y: 6 }, { x: 14, y: 6 }, { x: 18, y: 6 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 60 }, { wt: 60 }], P2: [{ hp: 20 }, { hp: 15 }, { hp: 15 }, { hp: 15 }, { hp: 15 }] },
    startSp: { P1: 6, P2: 0 },
  }),
  guide: [
    { unit: YUK_SON, phases: [
      { lines: ['tut.s.yuk-son.intro', 'tut.s.yuk-son.intro2', 'tut.s.yuk-son.skill', 'tut.s.yuk-son.delay', 'tut.s.yuk-son.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: YUK_SON, phases: [{ lines: ['tut.s.yuk-son.fire', 'tut.s.yuk-son.hold'], allow: ['move', 'attack', 'endTurn'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.yuk-son.done', 'tut.s.yuk-son.done2'],
});
