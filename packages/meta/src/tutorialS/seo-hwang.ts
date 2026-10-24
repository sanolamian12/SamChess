import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 서황 — 번성 구원 (219) ──────────────────────────────────────

/**
 * 관우군의 관평 · 주창 · 요화 · 미방이 번성의 조인(K)을 에워쌌다. 서황이 바깥에서 달려와 **2일 안에(시각 200 — `timeUp`)**
 * 넷을 쓰러뜨려 포위를 푼다(`killCount` 4). 적은 King이 없다 — 넷을 다 쓰러뜨리면 전멸로도 같은 순간에 끝난다.
 *
 * 「병귀신속」(차례가 세 번 돌아올 동안 WT −0.5일)으로 서황의 WT가 107 → 57이 되어, 시각 0 · 58 · 116 · 174에 네 번 선다.
 * 적장들은 HP 4로 깎아 두어 서황(Lv5, 공격만 올려 AT 4)의 한 대에 쓰러진다 — 한 차례에 하나씩, 넷이면 네 차례다.
 * 기술 없이 두면 서황은 시각 0 · 107에만 서고 조인(AT 2)이 한 명을 거들어도 시각 200에 둘이 남는다(엔진으로 확인했다).
 * 조인은 Lv4(HP 25) — 둘러싸여 맞아도 버틴다(끝에 19쯤 남는다).
 *
 * 서황의 네 차례는 전부 대본이 정한다(2026-10-24, 「다르게 두어도 이기는가」 6/12 → 12/12) — 첫 둘은 칸까지(12,10 → 미방,
 * 13,8 → 요화), 뒤 둘은 대상만(주창 · 관평 — `target`이 [공격]을 묶는다). 칸을 비워 두면 다른 칸으로 간 서황이 셋째 차례에
 * 주창에게 못 닿아 시각 200에 하나가 남았다. 사이에 끼는 조인의 차례(시각 111)도 주창을 친다.
 */
const SEO_HWANG = U('P1-Knight');
const JO_IN = U('P1-King');
const [GWAN_PYEONG, JU_CHANG, YO_HWA, MI_BANG] = [U('P2-Queen'), U('P2-Rock'), U('P2-Bishop'), U('P2-Pawn')];
export const seoHwang = (): TutorialStage[] => stage('seo-hwang', {
  config: config('seo-hwang', {
    P1: [entry('seo-hwang', 'Knight', 5, { statPicks: ['at', 'at', 'at', 'at'] }), entry('jo-in', 'King', 4)],
    P2: [entry('gwan-pyeong', 'Queen'), entry('ju-chang', 'Rock'), entry('yo-hwa', 'Bishop'), entry('mi-bang', 'Pawn')],
  }, {
    positions: {
      P1: [{ x: 14, y: 11 }, { x: 12, y: 7 }],
      P2: [{ x: 12, y: 5 }, { x: 11, y: 6 }, { x: 13, y: 7 }, { x: 12, y: 9 }],
    },
    overrides: { P1: [{ wt: 0 }], P2: [{ hp: 4 }, { hp: 4 }, { hp: 4 }, { hp: 4 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killCount', count: 4 }], lose: [{ kind: 'timeUp', at: 200 }] },
  }),
  guide: [
    { unit: SEO_HWANG, phases: [
      { lines: ['tut.s.seo-hwang.intro', 'tut.s.seo-hwang.intro2', 'tut.s.seo-hwang.skill', 'tut.s.seo-hwang.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.seo-hwang.attack', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 10 }, until: 'moved' },
      { lines: ['tut.s.seo-hwang.hit'], allow: ['attack'], target: MI_BANG },
    ] },
    { unit: SEO_HWANG, phases: [
      { lines: ['tut.s.seo-hwang.again', 'tut.go.move'], allow: ['move'], moveTo: { x: 13, y: 8 }, until: 'moved' },
      { lines: ['tut.s.seo-hwang.again2'], allow: ['attack'], target: YO_HWA },
    ] },
    { unit: JO_IN, phases: [{ lines: ['tut.s.seo-hwang.join'], allow: ['attack'], target: JU_CHANG }] },
    { unit: SEO_HWANG, phases: [{ lines: ['tut.s.seo-hwang.third'], allow: ['move', 'attack'], target: JU_CHANG }] },
    { unit: SEO_HWANG, phases: [{ lines: ['tut.s.seo-hwang.last'], allow: ['move', 'attack'], target: GWAN_PYEONG }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.seo-hwang.done', 'tut.s.seo-hwang.done2'],
});
