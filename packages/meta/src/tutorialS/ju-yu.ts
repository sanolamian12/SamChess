import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 주유 — 적벽 전야 · 고육지책 (208) ─────────────────────────────

/**
 * 채모 · 장윤의 수군이 몰래 오나라 진채에 올라 황개 곁까지 다가왔다. 주유와 황개는 적 앞에서 **가짜로 다툰** 뒤, 주유가
 * 「고육지책」으로 황개를 짝으로 정하고 「예」를 골라 황개를 친다(거리와 상관없이). 맞은 황개는 1일 동안 크리 100% · 적의 공격
 * 대상이 되지 않는다 — 채모 · 장윤은 제 편끼리 치고받는 줄 알고 어리둥절한 채 황개에게 베인다. 둘이 쓰러지면 장간이 술병을 들고
 * 주유를 찾아와 군중의 사정을 캐려 한다 — 주유는 「아니오」를 골라 장간을 직접 친다. 장간의 HP가 절반 아래로 떨어지면 이기고
 * (`hpBelow`), 장간은 판 귀퉁이로 물러나 사라진다(끝 장면). 황개가 쓰러지면 진다(`unitLost`), 주유가 쓰러져도 진다(King).
 * **장간은 장수 명단에 없어 채중을 세우고 이 판에서만 「장간」으로 부른다**(`alias`, 2026-11-10 기획자 — 처음엔 감택을 세웠는데
 * 감택은 오나라 쪽 사람이라 주유와 싸우는 구도가 어긋났다).
 * (2026-11-10 기획자 — 고육지책을 「짝을 칠지 차례마다 고른다 · 거리 무관」으로 바꾸며 다시 짰다)
 *
 * 채모 · 장윤 · 장간은 자리를 지킨다(`hold`). 장간은 처음엔 숨어 있다(`hidden`, 판 귀퉁이 B15 · 첫 WT 5000) — 황개가 둘째 차례를
 * 마치면 장면이 주유 곁(L13)으로 걸어 들인다(`scene.move`).
 */
const JU_YU = U('P1-King');
const HWANG_GAE = U('P1-Rock');
const CHAE_MO = U('P2-Rock');
const JANG_YUN = U('P2-Knight');
/** 장간 — 명단에 없어 채중을 세우고 이 판에서만 장간으로 부른다(`alias`) */
const JANG_GAN = U('P2-Bishop');
export const juYu = (): TutorialStage[] => stage('ju-yu', {
  config: config('ju-yu', {
    P1: [
      entry('ju-yu', 'King', 3, { statPicks: ['at', 'at'] }),
      entry('hwang-gae', 'Rock', 7, { statPicks: ['hp', 'hp', 'hp', 'hp', 'at', 'at'] }),
    ],
    P2: [entry('chae-mo', 'Rock', 3), entry('jang-yun', 'Knight', 3), entry('chae-jung', 'Bishop', 3)],
  }, {
    positions: {
      // 주유 M13(진채 안) · 황개 N9(앞) · 채모 O8 · 장윤 M8(황개의 대각 곁) · 장간 B15(숨어 있다)
      P1: [{ x: 12, y: 12 }, { x: 13, y: 8 }],
      P2: [{ x: 14, y: 7 }, { x: 12, y: 7 }, { x: 1, y: 14 }],
    },
    overrides: { P1: [{ wt: 0 }, { wt: 10 }], P2: [{ hp: 6, wt: 30 }, { hp: 6, wt: 40 }, { hp: 12, wt: 5000 }] },
    startSp: { P1: 6, P2: 0 },
    // 장간의 HP가 절반(20의 10) 아래로 — 주유의 한 대(3)면 닿는다
    goals: { win: [{ kind: 'hpBelow', unit: JANG_GAN, pct: 50 }], lose: [{ kind: 'unitLost', unit: HWANG_GAE }] },
  }),
  hold: [CHAE_MO, JANG_YUN, JANG_GAN],
  hidden: [JANG_GAN],
  alias: { 'chae-jung': 'alias.jang-gan' },
  // 황개가 둘째 차례(장윤을 벤 차례)를 마치면 장간이 주유를 찾아온다
  scene: { after: HWANG_GAE, afterTurn: 2, move: { unit: JANG_GAN, to: { x: 11, y: 12 } } },
  guide: [
    { unit: JU_YU, phases: [
      // 적 앞에서 가짜로 다툰 뒤 고육지책
      { lines: ['tut.s.ju-yu.intro', 'tut.s.ju-yu.intro2', say('ju-yu', 1, 'chae-mo'), say('ju-yu', 2, 'ju-yu'), say('ju-yu', 3, 'hwang-gae'), say('ju-yu', 4, 'ju-yu'), 'tut.s.ju-yu.skill', 'tut.s.ju-yu.skill2'], allow: ['unique'], target: HWANG_GAE, until: 'skill' },
      { lines: ['tut.s.ju-yu.ask', 'tut.s.ju-yu.ask2'], allow: ['attack'], target: HWANG_GAE, bitter: 'yes' },
    ], after: ['tut.s.ju-yu.buffed', say('ju-yu', 5, 'chae-mo')] },
    { unit: HWANG_GAE, phases: [{ lines: ['tut.s.ju-yu.cut'], allow: ['attack'], target: CHAE_MO }], after: [say('ju-yu', 6, 'jang-yun')] },
    { unit: JU_YU, phases: [{ lines: ['tut.s.ju-yu.again'], allow: ['attack'], target: HWANG_GAE, bitter: 'yes' }] },
    { unit: HWANG_GAE, phases: [{ lines: ['tut.s.ju-yu.cut2'], allow: ['attack'], target: JANG_YUN }],
      after: ['tut.s.ju-yu.visit', say('ju-yu', 7, 'chae-jung'), say('ju-yu', 10, 'ju-yu')] },
    { unit: JU_YU, phases: [{ lines: ['tut.s.ju-yu.no'], allow: ['attack'], target: JANG_GAN, bitter: 'no' }] },
  ] satisfies GuideTurn[],
  // 장간이 다쳐 달아난다 — 한마디 하고 판 귀퉁이로 물러나 사라진다
  finale: {
    appear: [],
    steps: [{ lines: [say('ju-yu', 11, 'chae-jung')], retreat: [{ unit: JANG_GAN, to: { x: 1, y: 14 } }], leave: true }],
  },
  outro: [say('ju-yu', 8, 'hwang-gae'), say('ju-yu', 9, 'ju-yu'), 'tut.s.ju-yu.done', 'tut.s.ju-yu.done2'],
});
