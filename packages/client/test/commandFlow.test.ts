/**
 * 명령 흐름 회귀 — 전투 UI 개편 4단계 (2026-10-06, `src/ui/commandFlow.ts`)
 *
 * 흐름은 DOM이 없어서 한 차례를 통째로 밀어 볼 수 있다. 화면(스모크)은 「단추가 그 자리에 있는가」를,
 * 여기는 「누른 순서대로 엔진이 받는 의도가 나오는가」를 본다 — 둘을 따로 깨 봐야 둘 다 산 것을 안다.
 *
 * 고정하는 것:
 * - **[이동]을 눌러야 이동 범위가 깔린다** — 차례가 오면 흐름은 `menu`이고 판 클릭은 아무것도 안 한다
 * - **이동만 확인창이 없다** — 공격 · 책략 · 명상 · 대기는 전부 확인창을 지나고, 대상 없는 책략도 그렇다
 * - [공격]은 대상이 없어도 열린다 · [취소]는 한 단계 뒤로 · 고유기술 조준의 취소는 물음으로
 * - 흐름이 내는 의도는 **언제나 `validate()`를 통과한다** — 눌렀는데 거부당하는 일이 없다
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  aimingSpec, advanceTime, castCandidates, castEffects, commandsFor, createBattle, legalMovesFor,
  validate,
} from '@samchess/rules';
import type { BattleState, Intent, OfficerId, PieceType, RosterEntry, Side, TacticId, UnitId } from '@samchess/rules';
import { OFFICERS, TACTICS } from '@samchess/data';
import { makeAiOpponent } from '@samchess/meta';
import { CommandFlow } from '../src/ui/commandFlow.ts';

// ═══════════════════════════════════════════════════════════════
// 표본
// ═══════════════════════════════════════════════════════════════

function fresh(seed: number): BattleState {
  const a = makeAiOpponent('3v3', 800, seed);
  const b = makeAiOpponent('3v3', 800, seed + 1000, a.entries.map((e) => e.officer));
  let s = createBattle({ matchId: 't', seed, mode: '3v3', rosters: { P1: a.entries, P2: b.entries } });
  s = { ...s, phase: 'running' };
  return s;
}

/** 이 유닛에게 제어권을 쥐여 준다 — 엔진의 순서를 기다리지 않고 원하는 장수로 시험한다 */
function control(s: BattleState, id: UnitId): BattleState {
  const t = structuredClone(s);
  t.phase = 'control';
  t.activeUnit = id;
  t.activeTurn = { moved: false, acted: false, usedUniqueSkill: false };
  return t;
}

const T = (name: string): TacticId => TACTICS.find((x) => x.name === name)!.id as TacticId;

function learn(s: BattleState, id: UnitId, tactics: TacticId[]): BattleState {
  const t = structuredClone(s);
  (t.units[id] as unknown as { tactics: TacticId[] }).tactics = tactics;
  t.units[id]!.mp = t.units[id]!.maxMp;
  return t;
}

const ok = (s: BattleState, side: Side, intent: Intent | null | undefined): void => {
  assert.ok(intent, '의도가 나와야 한다');
  const v = validate(s, side, intent!);
  assert.ok(v.ok, `엔진이 거부했다: ${JSON.stringify(intent)} — ${v.ok ? '' : v.reason}`);
};

const unitOf = (s: BattleState, side: Side, piece: string): UnitId =>
  Object.values(s.units).find((u) => u.side === side && u.piece === piece)!.id;

// ═══════════════════════════════════════════════════════════════
// 차례의 시작과 이동
// ═══════════════════════════════════════════════════════════════

test('차례가 오면 명령 선택이다 — 이동 범위는 [이동]을 눌러야 깔린다', () => {
  const s = control(fresh(3), unitOf(fresh(3), 'P1', 'King'));
  const f = new CommandFlow();
  f.sync(s);
  assert.equal(f.step.k, 'menu');
  assert.equal(f.boardMode, 'idle', '이동 범위가 깔리지 않는다');

  const to = legalMovesFor(s, s.activeUnit!)[0]!;
  assert.equal(f.pickCell(s, 'P1', to, null).handled, false, '명령 전에는 판 클릭이 아무 의도도 안 낸다');

  f.press('move', s, 'P1');
  assert.equal(f.boardMode, 'move');
  assert.equal(f.activeCommand, 'move');
  const pick = f.pickCell(s, 'P1', to, null);
  assert.equal(pick.handled, true);
  assert.deepEqual(pick.intent, { t: 'move', to }, '이동은 확인창 없이 곧장 나간다');
  ok(s, 'P1', pick.intent);
  assert.equal(f.step.k, 'menu', '이동한 뒤에는 명령 선택으로 돌아온다');
});

