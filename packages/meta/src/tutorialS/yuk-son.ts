import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 육손 — 이릉 (222) ───────────────────────────────────────────

/**
 * 유비가 칠백 리에 걸쳐 진채를 늘어세웠다. 육손이 「화소연영」으로 **유비가 선 줄과 위아래 2줄**(3~7줄)의 가로 전체에 불을 놓는다
 * (2026-11-09 기획자 — 옛 「전 적군 최대 HP 10% × 3」을 바꿨다). 붙는 순간 2, 그 뒤 4.9일 동안 하루마다 2 — 다 맞으면 10.
 * 촉군은 긴 원정에 지쳐 **HP 10**이다 — 기획자가 든 예 그대로 「불을 피하지 않고 5일을 버틴 King은 쓰러진다」.
 * 오군은 **불 바로 바깥 8줄**에 서고, 촉군 넷은 **유비보다 2줄 뒤(3줄)**에서 출발해 불길을 지나 내려와 맞선다(2026-11-09
 * 기획자 — 처음에는 촉군을 진채에 묶어 두었더니 아무도 안 움직였고, 다음에는 7줄에 두었더니 오군과 너무 바짝 붙었다).
 * 주태(Rock · 대각선 공격)와 서성(Bishop · 상하좌우)이 앞에서 받고,
 * 육손(King)은 뒤에 선다. 촉군은 싸우다 불에 타 쓰러지고, 유비는 시각 455 무렵 불 속에서 쓰러져 이긴다.
 * **불은 아군도 태운다.** **6일(시각 600) 안에 유비를 쓰러뜨리지 못하면 진다**(`timeUp`) — 기술 없이 두면 앞줄은 이겨도
 * 유비에게 닿지 못하고 시각 600에 진다(엔진으로 확인했다, 다르게 두어도 12/12).
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
      // 촉군은 Lv9 — 맞붙으면 오군 셋이 못 당한다. 지쳐 HP 10으로 선다(아래 overrides)
      entry('yu-bi', 'King', 9), entry('jang-po', 'Rock', 9), entry('ma-ryang', 'Pawn', 9),
      entry('o-ui', 'Knight', 9), entry('sa-ma-ga', 'Queen', 9),
    ],
  }, {
    positions: {
      // 불은 3~7줄 — 촉군 넷은 유비(5줄)보다 2줄 뒤 3줄, 오군은 불 바로 바깥 8줄. 주태(Rock · 대각선)는 장포 · 마량을 함께, 서성(Bishop · 상하좌우)은 오의를 맡는다
      P1: [{ x: 12, y: 10 }, { x: 12, y: 8 }, { x: 9, y: 8 }],
      P2: [{ x: 12, y: 5 }, { x: 11, y: 3 }, { x: 13, y: 3 }, { x: 9, y: 3 }, { x: 15, y: 3 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 60 }, { wt: 60 }], P2: [{ hp: 10 }, { hp: 10 }, { hp: 10 }, { hp: 10 }, { hp: 10 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { lose: [{ kind: 'timeUp', at: 600 }] },
  }),
  guide: [
    { unit: YUK_SON, phases: [
      { lines: ['tut.s.yuk-son.intro', 'tut.s.yuk-son.intro2', say('yuk-son', 1, 'yu-bi'), say('yuk-son', 2, 'yuk-son'), 'tut.s.yuk-son.skill', 'tut.s.yuk-son.delay', 'tut.s.yuk-son.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: YUK_SON, phases: [{ lines: ['tut.s.yuk-son.fire', say('yuk-son', 3, 'ju-tae'), 'tut.s.yuk-son.hold'], allow: ['move', 'attack', 'endTurn'] }] },
  ] satisfies GuideTurn[],
  outro: [say('yuk-son', 4, 'yu-bi'), 'tut.s.yuk-son.done', 'tut.s.yuk-son.done2'],
});
