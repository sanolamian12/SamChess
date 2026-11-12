/**
 * **지급 대조** (2026-11-12) — 관리자 지급(감사 로그 `adjust.*`) · 우편 받기가 **약속한 양**과 같은 쓰기의 장부 줄이 **실제로 바꾼 양**을 견준다.
 * 판정은 `@samchess/meta`의 `grantExpected` · `grantActual` · `grantStatus`. 짝은 `account_ledger.ref`(`audit:{id}` · `mail:{id}`)로 찾는다 —
 * 관리자 지급은 감사 로그를 적는 자리가(`admin/store.ts`의 `linkAudit`), 우편은 요청 맥락이 붙인다.
 *
 * 쓰는 자리 둘: 관리자 계정 상세의 「지급 대조」(`admin/store.ts`의 `listGrants` — 한 계정 전부) · 1시간 점검(`anomaly.ts` — 지난 점검 뒤의 줄, 징후 'grant').
 */
import type { Pool, PoolClient } from 'pg';
import { GRANT_SOURCES, adjustmentsOfAudit, grantActual, grantExpected, grantStatus } from '@samchess/meta';
import type { Adjustment, GrantStatus } from '@samchess/meta';

export interface GrantCheck {
  /** 짝 — `audit:{id}` · `mail:{id}`. 짝이 없는 장부 줄(`orphan`)은 `null` */
  ref: string | null;
  uid: string;
  /** 지급한 시각(감사 로그) · 받은 시각(우편 받기의 장부 줄) */
  at: Date;
  kind: 'audit' | 'mail';
  /** 감사 로그의 이름(`adjust.item`) · 우편 제목(한국어) */
  label: string;
  expected: Record<string, number>;
  /** 그 쓰기의 장부 줄이 바꾼 양(접은 것). 장부 줄이 없으면 `null` */
  actual: Record<string, number> | null;
  status: GrantStatus;
  ledgerIds: number[];
}

type Db = Pool | PoolClient;

interface LedgerRow { id: string; uid: string; at: Date; source: string; delta: Record<string, number>; ref: string | null }
/** `params`는 `adjust.<kind>`면 `Adjustment` 하나, `adjust.batch`면 `{ adjustments }` — 읽는 자리는 `adjustmentsOfAudit` */
interface AuditRow { id: string; uid: string; at: Date; action: string; params: unknown }

/**
 * 견준다. `audits`는 감사 로그 `adjust.*` 줄, `ledger`는 지급 길(`GRANT_SOURCES`)의 장부 줄 + 그 감사 로그를 가리키는 줄이다.
 * 감사 로그마다 한 줄, 우편 받기마다 한 줄, 짝 없는 지급 길의 장부 줄마다 한 줄.
 */
