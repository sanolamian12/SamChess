/**
 * 관리자 API의 DB 접근 — 계정 검색 · 계정 읽기 · 감사 로그와 함께 쓰기 · 전체 집계.
 *
 * 읽기는 **저장하지 않는다.** 게임의 `getProfile()`은 읽으면서 군량 정산 · 도적떼 출몰을
 * 되쓰지만, 관리자가 들여다본 것만으로 계정이 바뀌면 안 된다 — 정산은 메모리에서만 해서
 * 「지금 들어오면 보일 값」을 보여 준다(도적떼는 출몰시키지 않는다).
 */
import { withCheckout } from '../checkout.ts';
import { pool } from '../db.ts';
import type { PoolClient } from 'pg';
import { mutateProfile, syncAtServer } from '../profileStore.ts';
import { changedProfileFields, injuryHealsAt, isInjured, migrateProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { AdminUser, AuditRow, Stats, UserDetail, UserRow } from './types.ts';

/** 시험 계정 — 스모크 · 확인 도구가 만드는 주소. 목록에서 가려 보이게 표시만 한다 */
export const isTestEmail = (email: string | null): boolean => !!email && email.endsWith('@samchess.test');

/** 서버 시계로 정산한 「지금 값」 — 게임이 쓰는 정산과 같은 함수(`syncAtServer`)다. 도적떼는 출몰시키지 않는다 */
function synced(raw: unknown, now: number): PlayerProfile | null {
  const migrated = migrateProfile(raw);
  return migrated ? syncAtServer(migrated, now) : null;
}

// ── 검색 ──────────────────────────────────────────────────────

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

export async function readUser(uid: string): Promise<UserDetail | null> {
  const r = await pool.query<{
    uid: string; email: string | null; created_at: Date; last_sign_in_at: Date | null; banned_until: Date | null;
    ban_reason: string | null; data: unknown; updated_at: Date | null;
  }>(
    `select u.id as uid, u.email, u.created_at, u.last_sign_in_at, u.banned_until,
            u.raw_app_meta_data->'ban'->>'reason' as ban_reason, p.data, p.updated_at
       from auth.users u left join profiles p on p.uid = u.id
      where u.id = $1`,
    [uid],
  );
  const row = r.rows[0];
  if (!row) return null;
  const now = Date.now();
  const profile = row.data ? synced(row.data, now) : null;
  return {
    uid: row.uid,
    email: row.email,
    createdAt: row.created_at.toISOString(),
    lastSignInAt: row.last_sign_in_at?.toISOString() ?? null,
    bannedUntil: row.banned_until?.toISOString() ?? null,
    banReason: row.banned_until && row.banned_until > new Date() ? row.ban_reason : null,
    isTest: isTestEmail(row.email),
    profileUpdatedAt: row.updated_at?.toISOString() ?? null,
    profile,
    injuries: Object.entries(profile?.roster ?? {})
      .filter(([, inst]) => isInjured(inst, now))
      .map(([officer, inst]) => ({ officer, healsAt: injuryHealsAt(inst)!, healing: inst.healingAt !== undefined })),
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

// ── 계정 정지 ─────────────────────────────────────────────────

/** 한 번에 걸 수 있는 가장 긴 정지 — 100년, 화면의 「영구」 */
export const BAN_DAYS_MAX = 36_500;

export type BanResult =
  | { ok: true; bannedUntil: string | null; auditId: number }
  | { ok: false; status: number; reason: string };

/**
 * 정지(`days`) · 해제(`null`). **`auth.users`를 직접 고치고 감사 로그를 같은 트랜잭션에서 적는다** — Supabase
 * Admin API(`ban_duration`)도 같은 칸(`banned_until`)을 쓰지만, 외부 호출과 DB 기록은 한 트랜잭션에 못 묶는다.
 * Supabase는 로그인 · 토큰 갱신 · `/auth/v1/user`마다 이 칸을 본다(정지 전 토큰도 바로 403 `user_banned`, 2026-10-20 실측).
 *
 * 사유는 `app_metadata.ban.reason`에 둔다 — 게임 API가 403 응답에 실어 게임 화면이 보여 준다(`../ban.ts`).
 * 정지가 끝나면 Supabase가 알아서 풀어 주므로 그때 남는 `ban` 칸은 읽는 쪽이 `banned_until`로 거른다.
 */
export async function setBan(uid: string, admin: AdminUser, days: number | null, reason: string): Promise<BanResult> {
  // 꺼낸 연결의 끊김 리스너 · 끊긴 연결 버리기는 `withCheckout`이 한다(`mutateProfile`과 같은 도우미)
  return withCheckout(() => pool.connect(), '관리자 정지 트랜잭션', (client) => banTx(client, uid, admin, days, reason));
}

async function banTx(
  client: PoolClient, uid: string, admin: AdminUser, days: number | null, reason: string,
): Promise<BanResult> {
  try {
    await client.query('begin');
    const cur = await client.query<{ banned_until: Date | null; role: string | null }>(
      `select banned_until, raw_app_meta_data->>'role' as role from auth.users where id = $1 for update`, [uid]);
    const row = cur.rows[0];
    const fail = async (status: number, why: string): Promise<BanResult> => {
      await client.query('rollback');
      return { ok: false, status, reason: why };
    };
    if (!row) return await fail(404, '없는 계정이다');
    const banned = !!row.banned_until && row.banned_until > new Date();
    if (days !== null) {
      if (uid === admin.uid) return await fail(400, '자기 계정은 정지할 수 없다');
      // 관리자 하나가 털리면 다른 관리자를 잠글 수 있게 되지 않게 — 역할을 먼저 거둔다(역할은 화면에서 못 바꾼다)
      if (row.role === 'admin') return await fail(400, '관리자 계정은 정지할 수 없다 — 먼저 npm run admin:role로 역할을 거둔다');
    } else if (!banned) {
      return await fail(400, '정지된 계정이 아니다');
    }

    const upd = await client.query<{ banned_until: Date | null }>(
      days !== null
        ? `update auth.users
              set banned_until = now() + make_interval(days => $2::int),
                  raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                    || jsonb_build_object('ban', jsonb_build_object('reason', $3::text, 'at', now(), 'by', $4::text)),
                  updated_at = now()
            where id = $1 returning banned_until`
        : `update auth.users
              set banned_until = null, raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'ban', updated_at = now()
            where id = $1 returning banned_until`,
      days !== null ? [uid, days, reason, admin.email] : [uid],
    );
    const until = upd.rows[0]!.banned_until?.toISOString() ?? null;
    const a = await client.query<{ id: string }>(
      `insert into admin_audit_log (admin_uid, admin_email, target_uid, action, params, reason, before, after)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [admin.uid, admin.email, uid, days !== null ? 'ban' : 'unban', JSON.stringify(days !== null ? { days } : {}), reason,
        JSON.stringify({ bannedUntil: banned ? row.banned_until!.toISOString() : null }), JSON.stringify({ bannedUntil: until })],
    );
    await client.query('commit');
    return { ok: true, bannedUntil: until, auditId: Number(a.rows[0]!.id) };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
}

// ── 감사 로그 읽기 ────────────────────────────────────────────

export interface AuditFilter {
  targetUid?: string;
  /** 관리자 이메일 — 목록(`listAuditAdmins`)에서 고른 값과 **정확히 같은** 것 */
  admin?: string;
  /** `ban` · `adjust.gold`처럼 하나, 또는 `adjust` · `resolve`처럼 묶음(그 아래 전부) */
  action?: string;
  /** ISO — `from` 이상 `to` 미만 */
  from?: string;
  to?: string;
  limit: number;
  beforeId?: number;
}

/** 최신부터. `beforeId`를 주면 그보다 오래된 것(다음 쪽) */
export async function listAudit(opts: AuditFilter): Promise<AuditRow[]> {
  const r = await pool.query<{
    id: string; at: Date; admin_email: string; target_uid: string | null; city: string | null;
    action: string; params: unknown; reason: string; before: unknown; after: unknown;
  }>(
    `select l.id, l.at, l.admin_email, l.target_uid, p.data->>'cityName' as city,
            l.action, l.params, l.reason, l.before, l.after
       from admin_audit_log l left join profiles p on p.uid = l.target_uid
      where ($1::uuid is null or l.target_uid = $1) and ($3::bigint is null or l.id < $3)
        and ($4::text is null or l.admin_email = $4)
        and ($5::text is null or l.action = $5 or l.action like $5 || '.%')
        and ($6::timestamptz is null or l.at >= $6) and ($7::timestamptz is null or l.at < $7)
      order by l.id desc
      limit $2`,
    [opts.targetUid ?? null, opts.limit, opts.beforeId ?? null, opts.admin ?? null, opts.action ?? null,
      opts.from ?? null, opts.to ?? null],
  );
  return r.rows.map((row) => ({
    id: Number(row.id), at: row.at.toISOString(), adminEmail: row.admin_email, targetUid: row.target_uid,
    targetCity: row.city, action: row.action, params: row.params, reason: row.reason, before: row.before, after: row.after,
  }));
}

/** 감사 로그에 한 번이라도 나온 관리자 — 화면의 거르기 목록 */
export async function listAuditAdmins(): Promise<string[]> {
  const r = await pool.query<{ admin_email: string }>(`select distinct admin_email from admin_audit_log order by admin_email`);
  return r.rows.map((row) => row.admin_email);
}

// ── 전체 집계 ─────────────────────────────────────────────────

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
