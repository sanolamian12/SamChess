/**
 * 수성전 판 · 수비군 방침 회귀 (GDD §8.8 「단계 6에서 정한 것」, 2026-10-30)
 *
 * 방침마다 「같은 판에서 다르게 움직이는가」를 본다 — 방침 분기를 빼면 떨어지는 검사여야 한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBattle } from '../src/battle.ts';
import { autoBattle, takeTurn } from '../src/ai.ts';
import { checkTimeLimit, chebyshev, supplyDepotOf } from '../src/state.ts';
import { SIEGE_CASTLE_CENTER, inSiegeCastle } from '../src/siege.ts';
import {
  DEFAULT_TACTIC_TABLE, defaultSkillRules, defaultStances, defaultTacticRules, stancesFor,
} from '../src/policy.ts';
import type {
  BattleEvent, BattleState, DefensePolicy, DefenseStance, OfficerId, RosterEntry, SkillRule, TacticId, TacticRule,
} from '../src/types.ts';
import { R, U, giveControl, learn, place } from './fixtures.ts';

const ATTACK: RosterEntry[] = [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')];
const GARRISON: RosterEntry[] = [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')];
const O = (id: string): OfficerId => id as OfficerId;
const TID = (id: string): TacticId => id as TacticId;

const EMPTY: DefensePolicy = { stances: {}, tactics: [], skills: [] };

function siege(policy?: DefensePolicy, seed = 1, rosters = { P1: ATTACK, P2: GARRISON }): BattleState {
  return createBattle({
    matchId: 'siege-test', seed, mode: '3v3', scenario: 'siege', rosters,
    ...(policy ? { policy: { P2: policy } } : {}),
  });
}

const moveOf = (events: BattleEvent[]) => events.find((e) => e.e === 'moved') as { to: { x: number; y: number } } | undefined;
const has = (events: BattleEvent[], kind: BattleEvent['e']): boolean => events.some((e) => e.e === kind);

// ── 수성전 판 ─────────────────────────────────────────────────

test('수성전 판 — 25×20 그대로, 북군 군량고 자리에 성채 3×3(성지), 북군 군량고는 없다', () => {
  for (const mode of ['3v3', '5v5'] as const) {
    const rosters = mode === '3v3' ? { P1: ATTACK, P2: GARRISON } : {
      P1: [...ATTACK, R('jang-bi', 'Queen'), R('jo-un', 'Knight')],
      P2: [...GARRISON.slice(0, 2), R('ga-hu', 'Queen'), R('an-ryang', 'Knight'), R('ak-jin', 'Pawn')],
    };
    const s = createBattle({ matchId: 't', seed: 1, mode, scenario: 'siege', rosters });
    assert.deepEqual(s.boardSize, { x: 25, y: 20 });
    assert.equal(s.terrain.length, 9);
    for (const t of s.terrain) {
      assert.equal(t.terrain, 'holy');
      assert.equal(t.fort?.side, 'P2');
      assert.ok(inSiegeCastle(t.pos));
    }
    assert.equal(supplyDepotOf(s, 'P2'), null, '수비 쪽 군량고는 없다 — 공격자는 King으로만 이긴다');
    assert.deepEqual(supplyDepotOf(s, 'P1'), { x: 12, y: 19 }, '공격자 군량고는 그대로');
  }
  assert.deepEqual(SIEGE_CASTLE_CENTER, { x: 12, y: 2 });
});

test('수성전 — 60일(time 6000)을 버티면 HP 합과 무관하게 수비 승', () => {
  const s = structuredClone(siege());
  s.phase = 'running';
  s.time = 6000;
  for (const u of Object.values(s.units)) if (u.side === 'P2') u.hp = 1;   // HP 합은 공격자가 크다
  const events: BattleEvent[] = [];
  checkTimeLimit(s, events);
  assert.equal(s.winner, 'P2');
  assert.equal(s.outcome, 'timeLimit');

  const field = structuredClone(createBattle({ matchId: 't', seed: 1, mode: '3v3', rosters: { P1: ATTACK, P2: GARRISON } }));
  field.phase = 'running';
  field.time = 6000;
  for (const u of Object.values(field.units)) if (u.side === 'P2') u.hp = 1;
  checkTimeLimit(field, []);
  assert.equal(field.winner, 'P1', '야전은 그대로 HP 합으로 가른다');
});

// ── 기본값 ────────────────────────────────────────────────────

test('기본 행동 방침 — King 수성, 나머지는 편성 순서대로 점령 · 진군 · 호위 · 암살', () => {
  assert.deepEqual(defaultStances(['King', 'Queen', 'Rock', 'Bishop', 'Knight']),
    { King: 'hold', Queen: 'occupy', Rock: 'advance', Bishop: 'escort', Knight: 'assassinate' });
  assert.deepEqual(defaultStances(['Rock', 'King', 'Pawn']), { Rock: 'occupy', King: 'hold', Pawn: 'advance' },
    'King이 첫째가 아니어도 King은 수성, 둘째는 King을 뺀 첫 장수');
  assert.deepEqual(stancesFor('King'), ['hold', 'occupy', 'advance', 'assassinate']);
  assert.ok(!stancesFor('Queen').includes('hold'));
});

test('기본 고유기술 방침 — B → A → S → E, 같은 등급은 편성 순, 모두 「SP 충전 시 즉시」', () => {
  const rules = defaultSkillRules([O('heon-je'), O('jo-jo'), O('an-ryang'), O('ak-jin'), O('jang-hap')]);
  assert.deepEqual(rules.map((r) => r.officer), ['ak-jin', 'an-ryang', 'jo-jo', 'jang-hap', 'heon-je']);
  assert.ok(rules.every((r) => r.when === 'spReady'));
});

test('기본 책략 방침 — 수비군이 가진 책략의 줄만, 표의 순서대로 · 진화는 없다', () => {
  const rules = defaultTacticRules(new Set([TID('chim-muk'), TID('hoe-bok'), TID('jeung-pok')]));
  assert.deepEqual(rules.map((r) => r.tactic), ['hoe-bok', 'jeung-pok', 'chim-muk']);
  assert.ok(!DEFAULT_TACTIC_TABLE.some((r) => r.tactic === 'jin-hwa'));
  assert.equal(DEFAULT_TACTIC_TABLE.length, 15);
});

// ── 행동 방침 ─────────────────────────────────────────────────

/** 북군 Bishop(장합)만 판 가운데에 두고, 공격자는 멀리 — 「지금 이기는 수」 · 조우가 없는 자리 */
function lone(stance: DefenseStance): BattleState {
  const s = place(siege({ ...EMPTY, stances: { Bishop: stance } }), {
    'P2-King': { x: 12, y: 2 }, 'P2-Bishop': { x: 4, y: 9 }, 'P2-Queen': { x: 20, y: 1 },
    'P1-King': { x: 22, y: 17 }, 'P1-Rock': { x: 18, y: 18 }, 'P1-Pawn': { x: 16, y: 18 },
  });
  return giveControl(s, U('P2-Bishop'));
}

