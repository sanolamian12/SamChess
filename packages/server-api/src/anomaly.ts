/**
 * **이상 징후 점검** (2026-11-12, 설계 `history/2026-11-12_이상징후_설계.md` · 판정은 `@samchess/meta`의 `ledger.ts`).
 *
 * 1시간마다 게임 API가 돌린다(`startAnomalyTimer`, 관리자 API는 늘 떠 있지 않다). 손으로는 `npm run anomaly:scan`.
 * 찾는 것 —
 *  · ① 출처 없는 변화: 장부 줄 중 **쓰는 순간 판정이 걸린 것**(`unexpected`) — 지난 점검 뒤의 줄만
 *  · ①-b 장부 밖 변화: 계정의 지금 값이 그 계정 장부의 마지막 `after`와 다르다(DB 직접 수정 · 장부를 안 지나는 도구). 군량은 빼고 본다 —
 *    군량 충전만의 정산은 장부에 안 적는다. 장부가 없는 계정(장부 전부터 있던 계정)은 **기준 줄만 적는다**(징후 아님)
 *  · ② 불변식 위반: 전 계정에 `profileInvariants()`
 *  · ④ 수상한 거절: 지난 점검 뒤(≈ 1시간)의 거절을 계정 · 코드마다 세어 문턱(`REJECT_WATCH`) 이상
 * 같은 계정 · 종류 · 무엇이 열려 있으면 새 줄을 안 만들고 `last_seen` · `hits`만 민다. 자동 정지 · 회수는 없다 — 관리자가 보고 처리한다.
 *
 * **한 트랜잭션 + 트랜잭션 잠금**(`pg_try_advisory_xact_lock`) — 게임 API가 여러 대 떠도 한 번만 돈다. 세션 잠금은 트랜잭션 풀러(6543)에서
 * 연결이 바뀌어 안 선다. 보관 기간(90일)이 지난 장부 · 거절도 여기서 지운다 — 계정마다 마지막 장부 줄은 남긴다(①-b의 기준).
 */
import type { PoolClient } from 'pg';
import { PROFILE_VERSION, REJECT_WATCH, ledgerValues, migrateProfile, outsideDelta, profileInvariants } from '@samchess/meta';
import type { InvariantBreak, LedgerValues, PlayerProfile } from '@samchess/meta';
import { pool } from './db.ts';
import { withCheckout } from './checkout.ts';

/** 점검 잠금 열쇠 — 다른 잠금과 안 겹치는 아무 수 */
const LOCK_KEY = 0x5ca7_a40d;
/** 장부 · 거절 보관 */
const KEEP_DAYS = 90;
/** 점검 사이 */
export const SCAN_EVERY_MS = 60 * 60 * 1000;

export interface ScanResult {
  scanId: number;
  /** 본 계정 수 */
  accounts: number;
  /** 새로 열린 징후 */
  opened: number;
  /** 이미 열려 있던 징후에 다시 걸린 것 */
  bumped: number;
  ledgerTo: number;
  rejectsTo: number;
}

type Kind = 'source' | 'create' | 'dev' | 'outside' | 'invariant' | 'reject';

/** 징후 한 줄 — 열려 있는 같은 줄이 있으면 민다. 새로 열었으면 참 */
async function raise(tx: PoolClient, uid: string, kind: Kind, key: string, detail: unknown): Promise<boolean> {
  const r = await tx.query<{ inserted: boolean }>(
    `insert into anomalies (uid, kind, key, detail) values ($1, $2, $3, $4)
     on conflict (uid, kind, key) where status = 'open'
     do update set last_seen = now(), hits = anomalies.hits + 1, detail = excluded.detail
     returning (xmax = 0) as inserted`,
    [uid, kind, key, JSON.stringify(detail)],
  );
  return r.rows[0]!.inserted;
}

/** 저장된 값이 모양부터 어긋나 판정이 던지면 그것도 깨진 것이다 */
function safeInvariants(p: PlayerProfile): InvariantBreak[] {
  try {
    return profileInvariants(p);
  } catch (e) {
    return [{ code: 'shape', key: 'profile', detail: String(e) }];
  }
}

async function baseline(tx: PoolClient, uid: string, values: LedgerValues): Promise<void> {
  await tx.query(
    `insert into account_ledger (uid, source, phase, delta, after) values ($1, 'scan', 'baseline', '{}', $2)`,
    [uid, JSON.stringify(values)],
  );
}

