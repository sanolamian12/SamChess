/**
 * 기본 튜토리얼 세 판 — **안내대로 두면 이긴다** (`tutorialBattles.ts`)
 *
 * 사람의 수는 안내가 정하고 시드도 고정이라 판 전체가 결정적이다. 여기서 안내의 수를 그대로 두어
 * 판이 「설명한 대로」 흘러가는지 본다 — 제자리에서는 안 닿는다 · 증폭 없이는 안 쓰러진다 · 일당백 뒤에 쓰러진다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceTime, apply, createBattle, findStatus, idleTurn, legalMovesFor, legalTargetsFor, takeTurn, uniqueSkillCost,
} from '@samchess/rules';
import type { BattleState, Intent, UnitId, Vec2 } from '@samchess/rules';
import { TUTORIAL_HUMAN_SIDE, tutorialStages } from '../src/index.ts';
import type { TutorialStage } from '../src/index.ts';

const U = (id: string): UnitId => id as UnitId;

/** 사람 차례가 올 때까지 시간을 흘리고 적의 차례를 둔다 */
function untilHuman(s: BattleState, stage: TutorialStage): BattleState {
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === 'finished') return s;
    if (s.phase === 'running') { s = advanceTime(s).state; continue; }
    const unit = s.units[s.activeUnit!]!;
    if (unit.side === TUTORIAL_HUMAN_SIDE) return s;
    s = (stage.enemy === 'idle' ? idleTurn(s) : takeTurn(s)).state;
  }
  throw new Error('사람 차례가 오지 않는다');
}

const act = (s: BattleState, intent: Intent): BattleState => apply(s, TUTORIAL_HUMAN_SIDE, intent).state;

/** 이 칸들 중 대상을 칠 수 있는 첫 칸 */
function tileToHit(s: BattleState, unit: UnitId, target: UnitId): Vec2 | undefined {
  return legalMovesFor(s, unit).find((to) => {
    const moved = act(s, { t: 'move', to });
    return legalTargetsFor(moved, unit).includes(target);
  });
}

