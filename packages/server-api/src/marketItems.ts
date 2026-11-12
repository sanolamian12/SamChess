/**
 * **시장 아이템 낱개 추적표** (2026-11-12, `market_items`) — 관리자가 「산 것 · 쓴 것 · 낸 금화」를 낱개로 맞춰 보는 표.
 *
 * 게임은 시장 아이템을 **종류마다 개수**로만 센다(`marketOwned` — 같은 종류끼리 구별이 없다). 그래서 이 표는 게임이 읽지 않고
 * **관리자만 본다.** 계정을 쓰는 트랜잭션(`profileStore.ts`의 `transact`) 안에서 쓰기 전 · 후를 견주어 낱개 줄을 맞춘다 —
 * 변화 장부(`ledger.ts`)와 같은 자리 · 같은 트랜잭션이라 「추적표 없이 바뀐 아이템」이 없다.
 *
 * 한 낱개의 걸음: 들어옴(구매 · 관리자 지급 · 우편 · 처음 본 것 …) → 들고 갈 장수가 바뀜(양도일 · 보유자) → 판에 나감(사용일 · 사용자)
 * → 판이 끝나면 **사용**으로 굳거나(더는 안 바뀐다), 판이 무르면 보유로 되돌아온다. 컬렉션 등록 · 관리자 회수로 빠지면 **빠짐**.
 *
 * **어느 낱개인가는 이 표가 정하는 규칙이다** — 판에 나간 것은 그 장수가 들고 있던 낱개, 빠진 것은 아무도 안 든 오래된 낱개부터.
 * 게임 계정은 「그 종류 하나가 줄었다」로만 알아서, 남은 낱개의 구매일이 게임 화면과 다를 수 있다(개수 · 보유자 · 사용자는 같다).
 *
 * 수상한 것은 그 자리에서 이상 징후(`market`)로 올린다 —
 *  · `gold` — 구매로 들어왔는데 금화가 값만큼 안 줄었다
 *  · `noSource` — 구매 · 지급 · 우편이 아닌 길로 늘었다
 *  · `phantom` — 가진 것이 없는데 판에 나갔다(낱개 없이 사용)
 */
import type { PoolClient } from 'pg';
import type { PlayerProfile } from '@samchess/meta';
import { raise } from './anomaly.ts';
import { currentRef, currentSource } from './requestContext.ts';
import { hasMarket, planUnits } from './marketUnitsPlan.ts';
import type { LiveUnit, Plan, PlanContext } from './marketUnitsPlan.ts';

export type { MarketUnitOrigin, UnitFlag, UnitStatus } from './marketUnitsPlan.ts';


async function apply(tx: PoolClient, uid: string, plan: Plan, route: string): Promise<void> {
  for (const c of plan.creates) {
    await tx.query(
      `insert into market_items (uid, unit, item, seq, origin, route, status, bought_at, gold_before, gold_after, price, holder, handed_at,
                                 used_at, used_by, used_battle, flag, ref)
       values ($1, $2, $3, $4, $5, $6, $7, case when $8::bigint is null then null else to_timestamp($8::bigint / 1000.0) end,
               $9, $10, $11, $12, case when $12::text is null then null else now() end,
               case when $7 = 'inPlay' then now() else null end, $13, $14, $15, $16)`,
      [uid, c.unit, c.item, c.seq, c.origin, route, c.status, c.boughtAt, c.goldBefore, c.goldAfter, c.price, c.holder,
        c.usedBy, c.usedBattle, c.flag, c.origin === 'mail' ? currentRef() : null],
    );
  }
  for (const ch of plan.changes) {
    const [sql, args]: [string, unknown[]] =
      ch.kind === 'hand' ? ['holder = $3, handed_at = now()', [ch.holder]]
      : ch.kind === 'play' ? [`status = 'inPlay', used_at = now(), used_by = $3, used_battle = $4, used_route = $5`, [ch.usedBy, ch.usedBattle, route]]
      : ch.kind === 'back' ? [`status = 'held', used_at = null, used_by = null, used_battle = null, used_route = null, holder = null`, []]
      : ch.kind === 'used' ? [`status = 'used', ended_at = now(), end_route = $3`, [route]]
      : [`status = 'removed', holder = null, ended_at = now(), end_route = $3`, [route]];
    await tx.query(`update market_items set ${sql} where uid = $1 and unit = $2`, [uid, ch.unit, ...args]);
  }
  for (const f of plan.flags) {
    await raise(tx, uid, 'market', `${f.flag}:${f.item}`, { ...f.detail, units: f.units, route });
  }
}

