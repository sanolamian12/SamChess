import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, stage } from './common.ts';

// ── 태사자 — 북해 구원 (193) ─────────────────────────────────────

/**
 * 황건적 관해가 북해성 성문 앞까지 밀고 들어와 공융(King, 성 안)을 노린다. 공융은 지쳐 있어(HP 4) 관해의 한 대에 쓰러진다 —
 * 태사자가 「소패왕전」으로 관해를 일기토에 묶으면(둘 중 하나가 쓰러질 때까지 **서로만** 칠 수 있다) 관해의 창이 공융에게
 * 못 간다. 관해를 쓰러뜨리면 이긴다(`killTarget`). 공융이 쓰러지면 대전 승패(군주 격파)로 진다.
 *
 * 엔진으로 확인했다: 기술 없이 같은 수를 두면 관해가 t 138에 공융을 친다. 기술을 쓰면 관해는 태사자만 치고(한 대 2),
 * 태사자가 네 번째 공격(t 331)에 관해를 쓰러뜨린다. 남은 황건 셋(한섬 · 장연 · 유벽)은 판 위쪽 황건 진영에서 내려오는 중이라
 * 일기토가 끝나기 전에 공융에게 닿지 않는다. 공융은 관해와 4칸 떨어져 서서 스스로 나서지 않는다(회귀의 손은 한 걸음에
 * 칠 수 있는 적만 친다). 적 셋은 C · D급이라 고유기술이 없다.
 */
const TAE_SA_JA = U('P1-Knight');
const GWAN_HAE = U('P2-Queen');
export const taeSaJa = (): TutorialStage[] => stage('tae-sa-ja', {
  config: config('tae-sa-ja', {
    P1: [entry('tae-sa-ja', 'Knight', 7, { statPicks: ['at', 'at', 'at', 'at', 'hp', 'hp'] }), entry('gong-yung', 'King')],
    P2: [entry('gwan-hae', 'Queen', 3, { statPicks: ['hp', 'at'] }), entry('han-seom', 'Rock'), entry('jang-yeon', 'Bishop'), entry('yu-byeok', 'Pawn')],
  }, {
    positions: {
      P1: [{ x: 9, y: 10 }, { x: 12, y: 13 }],
      P2: [{ x: 12, y: 9 }, { x: 8, y: 4 }, { x: 16, y: 4 }, { x: 12, y: 3 }],
    },
    overrides: { P1: [{ wt: 0 }, { hp: 4 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killTarget', unit: GWAN_HAE }] },
  }),
  guide: [
    { unit: TAE_SA_JA, phases: [
      { lines: ['tut.s.tae-sa-ja.intro', 'tut.s.tae-sa-ja.intro2', 'tut.s.tae-sa-ja.skill', 'tut.s.tae-sa-ja.skill2'], allow: ['unique'], target: GWAN_HAE, until: 'skill' },
      { lines: ['tut.s.tae-sa-ja.ride', 'tut.go.move'], allow: ['move'], moveTo: { x: 11, y: 9 }, until: 'moved' },
      { lines: ['tut.s.tae-sa-ja.attack'], allow: ['attack'] },
    ] },
    { unit: TAE_SA_JA, phases: [{ lines: ['tut.s.tae-sa-ja.duel', 'tut.s.tae-sa-ja.duel2'], allow: ['move', 'attack', 'endTurn'] }] },
  ] satisfies GuideTurn[],
  outro: ['tut.s.tae-sa-ja.done', 'tut.s.tae-sa-ja.done2'],
});