test('이동 중 후보가 아닌 칸(장수가 선 칸)은 살펴보기로 넘긴다 · [취소]는 명령 선택으로', () => {
  const s = control(fresh(3), unitOf(fresh(3), 'P1', 'King'));
  const f = new CommandFlow();
  f.sync(s);
  f.press('move', s, 'P1');
  const self = s.units[s.activeUnit!]!;
  assert.equal(f.pickCell(s, 'P1', self.pos, self.id).handled, false);
  f.cancel();
  assert.equal(f.step.k, 'menu');
  // 눌려 있는 칸을 다시 누르면 명령 선택으로
  f.press('move', s, 'P1');
  f.press('move', s, 'P1');
  assert.equal(f.step.k, 'menu');
});

test('차례가 바뀌면 고르던 것을 버린다 (sync)', () => {
  const s = control(fresh(3), unitOf(fresh(3), 'P1', 'King'));
  const f = new CommandFlow();
  f.sync(s);
  f.press('move', s, 'P1');
  f.sync(s);
  assert.equal(f.step.k, 'move', '같은 차례에서는 그대로');
  f.sync({ ...s, time: s.time + 1 });
  assert.equal(f.step.k, 'menu');
});

// ═══════════════════════════════════════════════════════════════
// 공격
// ═══════════════════════════════════════════════════════════════

test('[공격]은 대상이 없어도 열린다 — 사거리만 보이고 의도는 안 나온다 (확정 1)', () => {
  const base = fresh(3);
  const s = control(base, unitOf(base, 'P1', 'King'));
  assert.equal(commandsFor(s, 'P1')!.attack, false, '표본: 칠 대상이 없어야 검사가 산다');
  const f = new CommandFlow();
  f.sync(s);
  assert.equal(f.enabled(s, 'P1').attack, true);
  f.press('attack', s, 'P1');
  assert.equal(f.boardMode, 'attack');
});

test('공격 → 대상 → 확인창 → [확인]이 엔진이 받는 의도다 · [취소]는 대상 선택으로', () => {
  const base = fresh(3);
  const me = unitOf(base, 'P1', 'King');
  const foe = unitOf(base, 'P2', 'King');
  const s = control(base, me);
  // 적을 바로 옆에 세운다 — King은 8방향 한 칸을 친다
  const at = s.units[me]!.pos;
  s.units[foe]!.pos = { x: at.x + 1 === s.boardSize.x ? at.x - 1 : at.x + 1, y: at.y };
  assert.equal(commandsFor(s, 'P1')!.attack, true, '표본: 칠 수 있어야 한다');

  const f = new CommandFlow();
  f.sync(s);
  f.press('attack', s, 'P1');
  assert.equal(f.pickCell(s, 'P1', s.units[foe]!.pos, foe).handled, true);
  assert.equal(f.step.k, 'confirm', '공격도 확인창을 지난다(4단계 — 판 밖이라 되살렸다)');
  assert.equal(f.cameraFocus, foe, '확인창이 떠 있으면 카메라가 대상을 비춘다');
  assert.equal(f.boardMode, 'attack', '확인창 뒤의 자리는 대상 선택이다(다른 적을 누르면 바꿔 고른다)');

  f.cancel();
  assert.equal(f.step.k, 'attack', '[취소]는 한 단계 뒤로');
  f.pickCell(s, 'P1', s.units[foe]!.pos, foe);
  const intent = f.commit();
  assert.deepEqual(intent, { t: 'attack', targets: [foe] });
  ok(s, 'P1', intent);
  assert.equal(f.step.k, 'menu');
});

// ═══════════════════════════════════════════════════════════════
// 명상 · 대기
// ═══════════════════════════════════════════════════════════════