test('행동 방침 — 같은 자리에서 점령 · 암살 · 호위가 다르게 걷는다', () => {
  const to = (stance: DefenseStance) => moveOf(takeTurn(lone(stance)).events)?.to;
  const occupy = to('occupy')!;
  const assassinate = to('assassinate')!;
  const escort = to('escort')!;
  const from = { x: 4, y: 9 };
  assert.ok(chebyshev(occupy, { x: 12, y: 19 }) < chebyshev(from, { x: 12, y: 19 }), '점령은 군량고로 다가간다');
  assert.ok(chebyshev(assassinate, { x: 22, y: 17 }) < chebyshev(from, { x: 22, y: 17 }), '암살은 적 King으로 다가간다');
  assert.ok(chebyshev(escort, { x: 12, y: 2 }) < chebyshev(from, { x: 12, y: 2 }), '호위는 아군 King으로 돌아간다');
  assert.notDeepEqual(escort, occupy);
});

test('수성 — 성 밖의 King은 성으로 가고, 성 안의 King은 칠 적이 없으면 성을 안 떠난다', () => {
  const outside = giveControl(place(siege({ ...EMPTY, stances: { King: 'hold' } }), {
    'P2-King': { x: 12, y: 7 }, 'P2-Bishop': { x: 2, y: 2 }, 'P2-Queen': { x: 22, y: 1 },
    'P1-King': { x: 22, y: 17 }, 'P1-Rock': { x: 18, y: 18 }, 'P1-Pawn': { x: 16, y: 18 },
  }), U('P2-King'));
  const step = moveOf(takeTurn(outside).events)?.to;
  assert.ok(step && chebyshev(step, SIEGE_CASTLE_CENTER) < chebyshev({ x: 12, y: 7 }, SIEGE_CASTLE_CENTER));

  const inside = giveControl(place(siege({ ...EMPTY, stances: { King: 'hold' } }), {
    'P2-King': { x: 13, y: 3 }, 'P2-Bishop': { x: 2, y: 2 }, 'P2-Queen': { x: 22, y: 1 },
    'P1-King': { x: 22, y: 17 }, 'P1-Rock': { x: 18, y: 18 }, 'P1-Pawn': { x: 16, y: 18 },
  }), U('P2-King'));
  const r = takeTurn(inside);
  assert.ok(inSiegeCastle(r.state.units[U('P2-King')]!.pos), '성 밖으로 나가지 않는다');

  // 같은 자리에서 진군 King은 성을 떠난다 — 수성 분기가 실제로 갈랐다는 표시
  const advancing = giveControl(place(siege({ ...EMPTY, stances: { King: 'advance' } }), {
    'P2-King': { x: 13, y: 3 }, 'P2-Bishop': { x: 2, y: 2 }, 'P2-Queen': { x: 22, y: 1 },
    'P1-King': { x: 22, y: 17 }, 'P1-Rock': { x: 18, y: 18 }, 'P1-Pawn': { x: 16, y: 18 },
  }), U('P2-King'));
  assert.ok(!inSiegeCastle(takeTurn(advancing).state.units[U('P2-King')]!.pos));
});

