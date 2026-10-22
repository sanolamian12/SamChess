/**
 * 기본 튜토리얼 세 판 — **안내 대본 그대로 두면 이긴다** (`tutorialBattles.ts`)
 *
 * 사람의 수는 대본(`guide`)이 정하고 시드도 고정이라 판 전체가 결정적이다. 화면은 대본이 켠 명령 · 칸만 누르게
 * 하므로, 여기서 대본을 그대로 두어 본다 — 차례의 장수가 대본과 같은가 · 대본이 켠 명령이 그 순간 엔진에서도
 * 켜져 있는가 · 끝까지 두면 이기는가. 대본이 끝난 뒤의 차례(기본 3)는 「칠 수 있으면 치고 아니면 넘긴다」로 둔다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceTime, apply, commandsFor, createBattle, findStatus, idleTurn, legalMovesFor, legalTargetsFor, takeTurn,
} from '@samchess/rules';
import type { BattleState, Intent, UnitId, Vec2 } from '@samchess/rules';
import { TUTORIAL_HUMAN_SIDE, tutorialStages } from '../src/index.ts';
import type { GuideCommand, GuidePhase, TutorialStage } from '../src/index.ts';

/** 사람 차례가 올 때까지 시간을 흘리고 적의 차례를 둔다 */
function untilHuman(s: BattleState, stage: TutorialStage): BattleState {
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === 'finished') return s;
    if (s.phase === 'running') { s = advanceTime(s).state; continue; }
    if (s.units[s.activeUnit!]!.side === TUTORIAL_HUMAN_SIDE) return s;
    s = (stage.enemy === 'idle' ? idleTurn(s) : takeTurn(s)).state;
  }
  throw new Error('사람 차례가 오지 않는다');
}

const act = (s: BattleState, intent: Intent): BattleState => apply(s, TUTORIAL_HUMAN_SIDE, intent).state;
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

/** 칸을 정하지 않은 차례 — 칠 수 있으면(필요하면 다가가서) 치고, 아니면 넘긴다 */
function freeTurn(s: BattleState): BattleState {
  const me = s.activeUnit!;
  const direct = legalTargetsFor(s, me);
  if (direct.length) return act(s, { t: 'attack', targets: [direct[0]!] });
  if (!s.activeTurn?.moved) {
    const to = tileToHit(s, me);
    if (to) {
      const moved = act(s, { t: 'move', to });
      return act(moved, { t: 'attack', targets: [legalTargetsFor(moved, me)[0]!] });
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
  if (phase.allow.includes('unique')) return act(s, { t: 'castUniqueSkill' });
  if (phase.allow.includes('attack')) return freeTurn(s);
  return act(s, { t: 'endTurn' });
}

/** 판 하나를 대본대로 끝까지 */
function play(stage: TutorialStage, watch?: (s: BattleState, turn: number) => void): BattleState {
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

describe('기본 1 — 기물 여섯', () => {
  const stages = tutorialStages('basic-1');

  it('King → Rock → Bishop → Knight → Queen → Pawn 차례, 9 × 9, 손견 하나 vs HP 1 도적 하나', () => {
    assert.deepEqual(stages.map((x) => x.lesson), ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'].map((p) => `basic-1.${p}`));
    for (const st of stages) {
      assert.deepEqual(st.config.setup!.board, { x: 9, y: 9 });
      assert.equal(st.config.rosters.P1[0]!.officer, 'son-gyeon');
      assert.equal(st.enemy, 'idle');
      assert.deepEqual(st.guide[0]!.phases.map((p) => p.allow), [['move'], ['attack']], '이동 → 공격 두 걸음');
    }
  });

  for (const stage of stages) {
    it(`${stage.lesson} — 제자리에서는 안 닿고, 정해 둔 칸으로 가면 한 대에 쓰러진다`, () => {
      const start = untilHuman(createBattle(stage.config), stage);
      assert.deepEqual(legalTargetsFor(start, start.activeUnit!), [], '제자리에서 닿으면 [이동]을 배울 이유가 없다');
      const end = play(stage);
      assert.equal(end.phase, 'finished');
      assert.equal(end.winner, 'P1');
      // 한 차례 안에 끝난다 — 이동 → 공격
      assert.equal(end.log.filter((e) => e.e === 'controlGranted' && e.unit.startsWith('P1')).length, 1);
    });
  }
});

describe('기본 2 — 증폭 · 탕약 · 협동', () => {
  const [stage] = tutorialStages('basic-2');
  const son = (s: BattleState) => s.units['P1-Knight' as UnitId]!;

  it('가후가 증폭 → 손견이 한 대 → 가후가 다가가 탕약 → 손견이 다가감 → 가후가 증폭 → 손견이 한 대로 이긴다', () => {
    const seen: string[] = [];
    const end = play(stage!, (s, turn) => {
      if (turn === 1) assert.ok(findStatus(son(s), 'critical100'), '증폭이 걸린 채 손견 차례가 온다');
      if (turn === 3) assert.equal(son(s).hp, 9, '탕약으로 4 → 9');
      seen.push(s.activeUnit!);
    });
    assert.equal(end.winner, 'P1');
    assert.equal(stage!.guide.length, 6);
    assert.deepEqual(seen, stage!.guide.map((t) => t.unit), '가후와 손견이 번갈아 돈다');
  });

  it('도적은 보통 한 대로는 안 쓰러진다 — 크리(×2) 한 대에만', () => {
    const s = createBattle(stage!.config);
    for (const id of ['P2-Queen', 'P2-Rock']) {
      const hp = s.units[id as UnitId]!.hp;
      assert.ok(hp > son(s).at && hp <= son(s).at * 2, `${id} HP ${hp}`);
    }
  });
});

describe('기본 3 — 일당백 · 시간 · SP', () => {
  const [stage] = tutorialStages('basic-3');
  const MA = 'P1-Knight' as UnitId;

  it('기다림 → 일당백 → 크리 100% 동안 쳐서 이긴다, 마등은 살아 있고 적도 한 번은 친다', () => {
    let critTurns = 0;
    const end = play(stage!, (s) => { if (findStatus(s.units[MA]!, 'critical100')) critTurns++; });
    assert.equal(end.phase, 'finished');
    assert.equal(end.winner, 'P1');
    assert.ok(end.units[MA]!.alive);
    assert.ok(critTurns > 0, '크리 100%가 켜진 차례가 있었다');
    assert.ok(end.log.some((e) => e.e === 'attacked' && e.target === MA), '적이 처음으로 움직이고 친다');
    // 대본이 일당백 전에는 기다리게 하므로 마등의 공격은 전부 크리다
    const mine = end.log.filter((e) => e.e === 'attacked' && e.unit === MA);
    assert.ok(mine.length > 0 && mine.every((e) => e.e === 'attacked' && e.critical), '마등의 공격은 전부 크리');
  });
});
