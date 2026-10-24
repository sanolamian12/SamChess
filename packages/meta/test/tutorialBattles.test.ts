/**
 * 기본 튜토리얼 세 판 — **안내 대본 그대로 두면 이긴다** (`tutorialBattles.ts`)
 *
 * 사람의 수는 대본(`guide`)이 정하고 시드도 고정이라 판 전체가 결정적이다. 화면은 대본이 켠 명령 · 칸만 누르게
 * 하므로, 여기서 대본을 그대로 두어 본다 — 차례의 장수가 대본과 같은가 · 대본이 켠 명령이 그 순간 엔진에서도
 * 켜져 있는가 · 끝까지 두면 이기는가. 대본이 끝난 뒤의 차례(기본 3)는 「칠 수 있으면 치고 아니면 넘긴다」로 둔다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBattle, findStatus, legalTargetsFor } from '@samchess/rules';
import type { BattleState, UnitId } from '@samchess/rules';
import { tutorialStages } from '../src/index.ts';
import { play, untilHuman } from './tutorialPlay.ts';

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