test('방침이 없는 진영(공격자)과 방침 없는 판의 수는 기본 AI 그대로다', () => {
  const at = {
    'P2-King': { x: 12, y: 2 }, 'P2-Bishop': { x: 4, y: 9 }, 'P2-Queen': { x: 20, y: 1 },
    'P1-King': { x: 12, y: 17 }, 'P1-Rock': { x: 18, y: 15 }, 'P1-Pawn': { x: 10, y: 15 },
  };
  const withPolicy = giveControl(place(siege({ ...EMPTY, stances: { Rock: 'assassinate' } }), at), U('P1-Rock'));
  const without = giveControl(place(siege(), at), U('P1-Rock'));
  assert.deepEqual(takeTurn(withPolicy).events, takeTurn(without).events);
});

// ── 책략 방침 ─────────────────────────────────────────────────

/** 장합(Bishop)이 관우(Rock — 대각선으로 친다)와 조우 중이고, 가후(Queen)가 증폭 · 공포를 안다 — 가후의 차례 */
function engaged(tactics: TacticRule[]): BattleState {
  const rosters = { P1: ATTACK, P2: [GARRISON[0]!, GARRISON[1]!, R('ga-hu', 'Queen')] };
  let s = place(siege({ ...EMPTY, stances: { Queen: 'advance' }, tactics }, 1, rosters), {
    'P2-King': { x: 12, y: 2 }, 'P2-Bishop': { x: 10, y: 9 }, 'P2-Queen': { x: 3, y: 4 },
    'P1-King': { x: 22, y: 18 }, 'P1-Rock': { x: 11, y: 10 }, 'P1-Pawn': { x: 16, y: 18 },
  });
  s = learn(s, U('P2-Queen'), [TID('jeung-pok'), TID('gong-po')]);
  const t = giveControl(s, U('P2-Queen'));
  t.units[U('P2-Queen')]!.mp = 5;
  return t;
}

const castOf = (events: BattleEvent[]) => events.find((e) => e.e === 'tacticCast') as
  { tactic: string; target?: string } | undefined;

test('책략 방침 — 「아군이 적군과 조우」면 조우한 아군에게 증폭, 줄이 없으면 안 쓴다', () => {
  const rule: TacticRule = { caster: null, tactic: TID('jeung-pok'), when: 'allyEngaged' };
  const cast = castOf(takeTurn(engaged([rule])).events);
  assert.equal(cast?.tactic, 'jeung-pok');
  assert.equal(cast?.target, 'P2-Bishop', '해당 아군 = 조우 중인 장합');
  assert.equal(castOf(takeTurn(engaged([])).events), undefined);
});

