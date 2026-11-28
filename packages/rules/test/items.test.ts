/**
 * **Active 아이템 사용** — `{ t: 'useItem' }` (2026-09-23, 2026-11-28 대장간 연구 개편).
 *
 * 장터 아이템 · 대장간 병기가 같은 표이고, **Active는 차례를 끝내지 않는다**(2026-11-28 기획자) — 쓰고 이동 · 공격 · 책략.
 *
 * 여기 있는 검사는 **규칙을 하나씩 일부러 깨면 각각 정확히 그 자리에서 실패한다.**
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ITEMS, itemById } from '@samchess/data';
import { apply, createBattle, validate } from '../src/battle.ts';
import { advanceTime } from '../src/battle.ts';
import { findStatus, forecastAttack, hasStatus, legalTargetsFor, resolveAttack } from '../src/state.ts';
import { tacticMpCost } from '../src/effects.ts';
import { usableItemOf } from '../src/held.ts';
import type {
  BattleEvent, BattleState, OfficerId, PieceType, RosterEntry, Side, UnitId,
} from '../src/types.ts';
import { T, U, giveControl } from './fixtures.ts';

const TANG = 'tang-yak';            // 액티브 — 8방향 내 아군 1명(자신 포함) HP +5
const CHA = 'cha';                  // 액티브 — 8방향 내 아군 1명(자신 포함) MP 전량
const MOK = 'mok-u-yu-ma';          // 액티브 — 반경 1 아군 전원(자신 포함) HP +5
const MABI = 'ma-bi-san';           // 액티브 — 8방향 내 아군 1명 HP 50% 회복
const SON = 'son-ja-byeong-beop-seo'; // 액티브 — 3일간 받는 피해 반감(다른 반감과 겹친다)
const POK = 'pok-yak';              // 액티브 — 8방향 내 적 1명에게 5 (반감 무시)
const YEONG = 'yeong-gi';           // 액티브 — 진영 SP +3
const CHEONG = 'cheong-nang-seo';   // 패시브 — 부상 면제
const DAEGAM = 'dae-gam-do';        // Passive 병기 (결정타 +5%p)

const H = (officer: string, piece: PieceType, held?: string): RosterEntry => ({
  officer: officer as OfficerId, piece, level: 1, statPicks: [], tactics: [],
  ...(held ? { held } : {}),
});

/** 유비(King)가 시험 대상이고, 관우가 바로 옆에 선다 */
function fight(p1Held?: string, p2Held?: string): BattleState {
  const s = createBattle({
    matchId: 'items', seed: 11, mode: '3v3',
    rosters: {
      P1: [H('yu-bi', 'King', p1Held), H('gwan-u', 'Rock'), H('jo-sik', 'Pawn')],
      P2: [H('jo-jo', 'King', p2Held), H('jang-hap', 'Bishop'), H('heon-je', 'Queen')],
    },
  });
  // 유비 옆에 관우(아군)와 조조(적)를 붙여 둔다 — 「8방향 내」를 보는 검사가 많다
  const t = structuredClone(s);
  t.units[U('P1-King')]!.pos = { x: 10, y: 10 };
  t.units[U('P1-Rock')]!.pos = { x: 11, y: 10 };
  t.units[U('P1-Pawn')]!.pos = { x: 20, y: 18 };
  t.units[U('P2-King')]!.pos = { x: 10, y: 9 };
  t.units[U('P2-Bishop')]!.pos = { x: 1, y: 1 };
  t.units[U('P2-Queen')]!.pos = { x: 2, y: 1 };
  return t;
}

/** 유비에게 제어권을 주고 아이템을 쓴다 */
function use(held: string, target?: UnitId): { state: BattleState; events: BattleEvent[] } {
  const s = giveControl(fight(held), U('P1-King'));
  return apply(s, 'P1', { t: 'useItem', ...(target !== undefined ? { target } : {}) });
}

