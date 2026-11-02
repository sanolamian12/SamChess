import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import type { RosterEntry, TacticId } from '@samchess/rules';
import { O, U, config, entry, say, stage } from './common.ts';

// ── 서서 — 신야 팔문금쇄 (201) ──────────────────────────────────

/**
 * **두 판이다** (2026-11-02 기획자 — 『연의』 36회의 순서대로).
 *
 * **첫 판 — 팔문금쇄진.** 조인(Queen)이 진 한가운데(12,2), 이전(Rock)이 그 곁(14,3)에 있다. 유비 · 서서 · 조운이 진을 깨뜨릴 길을
 * 의논하고, 조운이 부표가 선 **생문**(동남쪽 문, 17,4)으로 간다. 그 차례가 끝나면 진이 흐트러진다(장면 `rout` — 조인 · 이전 HP 10 → 5).
 * 조운은 한 번 뛰어(15,3) 이전을, 다시 한 번 뛰어(13,2) 조인을 친다 — 공격력 5라 반피는 한 대다. 첫 판은 처음부터 끝까지 대본이고,
 * 그동안 다른 장수는 차례가 오지 않는다(시작 WT 400). 이기면 북서쪽 구석(2,2 · 2,3 — 맨 윗줄은 좌표 글자 · 전투 기록에 가린다)에 조조 · 정욱이 나타난다(`finale`).
 *
 * **둘째 판 — 위조 편지.** 조운은 진을 꿰뚫고 **경문**(서쪽 문)으로 나온 자리(5,4)에 서 있다. 유비의 차례에 서서가 어머니의 편지(정욱이
 * 글씨를 흉내 내 꾸민 것)를 받고, 그 차례가 끝나면 서서가 조조 앞(4,3)으로 끌려간다(장면 `move`). 서서의 차례에 「신재조영 심재촉」 —
 * 서서 자신과 적 전체가 게임 끝까지 책략을 못 쓴다. 조조 · 정욱은 Lv8에 MP만 올렸다(HP 10 · MP 19 · 공격력 2, 「질병」 · 「경직」 · 「함정」) —
 * 책략이 봉해지면 칼만 남는다. 둘은 자리를 지킨다(`hold` — 기준 AI의 King은 노려지면 물러나 쫓지 못한다). 조운이 달려와 치든 서서가 치든 이긴다.
 * 적의 첫 차례(WT 40)는 서서의 시전(WT 1) 뒤라, 기술 전에 책략이 걸리는 일은 없다.
 */
const picks = (hp: number, mp: number, at = 0): RosterEntry['statPicks'] => [...Array(hp).fill('hp'), ...Array(mp).fill('mp'), ...Array(at).fill('at')];
const CASTER = ['jil-byeong', 'gyeong-jik', 'ham-jeong'] as TacticId[];

const SEO_SEO = U('P1-Pawn');
const JO_UN = U('P1-Knight');
const YU_BI = U('P1-King');
const JO_IN = U('P2-Queen');
const I_JEON = U('P2-Rock');

/** 조운 — 공격력 5(반피가 된 조인 · 이전을 한 대에), HP 15. 두 판이 같다 */
const joUn = (): RosterEntry => entry('jo-un', 'Knight', 8, { statPicks: picks(1, 0, 6) });
/** 생문 — 팔문금쇄진의 동남쪽 문 */
const SAENG_MUN = { x: 17, y: 4 };
/** 조조 · 정욱이 나타나는 북서쪽 구석 */
const JO_JO_AT = { x: 2, y: 2 };
const JEONG_UK_AT = { x: 2, y: 3 };