async function assemble(db: Db, audits: AuditRow[], ledger: LedgerRow[]): Promise<GrantCheck[]> {
  // 장부가 생기기 전의 지급은 견줄 줄이 없다 — 「안 들어감」이 아니라 「장부 전」(장부는 2026-11-12에 생겼다)
  const since = (await db.query<{ m: Date | null }>('select min(at) as m from account_ledger')).rows[0]?.m ?? null;
  const byRef = new Map<string, LedgerRow[]>();
  for (const l of ledger) if (l.ref) byRef.set(l.ref, [...(byRef.get(l.ref) ?? []), l]);
  const sum = (rows: LedgerRow[] | undefined): Record<string, number> | null => {
    if (!rows?.length) return null;
    const out: Record<string, number> = {};
    for (const r of rows) for (const [k, n] of Object.entries(grantActual(r.delta))) out[k] = (out[k] ?? 0) + n;
    return out;
  };
  const out: GrantCheck[] = [];
  for (const a of audits) {
    const ref = `audit:${a.id}`;
    const rows = byRef.get(ref);
    const expected = grantExpected(adjustmentsOfAudit(a.action, a.params));
    const actual = sum(rows);
    const status = !actual && (!since || a.at < since) ? 'before' : grantStatus(expected, actual);
    out.push({ ref, uid: a.uid, at: a.at, kind: 'audit', label: a.action, expected, actual, status, ledgerIds: (rows ?? []).map((r) => Number(r.id)) });
  }
  // 우편 받기 — 우편의 보상을 읽어 온다
  const mailRows = ledger.filter((l) => GRANT_SOURCES[l.source] === 'mail');
  const mailIds = [...new Set(mailRows.map((l) => l.ref).filter((r): r is string => !!r?.startsWith('mail:')).map((r) => Number(r.slice(5))))];
  const mails = new Map<number, { title: Record<string, string>; rewards: Adjustment[] }>();
  if (mailIds.length) {
    for (const m of (await db.query<{ id: string; title: Record<string, string>; rewards: Adjustment[] }>(
      'select id, title, rewards from mail where id = any($1::bigint[])', [mailIds])).rows) {
      mails.set(Number(m.id), { title: m.title, rewards: m.rewards });
    }
  }
  for (const l of mailRows) {
    const mail = l.ref?.startsWith('mail:') ? mails.get(Number(l.ref.slice(5))) : undefined;
    const actual = grantActual(l.delta);
    if (!mail) {
      out.push({ ref: l.ref, uid: l.uid, at: l.at, kind: 'mail', label: l.ref ? '지워진 우편' : '우편 받기', expected: {}, actual, status: 'orphan', ledgerIds: [Number(l.id)] });
      continue;
    }
    const expected = grantExpected(mail.rewards);
    out.push({ ref: l.ref, uid: l.uid, at: l.at, kind: 'mail', label: mail.title['ko'] ?? '', expected, actual, status: grantStatus(expected, actual), ledgerIds: [Number(l.id)] });
  }
  // 관리자 지급 길인데 감사 로그와 안 이어진 장부 줄 — 그 길은 감사 로그 없이 못 쓴다
  for (const l of ledger) {
    if (GRANT_SOURCES[l.source] === 'audit' && !l.ref) {
      out.push({ ref: null, uid: l.uid, at: l.at, kind: 'audit', label: '감사 로그 없음', expected: {}, actual: grantActual(l.delta), status: 'orphan', ledgerIds: [Number(l.id)] });
    }
  }
  return out.sort((x, y) => y.at.getTime() - x.at.getTime());
}

const GRANT_ROUTES = Object.keys(GRANT_SOURCES);

/** 한 계정 전부 — 최근 `limit`개 감사 로그와 장부 줄(장부는 90일 보관이라 그보다 옛 지급은 「장부 줄 없음」으로 보인다) */
export async function grantsOfAccount(db: Db, uid: string, limit = 200): Promise<GrantCheck[]> {
  const audits = (await db.query<AuditRow>(
    `select id, target_uid as uid, at, action, params from admin_audit_log
      where target_uid = $1 and action like 'adjust.%' order by id desc limit $2`, [uid, limit])).rows;
  const ledger = (await db.query<LedgerRow>(
    `select id, uid, at, source, delta, ref from account_ledger
      where uid = $1 and phase = 'action' and (source = any($2::text[]) or ref = any($3::text[])) order by id desc limit $4`,
    [uid, GRANT_ROUTES, audits.map((a) => `audit:${a.id}`), limit * 2])).rows;
  return assemble(db, audits, ledger);
}

/**
 * 점검용 — 지난 점검 뒤의 감사 로그(`auditFrom < id <= auditTo`)와 장부 줄(`ledgerFrom < id <= ledgerTo`)만. 감사 로그와 그 장부 줄은
 * 같은 트랜잭션이라 둘 다 같은 창에 든다.
 */
export async function grantsInWindow(
  db: Db, auditFrom: number, auditTo: number, ledgerFrom: number, ledgerTo: number,
): Promise<GrantCheck[]> {
  const audits = (await db.query<AuditRow>(
    `select id, target_uid as uid, at, action, params from admin_audit_log
      where id > $1 and id <= $2 and action like 'adjust.%' and target_uid is not null`, [auditFrom, auditTo])).rows;
  const ledger = (await db.query<LedgerRow>(
    `select id, uid, at, source, delta, ref from account_ledger
      where phase = 'action' and ((id > $1 and id <= $2 and source = any($3::text[])) or ref = any($4::text[]))`,
    [ledgerFrom, ledgerTo, GRANT_ROUTES, audits.map((a) => `audit:${a.id}`)])).rows;
  return assemble(db, audits, ledger);
}