const reason = (s: BattleState, side: Side, target?: UnitId): string => {
  const r = validate(s, side, { t: 'useItem', ...(target !== undefined ? { target } : {}) });
  return r.ok ? '' : r.reason;
};

// ── 무엇을 들었는가 ────────────────────────────────────────────

test('들고 온 것이 액티브 아이템일 때만 쓸 수 있다', () => {
  assert.ok(usableItemOf(fight(TANG).units[U('P1-King')]!), '액티브');
  assert.equal(usableItemOf(fight(CHEONG).units[U('P1-King')]!), undefined, '패시브는 쓸 것이 없다');
  assert.equal(usableItemOf(fight(DAEGAM).units[U('P1-King')]!), undefined, 'Passive 병기도 쓸 것이 없다');
  assert.equal(usableItemOf(fight().units[U('P1-King')]!), undefined, '안 들었다');
});

test('패시브·병기·빈손은 거부된다 — 「쓸 수 있는 아이템이 없다」', () => {
  for (const held of [CHEONG, DAEGAM, undefined]) {
    const s = giveControl(fight(held), U('P1-King'));
    assert.equal(reason(s, 'P1', U('P1-Rock')), '쓸 수 있는 아이템이 없다', String(held));
  }
});

// ── 조준 — 책략의 규약을 그대로 빌린다 ─────────────────────────

test('탕약: 8방향 내 **아군 1명**만 — 적·먼 아군·무지정은 거부된다', () => {
  const s = giveControl(fight(TANG), U('P1-King'));
  assert.equal(reason(s, 'P1', U('P1-Rock')), '', '바로 옆 아군');
  assert.equal(reason(s, 'P1', U('P2-King')), '아군만 대상으로 삼는다', '적에게는 못 쓴다');
  assert.equal(reason(s, 'P1', U('P1-Pawn')), '1칸 이내여야 한다', '멀리 있는 아군');
  assert.equal(reason(s, 'P1'), '대상을 지정해야 한다', '조준이 필요한 아이템은 대상을 받아야 한다');
});

test('★ 폭약: 8방향 내 **적 1명** — 먼 적도 아군도 거부된다', () => {
  const s = giveControl(fight(POK), U('P1-King'));
  assert.equal(reason(s, 'P1', U('P2-King')), '', '바로 위 적');
  assert.equal(reason(s, 'P1', U('P1-Rock')), '적군만 대상으로 삼는다');
  // 2026-09-23까지 `enemyOne`은 거리를 **안 봤다** — 판 반대편까지 닿았다
  assert.equal(reason(s, 'P1', U('P2-Bishop')), '1칸 이내여야 한다', '판 반대편의 적');
});

test('영기 · 손자병법서 · 대완마는 조준이 없다 — 대상 없이 그대로 선다', () => {
  for (const held of [YEONG, SON, 'dae-wan-ma']) {
    const s = giveControl(fight(held), U('P1-King'));
    assert.equal(reason(s, 'P1'), '', held);
  }
});

// ── 효과 — 데이터(Effect DSL)가 정한다 ─────────────────────────

test('탕약 — 아군 HP +5. 이벤트 `itemUsed`가 먼저 오고 효과가 뒤따른다', () => {
  const before = fight(TANG);
  const hurt = structuredClone(before);
  hurt.units[U('P1-Rock')]!.hp = 1;
  const s = apply(giveControl(hurt, U('P1-King')), 'P1', { t: 'useItem', target: U('P1-Rock') });

  assert.equal(s.events[0]?.e, 'itemUsed');
  assert.equal((s.events[0] as { item: string }).item, TANG);
  assert.equal(s.state.units[U('P1-Rock')]!.hp, 6, '1 → 6');
});

