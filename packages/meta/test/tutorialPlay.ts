/**
 * 튜토리얼 판을 **대본 그대로** 두는 손 — 기본 셋(`tutorialBattles.test.ts`)과 S급(`tutorialSBattles.test.ts`)이 함께 쓴다.
 *
 * 화면은 대본이 켠 명령 · 칸 · 대상만 누르게 하므로 할 수 있는 일이 정해져 있다. 대본이 끝난 차례는
 * 「칠 수 있으면(필요하면 다가가서) 치고, 아니면 넘긴다」로 둔다.
 */

import assert from 'node:assert/strict';
import {
  advanceTime, apply, challengeTargets, commandsFor, controllingSide, createBattle, legalMovesFor, legalTargetsFor,
} from '@samchess/rules';
import type { BattleState, DuelKind, DuelPick, Intent, UnitId, Vec2 } from '@samchess/rules';
import { TUTORIAL_HUMAN_SIDE, applyTutorialScene, scenesOf, tutorialDuelAi, tutorialDuelReveal, tutorialEnemyTurn } from '../src/index.ts';
import type { GuideCommand, GuidePhase, TutorialStage } from '../src/index.ts';

/** 사람 차례가 올 때까지 시간을 흘리고 적의 차례를 둔다 */
export function untilHuman(s: BattleState, stage: TutorialStage): BattleState {
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === 'finished') return s;
    if (s.phase === 'running') { s = advanceTime(s).state; continue; }
    // 사람 차례 = **사람이 지휘하는** 장수의 차례 — 조종한 적(구호탄랑 · 삼고초려 · 연환계)의 차례도 화면에서는 사람이 둔다.
    // 진영(`side`)으로 가르면 그 차례를 AI가 두어 화면과 대본의 차례 세기가 어긋났다(2026-10-24)
    if (controllingSide(s, s.units[s.activeUnit!]!) === TUTORIAL_HUMAN_SIDE) return s;
    s = tutorialEnemyTurn(stage)(s).state;
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
    case 'duel': return c.duel;
    case 'debate': return c.debate;
  }
}

/** 칠 대상 중 HP가 가장 낮은 것 — 사람이 그렇게 고른다(쓰러뜨릴 수 있는 것부터) */
function weakest(s: BattleState, targets: readonly UnitId[]): UnitId {
  return [...targets].sort((a, b) => s.units[a]!.hp - s.units[b]!.hp || a.localeCompare(b))[0]!;
}

/**
 * 대본이 칸을 정하지 않은 차례를 어떻게 두는가 — 회귀는 `WEAKEST` 하나로 두고, 「다르게 두어도 이기는가」를 재는 도구
 * (`tools/tutorial_robust.ts`)가 여러 손을 바꿔 끼운다. 사람은 손이 정한 대로 두지 않는다.
 */
export interface Hand {
  /** 칠 대상 고르기 */
  pick(s: BattleState, targets: readonly UnitId[]): UnitId;
  /** 칠 수 있는 칸이 여럿이면 어디로 */
  tile?(s: BattleState, tiles: readonly Vec2[]): Vec2;
  /** 칠 적이 안 닿으면 가장 가까운 적에게 다가가는가(사람은 대개 다가간다) */
  approach?: boolean;
  /** 대결에서 합마다 낼 패(돌려 가며). `null`은 안 낸다(판정 주체가 채운다) */
  duelPicks?: { duel: readonly (DuelPick | null)[]; debate: readonly (DuelPick | null)[] };
}

const DEFAULT_PICKS = { duel: [null], debate: [null] };

/** 회귀의 손 — HP가 가장 낮은 적부터(쓰러뜨릴 수 있는 것부터), 안 닿으면 제자리 */
export const WEAKEST: Hand = { pick: weakest };

/** 칸을 정하지 않은 차례 — 칠 수 있으면(필요하면 다가가서) 손이 고른 적을 치고, 아니면 다가가거나 넘긴다 */
function freeTurn(s: BattleState, hand: Hand = WEAKEST): BattleState {
  const me = s.activeUnit!;
  const direct = legalTargetsFor(s, me);
  if (direct.length) return act(s, { t: 'attack', targets: [hand.pick(s, direct)] });
  if (!s.activeTurn?.moved) {
    const tiles = legalMovesFor(s, me).filter((to) => legalTargetsFor(act(s, { t: 'move', to }), me).length > 0);
    if (tiles.length) {
      const moved = act(s, { t: 'move', to: hand.tile ? hand.tile(s, tiles) : tiles[0]! });
      return act(moved, { t: 'attack', targets: [hand.pick(moved, legalTargetsFor(moved, me))] });
    }
    if (hand.approach) {
      const at = s.units[me]!.pos;
      const foes = Object.values(s.units).filter((u) => u.alive && controllingSide(s, u) !== TUTORIAL_HUMAN_SIDE);
      const dist = (p: Vec2): number => Math.min(...foes.map((f) => Math.abs(f.pos.x - p.x) + Math.abs(f.pos.y - p.y)));
      const best = [...legalMovesFor(s, me)].sort((a, b) => dist(a) - dist(b))[0];
      if (best && dist(best) < dist(at)) return act(act(s, { t: 'move', to: best }), { t: 'endTurn' });
    }
  }
  return act(s, { t: 'endTurn' });
}

