/**
 * 튜토리얼 판을 **대본 그대로** 두는 손 — 기본 셋(`tutorialBattles.test.ts`)과 S급(`tutorialSBattles.test.ts`)이 함께 쓴다.
 *
 * 화면은 대본이 켠 명령 · 칸 · 대상만 누르게 하므로 할 수 있는 일이 정해져 있다. 대본이 끝난 차례는
 * 「칠 수 있으면(필요하면 다가가서) 치고, 아니면 넘긴다」로 둔다.
 */

import assert from 'node:assert/strict';
import {
  advanceTime, apply, commandsFor, createBattle, idleTurn, legalMovesFor, legalTargetsFor, takeTurn,
} from '@samchess/rules';
import type { BattleState, Intent, UnitId, Vec2 } from '@samchess/rules';
import { TUTORIAL_HUMAN_SIDE } from '../src/index.ts';
import type { GuideCommand, GuidePhase, TutorialStage } from '../src/index.ts';

/** 사람 차례가 올 때까지 시간을 흘리고 적의 차례를 둔다 */
export function untilHuman(s: BattleState, stage: TutorialStage): BattleState {
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === 'finished') return s;
    if (s.phase === 'running') { s = advanceTime(s).state; continue; }
    if (s.units[s.activeUnit!]!.side === TUTORIAL_HUMAN_SIDE) return s;
    s = (stage.enemy === 'idle' ? idleTurn(s) : takeTurn(s)).state;
  }
  throw new Error('사람 차례가 오지 않는다');
}

export const act = (s: BattleState, intent: Intent): BattleState => apply(s, TUTORIAL_HUMAN_SIDE, intent).state;
const turnKey = (s: BattleState): string => `${s.activeUnit}|${s.time}`;

/** 명령 판의 켜짐 — 화면이 쓰는 것과 같은 읽기(`commandFlow.enabled`) */
function enabled(s: BattleState, cmd: GuideCommand): boolean {
  const c = commandsFor(s, TUTORIAL_HUMAN_SIDE);
  if (!c) return false;
  switch (cmd) {
    case 'move': return c.move;
    case 'attack': return c.attackOpen;
    case 'meditate': return c.meditate;
    case 'castTactic': return c.castTactic;
    case 'useItem': return c.useItemOpen;
    case 'endTurn': return c.endTurn;
    case 'unique': return c.unique;
  }
}

/** 이 칸들 중 대상을 칠 수 있는 첫 칸 */
function tileToHit(s: BattleState, unit: UnitId): Vec2 | undefined {
  return legalMovesFor(s, unit).find((to) => legalTargetsFor(act(s, { t: 'move', to }), unit).length > 0);
}

/** 칠 대상 중 HP가 가장 낮은 것 — 사람이 그렇게 고른다(쓰러뜨릴 수 있는 것부터) */
function weakest(s: BattleState, targets: readonly UnitId[]): UnitId {
  return [...targets].sort((a, b) => s.units[a]!.hp - s.units[b]!.hp || a.localeCompare(b))[0]!;
}

/** 칸을 정하지 않은 차례 — 칠 수 있으면(필요하면 다가가서) HP가 가장 낮은 적을 치고, 아니면 넘긴다 */
function freeTurn(s: BattleState): BattleState {
  const me = s.activeUnit!;
  const direct = legalTargetsFor(s, me);
  if (direct.length) return act(s, { t: 'attack', targets: [weakest(s, direct)] });
  if (!s.activeTurn?.moved) {
    const to = tileToHit(s, me);
    if (to) {
      const moved = act(s, { t: 'move', to });
      return act(moved, { t: 'attack', targets: [weakest(moved, legalTargetsFor(moved, me))] });
    }
  }
  return act(s, { t: 'endTurn' });
}

/** 대본의 한 단계를 둔다 — 사람이 켜진 명령만 누를 수 있으니 할 수 있는 일은 정해져 있다 */
function playPhase(s: BattleState, phase: GuidePhase): BattleState {
  const me = s.activeUnit!;
  for (const cmd of phase.allow) {
    if (cmd !== 'endTurn') assert.ok(enabled(s, cmd), `대본이 켠 [${cmd}]가 엔진에서 꺼져 있다`);
  }
  if (phase.allow.includes('move') && phase.moveTo) {
    assert.ok(legalMovesFor(s, me).some((p) => p.x === phase.moveTo!.x && p.y === phase.moveTo!.y), '정해 둔 칸으로 갈 수 있다');
    return act(s, { t: 'move', to: phase.moveTo });
  }
  if (phase.allow.includes('castTactic')) {
    return act(s, { t: 'castTactic', tactic: s.units[me]!.tactics[0]!, ...(phase.target ? { target: phase.target } : {}) });
  }
  if (phase.allow.includes('useItem')) return act(s, { t: 'useItem', ...(phase.target ? { target: phase.target } : {}) });
  if (phase.allow.includes('unique')) return act(s, { t: 'castUniqueSkill', ...(phase.target ? { target: phase.target } : {}) });
  if (phase.allow.includes('attack')) return freeTurn(s);
  return act(s, { t: 'endTurn' });
}

/** 판 하나를 대본대로 끝까지 */
export function play(stage: TutorialStage, watch?: (s: BattleState, turn: number) => void): BattleState {
  let s = untilHuman(createBattle(stage.config), stage);
  for (let turn = 0; turn < 40 && s.phase !== 'finished'; turn++) {
    const script = stage.guide[turn];
    watch?.(s, turn);
    if (script) {
      assert.equal(s.activeUnit, script.unit, `${turn + 1}번째 차례의 장수가 대본과 다르다`);
      const key = turnKey(s);
      for (const phase of script.phases) {
        if (s.phase === 'finished' || turnKey(s) !== key) break;
        s = playPhase(s, phase);
      }
      // 칸을 옮기고 끝난 단계 뒤에 명령이 안 남았으면 화면이 [대기]를 미리 띄운다 — 여기서는 넘긴다
      if (s.phase === 'control' && turnKey(s) === key) s = act(s, { t: 'endTurn' });
    } else {
      s = freeTurn(s);
    }
    s = untilHuman(s, stage);
  }
  return s;
}