test('차 — MP 전량 회복(최대치에서 잘린다)', () => {
  const base = fight(CHA);
  const dry = structuredClone(base);
  dry.units[U('P1-Rock')]!.mp = 0;
  const s = apply(giveControl(dry, U('P1-King')), 'P1', { t: 'useItem', target: U('P1-Rock') });
  const rock = s.state.units[U('P1-Rock')]!;
  assert.equal(rock.mp, rock.maxMp);
});

test('★ 탕약 · 차는 **자기 자신에게도** 쓴다 (2026-10-15 기획자 확정 · 세 아이템 설명은 2026-11-27에 「(자신 포함)」을 뺐다 — 효과는 그대로)', () => {
  // 엔진은 처음부터 받았다(거리 0이 반경 1 안이다). 규칙으로 정했으니 여기서 고정한다
  const hurt = structuredClone(fight(TANG));
  hurt.units[U('P1-King')]!.hp = 1;
  const healed = apply(giveControl(hurt, U('P1-King')), 'P1', { t: 'useItem', target: U('P1-King') });
  assert.equal(healed.state.units[U('P1-King')]!.hp, 6, '탕약 — 자신 1 → 6');

  const dry = structuredClone(fight(CHA));
  dry.units[U('P1-King')]!.mp = 0;
  const filled = apply(giveControl(dry, U('P1-King')), 'P1', { t: 'useItem', target: U('P1-King') });
  const king = filled.state.units[U('P1-King')]!;
  assert.equal(king.mp, king.maxMp, '차 — 자신 MP 전량');

  // 차는 설명이 규칙을 그대로 말한다. 탕약은 「아군이면 자신도 든다」를 맥락에 맡긴다(2026-11-27 기획자)
  for (const id of [TANG, CHA, MOK]) {
    assert.ok(!itemById.get(id)!.text.includes('(자신 포함)'), `${id} 설명은 「(자신 포함)」을 뺐다 — 「아군」에 자신이 든다`);
  }
});

test('목우유마 — 반경 1 아군 **전원 + 자신**. 멀리 있는 아군은 안 받는다', () => {
  const base = fight(MOK);
  const hurt = structuredClone(base);
  for (const id of ['P1-King', 'P1-Rock', 'P1-Pawn']) hurt.units[U(id)]!.hp = 1;
  const s = apply(giveControl(hurt, U('P1-King')), 'P1', { t: 'useItem' });
  assert.equal(s.state.units[U('P1-King')]!.hp, 6, '자신도 받는다');
  assert.equal(s.state.units[U('P1-Rock')]!.hp, 6, '옆 칸 아군');
  assert.equal(s.state.units[U('P1-Pawn')]!.hp, 1, '먼 아군은 안 받는다');
});

test('영기 — 진영 SP +3, 상한에서 잘린다', () => {
  const s = use(YEONG);
  assert.equal(s.state.sp.P1, 3);
  assert.equal(s.state.sp.P2, 0, '상대 SP는 안 건드린다');

  const full = structuredClone(fight(YEONG));
  full.sp.P1 = full.spCap.P1 - 1;
  const capped = apply(giveControl(full, U('P1-King')), 'P1', { t: 'useItem' });
  assert.equal(capped.state.sp.P1, capped.state.spCap.P1);
});

test('★ 폭약은 반감을 무시한다 — `damage`는 `resolveAttack`을 안 지난다', () => {
  const base = fight(POK);
  const guarded = structuredClone(base);
  guarded.units[U('P2-King')]!.statuses.push({ status: 'incomingDamageHalf' });
  const hp = guarded.units[U('P2-King')]!.hp;
  const s = apply(giveControl(guarded, U('P1-King')), 'P1', { t: 'useItem', target: U('P2-King') });
  assert.equal(s.state.units[U('P2-King')]!.hp, hp - 5, '반감이 걸려 있어도 5가 그대로 들어간다');
});

// ── 회복 · 버프 (2026-11-28) ───────────────────────────────────