async function scan(tx: PoolClient): Promise<ScanResult | null> {
  await tx.query('begin');
  const locked = (await tx.query<{ ok: boolean }>('select pg_try_advisory_xact_lock($1) as ok', [LOCK_KEY])).rows[0]!.ok;
  if (!locked) { await tx.query('rollback'); return null; }

  const prev = (await tx.query<{ ledger_to: string; rejects_to: string }>(
    'select ledger_to, rejects_to from anomaly_scans where finished_at is not null and error is null order by id desc limit 1')).rows[0];
  const ledgerFrom = Number(prev?.ledger_to ?? 0);
  const rejectsFrom = Number(prev?.rejects_to ?? 0);
  const scanId = Number((await tx.query<{ id: string }>('insert into anomaly_scans default values returning id')).rows[0]!.id);
  let opened = 0;
  let bumped = 0;
  const count = (fresh: boolean): void => { if (fresh) opened += 1; else bumped += 1; };

  // ① 출처 없는 변화 — 쓰는 순간 걸린 장부 줄
  const ledgerTo = Number((await tx.query<{ m: string | null }>('select max(id) as m from account_ledger')).rows[0]!.m ?? ledgerFrom);
  const flagged = (await tx.query<{ id: string; uid: string; source: string; phase: string; delta: Record<string, number>; unexpected: string[] }>(
    'select id, uid, source, phase, delta, unexpected from account_ledger where id > $1 and id <= $2 and unexpected is not null order by id',
    [ledgerFrom, ledgerTo])).rows;
  for (const row of flagged) {
    const detail = { ledgerId: Number(row.id), source: row.source, phase: row.phase, delta: row.delta, unexpected: row.unexpected };
    if (row.phase === 'create') count(await raise(tx, row.uid, 'create', 'create', detail));
    // 쓰는 순간 본 장부 밖 변화 — 그 쓰기 직전에 누군가 장부를 안 지나고 바꿨다(`ledger.ts`의 `writeLedger`)
    else if (row.unexpected.includes('outside')) count(await raise(tx, row.uid, 'outside', 'outside', detail));
    else {
      if (row.unexpected.includes('dev')) count(await raise(tx, row.uid, 'dev', row.source, detail));
      for (const g of row.unexpected.filter((u) => u !== 'dev')) count(await raise(tx, row.uid, 'source', `${row.source}:${g}`, detail));
    }
  }

  // ①-b 장부 밖 변화 · ② 불변식 — 전 계정
  const accounts = (await tx.query<{ uid: string; data: unknown; after: LedgerValues | null; ledger_id: string | null }>(
    `select p.uid, p.data, l.after, l.id as ledger_id from profiles p
       left join lateral (select after, id from account_ledger where uid = p.uid order by id desc limit 1) l on true`)).rows;
  for (const a of accounts) {
    const profile = migrateProfile(a.data);
    if (!profile) continue;
    // **불변식은 저장된 값 그대로에 본다** — 되접기(`migrateProfile`)는 읽을 때마다 깨진 것을 조용히 고친다(레벨은 성장 스택에서 다시 내고,
    // 도시 · 건물 레벨은 범위로 자른다). 고친 뒤에 보면 아무것도 안 걸린다. 저장 형식이 지금 버전이 아닌 옛 줄은 다르게 생긴 것이 정상이라
    // 되접은 값으로 본다.
    const stored = a.data as { version?: unknown };
    const target = stored?.version === PROFILE_VERSION ? (a.data as PlayerProfile) : profile;
    for (const b of safeInvariants(target)) {
      count(await raise(tx, a.uid, 'invariant', `${b.code}:${b.key}`, { ...b, stored: target !== profile }));
    }
    const now = ledgerValues(profile);
    if (!a.after) { await baseline(tx, a.uid, now); continue; }
    const diff = outsideDelta(a.after, now);
    if (diff) {
      count(await raise(tx, a.uid, 'outside', 'outside', { lastLedgerId: Number(a.ledger_id), diff }));
      // 지금 값을 새 기준으로 — 같은 변화를 점검마다 다시 알리지 않는다(열린 징후는 그대로 남는다)
      await baseline(tx, a.uid, now);
    }
  }

  // ④ 수상한 거절 — 지난 점검 뒤
  const rejectsTo = Number((await tx.query<{ m: string | null }>('select max(id) as m from account_rejects')).rows[0]!.m ?? rejectsFrom);
  const rejects = (await tx.query<{ uid: string; code: string; n: string; sources: string[] }>(
    `select uid, code, count(*) as n, array_agg(distinct source) as sources from account_rejects
      where id > $1 and id <= $2 group by uid, code`, [rejectsFrom, rejectsTo])).rows;
  for (const r of rejects) {
    const limit = REJECT_WATCH[r.code];
    if (limit !== undefined && Number(r.n) >= limit) {
      count(await raise(tx, r.uid, 'reject', r.code, { count: Number(r.n), limit, sources: r.sources }));
    }
  }

  // 보관 — 계정마다 마지막 장부 줄은 남긴다
  await tx.query(
    `delete from account_ledger where at < now() - make_interval(days => $1)
       and id not in (select max(id) from account_ledger group by uid)`, [KEEP_DAYS]);
  await tx.query('delete from account_rejects where at < now() - make_interval(days => $1)', [KEEP_DAYS]);
  await tx.query('delete from anomaly_scans where started_at < now() - make_interval(days => $1)', [KEEP_DAYS]);

  await tx.query(
    'update anomaly_scans set finished_at = now(), ledger_to = $2, rejects_to = $3, accounts = $4, found = $5 where id = $1',
    [scanId, ledgerTo, rejectsTo, accounts.length, opened],
  );
  await tx.query('commit');
  return { scanId, accounts: accounts.length, opened, bumped, ledgerTo, rejectsTo };
}

/**
 * **점검 한 번.** 다른 점검이 돌고 있으면 `null`. 실패하면 되감고, 점검 기록에 오류를 한 줄 남긴 뒤 다시 던진다.
 */
export async function scanAnomalies(): Promise<ScanResult | null> {
  try {
    return await withCheckout(() => pool.connect(), '이상 징후 점검', async (client) => {
      try {
        return await scan(client);
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      }
    });
  } catch (e) {
    await pool.query('insert into anomaly_scans (finished_at, error) values (now(), $1)', [String(e)]).catch(() => {});
    throw e;
  }
}

/** 게임 API가 1시간마다 점검을 돌린다 — 뜬 지 1분 뒤 처음. `SAMCHESS_ANOMALY_SCAN=off`면 안 돌린다(시험용 서버) */
export function startAnomalyTimer(): void {
  if (process.env['SAMCHESS_ANOMALY_SCAN'] === 'off') return;
  const run = (): void => {
    scanAnomalies()
      .then((r) => { if (r) console.log(`[anomaly] 점검 #${r.scanId} — 계정 ${r.accounts} · 새 징후 ${r.opened} · 다시 걸림 ${r.bumped}`); })
      .catch((e) => console.error('[anomaly] 점검 실패', e));
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, SCAN_EVERY_MS).unref();
}
