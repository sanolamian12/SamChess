/**
 * 들고 온 것 — Passive 아이템(장터 · 대장간 병기 같은 표, 2026-11-28). Active는 `items.test.ts`.
 *
 * **2026-09-23 이전에는 병기가 전투에 아예 안 실렸다** — `EquipmentEffect`가
 * 데이터와 검증 테스트에만 있었고 엔진에 닿는 길이 없었다. 시장 아이템이 같은
 * 칸을 다투는 사이라 길을 하나(`RosterEntry.held`)로 놓으면서 함께 닫았다.
 *
 * 여기 있는 검사는 **규칙을 일부러 깨면 각각 정확히 그 자리에서 실패한다**
 * (`tools/`의 변이 확인으로 한 번씩 확인했다).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { equipmentById, marketItemById } from '@samchess/data';
import { createBattle } from '../src/battle.ts';
import { tacticsRevealed, toWire } from '../src/wire.ts';
import { attackDamage, criticalRateOf, forecastAttack } from '../src/state.ts';
import { heldEffectOf, wtHeldAdjust } from '../src/held.ts';
import { illusionChance } from '../src/effects.ts';
import type {
  BattleEvent, BattleState, OfficerId, PieceType, RosterEntry, TacticId, UnitId,
} from '../src/types.ts';
import { T, U, giveControl, learn } from './fixtures.ts';

/** 들고 온 것이 있는 로스터 한 줄 */
const H = (officer: string, piece: PieceType, held?: string, level = 1): RosterEntry => ({
  officer: officer as OfficerId, piece, level, statPicks: [], tactics: [],
  ...(held ? { held } : {}),
});

/** 3v3은 세 명이라야 한다 — 시험하려는 한 줄만 적고 나머지는 채운다 */
const fill = (rows: RosterEntry[], rest: RosterEntry[]): RosterEntry[] =>
  [...rows, ...rest.filter((r) => !rows.some((x) => x.piece === r.piece))].slice(0, 3);

function fight(p1: RosterEntry[], p2: RosterEntry[]): BattleState {
  return createBattle({
    matchId: 'held', seed: 7, mode: '3v3',
    rosters: { P1: fill(p1, P1_REST), P2: fill(p2, P2_REST) },
  });
}

const P1_REST = [H('yu-bi', 'King'), H('gwan-u', 'Rock'), H('jo-sik', 'Pawn')];
const P2_REST = [H('jo-jo', 'King'), H('jang-hap', 'Bishop'), H('heon-je', 'Queen')];

const BARE_P2: RosterEntry[] = [];
const bare = (): RosterEntry[] => [];

// ── 표를 가르는 자리는 하나다 ──────────────────────────────────

test('heldEffectOf: Passive 병기 · 아이템은 passive를 준다 — 같은 표에서', () => {
  assert.equal(heldEffectOf('dae-gam-do').criticalRate, 5, '병기');
  assert.equal(heldEffectOf('jeok-ro').wtDeltaLowHp, -20, '장터 아이템');
  assert.deepEqual(heldEffectOf(undefined), {}, '안 들었으면 빈 값');
  assert.deepEqual(heldEffectOf('없는-물건'), {}, '모르는 id는 던지지 않고 빈 값');
});

test('heldEffectOf: **액티브 아이템은 들고만 있는 동안 아무것도 안 준다**', () => {
  const tangYak = marketItemById.get('tang-yak');
  assert.equal(tangYak?.kind, 'active');
  assert.ok(tangYak?.effects, '쓸 때 도는 효과는 있다');
  assert.deepEqual(heldEffectOf('tang-yak'), {}, '들고만 있으면 빈 값이다');
});

test('두 표의 id가 안 겹친다 — 겹치면 병기가 아이템을 가린다', () => {
  for (const id of marketItemById.keys()) {
    assert.equal(equipmentById.has(id), false, `id 충돌: ${id}`);
  }
});

// ── 적로 — HP 절반 이하에서 WT −20 (2026-11-28) ─────────────────

test('적로: 멀쩡할 때는 그대로, HP 절반 이하면 WT −20', () => {
  const s = fight([H('yu-bi', 'King', 'jeok-ro')], BARE_P2);
  const bareU = fight([H('yu-bi', 'King')], BARE_P2).units[U('P1-King')]!;
  const u = s.units[U('P1-King')]!;
  assert.equal(u.wtBase, bareU.wtBase, '기준값은 안 바뀐다(`wtDelta`가 없다)');
  assert.equal(wtHeldAdjust(u), 0, '멀쩡할 때');
  u.hp = Math.floor(u.maxHp / 2);
  assert.equal(wtHeldAdjust(u), -20, '절반 이하');
});

// ── 갑옷 — 최대 HP (2026-11-28, 옛 베리어를 걷었다) ──────────────

test('엄심경 · 두무: 최대 HP와 HP가 함께 오르고, 회복으로 다시 찬다', () => {
  const bareU = fight([H('yu-bi', 'King')], BARE_P2).units[U('P1-King')]!;
  for (const [id, n] of [['eom-sim-gyeong', 3], ['du-mu', 6], ['sa-ja-tu-gu', 10], ['su-myeon-tan-du-yeon-hwan-gae', 15]] as const) {
    const u = fight([H('yu-bi', 'King', id)], BARE_P2).units[U('P1-King')]!;
    assert.equal(u.maxHp, bareU.maxHp + n, id);
    assert.equal(u.hp, u.maxHp, `${id}: 가득 차서 시작한다`);
    assert.equal(u.barrier, undefined, `${id}: 베리어는 없다`);
  }
});