test('마비산 — 8방향 내 아군 1명의 HP를 최대 HP의 50%만큼', () => {
  const hurt = structuredClone(fight(MABI));
  const rock = hurt.units[U('P1-Rock')]!;
  rock.hp = 1;
  const s = apply(giveControl(hurt, U('P1-King')), 'P1', { t: 'useItem', target: U('P1-Rock') });
  assert.equal(s.state.units[U('P1-Rock')]!.hp, 1 + Math.floor(rock.maxHp * 0.5));
});

test('★ 손자병법서 — 받는 피해 반감이 **다른 반감과 겹친다** (1/4), 지속 290', () => {
  const s = structuredClone(use(SON).state);
  const me = s.units[U('P1-King')]!;
  assert.equal(findStatus(me, 'itemIncomingHalf')?.expiresAt, 290, '3일 = 290 눈금');
  s.units[U('P2-King')]!.at = 8;
  assert.equal(forecastAttack(s, U('P2-King'), U('P1-King'))!.normal, 4, '한 겹');
  me.statuses.push({ status: 'incomingDamageHalf' });      // 조운 「간뇌도지」 같은 반감
  assert.equal(forecastAttack(s, U('P2-King'), U('P1-King'))!.normal, 2, '두 겹 — 1/4');
  const events: BattleEvent[] = [];
  const hp = me.hp;
  resolveAttack(s, s.units[U('P2-King')]!, me, events);
  const hit = events.find((e) => e.e === 'attacked') as { damage: number; critical: boolean };
  assert.equal(me.hp, hp - hit.damage);
  assert.ok(hit.damage <= 4, '결정타여도 8 × 2 / 4 = 4');
});

test('대완마 · 적토마 — 앞으로 내 차례 세 번 동안 WT −10 · −30', () => {
  for (const [held, delta] of [['dae-wan-ma', -10], ['jeok-to-ma', -30]] as const) {
    const me = use(held).state.units[U('P1-King')]!;
    assert.deepEqual(me.wtModifiers, [{ delta, turnsLeft: 3 }], held);
  }
});

test('태평요술 — 3일간 책략 MP 소모 0', () => {
  const s = use('tae-pyeong-yo-sul').state;
  const me = s.units[U('P1-King')]!;
  assert.equal(findStatus(me, 'itemZeroMp')?.expiresAt, 290);
  assert.equal(tacticMpCost(me, T('회복')), 0);
});

test('육도삼략 — 2일간 맞으면 반드시 반격한다(굴리지 않는다)', () => {
  const s = structuredClone(use('yuk-do-sam-ryak').state);
  const me = s.units[U('P1-King')]!, foe = s.units[U('P2-King')]!;
  assert.equal(findStatus(me, 'itemCounter')?.expiresAt, 190);
  me.hp = 99; foe.hp = 99;
  const events: BattleEvent[] = [];
  resolveAttack(s, foe, me, events);
  assert.equal(events.filter((e) => e.e === 'attacked').length, 2, '맞고 → 반격');
});

test('★ 의천검 — 쓰는 즉시 1일간 아군 전원 결정타 100% · 쓴 그 차례의 공격부터 들어간다', () => {
  const s = use('ui-cheon-geom').state;
  for (const u of Object.values(s.units).filter((x) => x.side === 'P1')) {
    assert.equal(findStatus(u, 'itemCritAll')?.expiresAt, 90, u.id);
    assert.equal(forecastAttack(s, u.id, U('P2-King'))!.criticalRate, 100, u.id);
  }
  assert.equal(s.activeUnit, U('P1-King'), '차례가 그대로다');
  const r = apply(s, 'P1', { t: 'attack', targets: [U('P2-King')] });
  assert.equal((r.events.find((e) => e.e === 'attacked') as { critical: boolean }).critical, true, '쓰고 바로 친 한 대가 결정타');
});

// ── 쓰는 즉시 치는 한 대 (수극 · 유성추, 2026-11-28 기획자 — 「다음 공격」 상태에서 바꿨다) ──

