import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 노숙 — 익양 대치 (215) ─────────────────────────────────────

/**
 * 형주를 두고 익양에서 관우와 맞선다. 앞선 싸움으로 오군은 지쳐 있다 — **장수 셋은 HP 30%쯤, 노숙은 3/40으로 시작한다.**
 * 노숙(King)이 「지곤상증」(아군 전원 HP를 최대치의 30% 회복)으로 한 번에 일으켜 세우고 관우 · 관평 · 주창을 물리친다
 * (적 전멸 `wipeOut` — 적은 King이 없다). 노숙이 King이라 쓰러지면 진다(「아군 King 생존」).
 *
 * 엔진으로 맞췄다 — 오군 셋(감녕 · 주태 · 능통) Lv7(AT 3.5 · HP 25, 8로 시작) · 노숙 Lv7(HP 40, 3으로 시작) 대
 * 관우 Lv5(AT 3 · HP 20) · 관평 · 주창 Lv3(AT 3 · HP 10). 회복하면 시각 566에 이기고 노숙이 HP 15 남는다.
 * 노숙은 2026-10-24에 Lv3(HP 20, 6으로 시작) → Lv7(HP 40, 3으로 시작)으로 바꿨다 — 회복이 최대 체력의 30%라 최대치를 키우면
 * 회복은 +6 → +12로 커지고 시작 HP는 낮아 회복 없는 판은 더 빨리 무너진다. 전에는 대본 밖을 다르게 두면 노숙이 HP 3으로 겨우
 * 살았고(무작위 손 둘), 회복 없이도 다가가 치는 손 하나가 이겼다. 이제 열두 손 모두 이기고(노숙 HP 6 이상) 회복 없이는 열두 손 모두 진다.
 * 회복 없이 두면 시각 363 무렵 노숙이 쓰러진다. 적은 SP 0으로 시작해 판이 끝날 때까지 고유기술에 닿지 않는다
 * (관평 · 주창 「용맹전진」 5 · 관우 「온주참화웅」 6).
 */
const NO_SUK = U('P1-King');
export const noSuk = (): TutorialStage[] => stage('no-suk', {
  config: config('no-suk', {
    P1: [
      entry('no-suk', 'King', 7),
      entry('gam-nyeong', 'Knight', 7, { statPicks: ['at', 'at', 'at', 'hp', 'hp', 'hp'] }),
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
      P2: [{ x: 12, y: 4 }, { x: 10, y: 5 }, { x: 14, y: 5 }],
    },
    overrides: { P1: [{ wt: 0, hp: 3 }, { hp: 8 }, { hp: 8 }, { hp: 8 }] },
    startSp: { P1: 6, P2: 0 },
  }),
  guide: [
    { unit: NO_SUK, phases: [
      { lines: ['tut.s.no-suk.intro', 'tut.s.no-suk.intro2', 'tut.s.no-suk.worn', 'tut.s.no-suk.skill', 'tut.s.no-suk.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.no-suk.healed', 'tut.s.no-suk.wait'], allow: ['endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.no-suk.done', 'tut.s.no-suk.done2'],
});
