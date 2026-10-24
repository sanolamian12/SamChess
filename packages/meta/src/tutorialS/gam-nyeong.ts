import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 감녕 — 유수구 백기 야습 (213) ─────────────────────────────────

/**
 * 감녕이 기병 백 기로 조조의 진채를 친다. 「백기겁위영」(1.9일 동안 맵 어디든 이동)으로 장수들의 울타리를 넘어
 * 조조 곁에 내려앉고, 날이 밝기 전(제한 시각 4일, `timeUp`) 조조를 쓰러뜨린다. 조조가 King이라 격파하면
 * 대전 승패(군주 격파)로 이긴다.
 *
 * 초안의 「지형으로 막힌 진영」은 엔진에 못 지나가는 지형이 없어 **거리 + 장수 울타리 + 제한 시각**으로 바꿨다 —
 * 감녕(King, 한 칸씩)이 걸어서는 11줄을 4일 안에 못 건넌다. 감녕이 King이라 쓰러지면 진다(밤 기습이 실패한 것이다).
 * 엔진으로 맞췄다 — 감녕 Lv9(AT 5 · HP 20)이 조조 Lv3(HP 20)을 세 차례(시각 214)에 쓰러뜨리고 HP 14가 남는다.
 * 크리 없이도 네 차례(시각 321)면 닿아 제한 시각 안이다.
 * 감녕의 칼은 대본이 조조에게 고정한다(`target`, 2026-10-24) — 열어 두면 몰려든 적장을 친 손이 조조를 제한 시각 안에 못 쓰러뜨려
 * 열두 손 중 셋이 졌다. 능통은 강가에서 퇴로를 지킨다([대기]만). 그래서 대본 밖 차례가 없고 어떻게 두어도 같은 판이다.
 * 대본은 네 번째 칼(시각 321)까지 적어 둔다 — 시드가 같아 실제로는 세 번째(크리)에 끝난다.
 * 기술 없이는 걸어서 제한 시각 안에 조조에게 닿지 못해 언제나 진다.
 * 적에게는 SP를 안 준다(조홍 · 악진의 「일격필살」은 SP 4 — 판이 그 전에 끝난다).
 */
const GAM_NYEONG = U('P1-King');
const NEUNG_TONG = U('P1-Knight');
const JO_JO = U('P2-King');
export const gamNyeong = (): TutorialStage[] => stage('gam-nyeong', {
  config: config('gam-nyeong', {
    P1: [entry('gam-nyeong', 'King', 9, { statPicks: ['at', 'at', 'at', 'at', 'at', 'at', 'hp', 'hp'] }), entry('neung-tong', 'Knight', 3)],
    P2: [entry('jo-jo', 'King', 3), entry('jo-hong', 'Rock', 3), entry('i-jeon', 'Bishop', 3), entry('ak-jin', 'Pawn', 3)],
  }, {
    positions: {
      P1: [{ x: 12, y: 13 }, { x: 14, y: 13 }],
      P2: [{ x: 12, y: 1 }, { x: 10, y: 4 }, { x: 12, y: 4 }, { x: 14, y: 4 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { lose: [{ kind: 'timeUp', at: 400 }] },
  }),
  guide: [
    { unit: GAM_NYEONG, phases: [
      { lines: ['tut.s.gam-nyeong.intro', 'tut.s.gam-nyeong.intro2', 'tut.s.gam-nyeong.wall', 'tut.s.gam-nyeong.skill', 'tut.s.gam-nyeong.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.gam-nyeong.leap', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 2 }, until: 'moved' },
      { lines: ['tut.s.gam-nyeong.attack'], allow: ['attack'], target: JO_JO },
    ] },
    { unit: GAM_NYEONG, phases: [{ lines: ['tut.s.gam-nyeong.rush', 'tut.s.gam-nyeong.rush2'], allow: ['move', 'attack'], target: JO_JO }] },
    { unit: NEUNG_TONG, phases: [{ lines: ['tut.s.gam-nyeong.hold'], allow: ['endTurn'] }] },
    { unit: GAM_NYEONG, phases: [{ lines: ['tut.s.gam-nyeong.rush2'], allow: ['move', 'attack'], target: JO_JO }] },
    // 여기부터는 크리 없이 맞을 때를 위한 여분이다 — 조조 HP 15면 세 번째 칼(시각 214)에 끝난다
    { unit: NEUNG_TONG, phases: [{ lines: [], allow: ['endTurn'] }] },
    { unit: GAM_NYEONG, phases: [{ lines: ['tut.s.gam-nyeong.rush2'], allow: ['move', 'attack'], target: JO_JO }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.gam-nyeong.done', 'tut.s.gam-nyeong.done2'],
});
