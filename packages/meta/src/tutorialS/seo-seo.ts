import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import type { RosterEntry, TacticId } from '@samchess/rules';
import { U, config, entry, stage } from './common.ts';

// ── 서서 — 신야 팔문금쇄 (201) ──────────────────────────────────

/**
 * 조인의 군이 신야로 밀려온다. 서서 · 조운 · 유비(K)가 맞서고, 적은 조인 · 이전(앞) + 책사 정욱 · 유엽(뒤)이다. **적 전멸**로 이긴다.
 *
 * 「신재조영 심재촉」(적 전체 MP 0)이 책략을 통째로 뽑는다. 책사 둘은 Lv8(MP만 올려 19)에 「질병」(1일마다 HP 1) · 「경직」(WT +1일) ·
 * 「함정」을 들고, 닿지 않는 차례마다 그것을 건다(기준 AI는 칠 수 없는 차례에 책략을 쓴다). 기술 없이 두면 아군이 병들고 굳어
 * 유비가 쓰러진다(엔진으로 두어 보니 시각 727에 군주 격파). 쓰면 책사들은 명상으로 1씩 모으다 「함정」 한 번에 그치고,
 * 시각 727에 적이 전멸한다 — 아군은 HP 16 · 15 · 17이 남는다.
 *
 * 무대표(§4)의 여광 · 여상은 **정욱 · 유엽으로 바꿨다** — 환술 성공률이 `20 + 지력 차`라 지력 25 · 23으로는 유비(64)에게 0%다.
 * 「책략 위주」인 적이 실제로 책략을 걸어야 MP 0이 뜻을 가진다. 조인은 King으로 두지 않았다 — 기준 AI의 King은 노려지면 물러나
 * 대본 밖의 손(한 걸음에 닿으면 친다)이 쫓지 못했다. 그래서 판의 끝은 계획대로 「적 전멸」이다.
 * 「초선」 · 「유인」(아군 조종)은 넣지 않았다 — 조종당한 아군의 차례는 대본으로 둘 수 없다.
 */
const SEO_SEO = U('P1-Pawn');
const picks = (hp: number, mp: number, at = 0): RosterEntry['statPicks'] => [...Array(hp).fill('hp'), ...Array(mp).fill('mp'), ...Array(at).fill('at')];
const CASTER = ['jil-byeong', 'gyeong-jik', 'ham-jeong'] as TacticId[];
export const seoSeo = (): TutorialStage[] => stage('seo-seo', {
  config: config('seo-seo', {
    P1: [entry('seo-seo', 'Pawn', 3), entry('jo-un', 'Knight', 7, { statPicks: picks(3, 0, 3) }), entry('yu-bi', 'King', 5)],
    P2: [
      entry('jo-in', 'Queen', 5, { statPicks: picks(0, 0, 4) }),
      entry('i-jeon', 'Rock', 5, { statPicks: picks(0, 0, 4) }),
      entry('jeong-uk', 'Pawn', 8, { statPicks: picks(0, 7), tactics: CASTER }),
      entry('yu-yeop', 'Bishop', 8, { statPicks: picks(0, 7), tactics: CASTER }),
    ],
  }, {
    positions: {
      P1: [{ x: 12, y: 11 }, { x: 13, y: 10 }, { x: 12, y: 12 }],
      P2: [{ x: 12, y: 5 }, { x: 10, y: 5 }, { x: 12, y: 2 }, { x: 14, y: 3 }],
    },
    overrides: { P1: [{ wt: 0 }] },
    startSp: { P1: 6, P2: 0 },
  }),
  guide: [
    { unit: SEO_SEO, phases: [
      { lines: ['tut.s.seo-seo.intro', 'tut.s.seo-seo.intro2', 'tut.s.seo-seo.skill', 'tut.s.seo-seo.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.seo-seo.drained', 'tut.s.seo-seo.fight'], allow: ['move', 'attack', 'endTurn'] },
    ] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.seo-seo.done', 'tut.s.seo-seo.done2'],
});
