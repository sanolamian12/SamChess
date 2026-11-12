/**
 * 기본 튜토리얼 세 판 — **안내 대본 그대로 두면 이긴다** (`tutorialBattles.ts`)
 *
 * 사람의 수는 대본(`guide`)이 정하고 시드도 고정이라 판 전체가 결정적이다. 화면은 대본이 켠 명령 · 칸만 누르게
 * 하므로, 여기서 대본을 그대로 두어 본다 — 차례의 장수가 대본과 같은가 · 대본이 켠 명령이 그 순간 엔진에서도
 * 켜져 있는가 · 끝까지 두면 이기는가. 대본이 끝난 뒤의 차례(기본 3)는 「칠 수 있으면 치고 아니면 넘긴다」로 둔다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DUEL_COUNT_MS, DUEL_FIRST_COUNT_MS, apply, commandsFor, createBattle, findStatus, legalTargetsFor } from '@samchess/rules';
import type { BattleState, DuelPick, UnitId } from '@samchess/rules';
import { tutorialDuelAi, tutorialDuelHold, tutorialDuelReveal, tutorialStages } from '../src/index.ts';
import { WEAKEST, play, untilHuman } from './tutorialPlay.ts';

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

  it('일당백이 터질 때 두목이 이미 붙어 있고, 대본의 두 번째 공격으로 끝난다 (2026-11-12 기획자)', () => {
    const seen: number[] = [];
    const end = play(stage!, (s, turn) => {
      // 공격 차례(셋째 · 넷째)는 다가가지 않고 그 자리에서 친다 — 안내가 [이동]을 안 켠다
      if (turn >= 2) assert.ok(legalTargetsFor(s, MA).includes('P2-King' as UnitId), `${turn + 1}번째 차례에 두목이 닿지 않는다`);
      seen.push(turn);
    });
    assert.equal(end.winner, 'P1');
    assert.equal(seen.length, stage!.guide.length, '대본의 마지막 차례에서 판이 끝난다');
    assert.equal(end.log.filter((e) => e.e === 'attacked' && e.unit === MA).length, 2, '두 대');
  });
});

// ── 일기토 · 설전 (2026-11-12) ────────────────────────────────

/** 사람이 낼 패의 여러 손 — 무엇을 내든(안 내든) 같은 결말이어야 한다 */
const DUEL_HANDS: { name: string; duel: (DuelPick | null)[]; debate: (DuelPick | null)[] }[] = [
  { name: '안 낸다', duel: [null], debate: [null] },
  { name: '바위 · 1만', duel: ['rock'], debate: [1] },
  { name: '돌려 가며', duel: ['scissors', 'paper', 'rock'], debate: [3, 2, 1] },
];

describe('일기토 — 손견 vs 도적 두목 (대결 안에서 합마다 멈춰 말하고, 이기면 곧장 판이 끝난다)', () => {
  const [stage] = tutorialStages('basic-duel');

  it('대결이 켜진 판이다 — 상한 15 · SP 14로 시작, 첫 차례에 붙어 있어 [일기토]가 켜진다 · 손견은 Knight', () => {
    const s = untilHuman(createBattle(stage!.config), stage!);
    assert.equal(s.duels, true);
    assert.equal(s.spCap.P1, 15);
    assert.equal(s.sp.P1, 14);
    assert.equal(s.units[s.activeUnit!]!.piece, 'Knight');
    assert.equal(commandsFor(s, 'P1')!.duel, true);
  });

  for (const hand of DUEL_HANDS) {
    it(`패를 「${hand.name}」 내도 셋째 합에 이기고, 그 순간 판의 목표로 이긴다 — SP 15 · 두목 부상 · 아무도 안 친다`, () => {
      const end = play(stage!, undefined, { ...WEAKEST, duelPicks: hand });
      assert.equal(end.winner, 'P1');
      assert.equal(end.outcome, 'objective');
      assert.deepEqual(end.log.filter((e) => e.e === 'duelRound').map((e) => e.e === 'duelRound' && e.result), ['turnover', 'hit', 'hit']);
      assert.equal(end.sp.P1, 15);
      assert.ok(end.log.some((e) => e.e === 'duelWounded' && e.unit === 'P2-King'));
      assert.ok(!end.log.some((e) => e.e === 'attacked' || e.e === 'moved'), '대결 말고는 아무 수도 없다');
    });
  }

  it('합마다 멈춰 설 자리 — 첫 합은 준비 뒤 첫 카운트 직전, 다음 합부터는 공개 뒤 카운트 직전, 안내가 없는 합은 안 선다', () => {
    const s = untilHuman(createBattle(stage!.config), stage!);
    let d = apply(s, 'P1', { t: 'challenge', kind: 'duel', target: 'P2-King' as UnitId }).state;
    d = apply(d, 'P2', tutorialDuelAi(d, 'P2')!).state;
    assert.equal(tutorialDuelHold(stage!, d), DUEL_FIRST_COUNT_MS);
    d = apply(d, 'P1', tutorialDuelReveal(d)).state;
    assert.equal(tutorialDuelHold(stage!, d), DUEL_COUNT_MS);
    assert.equal(tutorialDuelHold({ duelGuide: [['x']] }, d), null, '둘째 합의 안내가 없으면 안 선다');
    assert.equal(tutorialDuelHold(stage!, s), null, '대결 밖에서는 안 선다');
  });
});

describe('설전 — 가후(MP 0)가 이기면 곧장 판이 끝나고 MP가 2가 된다', () => {
  const [stage] = tutorialStages('basic-debate');
  const ga = (s: BattleState) => s.units['P1-Bishop' as UnitId]!;

  it('처음에는 MP가 0이라 책략을 못 쓰고, [설전]이 켜진다 · 가후는 Bishop', () => {
    const s = untilHuman(createBattle(stage!.config), stage!);
    assert.equal(s.activeUnit, 'P1-Bishop');
    assert.equal(ga(s).mp, 0);
    const c = commandsFor(s, 'P1')!;
    assert.equal(c.castTactic, false);
    assert.deepEqual([c.debate, c.duel], [true, false]);
  });

  for (const hand of DUEL_HANDS) {
    it(`패를 「${hand.name}」 내도 셋째 합에 이기고 판의 목표로 끝난다 — 가후 MP 2`, () => {
      const end = play(stage!, undefined, { ...WEAKEST, duelPicks: hand });
      assert.equal(end.winner, 'P1');
      assert.equal(end.outcome, 'objective');
      assert.deepEqual(end.log.filter((e) => e.e === 'duelRound').map((e) => e.e === 'duelRound' && e.result), ['turnover', 'hit', 'hit']);
      assert.equal(ga(end).mp, 2);
      assert.ok(!end.log.some((e) => e.e === 'moved' || e.e === 'attacked' || e.e === 'tacticCast'));
    });
  }
});
