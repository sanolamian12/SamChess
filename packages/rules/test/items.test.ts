/**
 * **액티브 아이템 사용** — `{ t: 'useItem' }` (2026-09-23, GDD §6.5).
 *
 * 열여섯 중 여섯이 액티브다(탕약·차·목우유마·마비산·폭약·영기). 2026-09-23에
 * 데이터·인벤토리·화면까지 붙었는데 **쓸 방법이 없었다** — 그 마지막 한 칸이다.
 *
 * 여기 있는 검사는 **규칙을 하나씩 일부러 깨면 각각 정확히 그 자리에서 실패한다.**
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { marketItemById } from '@samchess/data';
import { apply, createBattle, validate } from '../src/battle.ts';
import { advanceTime } from '../src/battle.ts';
import { forecastAttack, hasStatus, resolveAttack } from '../src/state.ts';
import { usableItemOf } from '../src/held.ts';
import type {
  BattleEvent, BattleState, OfficerId, PieceType, RosterEntry, Side, UnitId,
} from '../src/types.ts';
import { U, giveControl } from './fixtures.ts';

const TANG = 'tang-yak';            // 액티브 — 8방향 내 아군 1명 HP +5
const CHA = 'cha';                  // 액티브 — 8방향 내 아군 1명 MP 전량
const MOK = 'mok-u-yu-ma';          // 액티브 — 반경 1 아군 전원(자신 포함) HP +5
const MABI = 'ma-bi-san';           // 액티브 — 자신, 지속 90 동안 받는 피해 0
const POK = 'pok-yak';              // 액티브 — 8방향 내 적 1명에게 5 (반감 무시)
const YEONG = 'yeong-gi';           // 액티브 — 진영 SP +3
const CHEONG = 'cheong-nang-seo';   // 패시브 — 부상 면제
const DAEGAM = 'dae-gam-do';        // 병기

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
  assert.equal(usableItemOf(fight(DAEGAM).units[U('P1-King')]!), undefined, '병기는 영구 효과다');
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

test('마비산·영기는 조준이 없다 — 대상 없이 그대로 선다', () => {
  for (const held of [MABI, YEONG]) {
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

// ── 마비산 — `incomingDamageZero` ──────────────────────────────

test('마비산 — 공격 피해가 0이 되고 확인창도 0을 보여 준다', () => {
  const s = use(MABI).state;
  const me = s.units[U('P1-King')]!;
  assert.ok(hasStatus(me, 'incomingDamageZero'));

  const events: BattleEvent[] = [];
  const hp = me.hp;
  resolveAttack(s, s.units[U('P2-King')]!, me, events);
  assert.equal(s.units[U('P1-King')]!.hp, hp, 'HP가 안 준다');
  assert.equal((events.find((e) => e.e === 'attacked') as { damage: number }).damage, 0);

  const fc = forecastAttack(s, U('P2-King'), U('P1-King'))!;
  assert.equal(fc.normal, 0, '화면이 미리 보여 주는 숫자도 엔진이 낸다');
  assert.equal(fc.critical, 0);
  assert.equal(fc.lethal, 'never');
});

test('★ 마비산은 즉사·지속 피해를 막지 못한다 — 데미지 경로가 아니다', () => {
  const s = structuredClone(use(MABI).state);
  const victim = s.units[U('P1-Rock')]!;      // King은 즉사가 안 통한다
  victim.statuses.push({ status: 'incomingDamageZero' });
  const attacker = s.units[U('P2-King')]!;
  attacker.statuses.push({ status: 'instantKillNext' });
  const events: BattleEvent[] = [];
  resolveAttack(s, attacker, victim, events);
  assert.equal(s.units[U('P1-Rock')]!.alive, false, '즉사는 그대로 통한다');
});

test('마비산의 지속은 90 — 한 사이클 뒤에 풀린다', () => {
  const s = use(MABI).state;
  const st = s.units[U('P1-King')]!.statuses.find((x) => x.status === 'incomingDamageZero')!;
  // 시각 0에 걸었으므로 만료는 90이다 (`WT 90/190/290/490` 눈금의 한 사이클)
  assert.equal(st.expiresAt, 90);
});

// ── 턴 — 책략과 같은 행동 칸 ───────────────────────────────────

test('아이템은 행동 칸을 쓰고 그 턴을 끝낸다', () => {
  const r = use(YEONG);
  assert.equal(r.state.activeUnit, null, '턴이 끝났다');
  assert.ok(r.events.some((e) => e.e === 'turnEnded'));
});

test('이미 행동했으면 못 쓴다 — 공격·책략과 같은 칸이다', () => {
  const s = giveControl(fight(YEONG), U('P1-King'));
  const acted = structuredClone(s);
  acted.activeTurn!.acted = true;
  assert.equal(reason(acted, 'P1'), '이미 행동했다');
});

test('이동한 뒤에는 쓸 수 있다 — 「이동 + 행동 하나」', () => {
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
  for (const held of [TANG, POK, MABI, YEONG]) {
    const s = giveControl(fight(held), U('P1-King'));
    const target = held === POK ? U('P2-King') : held === TANG ? U('P1-Rock') : undefined;
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

test('액티브 여섯은 전부 `effects`를 갖고, 패시브 열은 안 갖는다', () => {
  const actives = [...marketItemById.values()].filter((i) => i.kind === 'active');
  assert.equal(actives.length, 6);
  for (const item of actives) assert.ok((item.effects ?? []).length > 0, item.id);
  for (const item of [...marketItemById.values()].filter((i) => i.kind === 'passive')) {
    // 패시브는 키째로 없다 — 있으면 `usableItemOf`가 아니라 여기서 먼저 걸린다
    assert.equal(item.effects, undefined, `${item.id} — 패시브는 쓸 것이 없다`);
  }
});

test('액티브 여섯은 **전부 쓸 수 있다** — 조준까지 엔진이 받아 준다', () => {
  for (const item of [...marketItemById.values()].filter((i) => i.kind === 'active')) {
    const s = giveControl(fight(item.id), U('P1-King'));
    const targets: (UnitId | undefined)[] = [undefined, U('P1-Rock'), U('P2-King')];
    assert.ok(targets.some((t) => validate(s, 'P1', { t: 'useItem', ...(t ? { target: t } : {}) }).ok),
      `${item.id} — 어떤 대상으로도 쓸 수 없다`);
  }
});

// ── 시간이 흘러도 상태가 산다 ──────────────────────────────────

test('마비산을 쓰고 시간이 흐르면 만료 이벤트가 온다', () => {
  let s = use(MABI).state;
  for (let i = 0; i < 6 && hasStatus(s.units[U('P1-King')]!, 'incomingDamageZero'); i++) {
    s = advanceTime(s).state;
    if (s.phase === 'control') s = apply(s, s.units[s.activeUnit!]!.side, { t: 'endTurn' }).state;
  }
  assert.equal(hasStatus(s.units[U('P1-King')]!, 'incomingDamageZero'), false, '90이 지나면 풀린다');
});