test('책략 방침 — 특정 장수 줄은 그 장수의 차례에만, 확률 조건이 안 서면 다음 줄', () => {
  const other: TacticRule = { caster: O('jo-jo'), tactic: TID('jeung-pok'), when: 'allyEngaged' };
  assert.equal(castOf(takeTurn(engaged([other])).events), undefined, '조조의 줄은 가후가 안 쓴다');

  const sure: TacticRule = { caster: null, tactic: TID('gong-po'), when: 'allyEngaged', minChance: 90 };
  const fallback: TacticRule = { caster: null, tactic: TID('jeung-pok'), when: 'allyEngaged' };
  const cast = castOf(takeTurn(engaged([sure, fallback])).events);
  assert.equal(cast?.tactic, 'jeung-pok', '가후의 공포(관우에게 36%)는 90%에 못 미쳐 건너뛴다');

  const loose: TacticRule = { caster: null, tactic: TID('gong-po'), when: 'allyEngaged', minChance: 10 };
  assert.equal(castOf(takeTurn(engaged([loose, fallback])).events)?.tactic, 'gong-po');
});

test('책략 방침 — 조건이 안 서면(조우 없음) 쓰지 않는다', () => {
  const rule: TacticRule = { caster: null, tactic: TID('jeung-pok'), when: 'allyEngaged' };
  const s = place(engaged([rule]), { 'P1-Rock': { x: 22, y: 15 } });
  assert.equal(castOf(takeTurn(s).events), undefined);
});

// ── 고유기술 방침 ─────────────────────────────────────────────

function skillTurn(skills: SkillRule[], sp: number): BattleState {
  const s = giveControl(place(siege({ ...EMPTY, skills }), {
    'P2-King': { x: 12, y: 2 }, 'P2-Bishop': { x: 4, y: 3 }, 'P2-Queen': { x: 20, y: 1 },
    'P1-King': { x: 22, y: 17 }, 'P1-Rock': { x: 18, y: 18 }, 'P1-Pawn': { x: 16, y: 18 },
  }), U('P2-King'));
  s.sp.P2 = sp;
  return s;
}

test('고유기술 방침 — 줄이 있으면 쓰고, 지운 기술은 안 쓴다', () => {
  assert.ok(has(takeTurn(skillTurn([{ officer: O('jo-jo'), when: 'spReady' }], 6)).events, 'uniqueSkillCast'));
  assert.ok(!has(takeTurn(skillTurn([], 6)).events, 'uniqueSkillCast'));
});

test('고유기술 방침 — 윗순위가 조건이 서 있으면 아래 순위는 그 비용만큼 SP를 남긴다', () => {
  const rules: SkillRule[] = [{ officer: O('jang-hap'), when: 'spReady' }, { officer: O('jo-jo'), when: 'spReady' }];
  assert.ok(!has(takeTurn(skillTurn(rules, 6)).events, 'uniqueSkillCast'), 'SP 6 — 쓰면 장합 몫이 안 남는다');
  assert.ok(has(takeTurn(skillTurn(rules, 12)).events, 'uniqueSkillCast'), 'SP 12 — 쓰고도 6이 남는다');

  // 윗순위 조건이 안 서면 양보하지 않는다 — 장합은 「본인이 적군과 조우」인데 아무도 안 붙었다
  const waiting: SkillRule[] = [{ officer: O('jang-hap'), when: 'selfEngaged' }, { officer: O('jo-jo'), when: 'spReady' }];
  assert.ok(has(takeTurn(skillTurn(waiting, 6)).events, 'uniqueSkillCast'));
});

// ── 한 판 ─────────────────────────────────────────────────────

test('수성전 자동 대전 — 방침을 실은 판이 여러 시드에서 끝까지 간다', () => {
  const policy: DefensePolicy = {
    stances: defaultStances(GARRISON.map((r) => r.piece)),
    tactics: [...DEFAULT_TACTIC_TABLE],
    skills: defaultSkillRules(GARRISON.map((r) => r.officer)),
  };
  for (let seed = 1; seed <= 12; seed++) {
    const r = autoBattle(siege(policy, seed));
    assert.ok(r.winner === 'P1' || r.winner === 'P2', `시드 ${seed}: 수성전에는 무승부가 없다`);
    if (r.outcome === 'timeLimit') assert.equal(r.winner, 'P2');
    if (r.outcome === 'supplyTaken') assert.equal(r.winner, 'P2', '공격자는 군량고로 못 이긴다');
  }
});