async function step(
  tx: PoolClient, uid: string, live: LiveUnit[], seq: Map<string, number>, target: PlayerProfile, ctx: PlanContext,
): Promise<LiveUnit[]> {
  const plan = planUnits(live, target, seq, ctx);
  if (plan.creates.length === 0 && plan.changes.length === 0) return live;
  await apply(tx, uid, plan, ctx.source);
  return loadLive(tx, uid);
}

async function loadLive(tx: PoolClient, uid: string): Promise<LiveUnit[]> {
  return (await tx.query<{ unit: string; item: string; seq: number; status: 'held' | 'inPlay'; holder: string | null; used_by: string | null; used_battle: string | null }>(
    `select unit, item, seq, status, holder, used_by, used_battle from market_items where uid = $1 and status in ('held', 'inPlay')`, [uid],
  )).rows.map((r) => ({ unit: r.unit, item: r.item, seq: r.seq, status: r.status, holder: r.holder, usedBy: r.used_by, usedBattle: r.used_battle }));
}

/**
 * 한 번의 쓰기를 추적표에 적는다 — `writeLedger`와 같은 인자(되접은 값 · 정산한 값 · 쓴 값). 세 단계다:
 *  1. **읽은 값**(`migrated`)에 맞춘다 — 추적표가 생긴 뒤 처음이면 `baseline`, 그 뒤로 어긋났으면 장부 밖 변화(`outside`)
 *  2. **정산한 값**(`current`) — 읽는 순간의 서버 정산(방치된 판의 정산 · 환불 …)
 *  3. **쓴 값**(`next`) — 이 요청이 한 일. 새 낱개의 출처 · 금화 대조가 여기서 걸린다
 */
export async function writeMarketItems(
  tx: PoolClient, uid: string, migrated: PlayerProfile | null, current: PlayerProfile | null, next: PlayerProfile,
): Promise<void> {
  if (!hasMarket(migrated) && !hasMarket(current) && !hasMarket(next)) {
    // 아무 데도 없다 — 다만 살아 있는 낱개가 남아 있으면(장부 밖에서 지워졌다) 맞춰야 하니 그때만 연다
    const any = await tx.query('select 1 from market_items where uid = $1 and status in ($2, $3) limit 1', [uid, 'held', 'inPlay']);
    if (any.rowCount === 0) return;
  }
  const seqRows = (await tx.query<{ item: string; m: number }>(
    'select item, max(seq) as m from market_items where uid = $1 group by item', [uid])).rows;
  const seq = new Map(seqRows.map((r) => [r.item, Number(r.m) + 1]));
  const fresh = seqRows.length === 0;
  let live = await loadLive(tx, uid);
  if (migrated) {
    const g = migrated.gold;
    live = await step(tx, uid, live, seq, migrated, { source: fresh ? 'baseline' : 'outside', goldBefore: g, goldAfter: g });
  }
  if (current) live = await step(tx, uid, live, seq, current, { source: 'sync', goldBefore: migrated?.gold ?? 0, goldAfter: current.gold });
  await step(tx, uid, live, seq, next, { source: currentSource(), goldBefore: current?.gold ?? next.gold, goldAfter: next.gold });
}
