import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 노숙 — 익양 대치 (215) ─────────────────────────────────────

/**
 * 형주를 두고 익양에서 관우와 맞선다. 양쪽 다 한창 싸우던 중이다 — **오군 장수 셋은 HP 30%쯤, 노숙은 3/40, 촉군은 반쯤**
 * (관우 10/20 · 관평 · 주창 5/10)으로 시작하고, 적은 오군 앞줄 바로 위(2~3칸)에 붙어 있다 (2026-10-28 기획자 — 치열하게, 더 빨리).
 * 노숙(King)이 「지곤상증」(아군 전원 HP를 최대치의 50% 회복 — 2026-10-28에 30%에서)으로 한 번에 일으켜 세우고 관우 · 관평 · 주창을 물리친다
 * (적 전멸 `wipeOut` — 적은 King이 없다). 노숙이 King이라 쓰러지면 진다(「아군 King 생존」).
 *
 * 엔진으로 맞췄다 — 오군 셋(감녕 · 주태 · 능통) Lv7(AT 3.5 · HP 25, 8로 시작) · 노숙 Lv7(HP 40, 3으로 시작) 대
 * 관우 Lv5(AT 3 · HP 20) · 관평 · 주창 Lv3(AT 3 · HP 10). 시각 359에 이기고 노숙이 HP 23 남는다(30%였을 때 15)
 * (열두 손 239~359 — 붙이기 전에는 566 · 479~678). 감녕은 2026-10-28에 Knight → Bishop(기획자).
 * 첫 차례는 고유기술만 켜 두어 [미사용]이 막힌다(`skipLocked`) — 회복 없는 판은 일어나지 않는다.
 * 노숙은 2026-10-24에 Lv3 → Lv7로 바꿨다 — 회복이 최대 체력 비율이라 최대치를 키우면 회복도 커진다(지금 +20).
 * 적은 SP 0으로 시작해 판이 끝날 때까지 고유기술에 닿지 않는다
 * (관평 · 주창 「용맹전진」 5 · 관우 「온주참화웅」 6).
 */
const NO_SUK = U('P1-King');
export const noSuk = (): TutorialStage[] => stage('no-suk', {
  config: config('no-suk', {
    P1: [
      entry('no-suk', 'King', 7),
      entry('gam-nyeong', 'Bishop', 7, { statPicks: ['at', 'at', 'at', 'hp', 'hp', 'hp'] }),
      entry('ju-tae', 'Rock', 7, { statPicks: ['at', 'at', 'at', 'hp', 'hp', 'hp'] }),
      entry('neung-tong', 'Pawn', 7, { statPicks: ['at', 'at', 'at', 'hp', 'hp', 'hp'] }),
    ],
    P2: [
      entry('gwan-u', 'Queen', 5, { statPicks: ['at', 'at', 'hp', 'hp'] }),
      entry('gwan-pyeong', 'Rock', 3, { statPicks: ['at', 'at'] }),
      entry('ju-chang', 'Knight', 3, { statPicks: ['at', 'at'] }),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 13 }, { x: 10, y: 10 }, { x: 12, y: 10 }, { x: 14, y: 10 }],
      P2: [{ x: 12, y: 6 }, { x: 10, y: 7 }, { x: 14, y: 7 }],
    },
    overrides: { P1: [{ wt: 0, hp: 3 }, { hp: 8 }, { hp: 8 }, { hp: 8 }], P2: [{ hp: 10 }, { hp: 5 }, { hp: 5 }] },
    startSp: { P1: 6, P2: 0 },
  }),
  guide: [
    { unit: NO_SUK, phases: [
      { lines: ['tut.s.no-suk.intro', 'tut.s.no-suk.intro2', say('no-suk', 1, 'gwan-u'), say('no-suk', 2, 'no-suk'), 'tut.s.no-suk.worn', 'tut.s.no-suk.skill', 'tut.s.no-suk.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.no-suk.healed', say('no-suk', 3, 'ju-tae'), 'tut.s.no-suk.wait'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('no-suk', 4, 'no-suk'), 'tut.s.no-suk.done', 'tut.s.no-suk.done2'],
});
