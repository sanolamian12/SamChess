import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 제갈량 — 적벽 (208) ──────────────────────────────────────────

/**
 * 제갈량이 남병산 칠성단(지도 왼쪽 아래)에서 동남풍을 빌었다 — 바람이 부는 **2.2일 안에** 조조(King, 기함 위에 홀로)를
 * 쓰러뜨려야 한다(`timeUp` 220). 주인공은 다른 장수의 기술이다: 화선을 모는 정봉의 「일격필살」(0.9일 동안 크리티컬 100%,
 * 시전 지연 30)을 제갈량의 「차동풍」(**이미 쓴** 아군의 고유기술을 다시 쓸 수 있게)으로 되살려 두 번 쓴다.
 *
 * 정봉의 크리는 9, 조조는 HP 18 — 확정 크리 두 번(t 31 · t 183)이라야 바람이 멎기 전에 쓰러진다. 차동풍이 없으면 둘째 공격(t 152)은
 * 20% 굴림이고, 셋째(t 273)는 이미 늦다 — 엔진으로 확인했다(조조 HP 5로 남고 t 226에 진다. 조조의 첫 WT 40은 이 굴림이 실제로
 * 빗나가는 자리로 골랐다). SP는 14로 시작해 일격필살 4 + 차동풍 6을 쓰고, 둘째 일격필살 4는 시간 충전으로 찬다(상한 15 = 3명 × 5).
 *
 * 초안(§4)의 황개 · 정보 · 감택(공용 기술 보유) · 조조군 넷과 달리 정봉 · 감택 · 조조 홀로다 — 차동풍은 「안 쓴 기술을 두 번」이
 * 아니라 「쓴 기술을 되살리기」라(`restoreAllyUniqueSkills`) 한 사람의 기술을 쓰고 → 되살리고 → 다시 쓰는 흐름이 가장 또렷하고,
 * 황개 · 정보의 「용맹전진」(피해 절반)으로는 두 번째가 판을 가르지 못했다. 감택은 칠성단 곁(SP 상한을 채우는 자리)에 선다.
 * 조조가 홀로라 물러나지 않고 맞선다(홀로 남은 King) — 정봉이 다시 쫓지 않아도 된다.
 */
const JE_GAL_RYANG = U('P1-Pawn');
const JEONG_BONG = U('P1-Knight');
const GAM_TAEK = U('P1-Bishop');
export const jeGalRyang = (): TutorialStage[] => stage('je-gal-ryang', {
  config: config('je-gal-ryang', {
    P1: [
      entry('je-gal-ryang', 'Pawn', 3),
      entry('jeong-bong', 'Knight', 8, { statPicks: ['at', 'at', 'at', 'at', 'at', 'hp', 'hp'] }),
      entry('gam-taek', 'Bishop', 3),
    ],
    P2: [entry('jo-jo', 'King', 3)],
  }, {
    positions: {
      P1: [{ x: 3, y: 12 }, { x: 13, y: 5 }, { x: 4, y: 13 }],
      P2: [{ x: 12, y: 2 }],
    },
    overrides: { P1: [{ wt: 1 }, { wt: 0 }], P2: [{ hp: 18, wt: 40 }] },
    startSp: { P1: 14, P2: 0 },
    goals: { lose: [{ kind: 'timeUp', at: 220 }] },
  }),
  guide: [
    { unit: JEONG_BONG, phases: [
      { lines: ['tut.s.je-gal-ryang.intro', 'tut.s.je-gal-ryang.intro2', 'tut.s.je-gal-ryang.fire', 'tut.s.je-gal-ryang.fire2', 'tut.s.je-gal-ryang.fire3'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: JE_GAL_RYANG, phases: [
      { lines: ['tut.s.je-gal-ryang.wind', 'tut.s.je-gal-ryang.wind2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.je-gal-ryang.pass'], allow: ['endTurn'] },
    ] },
    { unit: JEONG_BONG, phases: [
      { lines: ['tut.s.je-gal-ryang.ram', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 3 }, until: 'moved' },
      { lines: ['tut.s.je-gal-ryang.strike'], allow: ['attack'] },
    ] },
    { unit: JE_GAL_RYANG, phases: [{ lines: ['tut.s.je-gal-ryang.pass'], allow: ['endTurn'] }] },
    { unit: GAM_TAEK, phases: [{ lines: ['tut.s.je-gal-ryang.pass'], allow: ['endTurn'] }] },
    { unit: JEONG_BONG, phases: [{ lines: ['tut.s.je-gal-ryang.again', 'tut.s.je-gal-ryang.again2'], allow: ['unique'], until: 'skill' }] },
    { unit: JEONG_BONG, phases: [{ lines: ['tut.s.je-gal-ryang.finish'], allow: ['move', 'attack', 'endTurn'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.je-gal-ryang.done', 'tut.s.je-gal-ryang.done2'],
});
