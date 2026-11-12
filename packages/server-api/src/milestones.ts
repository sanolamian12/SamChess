/**
 * **260명 달성의 순번** (2026-11-12, `meta/milestone.ts` · `sql/schema.sql`의 `roster_milestones`).
 *
 * **계정을 쓰는 트랜잭션 안에서** 부른다(`profileStore.ts`의 `transact`). 이번 쓰기로 원래 장수 260명을 모두 갖게 됐고 아직 기록이
 * 없으면 표에 한 줄을 넣어 순번을 받고, 그 순번을 계정에 적는다 — 같은 트랜잭션이라 「표에는 있는데 계정에는 없는」 일이 없다.
 *
 * - **순번은 표가 정한다** — 프로필만 보고는 다른 계정과의 순서를 모른다. 둘이 같은 순간에 닿아도 같은 순번을 받지 않게
 *   트랜잭션 잠금(`pg_advisory_xact_lock`)을 쥐고 「가장 큰 순번 + 1」을 넣는다. 일생에 한 번 도는 길이라 잠금이 줄 설 일이 없다.
 * - **계정이 지워져도 순번은 남는다**(`on delete set null`) — 뒷사람이 앞으로 당겨져 101번째가 100번째가 되지 않는다.
 * - 표에 이미 이 계정의 줄이 있으면(계정 행을 손으로 고쳐 기록이 빠진 경우) 그 순번을 다시 적는다 — 새로 받지 않는다.
 * - **표가 없으면 이 길만 실패한다** — 260명에 닿는 쓰기만 표를 읽으므로 다른 계정 쓰기는 멀쩡하다. 그래도 운영 전 `db:migrate:prod`.
 */
import type { PoolClient } from 'pg';
import { allOfficersMilestone, ownsAllOfficers, recordAllOfficers } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';

/** 잠금 열쇠 — 이 표만 쓴다 */
const LOCK_KEY = 2026_11_12;

export async function stampMilestones(client: PoolClient, uid: string, next: PlayerProfile, now: number): Promise<PlayerProfile> {
  if (allOfficersMilestone(next)?.seat !== undefined) return next;
  if (!ownsAllOfficers(next)) return next;
  await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
  const had = await client.query<{ seat: number; at: string }>(
    'select seat, (extract(epoch from achieved_at) * 1000)::bigint as at from roster_milestones where uid = $1', [uid]);
  if (had.rows[0]) return recordAllOfficers(next, Number(had.rows[0].at), had.rows[0].seat);
  const at = allOfficersMilestone(next)?.at ?? now;
  const r = await client.query<{ seat: number }>(
    `insert into roster_milestones (seat, uid, city_name, achieved_at)
     select coalesce(max(seat), 0) + 1, $1, $2, to_timestamp($3 / 1000.0) from roster_milestones
     returning seat`,
    [uid, next.cityName, at],
  );
  return recordAllOfficers(next, at, r.rows[0]!.seat);
}
