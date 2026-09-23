/**
 * 들고 온 것 — 대장간 병기 · 시장 아이템 패시브 (2026-09-23, GDD §6.5).
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
import { toWire } from '../src/wire.ts';
import {
  attackDamage, criticalRateOf, damageUnit, forecastAttack, resolveAttack,
} from '../src/state.ts';
import { heldEffectOf, wtHeldAdjust } from '../src/held.ts';
import { illusionChance, tacticMpCost } from '../src/effects.ts';
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

test('heldEffectOf: 병기는 effect를, 패시브 아이템은 passive를 준다', () => {
  assert.equal(heldEffectOf('dae-gam-do').criticalRate, 5, '병기');
  assert.equal(heldEffectOf('jeok-to-ma').wtDelta, -20, '패시브 아이템');
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

// ── 말 — WT ────────────────────────────────────────────────────

test('적토마: wtBase에서 20을 뺀다', () => {
  const withHorse = fight([H('yu-bi', 'King', 'jeok-to-ma')], BARE_P2).units[U('P1-King')]!;
  const without = fight([H('yu-bi', 'King')], BARE_P2).units[U('P1-King')]!;
  assert.equal(withHorse.wtBase, without.wtBase - 20);
  assert.equal(withHorse.wt, withHorse.wtBase, '첫 WT도 같이 줄어 순서가 바로 반영된다');
});

test('절영: HP 절반 이하에서만 −15로 **바뀐다** (−25가 아니다)', () => {
  const s = fight([H('yu-bi', 'King', 'jeol-yeong')], BARE_P2);
  const u = s.units[U('P1-King')]!;
  assert.equal(wtHeldAdjust(u), 0, '멀쩡할 때는 기준값 그대로(−10이 이미 들어 있다)');
  u.hp = Math.floor(u.maxHp / 2);
  assert.equal(wtHeldAdjust(u), -5, '−10에서 −15로 바뀌는 차이만 얹는다');
});

// ── 병기 — 데미지·결정타·베리어 ────────────────────────────────

test('청룡언월도: AT +1이 감쇠보다 먼저라 결정타에서 두 배로 불어난다', () => {
  const s = fight([H('gwan-u', 'Rock', 'cheong-ryong-eon-wol-do')], BARE_P2);
  const bareS = fight([H('gwan-u', 'Rock')], BARE_P2);
  const atk = s.units[U('P1-Rock')]!, victim = s.units[U('P2-King')]!;
  const atkBare = bareS.units[U('P1-Rock')]!, victimBare = bareS.units[U('P2-King')]!;
  assert.equal(
    attackDamage(atk, victim, false, false, false),
    attackDamage(atkBare, victimBare, false, false, false) + 1, '평타 +1');
  assert.equal(
    attackDamage(atk, victim, true, false, false),
    attackDamage(atkBare, victimBare, true, false, false) + 2, '결정타 +2');
});

test('대감도: 결정타 확률에 %p를 얹고 100을 안 넘는다', () => {
  const s = fight([H('gwan-u', 'Rock', 'dae-gam-do')], BARE_P2);
  const bareS = fight([H('gwan-u', 'Rock')], BARE_P2);
  assert.equal(
    criticalRateOf(s.units[U('P1-Rock')]!, s.units[U('P2-King')]!),
    Math.min(100, criticalRateOf(bareS.units[U('P1-Rock')]!, bareS.units[U('P2-King')]!) + 5));
});

test('엄심경: 베리어가 데미지를 **먼저** 받아내고 HP는 안 준다', () => {
  const s = fight([H('yu-bi', 'King', 'eom-sim-gyeong')], BARE_P2);
  const u = s.units[U('P1-King')]!;
  assert.equal(u.barrier, 3);
  const hp0 = u.hp;
  const events: BattleEvent[] = [];
  damageUnit(s, u, 2, 'test', events);
  assert.equal(u.hp, hp0, 'HP는 그대로');
  assert.equal(u.barrier, 1, '베리어만 줄었다');
  assert.ok(events.some((e) => e.e === 'barrierChanged'), 'barrierChanged가 온다');

  damageUnit(s, u, 3, 'test', events);
  assert.equal(u.barrier, undefined, '다 쓰면 키째로 없앤다');
  assert.equal(u.hp, hp0 - 2, '넘친 만큼만 HP로 간다');
});

// ── 적로 — 한 번 버틴다 ────────────────────────────────────────

test('적로: 치명상을 한 번만 버틴다', () => {
  const s = fight([H('yu-bi', 'King', 'jeok-ro')], BARE_P2);
  const u = s.units[U('P1-King')]!;
  const events: BattleEvent[] = [];
  damageUnit(s, u, 999, 'test', events);
  assert.equal(u.alive, true, '한 번은 버틴다');
  assert.equal(u.hp, 1);
  damageUnit(s, u, 999, 'test', events);
  assert.equal(u.alive, false, '두 번째는 안 버틴다');
});

test('적로를 안 들면 그대로 죽는다', () => {
  const s = fight([H('yu-bi', 'King')], BARE_P2);
  const u = s.units[U('P1-King')]!;
  damageUnit(s, u, 999, 'test', []);
  assert.equal(u.alive, false);
});

// ── 손자병법서 — 최종 데미지 ±1 ───────────────────────────────

test('손자병법서: 주는 +1 · 받는 −1이 **감쇠 뒤에** 걸리고 하한은 0이다', () => {
  const dealt = fight([H('gwan-u', 'Rock', 'son-ja-byeong-beop-seo')], BARE_P2);
  const bareS = fight([H('gwan-u', 'Rock')], BARE_P2);
  const base = attackDamage(
    bareS.units[U('P1-Rock')]!, bareS.units[U('P2-King')]!, false, false, false);
  assert.equal(
    attackDamage(dealt.units[U('P1-Rock')]!, dealt.units[U('P2-King')]!, false, false, false),
    base + 1);

  const taken = fight(bare(), [H('jo-jo', 'King', 'son-ja-byeong-beop-seo'),
    H('jang-hap', 'Bishop'), H('heon-je', 'Queen')]);
  assert.equal(
    attackDamage(taken.units[U('P1-Rock')]!, taken.units[U('P2-King')]!, false, false, false),
    base - 1, '받는 쪽이 들면 1 준다');

  // 하한 0 — 약한 공격이 완전히 무효가 되는 것은 의도다
  const weak = fight([H('heon-je', 'Pawn')], [H('jo-jo', 'King', 'son-ja-byeong-beop-seo')]);
  const atk = weak.units[U('P1-Pawn')]!, def = weak.units[U('P2-King')]!;
  atk.at = 1;
  assert.equal(attackDamage(atk, def, false, true, false), 0, '반감 뒤 1에서 −1이면 0');
});

test('공격 확인창이 같은 함수를 본다 — 화면이 공식을 다시 적지 않는다', () => {
  const s = fight([H('gwan-u', 'Rock', 'cheong-ryong-eon-wol-do')], BARE_P2);
  const atk = s.units[U('P1-Rock')]!, def = s.units[U('P2-King')]!;
  const f = forecastAttack(s, atk.id, def.id)!;
  assert.equal(f.normal, attackDamage(atk, def, false, false, false));
  assert.equal(f.critical, attackDamage(atk, def, true, false, false));
  assert.equal(f.criticalRate, criticalRateOf(atk, def));
});

// ── 태평요술 · 우선 — 책략 ─────────────────────────────────────

test('태평요술: 책략 MP를 1 깎고 하한은 0이다', () => {
  const s = fight([H('yu-bi', 'King', 'tae-pyeong-yo-sul')], BARE_P2);
  const bareS = fight([H('yu-bi', 'King')], BARE_P2);
  for (const name of ['회복', '결계']) {
    const t = T(name);
    const want = Math.max(0, tacticMpCost(bareS.units[U('P1-King')]!, t) - 1);
    assert.equal(tacticMpCost(s.units[U('P1-King')]!, t), want, name);
  }
});

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

// ── 육도삼략 — 확률 반격 ───────────────────────────────────────

test('육도삼략: 확률 반격 — **안 들었으면 굴리지 않는다**', () => {
  // 굴리면 `rngCursor`가 밀려 아이템을 안 든 판의 리플레이가 깨진다.
  const hit = (held?: string): { cursor: number; countered: boolean } => {
    const s = fight([H('gwan-u', 'Rock')], [H('jo-jo', 'King', held)]);
    const atk = s.units[U('P1-Rock')]!, def = s.units[U('P2-King')]!;
    def.hp = 99; atk.hp = 99;
    const events: BattleEvent[] = [];
    const before = s.rngCursor;
    resolveAttack(s, atk, def, events);
    return {
      cursor: s.rngCursor - before,
      countered: events.filter((e) => e.e === 'attacked').length > 1,
    };
  };
  const bareRoll = hit().cursor;
  const withBook = hit('yuk-do-sam-ryak').cursor;
  assert.equal(withBook, bareRoll + 1, '들었을 때만 한 번 더 굴린다');
});

test('육도삼략: 30% 언저리로 반격한다', () => {
  let countered = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    const s = createBattle({
      matchId: 'counter', seed, mode: '3v3',
      rosters: {
        P1: fill([H('gwan-u', 'Rock')], P1_REST),
        P2: fill([H('jo-jo', 'King', 'yuk-do-sam-ryak')], P2_REST),
      },
    });
    const atk = s.units[U('P1-Rock')]!, def = s.units[U('P2-King')]!;
    def.hp = 99; atk.hp = 99;
    const events: BattleEvent[] = [];
    resolveAttack(s, atk, def, events);
    if (events.filter((e) => e.e === 'attacked').length > 1) countered++;
  }
  const rate = (countered / N) * 100;
  assert.ok(Math.abs(rate - 30) < 8, `반격률 ${rate.toFixed(1)}% — 30% 언저리라야 한다`);
});

test('청강검: 결정타 추가 데미지는 **감쇠 뒤에** 붙는다', () => {
  // `criticalDamage`는 `FORMULA.damage` 밖에서 더한다 — `data.test.ts`가 이미
  // 고정해 둔 계약이라 반감이 걸려도 1은 온전히 붙는다.
  assert.equal(equipmentById.get('cheong-gang-geom')?.effect.criticalDamage, 1);
  const s = fight([H('gwan-u', 'Rock', 'cheong-gang-geom')], BARE_P2);
  const bareS = fight([H('gwan-u', 'Rock')], BARE_P2);
  const atk = s.units[U('P1-Rock')]!, def = s.units[U('P2-King')]!;
  const atk0 = bareS.units[U('P1-Rock')]!, def0 = bareS.units[U('P2-King')]!;
  assert.equal(
    attackDamage(atk, def, false, false, false),
    attackDamage(atk0, def0, false, false, false), '평타에는 안 붙는다');
  assert.equal(
    attackDamage(atk, def, true, false, false),
    attackDamage(atk0, def0, true, false, false) + 1, '결정타에만 +1');
  assert.equal(
    attackDamage(atk, def, true, true, false),
    attackDamage(atk0, def0, true, true, false) + 1, '반감이 걸려도 1은 온전하다');
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
