import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 손권 — 유수구 수비 (213) ────────────────────────────────────

/**
 * 조조의 대군이 유수구로 밀려온다. 손권(K) · 주태 · 서성은 지난 싸움에 지쳐 **HP 8/20로 시작**하고, 조조군 넷(조홍 · 이전 · 악진 ·
 * 하후연)이 북쪽에서 내려온다. 조조(K)는 북쪽 끝 본진에 머문다. **4일(시각 400)을 아무도 잃지 않고 버티면 이긴다** —
 * 손권은 King이라 쓰러지면 지고, 주태 · 서성을 잃어도 진다(`unitLost`).
 *
 * 「수성지주」는 손권 둘레 3×3에 성채(0.9일마다 HP 1 회복)를 세운다. 셋이 처음부터 그 안에 서 있게 두어, 적이 닿기 전부터
 * 차오르고 싸우는 동안에도 찬다. 한 칸에 1씩이라 작아 보이지만 셋 × 4일이면 판이 갈린다 — 기술 없이 두면 서성이
 * 시각 355에 쓰러지고, 쓰면 시각 400에 셋이 HP 12 · 6 · 4로 남는다(엔진으로 자리 · 레벨 · 시작 HP를 훑어 골랐다).
 *
 * 적 넷은 Lv5(공격만 — AT 4). 시각 400 앞에서 끝내는 까닭: 적 SP가 4를 넘으면 조홍 · 악진의 「일격필살」이 터진다.
 * 성채는 그 칸에 선 **누구든** 고친다(적도) — 적이 성채 칸에 올라서는 것도 보인다.
 */
const SON_GWON = U('P1-King');
const ENEMY = { statPicks: ['at', 'at', 'at', 'at'] } as const;
export const sonGwon = (): TutorialStage[] => stage('son-gwon', {
  config: config('son-gwon', {
    P1: [entry('son-gwon', 'King', 3), entry('ju-tae', 'Queen', 3), entry('seo-seong', 'Pawn', 3)],
    P2: [
      entry('jo-jo', 'King', 5), entry('jo-hong', 'Rock', 5, { statPicks: [...ENEMY.statPicks] }),
      entry('i-jeon', 'Queen', 5, { statPicks: [...ENEMY.statPicks] }), entry('ak-jin', 'Knight', 5, { statPicks: [...ENEMY.statPicks] }),
      entry('ha-hu-yeon', 'Bishop', 5, { statPicks: [...ENEMY.statPicks] }),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 13 }, { x: 11, y: 12 }, { x: 13, y: 12 }],
      P2: [{ x: 12, y: 0 }, { x: 12, y: 4 }, { x: 9, y: 4 }, { x: 14, y: 4 }, { x: 16, y: 4 }],
    },
    overrides: { P1: [{ wt: 0, hp: 8 }, { hp: 8 }, { hp: 8 }] },
    startSp: { P1: 6, P2: 0 },
    goals: {
      win: [{ kind: 'survive', until: 400 }],
      lose: [{ kind: 'unitLost', unit: U('P1-Queen') }, { kind: 'unitLost', unit: U('P1-Pawn') }],
    },
  }),
  guide: [
    { unit: SON_GWON, phases: [
      { lines: ['tut.s.son-gwon.intro', 'tut.s.son-gwon.intro2', 'tut.s.son-gwon.skill', 'tut.s.son-gwon.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.son-gwon.built', 'tut.s.son-gwon.stay'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.son-gwon.done', 'tut.s.son-gwon.done2'],
});