test('명상 · 대기는 확인창을 지난다 — [취소]는 명령 선택으로', () => {
  const base = fresh(3);
  const s = control(base, unitOf(base, 'P1', 'King'));
  s.units[s.activeUnit!]!.mp = 0;
  const f = new CommandFlow();
  f.sync(s);
  for (const cmd of ['meditate', 'endTurn'] as const) {
    f.press(cmd, s, 'P1');
    assert.equal(f.step.k, 'confirm');
    assert.equal(f.activeCommand, cmd);
    f.cancel();
    assert.equal(f.step.k, 'menu');
    f.press(cmd, s, 'P1');
    const intent = f.commit();
    assert.deepEqual(intent, { t: cmd });
    ok(s, 'P1', intent);
  }
});

test('꺼진 칸은 눌러도 아무 일이 없다 — MP가 가득이면 명상', () => {
  const base = fresh(3);
  const s = control(base, unitOf(base, 'P1', 'King'));
  s.units[s.activeUnit!]!.mp = s.units[s.activeUnit!]!.maxMp;
  const f = new CommandFlow();
  f.sync(s);
  assert.equal(f.enabled(s, 'P1').meditate, false);
  f.press('meditate', s, 'P1');
  assert.equal(f.step.k, 'menu');
});

// ═══════════════════════════════════════════════════════════════
// 책략
// ═══════════════════════════════════════════════════════════════

test('책략 — 목록 → 조준 → 확인 → 의도. [취소]는 한 단계씩 뒤로', () => {
  const base = fresh(3);
  const me = unitOf(base, 'P1', 'King');
  const s = control(learn(base, me, [T('공포')]), me);
  const f = new CommandFlow();
  f.sync(s);
  f.press('castTactic', s, 'P1');
  assert.deepEqual(f.step, { k: 'list', kind: 'tactic' });
  f.pickTactic(s, 'P1', T('공포'));
  assert.equal(f.step.k, 'aim');
  assert.equal(f.boardMode, 'aim');

  const cands = castCandidates(s, 'P1', me, 'tactic', T('공포'));
  assert.ok(cands.length > 0, '표본: 겨눌 적이 있어야 한다');
  assert.equal(f.aimCells(s).length, cands.length, '칠하는 칸 = 엔진이 통과시킨 후보');

  // 순서 판의 줄 — 후보가 아니면 넘기고(카메라), 후보면 대상 지정 (확정 4)
  assert.equal(f.pickUnit(me).handled, false, '내 장수는 「공포」의 후보가 아니다');
  const target = cands[0] as UnitId;
  assert.equal(f.pickUnit(target).handled, true);
  assert.equal(f.step.k, 'confirm');
  assert.equal(f.cameraFocus, target);

  f.cancel();
  assert.equal(f.step.k, 'aim', '확인 → 조준');
  f.cancel();
  assert.deepEqual(f.step, { k: 'list', kind: 'tactic' }, '조준 → 목록');
  f.cancel();
  assert.equal(f.step.k, 'menu', '목록 → 명령 선택');

  f.press('castTactic', s, 'P1');
  f.pickTactic(s, 'P1', T('공포'));
  f.pickCell(s, 'P1', s.units[target]!.pos, target);
  const intent = f.commit();
  assert.deepEqual(intent, { t: 'castTactic', tactic: T('공포'), target });
  ok(s, 'P1', intent);
});

test('대상이 없는 책략도 확인창을 지난다 (확정 2) — 취소하면 목록으로', () => {
  const base = fresh(3);
  const me = unitOf(base, 'P1', 'King');
  // 조준이 필요 없는 책략을 데이터에서 찾는다 — 이름을 박아 두면 데이터가 바뀔 때 검사가 조용히 헛돈다
  const self = TACTICS.find((d) => {
    const s = control(learn(base, me, [d.id as TacticId]), me);
    return !aimingSpec(castEffects(s.units[me]!, 'tactic', d.id as TacticId))
      && validate(s, 'P1', { t: 'castTactic', tactic: d.id as TacticId }).ok;
  });
  assert.ok(self, '표본: 대상 없는 책략이 하나는 있어야 한다');
  const id = self.id as TacticId;
  const s = control(learn(base, me, [id]), me);
  const f = new CommandFlow();
  f.sync(s);
  f.press('castTactic', s, 'P1');
  f.pickTactic(s, 'P1', id);
  assert.equal(f.step.k, 'confirm', '바로 쏘지 않는다');
  f.cancel();
  assert.deepEqual(f.step, { k: 'list', kind: 'tactic' });
  f.pickTactic(s, 'P1', id);
  const intent = f.commit();
  assert.deepEqual(intent, { t: 'castTactic', tactic: id });
  ok(s, 'P1', intent);
});

