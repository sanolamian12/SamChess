import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 손견 — 양인 (191) ───────────────────────────────────────────

/**
 * 손견(K) · 정보 · 한당 · 황개가 판 위쪽에 몰린 호진(K)을 친다. 동탁군의 여포가 남서쪽에서 달려오고,
 * 여포가 닿기 전(**2일** — 시각 200, `timeUp`)에 호진을 쓰러뜨려야 한다. 여포는 이길 상대가 아니라 **시계**다.
 * (2026-11-09 기획자: 시간은 소수점 없이 2.3일 → 2일 · 맨 윗줄 · 맨 왼줄은 지도 좌표 글자에 가려 한 칸씩 안으로 —
 * 호진 12,0 → 12,1 · 여포 0,14 → 1,14, 아군 넷도 한 줄 내려 거리를 그대로 두었다.)
 *
 * 「강동지호」(시전 지연 30, 1.9일 동안 아군 전원 크리티컬 100%)가 발동하면 아군 넷의 한 대가 2 → 4가 된다.
 * 호진은 Lv5에 HP를 28/30로 깎아 둔다 — 크리티컬(4) 일곱 대(시각 162)에 쓰러지고, 기술 없이 두면 어느 손으로 두어도
 * 시각 200에 HP 8쯤 남는다(평소에도 무력 차로 크리티컬이 꽤 터지지만 모자란다). 30이면 여덟 대가 다 닿아야 해서
 * 둘째 바퀴에 정보가 못 닿는 손이 HP 2를 남기고 졌다(2026-10-24, 「다르게 두어도 이기는가」 8/12 → 12/12).
 * 첫 바퀴 네 차례(손견 · 정보 · 한당 · 황개)는 [공격]을 호진에 묶어 자리가 손마다 갈리지 않게 했다.
 *
 * 첫 WT — 손견 0으로 먼저 걸고, 아군 셋은 35 · 40 · 45로 **발동(시각 31) 뒤에** 서게 해 첫 공격부터 크리티컬이 실린다.
 * 셋은 한 걸음이면 호진을 칠 수 있는 자리에 선다. 호진은 자리를 지킨다(`hold`) — 위에 한 줄이 비어 있어 그대로 두면
 * 맨 윗줄로 달아나 황개(Knight)가 첫 바퀴에 못 닿았다. 궁지에 몰린 장수라 이야기에도 맞다.
 */
const SON_GYEON = U('P1-King');
const HO_JIN = U('P2-King');
export const sonGyeon = (): TutorialStage[] => stage('son-gyeon', {
  config: config('son-gyeon', {
    P1: [entry('son-gyeon', 'King', 3), entry('jeong-bo', 'Rock', 2), entry('han-dang', 'Pawn', 2), entry('hwang-gae', 'Knight', 2)],
    P2: [entry('ho-jin', 'King', 5), entry('yeo-po', 'Queen', 6)],
  }, {
    positions: {
      P1: [{ x: 13, y: 3 }, { x: 11, y: 5 }, { x: 12, y: 4 }, { x: 14, y: 3 }],
      P2: [{ x: 12, y: 1 }, { x: 1, y: 14 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 35 }, { wt: 40 }, { wt: 45 }], P2: [{ hp: 28 }, { wt: 50 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { lose: [{ kind: 'timeUp', at: 200 }] },
  }),
  guide: [
    { unit: SON_GYEON, phases: [
      { lines: ['tut.s.son-gyeon.intro', 'tut.s.son-gyeon.intro2', say('son-gyeon', 1, 'ho-jin'), say('son-gyeon', 2, 'son-gyeon'), 'tut.s.son-gyeon.skill', 'tut.s.son-gyeon.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: SON_GYEON, phases: [{ lines: ['tut.s.son-gyeon.fired', say('son-gyeon', 3, 'jeong-bo'), 'tut.s.son-gyeon.fired2'], allow: ['move', 'attack'], target: HO_JIN }] },
    { unit: U('P1-Rock'), phases: [{ lines: ['tut.s.son-gyeon.jeongbo'], allow: ['move', 'attack'], target: HO_JIN }] },
    { unit: U('P1-Pawn'), phases: [{ lines: ['tut.s.son-gyeon.handang'], allow: ['move', 'attack'], target: HO_JIN }] },
    { unit: U('P1-Knight'), phases: [{ lines: ['tut.s.son-gyeon.hwanggae'], allow: ['move', 'attack'], target: HO_JIN }] },
  ] satisfies GuideTurn[],
  hold: [HO_JIN],
  outro: [say('son-gyeon', 4, 'son-gyeon'), 'tut.s.son-gyeon.done', 'tut.s.son-gyeon.done2'],
});