test('★ 수극 — 8방향 내 적 1명을 **쓰는 즉시** 결정타로 치고, 차례가 이어져 또 공격할 수 있다', () => {
  const r = use('su-geuk', U('P2-King'));
  const hit = r.events.find((e) => e.e === 'attacked' && e.unit === U('P1-King')) as { critical: boolean; target: UnitId };
  assert.equal(hit.target, U('P2-King'));
  assert.equal(hit.critical, true);
  assert.equal(r.state.activeUnit, U('P1-King'), '차례가 그대로다');
  const far = structuredClone(fight('su-geuk'));
  far.units[U('P2-King')]!.pos = { x: 10, y: 8 };      // 두 칸 — 안 닿는다
  assert.equal(validate(giveControl(far, U('P1-King')), 'P1', { t: 'useItem', target: U('P2-King') }).ok, false);
});

test('유성추 — 8방향 두 칸 줄 위의 적 1명을 쓰는 즉시 친다(사이의 유닛은 안 막는다) · 줄 밖은 안 닿는다', () => {
  const far = structuredClone(fight('yu-seong-chu'));
  far.units[U('P2-King')]!.pos = { x: 15, y: 15 };
  far.units[U('P2-Bishop')]!.pos = { x: 12, y: 8 };     // 대각선 두 칸
  far.units[U('P2-Queen')]!.pos = { x: 11, y: 8 };      // (1, 2) — 줄 밖
  far.units[U('P2-Bishop')]!.hp = 99;
  const s = giveControl(far, U('P1-King'));
  assert.equal(validate(s, 'P1', { t: 'useItem', target: U('P2-Queen') }).ok, false, '줄 밖');
  const r = apply(s, 'P1', { t: 'useItem', target: U('P2-Bishop') });
  const hit = r.events.find((e) => e.e === 'attacked' && e.unit === U('P1-King')) as { target: UnitId };
  assert.equal(hit.target, U('P2-Bishop'));
  assert.ok(r.state.units[U('P2-Bishop')]!.hp < 99);
  assert.equal(r.state.activeUnit, U('P1-King'), '차례가 그대로다');
});

// ── 아이템으로 치는 한 대 (개산대부 · 청룡언월도 · 장팔사모) ──────

test('★ 개산대부 — 결정타로 치고 한 칸 밀어낸다. 그 뒤에 **또 공격**할 수 있다', () => {
  const r = use('gae-san-dae-bu', U('P2-King'));
  const hit = r.events.find((e) => e.e === 'attacked') as { critical: boolean };
  assert.equal(hit.critical, true);
  assert.deepEqual(r.state.units[U('P2-King')]!.pos, { x: 10, y: 8 }, '(10,9) → 반대쪽으로 한 칸');
  assert.ok(r.events.some((e) => e.e === 'moved' && e.pushed === true));
  assert.equal(r.state.activeUnit, U('P1-King'), '차례가 그대로다 — 평타를 또 칠 수 있다');
});

test('개산대부 — 밀 자리가 막혔으면 데미지 +3 (반감 없이)', () => {
  const blocked = structuredClone(fight('gae-san-dae-bu'));
  blocked.units[U('P2-Bishop')]!.pos = { x: 10, y: 8 };   // 밀려날 칸에 다른 유닛
  blocked.units[U('P2-King')]!.hp = 99;
  const crit = forecastAttack(giveControl(blocked, U('P1-King')), U('P1-King'), U('P2-King'))!.critical;
  const r = apply(giveControl(blocked, U('P1-King')), 'P1', { t: 'useItem', target: U('P2-King') });
  assert.deepEqual(r.state.units[U('P2-King')]!.pos, { x: 10, y: 9 }, '안 밀렸다');
  assert.equal(r.state.units[U('P2-King')]!.hp, 99 - crit - 3);
});