// ═══════════════════════════════════════════════════════════════
// 고유기술 물음
// ═══════════════════════════════════════════════════════════════

/**
 * 조준이 필요한 고유기술을 지금 쓸 수 있는 장수 — 명단에서 찾아 P1 King으로 세운다.
 * 이름을 박아 두면 데이터가 바뀔 때 검사가 조용히 헛돈다.
 */
function aimedUniqueCase(): { s: BattleState; id: UnitId } {
  const foes = ['jo-jo', 'jang-hap', 'heon-je'] as OfficerId[];
  for (const o of OFFICERS) {
    if (!o.uniqueSkill || foes.includes(o.id as OfficerId)) continue;
    const roster = (ids: string[], pieces: PieceType[]): RosterEntry[] =>
      ids.map((officer, i) => ({ officer: officer as OfficerId, piece: pieces[i]!, level: 1, statPicks: [], tactics: [] }));
    const base = createBattle({
      matchId: 't', seed: 1, mode: '3v3',
      rosters: {
        P1: roster([o.id, 'yu-bi', 'jo-sik'].filter((x, i, a) => a.indexOf(x) === i).slice(0, 3)
          .concat(o.id === 'yu-bi' || o.id === 'jo-sik' ? ['gwan-u'] : []), ['King', 'Rock', 'Pawn']),
        P2: roster(foes, ['King', 'Bishop', 'Queen']),
      },
    });
    const id = unitOf(base, 'P1', 'King');
    const s = control({ ...base, phase: 'running' }, id);
    s.sp.P1 = 99;
    if (!commandsFor(s, 'P1')!.unique) continue;
    if (aimingSpec(castEffects(s.units[id]!, 'unique'))) return { s, id };
  }
  throw new Error('표본: 조준이 필요한 고유기술을 쓸 수 있는 장수가 없다');
}

test('고유기술 — 쓸 수 있으면 먼저 묻고, [미사용]이면 그 차례엔 다시 안 묻는다', () => {
  const { s } = aimedUniqueCase();
  const f = new CommandFlow();
  f.sync(s);
  assert.equal(f.asking(s, 'P1'), true);
  f.skipUnique();
  assert.equal(f.asking(s, 'P1'), false);
  assert.equal(f.step.k, 'menu');
  f.sync({ ...s, time: s.time + 1 });
  assert.equal(f.asking({ ...s, time: s.time + 1 }, 'P1'), true, '다음 차례에는 다시 묻는다');
});

test('고유기술 [사용] → 조준 → [취소]는 물음으로 (확정 7) · 대상을 고르면 확인 없이 나간다', () => {
  const { s, id } = aimedUniqueCase();
  const f = new CommandFlow();
  f.sync(s);
  assert.equal(f.useUnique(s, 'P1'), null, '조준이 필요하면 아직 의도가 없다');
  assert.equal(f.step.k, 'aim');
  assert.equal(f.asking(s, 'P1'), false, '조준 중에는 묻지 않는다');
  f.cancel();
  assert.equal(f.asking(s, 'P1'), true, '물음으로 돌아왔다');

  f.useUnique(s, 'P1');
  const target = castCandidates(s, 'P1', id, 'unique')[0]!;
  const pick = typeof target === 'string'
    ? f.pickCell(s, 'P1', s.units[target]!.pos, target)
    : f.pickCell(s, 'P1', target, null);
  assert.equal(pick.handled, true);
  ok(s, 'P1', pick.intent);
  assert.equal(pick.intent!.t, 'castUniqueSkill');
  assert.equal(f.asking(s, 'P1'), false, '쓴 뒤에는 묻지 않는다');
});

test('명령을 고르는 중에는 고유기술 물음이 끼어들지 않는다', () => {
  const { s } = aimedUniqueCase();
  const f = new CommandFlow();
  f.sync(s);
  f.skipUnique();
  f.press('endTurn', s, 'P1');
  assert.equal(f.asking(s, 'P1'), false);
});