// ── 병기 — 결정타 ──────────────────────────────────────────────

test('대감도: 결정타 확률에 %p를 얹고 100을 안 넘는다', () => {
  const s = fight([H('gwan-u', 'Rock', 'dae-gam-do')], BARE_P2);
  const bareS = fight([H('gwan-u', 'Rock')], BARE_P2);
  assert.equal(
    criticalRateOf(s.units[U('P1-Rock')]!, s.units[U('P2-King')]!),
    Math.min(100, criticalRateOf(bareS.units[U('P1-Rock')]!, bareS.units[U('P2-King')]!) + 5));
});

test('공격 확인창이 같은 함수를 본다 — 화면이 공식을 다시 적지 않는다', () => {
  const s = fight([H('gwan-u', 'Rock', 'bang-cheon-hwa-geuk')], BARE_P2);
  const atk = s.units[U('P1-Rock')]!, def = s.units[U('P2-King')]!;
  const f = forecastAttack(s, atk.id, def.id)!;
  assert.equal(f.normal, attackDamage(atk, def, false, false, false));
  assert.equal(f.critical, attackDamage(atk, def, true, false, false));
  assert.equal(f.criticalRate, criticalRateOf(atk, def));
});

// ── 우선 — 책략 ────────────────────────────────────────────────

test('우선: 시전자는 +10, 대상이 들면 −10. **무조건인 0·100은 안 탄다**', () => {
  const caster = (held?: string, targetHeld?: string): number | null => {
    const s = learn(
      giveControl(
        fight([H('yu-bi', 'King', held)],
          [H('jo-jo', 'King', targetHeld), H('jang-hap', 'Bishop'), H('heon-je', 'Queen')]),
        U('P1-King')),
      U('P1-King'), [T('공포')]);
    return illusionChance(s, U('P1-King'), T('공포') as TacticId, U('P2-King'));
  };
  const base = caster()!;
  assert.equal(caster('u-seon'), Math.min(100, base + 10));
  assert.equal(caster(undefined, 'u-seon'), Math.max(0, base - 10));
});

// ── 척후기 — 전선에서 실제로 뗀다 ──────────────────────────────

test('척후기: **화면이 아니라 전선이 가린다** — 없는 쪽에는 상대 책략이 안 실린다', () => {
  const learned = (held?: string): BattleState => {
    const s = fight(
      [{ ...H('yu-bi', 'King', held), tactics: [T('회복')] as TacticId[] }],
      [{ ...H('jo-jo', 'King'), tactics: [T('공포')] as TacticId[] }],
    );
    return s;
  };
  const s = learned();
  assert.deepEqual([...s.units[U('P2-King')]!.tactics], [T('공포')], '권위 상태에는 있다');

  const blind = toWire(s, 'P1');
  assert.deepEqual([...blind.units[U('P2-King')]!.tactics], [], '상대 책략이 떨어져 나간다');
  assert.deepEqual([...blind.units[U('P1-King')]!.tactics], [T('회복')], '내 것은 그대로다');

  const scout = toWire(learned('cheok-hu-gi'), 'P1');
  assert.deepEqual([...scout.units[U('P2-King')]!.tactics], [T('공포')], '척후기가 있으면 보인다');
});

test('척후기: [책략 확인]의 켜짐(`tacticsRevealed`)은 **든 쪽만** · 적이 책략이 없어도 켜진다', () => {
  const s = fight([H('yu-bi', 'King', 'cheok-hu-gi')], [H('jo-jo', 'King')]);   // 적은 책략이 없다
  assert.equal(tacticsRevealed(s, 'P1'), true, '든 쪽은 켜진다 — 실려 온 책략이 없어도');
  assert.equal(tacticsRevealed(s, 'P2'), false, '안 든 쪽은 꺼진다');
  assert.equal(tacticsRevealed(toWire(s, 'P1'), 'P1'), true, '전선을 지난 뒤에도 같은 답 — 지참물은 안 뗀다');
});

test('척후기: 상대는 여전히 못 본다 — 든 쪽만 열린다', () => {
  const s = fight(
    [{ ...H('yu-bi', 'King', 'cheok-hu-gi'), tactics: [T('회복')] as TacticId[] }],
    [{ ...H('jo-jo', 'King'), tactics: [T('공포')] as TacticId[] }],
  );
  assert.deepEqual([...toWire(s, 'P2').units[U('P1-King')]!.tactics], [],
    'P2는 척후기가 없으므로 P1의 책략을 못 본다');
});

test('척후기: 뗄 것이 없으면 **원본을 그대로** 돌려준다 — 통마다 맵을 새로 안 만든다', () => {
  const s = fight([H('yu-bi', 'King')], BARE_P2);   // 아무도 책략이 없다
  assert.equal(toWire(s, 'P1').units, s.units, '같은 객체다');
});

test('척후기: 관전(진영 없음)은 그대로 본다', () => {
  const s = fight(
    [H('yu-bi', 'King')],
    [{ ...H('jo-jo', 'King'), tactics: [T('공포')] as TacticId[] }],
  );
  assert.deepEqual([...toWire(s).units[U('P2-King')]!.tactics], [T('공포')]);
});