test('청룡언월도 — 8방향 내 적 전원을 결정타로 · 닿는 적이 없으면 못 쓴다', () => {
  const ring = structuredClone(fight('cheong-ryong-eon-wol-do'));
  ring.units[U('P2-Bishop')]!.pos = { x: 11, y: 11 };
  for (const u of Object.values(ring.units)) u.hp = 99;
  const r = apply(giveControl(ring, U('P1-King')), 'P1', { t: 'useItem' });
  const hits = r.events.filter((e) => e.e === 'attacked' && e.unit === U('P1-King')) as { target: UnitId; critical: boolean }[];
  assert.deepEqual(new Set(hits.map((h) => h.target)), new Set([U('P2-King'), U('P2-Bishop')]));
  assert.ok(hits.every((h) => h.critical));

  const alone = structuredClone(fight('cheong-ryong-eon-wol-do'));
  alone.units[U('P2-King')]!.pos = { x: 15, y: 15 };
  assert.equal(reason(giveControl(alone, U('P1-King')), 'P1'), '닿는 적이 없다');
});

test('장팔사모 — 4방향 두 칸 줄 위의 적 전원, 앞의 아군을 지나 닿는다 · 대각선은 안 닿는다', () => {
  const line = structuredClone(fight('jang-pal-sa-mo'));
  line.units[U('P2-Bishop')]!.pos = { x: 12, y: 10 };    // 오른쪽 두 칸 — 그 앞(11,10)에 관우
  line.units[U('P2-Queen')]!.pos = { x: 11, y: 11 };     // 대각선
  for (const u of Object.values(line.units)) u.hp = 99;
  const r = apply(giveControl(line, U('P1-King')), 'P1', { t: 'useItem' });
  const hit = new Set(r.events.filter((e) => e.e === 'attacked' && e.unit === U('P1-King')).map((e) => (e as { target: UnitId }).target));
  assert.deepEqual(hit, new Set([U('P2-King'), U('P2-Bishop')]));
});

// ── 턴 — 차례를 끝내지 않는다 (2026-11-28) ─────────────────────

test('★ 아이템은 차례를 끝내지 않는다 — 쓰고 나서 공격한다', () => {
  const r = use(YEONG);
  assert.equal(r.state.activeUnit, U('P1-King'), '차례가 그대로다');
  assert.ok(!r.events.some((e) => e.e === 'turnEnded'));
  assert.equal(r.state.activeTurn?.acted, false, '행동 칸을 안 쓴다');
  assert.ok(validate(r.state, 'P1', { t: 'attack', targets: [U('P2-King')] }).ok, '그 뒤에 공격할 수 있다');
});

test('이미 행동했으면 못 쓴다 — 행동하면 차례가 끝나므로 아이템은 행동 전에 쓴다', () => {
  const s = giveControl(fight(YEONG), U('P1-King'));
  const acted = structuredClone(s);
  acted.activeTurn!.acted = true;
  assert.equal(reason(acted, 'P1'), '이미 행동했다');
});

test('이동한 뒤에도 쓸 수 있다', () => {
  const s = giveControl(fight(YEONG), U('P1-King'));
  const moved = structuredClone(s);
  moved.activeTurn!.moved = true;
  assert.equal(reason(moved, 'P1'), '');
});

test('★ 한 판에 한 번뿐이다 — 두 번째는 거부된다', () => {
  const first = use(YEONG).state;
  assert.equal(first.units[U('P1-King')]!.itemUsed, true);
  // 다음 차례를 받아도 그대로다
  const again = giveControl(first, U('P1-King'));
  assert.equal(reason(again, 'P1'), '쓸 수 있는 아이템이 없다');
});

test('★ 들고 온 것은 안 지운다 — 화면이 「무엇을 들고 나왔는지」를 말할 수 있어야 한다', () => {
  const s = use(YEONG).state;
  assert.equal(s.units[U('P1-King')]!.held, YEONG);
});

