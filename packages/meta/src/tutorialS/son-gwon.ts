import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 손권 — 유수구 수비 (213) ────────────────────────────────────

/**
 * 조조의 대군이 유수구로 밀려온다. 손권(K) · 주태 · 서성은 지난 싸움에 지쳐 **HP 8/20로 시작**하고, 조조군 넷(조홍 · 이전 · 악진 ·
 * 하후연)이 북쪽에서 내려온다. 조조(K)는 북쪽 끝 본진에 머문다. **4일(시각 400)을 아무도 잃지 않고 버티면 이긴다** —
 * 손권은 King이라 쓰러지면 지고, 주태 · 서성을 잃어도 진다(`unitLost`).
 *
 * 「수성지주」는 손권 둘레 3×3에 성채(0.9일마다 HP 1 회복)를 세운다. 셋이 처음부터 그 안에 서 있게 두어, 적이 닿기 전부터
 * 차오르고 싸우는 동안에도 찬다. 한 칸에 1씩이라 작아 보이지만 셋 × 4일이면 판이 갈린다 — 기술 없이 두면 서성이
 * 시각 355에 쓰러지고, 쓰면 셋 다 시각 400을 넘긴다(엔진으로 자리 · 레벨 · 시작 HP를 훑어 골랐다 — 남는 HP는 아래).
 *
 * 적 넷은 Lv5(공격만 — AT 4). 시각 400 앞에서 끝내는 까닭: 적 SP가 4를 넘으면 조홍 · 악진의 「일격필살」이 터진다.
 * 성채는 그 칸에 선 **누구든** 고친다(적도) — 적이 성채 칸에 올라서는 것도 보인다.
 *
 * 사람의 열 차례를 전부 대본이 정한다(2026-10-24, 「다르게 두어도 이기는가」 9/12 → 12/12) — 주태가 성채 밖으로 나가 치는 손은
 * 회복이 끊기고 둘러싸여 쓰러졌다. 적이 닿기 전 일곱 차례는 [대기]로 성채 안에서 차오르고, 하후연이 성채 앞에 닿은 두 차례
 * (손권 시각 333 · 서성 395)만 자리에서 맞받아 친다(`target`, 이동 없음). 그대로 두면 시각 400에 HP 4 · 12 · 8로 남고,
 * 같은 대본을 기술 없이 두면 손권이 시각 314에 쓰러진다(자유롭게 두어도 열둘 다 진다).
 */
const SON_GWON = U('P1-King');
const JU_TAE = U('P1-Queen');
const SEO_SEONG = U('P1-Pawn');
const HA_HU_YEON = U('P2-Bishop');
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
      lose: [{ kind: 'unitLost', unit: JU_TAE }, { kind: 'unitLost', unit: SEO_SEONG }],
    },
  }),
  guide: [
    { unit: SON_GWON, phases: [
      { lines: ['tut.s.son-gwon.intro', 'tut.s.son-gwon.intro2', say('son-gwon', 1, 'son-gwon'), say('son-gwon', 2, 'ju-tae'), 'tut.s.son-gwon.skill', 'tut.s.son-gwon.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.son-gwon.built', say('son-gwon', 3, 'seo-seong'), 'tut.s.son-gwon.stay'], allow: ['endTurn'] },
    ] },
    // 적이 다가오는 동안은 성채 안에서 [대기] — 나가서 치면 회복이 끊기고 둘러싸인다(손마다 다르게 두면 주태가 쓰러졌다)
    { unit: SON_GWON, phases: [{ lines: ['tut.s.son-gwon.hold'], allow: ['endTurn'] }] },
    { unit: JU_TAE, phases: [{ lines: ['tut.s.son-gwon.holdAll'], allow: ['endTurn'] }] },
    { unit: SEO_SEONG, phases: [{ lines: [], allow: ['endTurn'] }] },
    { unit: SON_GWON, phases: [{ lines: ['tut.s.son-gwon.half'], allow: ['endTurn'] }] },
    { unit: JU_TAE, phases: [{ lines: [], allow: ['endTurn'] }] },
    { unit: SEO_SEONG, phases: [{ lines: [], allow: ['endTurn'] }] },
    // 하후연이 성채 앞에 닿았다 — 자리를 지킨 채 맞받아 친다(이동은 꺼 둔다)
    { unit: SON_GWON, phases: [{ lines: ['tut.s.son-gwon.counter'], allow: ['attack'], target: HA_HU_YEON }] },
    { unit: JU_TAE, phases: [{ lines: [], allow: ['endTurn'] }] },
    { unit: SEO_SEONG, phases: [{ lines: ['tut.s.son-gwon.counter2'], allow: ['attack'], target: HA_HU_YEON }] },
  ] satisfies GuideTurn[],
  outro: [say('son-gwon', 4, 'jo-jo'), 'tut.s.son-gwon.done', 'tut.s.son-gwon.done2'],
});