describe('기본 1 — 기물 여섯', () => {
  const stages = tutorialStages('basic-1');

  it('King → Rock → Bishop → Knight → Queen → Pawn 차례, 9 × 9, 손견 하나 vs HP 1 도적 하나', () => {
    assert.deepEqual(stages.map((x) => x.lesson), ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'].map((p) => `basic-1.${p}`));
    for (const st of stages) {
      assert.deepEqual(st.config.setup!.board, { x: 9, y: 9 });
      assert.equal(st.config.rosters.P1[0]!.officer, 'son-gyeon');
      assert.equal(st.enemy, 'idle');
    }
  });

  for (const stage of stages) {
    it(`${stage.lesson} — 제자리에서는 안 닿고, 정해 둔 칸으로 가면 한 대에 쓰러진다`, () => {
      let s = untilHuman(createBattle(stage.config), stage);
      const me = s.activeUnit!;
      assert.equal(s.units[me]!.side, 'P1', '사람이 먼저 움직인다');
      assert.deepEqual(legalTargetsFor(s, me), [], '제자리에서 닿으면 [이동]을 배울 이유가 없다');
      assert.ok(legalMovesFor(s, me).some((p) => p.x === stage.moveTo!.x && p.y === stage.moveTo!.y), '정해 둔 칸으로 갈 수 있다');
      s = act(s, { t: 'move', to: stage.moveTo! });
      const targets = legalTargetsFor(s, me);
      assert.equal(targets.length, 1, '정해 둔 칸에서 도적이 닿는다');
      s = act(s, { t: 'attack', targets });
      assert.equal(s.phase, 'finished');
      assert.equal(s.winner, 'P1');
    });
  }
});

describe('기본 2 — 증폭 · 탕약 · 협동', () => {
  const [stage] = tutorialStages('basic-2');
  const GA_HU = U('P1-Bishop');
  const SON = U('P1-Knight');

  it('가후가 증폭 → 손견이 한 대 → 가후가 다가가 탕약 → 손견이 다가감 → 가후가 증폭 → 손견이 한 대로 이긴다', () => {
    let s = untilHuman(createBattle(stage!.config), stage!);

    // ① 가후 — 증폭을 손견에게
    assert.equal(s.activeUnit, GA_HU, '가후가 먼저');
    s = act(s, { t: 'castTactic', tactic: s.units[GA_HU]!.tactics[0]!, target: SON });
    assert.ok(findStatus(s.units[SON]!, 'critical100'), '증폭이 걸렸다');

    // ② 손견 — 다가가서 첫째 도적을 친다(크리 ×2 = HP 4)
    s = untilHuman(s, stage!);
    assert.equal(s.activeUnit, SON, '다음은 손견');
    const first = U('P2-Queen');
    const to1 = tileToHit(s, SON, first);
    assert.ok(to1, '첫째 도적을 칠 칸이 있다');
    s = act(s, { t: 'move', to: to1! });
    s = act(s, { t: 'attack', targets: [first] });
    assert.equal(s.units[first]!.alive, false, '증폭 한 대에 쓰러진다');

    // ③ 가후 — 손견 옆으로 가서 탕약
    s = untilHuman(s, stage!);
    assert.equal(s.activeUnit, GA_HU, '다시 가후');
    const near = legalMovesFor(s, GA_HU).find((p) => {
      const at = s.units[SON]!.pos;
      return Math.max(Math.abs(p.x - at.x), Math.abs(p.y - at.y)) === 1;
    });
    assert.ok(near, '손견 옆으로 갈 수 있다');
    s = act(s, { t: 'move', to: near! });
    const before = s.units[SON]!.hp;
    s = act(s, { t: 'useItem', target: SON });
    assert.equal(s.units[SON]!.hp, before + 5, '탕약 HP +5');

    // ④ 손견 — 둘째 도적에게 다가가기만 한다(이 차례에는 [이동]만 켜진다)
    s = untilHuman(s, stage!);
    assert.equal(s.activeUnit, SON);
    const second = U('P2-Rock');
    const toward = legalMovesFor(s, SON).find((p) => {
      // 다음 차례를 흉내 낸다 — 같은 자리에서 이동 칸을 새로 받는다
      const next = structuredClone(act(s, { t: 'move', to: p }));
      next.activeTurn = { moved: false, acted: false, usedUniqueSkill: false };
      return legalTargetsFor(next, SON).length === 0 && tileToHit(next, SON, second) !== undefined;
    });
    assert.ok(toward, '다음 차례에 둘째 도적을 칠 수 있는 칸으로 간다');
    s = act(s, { t: 'move', to: toward! });
    s = act(s, { t: 'endTurn' });

    // ⑤ 가후 — 증폭 한 번 더
    s = untilHuman(s, stage!);
    assert.equal(s.activeUnit, GA_HU);
    s = act(s, { t: 'castTactic', tactic: s.units[GA_HU]!.tactics[0]!, target: SON });

    // ⑥ 손견 — 둘째 도적을 친다
    s = untilHuman(s, stage!);
    assert.equal(s.activeUnit, SON);
    const to2 = tileToHit(s, SON, second);
    assert.ok(to2);
    s = act(s, { t: 'move', to: to2! });
    s = act(s, { t: 'attack', targets: [second] });
    assert.equal(s.phase, 'finished');
    assert.equal(s.winner, 'P1');
  });
});

describe('기본 3 — 일당백 · 시간 · SP', () => {
  const [stage] = tutorialStages('basic-3');
  const MA = U('P1-Knight');

  it('SP가 차기를 기다려 일당백 → 크리 100% 동안 쳐서 이긴다, 마등은 살아 있다', () => {
    let s = untilHuman(createBattle(stage!.config), stage!);
    assert.equal(s.sp.P1 >= 3, true, 'SP 3에서 시작한다');
    let cast = false;
    let hitsBeforeSkill = 0;
    for (let turn = 0; turn < 40 && s.phase !== 'finished'; turn++) {
      const me = s.units[MA]!;
      const cost = uniqueSkillCost(me);
      if (!cast && cost !== null && s.sp.P1 >= cost) {
        s = act(s, { t: 'castUniqueSkill' });
        cast = true;
      } else if (cast && me.casting) {
        s = act(s, { t: 'endTurn' });
      } else if (cast) {
        const target = U('P2-King');
        const direct = legalTargetsFor(s, MA).includes(target);
        const to = direct ? undefined : tileToHit(s, MA, target);
        if (to) s = act(s, { t: 'move', to });
        if (direct || to) {
          assert.ok(findStatus(s.units[MA]!, 'critical100'), '크리 100% 동안 친다');
          s = act(s, { t: 'attack', targets: [target] });
        } else {
          s = act(s, { t: 'endTurn' });
        }
      } else {
        if (!cast && legalTargetsFor(s, MA).length) hitsBeforeSkill++;
        s = act(s, { t: 'endTurn' });
      }
      s = untilHuman(s, stage!);
    }
    assert.equal(s.phase, 'finished');
    assert.equal(s.winner, 'P1');
    assert.ok(s.units[MA]!.alive);
    assert.ok(cast, '일당백을 썼다');
  });
});