test('조종당하는 중에는 못 쓴다 — 지휘권을 가져간 쪽도 못 쓴다', () => {
  const s = giveControl(fight(TANG), U('P1-King'));
  const puppet = structuredClone(s);
  puppet.units[U('P1-King')]!.control = { by: U('P2-King'), mode: 'moveAndAttack', uses: 1 };
  // 지시를 내리는 쪽은 P2가 된다(`controllingSide`) — 그쪽에서도 막힌다
  assert.equal(reason(puppet, 'P2', U('P1-Rock')), '조종당하는 중에는 아이템을 쓸 수 없다');
  assert.equal(reason(puppet, 'P1', U('P1-Rock')), '내 차례가 아니다', '원래 주인도 지금은 못 움직인다');
});

// ── 결정성 — 리플레이가 갈리지 않는다 ──────────────────────────

test('★ 아이템은 난수를 쓰지 않는다 — `rngCursor`가 안 밀린다', () => {
  for (const held of [TANG, POK, MABI, YEONG, SON, 'gae-san-dae-bu', 'cheong-ryong-eon-wol-do']) {
    const s = giveControl(fight(held), U('P1-King'));
    const target = held === POK || held === 'gae-san-dae-bu' ? U('P2-King') : held === TANG || held === MABI ? U('P1-Rock') : undefined;
    const r = apply(s, 'P1', { t: 'useItem', ...(target ? { target } : {}) });
    assert.equal(r.state.rngCursor, s.rngCursor, `${held} — 굴리면 리플레이가 깨진다`);
  }
});

test('같은 의도는 같은 결과를 낸다', () => {
  const a = use(TANG, U('P1-Rock')).state;
  const b = use(TANG, U('P1-Rock')).state;
  assert.deepEqual(a.units, b.units);
  assert.equal(a.time, b.time);
});

// ── 데이터가 사양이다 ──────────────────────────────────────────

test('Active는 전부 `effects`를 갖고, Passive는 안 갖는다', () => {
  const actives = ITEMS.filter((i) => i.kind === 'active');
  assert.equal(actives.length, 17, '장터 11 + 병기 6');
  for (const item of actives) assert.ok((item.effects ?? []).length > 0, item.id);
  for (const item of ITEMS.filter((i) => i.kind === 'passive')) {
    // 패시브는 키째로 없다 — 있으면 `usableItemOf`가 아니라 여기서 먼저 걸린다
    assert.equal(item.effects, undefined, `${item.id} — 패시브는 쓸 것이 없다`);
  }
});

test('Active는 **전부 쓸 수 있다** — 조준까지 엔진이 받아 준다', () => {
  for (const item of ITEMS.filter((i) => i.kind === 'active')) {
    const s = giveControl(fight(item.id), U('P1-King'));
    const targets: (UnitId | undefined)[] = [undefined, U('P1-Rock'), U('P2-King')];
    assert.ok(targets.some((t) => validate(s, 'P1', { t: 'useItem', ...(t ? { target: t } : {}) }).ok),
      `${item.id} — 어떤 대상으로도 쓸 수 없다`);
  }
});

// ── 시간이 흘러도 상태가 산다 ──────────────────────────────────

test('손자병법서를 쓰고 시간이 흐르면 만료 이벤트가 온다', () => {
  let s = use(SON).state;
  for (let i = 0; i < 200 && s.time <= 290 && s.phase !== 'finished'; i++) {
    if (s.phase === 'control') s = apply(s, s.units[s.activeUnit!]!.side, { t: 'endTurn' }).state;
    else s = advanceTime(s).state;
  }
  assert.ok(s.time > 290, `시간이 290을 넘겨야 한다 — 지금 ${s.time}`);
  assert.equal(hasStatus(s.units[U('P1-King')]!, 'itemIncomingHalf'), false, '290이 지나면 풀린다');
  assert.ok(itemById.get(SON));
});