export const seoSeo = (): TutorialStage[] => [
  ...stage('seo-seo', {
    config: config('seo-seo', {
      P1: [entry('seo-seo', 'Pawn', 3), joUn(), entry('yu-bi', 'King', 5)],
      P2: [
        entry('jo-in', 'Queen', 5, { statPicks: picks(0, 0, 4) }),
        entry('i-jeon', 'Rock', 5, { statPicks: picks(0, 0, 4) }),
      ],
    }, {
      positions: {
        P1: [{ x: 13, y: 8 }, { x: 16, y: 6 }, { x: 12, y: 9 }],
        P2: [{ x: 12, y: 2 }, { x: 14, y: 3 }],
      },
      overrides: { P1: [{ wt: 400 }, { wt: 0 }, { wt: 400 }], P2: [{ wt: 400 }, { wt: 400 }] },
      startSp: { P1: 0, P2: 0 },
    }),
    hold: [JO_IN, I_JEON],
    buoys: [SAENG_MUN],
    scene: { after: JO_UN, rout: { units: [JO_IN, I_JEON], hp: 5 } },
    guide: [
      { unit: JO_UN, phases: [
        { lines: ['tut.s.seo-seo.intro', 'tut.s.seo-seo.intro2', say('seo-seo', 1, 'yu-bi'), say('seo-seo', 2, 'seo-seo'), say('seo-seo', 3, 'jo-un'), say('seo-seo', 4, 'seo-seo'), 'tut.s.seo-seo.gate'], allow: ['move'], moveTo: SAENG_MUN, until: 'moved' },
        { lines: ['tut.s.seo-seo.gate2'], allow: ['endTurn'] },
      ] },
      { unit: JO_UN, phases: [
        { lines: [say('seo-seo', 5, 'jo-in'), 'tut.s.seo-seo.rout', 'tut.s.seo-seo.hit1'], allow: ['move'], moveTo: { x: 15, y: 3 }, until: 'moved' },
        { lines: [], allow: ['attack'], target: I_JEON },
      ] },
      { unit: JO_UN, phases: [
        { lines: ['tut.s.seo-seo.hit2'], allow: ['move'], moveTo: { x: 13, y: 2 }, until: 'moved' },
        { lines: [], allow: ['attack'], target: JO_IN },
      ] },
    ] satisfies GuideTurn[],
    outro: ['tut.s.seo-seo.broken', say('seo-seo', 6, 'jo-jo', true), say('seo-seo', 7, 'jeong-uk', true)],
    finale: {
      appear: [
        { officer: O('jo-jo'), piece: 'King', at: JO_JO_AT },
        { officer: O('jeong-uk'), piece: 'Pawn', at: JEONG_UK_AT },
      ],
    },
  }),
  ...stage('seo-seo', {
    config: config('seo-seo', {
      P1: [entry('seo-seo', 'Pawn', 5), joUn(), entry('yu-bi', 'King', 5)],
      P2: [
        entry('jo-jo', 'King', 8, { statPicks: picks(0, 7), tactics: CASTER }),
        entry('jeong-uk', 'Pawn', 8, { statPicks: picks(0, 7), tactics: CASTER }),
      ],
    }, {
      positions: {
        P1: [{ x: 13, y: 8 }, { x: 5, y: 4 }, { x: 12, y: 9 }],
        P2: [JO_JO_AT, JEONG_UK_AT],
      },
      overrides: { P1: [{ wt: 1 }, { wt: 60 }, { wt: 0 }], P2: [{ wt: 40 }, { wt: 45 }] },
      startSp: { P1: 6, P2: 0 },
    }),
    hold: [U('P2-King'), U('P2-Pawn')],
    scene: { after: YU_BI, move: { unit: SEO_SEO, to: { x: 4, y: 3 } } },
    guide: [
      { unit: YU_BI, phases: [
        { lines: ['tut.s.seo-seo.letter', say('seo-seo', 8, 'seo-seo'), say('seo-seo', 9, 'yu-bi'), 'tut.s.seo-seo.wait'], allow: ['endTurn'] },
      ] },
      { unit: SEO_SEO, phases: [
        { lines: ['tut.s.seo-seo.forged', say('seo-seo', 10, 'seo-seo'), 'tut.s.seo-seo.skill', 'tut.s.seo-seo.skill2'], allow: ['unique'], until: 'skill' },
        { lines: ['tut.s.seo-seo.drained', say('seo-seo', 11, 'jeong-uk'), 'tut.s.seo-seo.fight'], allow: ['move', 'attack', 'endTurn'] },
      ] },
    ] satisfies GuideTurn[],
    outro: [say('seo-seo', 12, 'seo-seo'), 'tut.s.seo-seo.done', 'tut.s.seo-seo.done2'],
  }),
];