/**
 * 대결을 걸고 끝까지 — 화면의 판정 주체(`LocalTransport`)가 하는 일 그대로: 적의 답(`tutorialDuelAi`) → 합마다 사람의 패 → 공개
 * (`tutorialDuelReveal`). 사람의 패는 `picks`를 돌려 가며 낸다(무엇을 내든 결말이 같아야 한다). 대결이 끝나 차례로 돌아온 상태를 낸다
 */
export function playDuel(s: BattleState, kind: DuelKind, picks: readonly (DuelPick | null)[] = [null]): BattleState {
  const target = challengeTargets(s, TUTORIAL_HUMAN_SIDE, kind)[0];
  assert.ok(target, `${kind}을 걸 상대가 없다`);
  s = act(s, { t: 'challenge', kind, target });
  for (let round = 0; s.phase === 'duel'; round++) {
    assert.ok(round < 20, '대결이 끝나지 않는다');
    const ai = tutorialDuelAi(s, 'P2');
    if (ai) { s = apply(s, 'P2', ai).state; continue; }
    const pick = picks[round % picks.length];
    if (pick !== null && pick !== undefined) s = act(s, { t: 'duelPick', pick });
    s = act(s, tutorialDuelReveal(s));
  }
  return s;
}

/** 대본의 한 단계를 둔다 — 사람이 켜진 명령만 누를 수 있으니 할 수 있는 일은 정해져 있다 */
function playPhase(s: BattleState, phase: GuidePhase, hand: Hand): BattleState {
  const duelPicks = hand.duelPicks ?? DEFAULT_PICKS;
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
  if (phase.allow.includes('duel')) return playDuel(s, 'duel', duelPicks.duel);
  if (phase.allow.includes('debate')) return playDuel(s, 'debate', duelPicks.debate);
  if (phase.allow.includes('unique')) return act(s, { t: 'castUniqueSkill', ...(phase.target ? { target: phase.target } : {}) });
  if (phase.allow.includes('attack') && phase.target) {
    // 대본이 칠 장수를 정했다 — 화면도 그 장수만 누를 수 있다(필요하면 칠 수 있는 칸으로 다가간다)
    const t = phase.target;
    if (legalTargetsFor(s, me).includes(t)) return act(s, { t: 'attack', targets: [t] });
    const to = s.activeTurn?.moved ? undefined
      : legalMovesFor(s, me).find((p) => legalTargetsFor(act(s, { t: 'move', to: p }), me).includes(t));
    assert.ok(to, `대본이 정한 대상 ${t}를 칠 수 없다`);
    return act(act(s, { t: 'move', to }), { t: 'attack', targets: [t] });
  }
  if (phase.allow.includes('attack')) return freeTurn(s, hand);
  return act(s, { t: 'endTurn' });
}

/** 판 하나를 대본대로 끝까지 */
export function play(stage: TutorialStage, watch?: (s: BattleState, turn: number) => void, hand: Hand = WEAKEST): BattleState {
  let s = untilHuman(createBattle(stage.config), stage);
  // 판 도중의 장면 — 화면은 판정 주체의 고리(`tutorialSceneHook`)가 그 차례가 끝난 통 뒤에 낸다. 여기서는 그 차례를 둔 바로 뒤에
  const scenes = scenesOf(stage);
  const sceneDone = scenes.map(() => false);
  const sceneTurns = scenes.map(() => 0);
  for (let turn = 0; turn < 40 && s.phase !== 'finished'; turn++) {
    const script = stage.guide[turn];
    watch?.(s, turn);
    if (script) {
      assert.equal(s.activeUnit, script.unit, `${turn + 1}번째 차례의 장수가 대본과 다르다`);
      const key = turnKey(s);
      for (const phase of script.phases) {
        if (s.phase === 'finished' || turnKey(s) !== key) break;
        s = playPhase(s, phase, hand);
      }
      // 칸을 옮기고 끝난 단계 뒤에 명령이 안 남았으면 화면이 [대기]를 미리 띄운다 — 여기서는 넘긴다
      if (s.phase === 'control' && turnKey(s) === key) s = act(s, { t: 'endTurn' });
    } else {
      s = freeTurn(s, hand);
    }
    scenes.forEach((scene, i) => {
      if (sceneDone[i] || script?.unit !== scene.after || ++sceneTurns[i]! < (scene.afterTurn ?? 1)) return;
      s = applyTutorialScene(s, scene).state;
      sceneDone[i] = true;
    });
    s = untilHuman(s, stage);
  }
  return s;
}
