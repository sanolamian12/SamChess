import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { O, U, config, entry, stage } from './common.ts';

// ── 여포 — 호로관 (190) ─────────────────────────────────────────

/**
 * 여포 하나가 「인중여포 마중적토」(맵 어디든 **한 번** 이동 + 2.9일 동안 반경 2칸 적 공격력 절반)로 연합군 진영 한복판에
 * 뛰어들어 적들을 물리친다. 장비의 HP가 **절반 이하**가 되는 순간 판이 끝나고(`hpBelow`), 끝 장면에 유비 · 관우가 나타나
 * 여포가 호로관 쪽으로 물러난다(2026-10-24 기획자 — 자유이동은 한 번이라 걸어 돌아오는 목표를 뺐다).
 *
 * 적은 King이 없다 — 원소가 King이면 쓰러뜨리는 순간 대전 승패(군주 격파)가 먼저 판을 끝낸다. 연합군 장수 셋은 HP를 깎아 두어
 * 한 대에 쓰러진다. 여포는 King(8방향 공격) — 뛰어내린 자리에서 둘레를 다 친다.
 */
const YEO_PO = U('P1-King');
const JANG_BI = U('P2-Queen');
export const yeoPo = (): TutorialStage[] => stage('yeo-po', {
  config: config('yeo-po', {
    // 엔진으로 훑어 골랐다 — 연합군 셋을 다 쓰러뜨린 뒤 장비가 절반이 되고, 여포는 HP 절반쯤 남는다(반경 2칸
    // 「공격력 절반」은 2.9일 뒤 풀린다 — 그 뒤 셋에게 둘러싸이면 Lv3 여포는 쓰러졌다)
    P1: [entry('yeo-po', 'King', 6, { statPicks: ['at', 'at', 'hp', 'hp', 'hp'] })],
    P2: [entry('jang-bi', 'Queen', 2), entry('won-so', 'Rock'), entry('gong-son-chan', 'Bishop'), entry('gong-son-wol', 'Knight')],
  }, {
    positions: {
      P1: [{ x: 12, y: 12 }],
      P2: [{ x: 12, y: 1 }, { x: 11, y: 4 }, { x: 13, y: 4 }, { x: 12, y: 5 }],
    },
    overrides: { P1: [{ wt: 0 }], P2: [undefined, { hp: 2 }, { hp: 2 }, { hp: 2 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'hpBelow', unit: JANG_BI, pct: 50 }], lose: [{ kind: 'unitLost', unit: YEO_PO }] },
  }),
  guide: [
    { unit: YEO_PO, phases: [
      { lines: ['tut.s.yeo-po.intro', 'tut.s.yeo-po.intro2', 'tut.s.yeo-po.skill', 'tut.s.yeo-po.skill2'], allow: ['unique'], until: 'skill' },
      { lines: ['tut.s.yeo-po.leap', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 4 }, until: 'moved' },
      { lines: ['tut.s.yeo-po.attack'], allow: ['attack'] },
    ] },
    { unit: YEO_PO, phases: [{ lines: ['tut.s.yeo-po.zhangfei', 'tut.s.yeo-po.zhangfei2'], allow: ['move', 'attack', 'endTurn'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.yeo-po.reinforce', 'tut.s.yeo-po.reinforce2', 'tut.s.yeo-po.done'],
  finale: {
    appear: [
      { officer: O('yu-bi'), piece: 'Pawn', at: { x: 9, y: 1 } },
      { officer: O('gwan-u'), piece: 'Rock', at: { x: 15, y: 1 } },
    ],
    retreat: { unit: YEO_PO, to: { x: 12, y: 13 } },
  },
});
