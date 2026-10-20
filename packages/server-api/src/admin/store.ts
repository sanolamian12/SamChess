/**
 * 관리자 API의 DB 접근 — 계정 검색 · 계정 읽기 · 감사 로그와 함께 쓰기 · 전체 집계.
 *
 * 읽기는 **저장하지 않는다.** 게임의 `getProfile()`은 읽으면서 군량 정산 · 도적떼 출몰을
 * 되쓰지만, 관리자가 들여다본 것만으로 계정이 바뀌면 안 된다 — 정산은 메모리에서만 해서
 * 「지금 들어오면 보일 값」을 보여 준다(도적떼는 출몰시키지 않는다).
 */
import { pool } from '../db.ts';
import { mutateProfile, syncAtServer } from '../profileStore.ts';
import { changedProfileFields, migrateProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { AdminUser } from './auth.ts';

/** 시험 계정 — 스모크 · 확인 도구가 만드는 주소. 목록에서 가려 보이게 표시만 한다 */
export const isTestEmail = (email: string | null): boolean => !!email && email.endsWith('@samchess.test');

/** 서버 시계로 정산한 「지금 값」 — 게임이 쓰는 정산과 같은 함수(`syncAtServer`)다. 도적떼는 출몰시키지 않는다 */
function synced(raw: unknown, now: number): PlayerProfile | null {
  const migrated = migrateProfile(raw);
  return migrated ? syncAtServer(migrated, now) : null;
}

// ── 검색 ──────────────────────────────────────────────────────

export interface UserRow {
  uid: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  isTest: boolean;
  /** 아직 도시를 안 만들었으면(가입만 했으면) `null` */
  cityName: string | null;
  cityLevel: number | null;
  gold: number | null;
  updatedAt: string | null;
}

/**
 * 이메일 · 도시 이름 · uid로 찾는다. 빈 검색어면 최근 가입 순.
 *
 * **`auth.users`를 기준으로 붙인다** — 가입만 하고 도시를 안 만든 계정도 보여야 한다
 * (가입 오프닝 중에 멈춘 사람 문의). `auth` 스키마는 직접 연결(postgres 역할)로만 읽힌다.
 */
export async function searchUsers(q: string, limit: number, includeTest: boolean): Promise<UserRow[]> {
  const term = q.trim();
  const r = await pool.query<{
    uid: string; email: string | null; created_at: Date; last_sign_in_at: Date | null; banned_until: Date | null;
    city_name: string | null; city_level: number | null; gold: number | null; updated_at: Date | null;
  }>(
    `select u.id as uid, u.email, u.created_at, u.last_sign_in_at, u.banned_until,
            p.data->>'cityName' as city_name, (p.data->>'cityLevel')::int as city_level,
            (p.data->>'gold')::int as gold, p.updated_at
       from auth.users u
       left join profiles p on p.uid = u.id
      where ($1 = '' or u.email ilike '%' || $1 || '%' or p.data->>'cityName' ilike '%' || $1 || '%' or u.id::text = $1)
        and ($3 or u.email is null or u.email not like '%@samchess.test')
      order by u.created_at desc
      limit $2`,
    [term, limit, includeTest],
  );
  return r.rows.map((row) => ({
    uid: row.uid,
    email: row.email,
    createdAt: row.created_at.toISOString(),
    lastSignInAt: row.last_sign_in_at?.toISOString() ?? null,
    bannedUntil: row.banned_until?.toISOString() ?? null,
    isTest: isTestEmail(row.email),
    cityName: row.city_name,
    cityLevel: row.city_level,
    gold: row.gold,
    updatedAt: row.updated_at?.toISOString() ?? null,
  }));
}

// ── 계정 하나 ─────────────────────────────────────────────────

export interface UserDetail {
  uid: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  isTest: boolean;
  profileUpdatedAt: string | null;
  /** 서버 시계로 정산한 값. 도시를 안 만들었으면 `null` */
  profile: PlayerProfile | null;
}

export async function readUser(uid: string): Promise<UserDetail | null> {
  const r = await pool.query<{
    uid: string; email: string | null; created_at: Date; last_sign_in_at: Date | null; banned_until: Date | null;
    data: unknown; updated_at: Date | null;
  }>(
    `select u.id as uid, u.email, u.created_at, u.last_sign_in_at, u.banned_until, p.data, p.updated_at
       from auth.users u left join profiles p on p.uid = u.id
      where u.id = $1`,
    [uid],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    uid: row.uid,
    email: row.email,
    createdAt: row.created_at.toISOString(),
    lastSignInAt: row.last_sign_in_at?.toISOString() ?? null,
    bannedUntil: row.banned_until?.toISOString() ?? null,
    isTest: isTestEmail(row.email),
    profileUpdatedAt: row.updated_at?.toISOString() ?? null,
    profile: row.data ? synced(row.data, Date.now()) : null,
  };
}

// ── 감사 로그와 함께 쓰기 ─────────────────────────────────────

export type AuditedResult =
  | { ok: true; profile: PlayerProfile; auditId: number }
  | { ok: false; status: number; reason: string };

/**
 * 한 계정을 고치고 **같은 트랜잭션에서** 감사 로그를 적는다 — 게임의 모든 쓰기와 같은
 * `mutateProfile()`(행 잠금 · 되접기 · 서버 시계 정산)을 지나고, 로그는 그 `onWrite` 훅이 적는다.
 * 규칙이 거부하면(`fn`이 던지면) 아무것도 쓰지 않고 로그도 남지 않는다.
 */
export async function mutateWithAudit(
  uid: string,
  admin: AdminUser,
  entry: { action: string; params: object; reason: string },
  fn: (current: PlayerProfile, now: number) => PlayerProfile,
): Promise<AuditedResult> {
  const now = Date.now();
  let auditId = 0;
  const value = await mutateProfile<AuditedResult>(uid, (current) => {
    if (!current) return { next: null, value: { ok: false, status: 404, reason: '도시를 만든 계정이 아니다' } };
    try {
      const next = fn(current, now);
      return { next, value: { ok: true, profile: next, auditId: 0 } };
    } catch (e) {
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid action' } };
    }
  }, {
    onWrite: async (tx, prev, next) => {
      // 정산으로 바뀐 몫(군량 충전 등)도 diff에 섞인다 — 게임이 다음 읽기에 어차피 되쓸 값이라 그대로 둔다
      const before = migrateProfile(prev);
      const diff = before ? changedProfileFields(before, next) : { before: null, after: next };
      const a = await tx.query<{ id: string }>(
        `insert into admin_audit_log (admin_uid, admin_email, target_uid, action, params, reason, before, after)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [admin.uid, admin.email, uid, entry.action, JSON.stringify(entry.params), entry.reason,
          JSON.stringify(diff.before), JSON.stringify(diff.after)],
      );
      auditId = Number(a.rows[0]!.id);
    },
  });
  return value.ok ? { ...value, auditId } : value;
}

// ── 감사 로그 읽기 ────────────────────────────────────────────

export interface AuditRow {
  id: number;
  at: string;
  adminEmail: string;
  targetUid: string | null;
  targetCity: string | null;
  action: string;
  params: unknown;
  reason: string;
  before: unknown;
  after: unknown;
}

/** 최신부터. `beforeId`를 주면 그보다 오래된 것(다음 쪽) */
export async function listAudit(opts: { targetUid?: string; limit: number; beforeId?: number }): Promise<AuditRow[]> {
  const r = await pool.query<{
    id: string; at: Date; admin_email: string; target_uid: string | null; city: string | null;
    action: string; params: unknown; reason: string; before: unknown; after: unknown;
  }>(
    `select l.id, l.at, l.admin_email, l.target_uid, p.data->>'cityName' as city,
            l.action, l.params, l.reason, l.before, l.after
       from admin_audit_log l left join profiles p on p.uid = l.target_uid
      where ($1::uuid is null or l.target_uid = $1) and ($3::bigint is null or l.id < $3)
      order by l.id desc
      limit $2`,
    [opts.targetUid ?? null, opts.limit, opts.beforeId ?? null],
  );
  return r.rows.map((row) => ({
    id: Number(row.id), at: row.at.toISOString(), adminEmail: row.admin_email, targetUid: row.target_uid,
    targetCity: row.city, action: row.action, params: row.params, reason: row.reason, before: row.before, after: row.after,
  }));
}

// ── 전체 집계 ─────────────────────────────────────────────────

export interface Stats {
  accounts: number;
  testAccounts: number;
  profiles: number;
  signups7d: number;
  active24h: number;
  active7d: number;
  /** 시험 계정을 뺀 합 */
  totals: { gold: number; grain: number; materials: number };
}

export async function readStats(): Promise<Stats> {
  const r = await pool.query<{
    accounts: string; test_accounts: string; profiles: string; signups_7d: string; active_24h: string; active_7d: string;
    gold: string | null; grain: string | null; materials: string | null;
  }>(
    `select count(*) as accounts,
            count(*) filter (where u.email like '%@samchess.test') as test_accounts,
            count(p.uid) as profiles,
            count(*) filter (where u.created_at > now() - interval '7 days') as signups_7d,
            count(*) filter (where u.last_sign_in_at > now() - interval '1 day') as active_24h,
            count(*) filter (where u.last_sign_in_at > now() - interval '7 days') as active_7d,
            sum((p.data->>'gold')::bigint) filter (where u.email not like '%@samchess.test') as gold,
            sum((p.data->>'grain')::bigint) filter (where u.email not like '%@samchess.test') as grain,
            sum((p.data->>'materials')::bigint) filter (where u.email not like '%@samchess.test') as materials
       from auth.users u left join profiles p on p.uid = u.id`,
  );
  const s = r.rows[0]!;
  return {
    accounts: Number(s.accounts), testAccounts: Number(s.test_accounts), profiles: Number(s.profiles),
    signups7d: Number(s.signups_7d), active24h: Number(s.active_24h), active7d: Number(s.active_7d),
    totals: { gold: Number(s.gold ?? 0), grain: Number(s.grain ?? 0), materials: Number(s.materials ?? 0) },
  };
}
