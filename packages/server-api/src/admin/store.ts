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
import {
  ADMIN_ROLES, MAIL_TTL_MS, aiAbandonAt, changedProfileFields, csCheck, csDayStartMs, csUsageFromAudit, hasPermission, injuryHealsAt, isGrantCapped,
  isInjured, migrateProfile, raidAutoSurrenderAt, roleForbiddenMessage,
} from '@samchess/meta';
import type { Adjustment, CsUsage, MailDraft, MailReward, MailText, PlayerProfile } from '@samchess/meta';
import type {
  AdminAuditAction, AdminMail, AdminRole, AdminUser, AuditRow, CsLimitError, MailAudience, RoleForbiddenError, MailStatus, Stats, Trend, UserDetail, UserRow,
} from './types.ts';

/** 시험 계정 — 스모크 · 확인 도구가 만드는 주소. 목록에서 가려 보이게 표시만 한다 */
export const isTestEmail = (email: string | null): boolean => !!email && email.endsWith('@samchess.test');

/** 서버 시계로 정산한 「지금 값」 — 게임이 쓰는 정산과 같은 함수(`syncAtServer`)다. 도적떼는 출몰시키지 않는다 */
function synced(raw: unknown, now: number): PlayerProfile | null {
  const migrated = migrateProfile(raw);
  return migrated ? syncAtServer(migrated, now) : null;
}

// ── 검색 ──────────────────────────────────────────────────────

/** 정렬 칸 — 화면의 이름 → SQL. **이 표 밖의 값은 SQL에 닿지 않는다**(라우트가 이 키로만 거른다) */
export const USER_SORTS = {
  created: 'u.created_at',
  lastSignIn: 'u.last_sign_in_at',
  updated: 'p.updated_at',
  level: `(p.data->>'cityLevel')::int`,
  gold: `(p.data->>'gold')::int`,
} as const;
export type UserSort = keyof typeof USER_SORTS;

/** 휴면 — 마지막 로그인이 이보다 오래됐거나 없다 */
export const DORMANT_DAYS = 30;

export interface UserSearch {
  q: string;
  includeTest: boolean;
  /** `banned` 지금 정지 중 · `noCity` 도시를 안 만듦 · `dormant` 30일 넘게 로그인 안 함 */
  filter?: 'banned' | 'noCity' | 'dormant';
  sort: UserSort;
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/** `ilike`의 `%` · `_` · `\`를 글자로 — 검색어에 섞여도 와일드카드가 되지 않게 */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * 이메일 · 도시 이름 일부 · uid로 찾는다. 빈 검색어면 전부. 정렬 · 거르기 · 쪽(offset)을 받고, **거른 전체 수**를 함께 준다.
 *
 * **`auth.users`를 기준으로 붙인다** — 가입만 하고 도시를 안 만든 계정도 보여야 한다
 * (가입 오프닝 중에 멈춘 사람 문의). `auth` 스키마는 직접 연결(postgres 역할)로만 읽힌다.
 * 정렬 값이 없는 줄(도시 없음 · 로그인 없음)은 방향과 상관없이 뒤로 보낸다.
 */
/** 검색 · 거르기 조건 — 목록과 「끝을 넘긴 쪽」의 전체 수 세기가 함께 쓴다. 자리 인자는 $1 검색어 · $2 그 글자 처리 ·
 * $3 시험 계정 포함 · $4 거르기 · $5 휴면 일수 */
const USER_WHERE = `
      where ($1 = '' or u.email ilike '%' || $2 || '%' or p.data->>'cityName' ilike '%' || $2 || '%' or u.id::text = $1)
        and ($3 or u.email is null or u.email not like '%@samchess.test')
        and ($4::text is null
             or ($4 = 'banned' and u.banned_until > now())
             or ($4 = 'noCity' and p.uid is null)
             or ($4 = 'dormant' and (u.last_sign_in_at is null or u.last_sign_in_at < now() - make_interval(days => $5::int))))`;

export async function searchUsers(s: UserSearch): Promise<{ rows: UserRow[]; total: number }> {
  const term = s.q.trim();
  const where = [term, likeEscape(term), s.includeTest, s.filter ?? null, DORMANT_DAYS];
  const order = `${USER_SORTS[s.sort]} ${s.dir === 'asc' ? 'asc' : 'desc'} nulls last, u.created_at desc`;
  const r = await pool.query<{
    uid: string; email: string | null; created_at: Date; last_sign_in_at: Date | null; banned_until: Date | null;
    city_name: string | null; city_level: number | null; gold: number | null; updated_at: Date | null; total: string;
  }>(
    `select u.id as uid, u.email, u.created_at, u.last_sign_in_at, u.banned_until,
            p.data->>'cityName' as city_name, (p.data->>'cityLevel')::int as city_level,
            (p.data->>'gold')::int as gold, p.updated_at, count(*) over () as total
       from auth.users u
       left join profiles p on p.uid = u.id
      ${USER_WHERE}
      order by ${order}
      limit $6 offset $7`,
    [...where, s.limit, s.offset],
  );
  // 전체 수는 줄마다 실려 오므로(`count(*) over ()`) 끝을 넘긴 쪽에는 없다 — 그때만 따로 센다
  let total = Number(r.rows[0]?.total ?? 0);
  if (r.rows.length === 0 && s.offset > 0) {
    const c = await pool.query<{ total: string }>(
      `select count(*) as total from auth.users u left join profiles p on p.uid = u.id ${USER_WHERE}`, where);
    total = Number(c.rows[0]!.total);
  }
  return {
    total,
    rows: r.rows.map((row) => ({
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
    })),
  };
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
    autoResolveAt: { aiBattle: profile ? aiAbandonAt(profile) : null, raid: profile ? raidAutoSurrenderAt(profile) : null },
  };
}

// ── 감사 로그와 함께 쓰기 ─────────────────────────────────────

type Query = Pick<PoolClient, 'query'>;

/** 감사 로그 한 줄 — 쓰는 길 넷(조정 · 정리 / 정지 · 해제 / 우편 보내기 / 우편 회수)이 전부 여기를 지난다. 그때의 자격(`admin_role`)도 */
async function insertAudit(
  tx: Query, admin: AdminUser,
  e: { targetUid: string | null; action: AdminAuditAction; params: object; reason: string; before: unknown; after: unknown },
): Promise<number> {
  const a = await tx.query<{ id: string }>(
    `insert into admin_audit_log (admin_uid, admin_email, admin_role, target_uid, action, params, reason, before, after)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [admin.uid, admin.email, admin.role, e.targetUid, e.action, JSON.stringify(e.params), e.reason,
      e.before === null ? null : JSON.stringify(e.before), e.after === null ? null : JSON.stringify(e.after)],
  );
  return Number(a.rows[0]!.id);
}

/** 거절 — `detail`은 응답 본문에 함께 싣는 것(`cs_limit`의 종류 · 상한 · 오늘 양) */
type Refusal = { ok: false; status: number; reason: string; detail?: object };

export type AuditedResult =
  | { ok: true; profile: PlayerProfile; auditId: number }
  | Refusal;

// ── CS 하루 합계 (2026-10-21c) ────────────────────────────────
//
// **따로 세는 표를 두지 않는다** — 감사 로그가 이미 정본이다. 오늘(KST) 그 사람이 **CS 자격으로** 남긴 `adjust.*` · `mail.send`의
// 주는 양을 더한다(셈은 `csUsageFromAudit`). 관리자였던 시간에 준 것은 세지 않는다.
//
// **세기 전에 그 CS의 요청을 줄 세운다**(`pg_advisory_xact_lock`) — 안 잠그면 동시에 들어온 두 요청이 같은 「오늘 양」을 읽고 둘 다
// 통과한다. 잠금은 트랜잭션이 끝날 때 풀리고, 감사 로그 줄은 같은 트랜잭션에서 적히므로 다음 요청은 그 줄까지 보고 센다.
// 잠그는 순서는 언제나 「계정 행(있으면) → 이 잠금」이다(우편은 계정 행을 안 잡는다) — 서로 기다리며 멈추지 않는다.

async function csUsedToday(q: Query, adminUid: string, nowMs: number): Promise<CsUsage> {
  const r = await q.query<{ action: string; params: unknown }>(
    `select action, params from admin_audit_log
      where admin_uid = $1 and admin_role = 'cs' and at >= to_timestamp($2::double precision / 1000)
        and (action like 'adjust.%' or action = 'mail.send')`,
    [adminUid, csDayStartMs(nowMs)],
  );
  return csUsageFromAudit(r.rows);
}

/** 화면이 「오늘 남은 양」을 그리는 데 — 읽기만 한다(잠그지 않는다) */
export const readCsUsage = (admin: AdminUser): Promise<CsUsage> => csUsedToday(pool, admin.uid, Date.now());

/** 상한에 걸리는 역할이면 잠그고 세서 판정한다. 넘으면 거절, 아니면 `null` */
async function csGate(tx: Query, admin: AdminUser, grants: readonly Adjustment[]): Promise<Refusal | null> {
  if (!isGrantCapped(admin.role) || grants.length === 0) return null;
  await tx.query(`select pg_advisory_xact_lock(hashtext('admin-cs:' || $1::text))`, [admin.uid]);
  const r = csCheck(grants, await csUsedToday(tx, admin.uid, Date.now()));
  if (r.ok) return null;
  const { ok: _ok, ...rest } = r;
  return { ok: false, status: 403, reason: 'cs_limit', detail: rest satisfies Omit<CsLimitError, 'error'> };
}

/** `onWrite` 안에서 거절할 때 — 던져서 트랜잭션을 되돌리고 `mutateWithAudit`이 받아 거절로 바꾼다 */
class AuditRefused extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) { super(refusal.reason); this.refusal = refusal; }
}

/**
 * 한 계정을 고치고 **같은 트랜잭션에서** 감사 로그를 적는다 — 게임의 모든 쓰기와 같은
 * `mutateProfile()`(행 잠금 · 되접기 · 서버 시계 정산)을 지나고, 로그는 그 `onWrite` 훅이 적는다.
 * 규칙이 거부하면(`fn`이 던지면) 아무것도 쓰지 않고 로그도 남지 않는다.
 *
 * `grants`는 이 조정이 주는 것 — CS면 로그를 적기 직전에 하루 합계를 잠근 채 세고(`csGate`), 넘으면 계정 쓰기까지 되돌린다.
 */
export async function mutateWithAudit(
  uid: string,
  admin: AdminUser,
  entry: { action: AdminAuditAction; params: object; reason: string; grants?: readonly Adjustment[] },
  fn: (current: PlayerProfile, now: number) => PlayerProfile,
): Promise<AuditedResult> {
  try {
    return await mutateWithAuditTx(uid, admin, entry, fn);
  } catch (e) {
    if (e instanceof AuditRefused) return e.refusal;
    throw e;
  }
}

async function mutateWithAuditTx(
  uid: string,
  admin: AdminUser,
  entry: { action: AdminAuditAction; params: object; reason: string; grants?: readonly Adjustment[] },
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
      const refused = await csGate(tx, admin, entry.grants ?? []);
      if (refused) throw new AuditRefused(refused);
      // 정산으로 바뀐 몫(군량 충전 등)도 diff에 섞인다 — 게임이 다음 읽기에 어차피 되쓸 값이라 그대로 둔다
      const before = migrateProfile(prev);
      const diff = before ? changedProfileFields(before, next) : { before: null, after: next };
      auditId = await insertAudit(tx, admin, {
        targetUid: uid, action: entry.action, params: entry.params, reason: entry.reason, before: diff.before, after: diff.after,
      });
    },
  });
  return value.ok ? { ...value, auditId } : value;
}

// ── 계정 정지 ─────────────────────────────────────────────────
//
// 한 번에 걸 수 있는 가장 긴 정지(`BAN_DAYS_MAX`, 화면의 「영구」)는 `@samchess/meta`의 `admin.ts`에 있다 — 화면이 리터럴 타입으로 묶는다.

export type BanResult =
  | { ok: true; bannedUntil: string | null; auditId: number }
  | Refusal;

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
    // `shortens` — 지금 정지 중인데 새로 끝나는 시각(`now() + days`)이 지금 끝나는 시각보다 이르다. 같은 DB 시계로 잠근 행에서 본다
    const cur = await client.query<{ banned_until: Date | null; role: string | null; shortens: boolean | null }>(
      `select banned_until, raw_app_meta_data->>'role' as role,
              banned_until > now() and now() + make_interval(days => $2::int) < banned_until as shortens
         from auth.users where id = $1 for update`, [uid, days]);
    const row = cur.rows[0];
    const fail = async (status: number, why: string): Promise<BanResult> => {
      await client.query('rollback');
      return { ok: false, status, reason: why };
    };
    if (!row) return await fail(404, '없는 계정이다');
    const banned = !!row.banned_until && row.banned_until > new Date();
    if (days !== null) {
      if (uid === admin.uid) return await fail(400, '자기 계정은 정지할 수 없다');
      // 관리자 하나가 털리면 다른 관리자를 잠글 수 있게 되지 않게 — 역할을 먼저 거둔다(역할은 화면에서 못 바꾼다). CS도 같다
      if ((ADMIN_ROLES as readonly (string | null)[]).includes(row.role)) {
        return await fail(400, '관리자 · CS 계정은 정지할 수 없다 — 먼저 npm run admin:role로 역할을 거둔다');
      }
      // 끝나는 시각을 앞당기는 정지는 사실상 해제다 — 영구를 1일로 줄이지 못하게 unban 권한을 요구한다(본체 검토, 2026-10-21c)
      if (row.shortens && !hasPermission(admin.role, 'unban')) {
        await client.query('rollback');
        const detail: Omit<RoleForbiddenError, 'error'> = { need: 'unban', message: `지금 정지가 더 길다 — ${roleForbiddenMessage('unban')}` };
        return { ok: false, status: 403, reason: 'role_forbidden', detail };
      }
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
    const auditId = await insertAudit(client, admin, {
      targetUid: uid, action: days !== null ? 'ban' : 'unban', params: days !== null ? { days } : {}, reason,
      before: { bannedUntil: banned ? row.banned_until!.toISOString() : null }, after: { bannedUntil: until },
    });
    await client.query('commit');
    return { ok: true, bannedUntil: until, auditId };
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
  /** 그 자격으로 한 것만 */
  role?: AdminRole;
  /** ISO — `from` 이상 `to` 미만 */
  from?: string;
  to?: string;
  limit: number;
  beforeId?: number;
}

/** 최신부터. `beforeId`를 주면 그보다 오래된 것(다음 쪽) */
export async function listAudit(opts: AuditFilter): Promise<AuditRow[]> {
  const r = await pool.query<{
    id: string; at: Date; admin_email: string; admin_role: AdminRole; target_uid: string | null; city: string | null;
    // 적는 길이 `insertAudit()` 하나이고 그 인자가 `AdminAuditAction`이라 그대로 믿는다(`admin_role`과 같은 결)
    action: AdminAuditAction; params: unknown; reason: string; before: unknown; after: unknown;
  }>(
    `select l.id, l.at, l.admin_email, l.admin_role, l.target_uid, p.data->>'cityName' as city,
            l.action, l.params, l.reason, l.before, l.after
       from admin_audit_log l left join profiles p on p.uid = l.target_uid
      where ($1::uuid is null or l.target_uid = $1) and ($3::bigint is null or l.id < $3)
        and ($4::text is null or l.admin_email = $4)
        and ($5::text is null or l.action = $5 or l.action like $5 || '.%')
        and ($6::timestamptz is null or l.at >= $6) and ($7::timestamptz is null or l.at < $7)
        and ($8::text is null or l.admin_role = $8)
      order by l.id desc
      limit $2`,
    [opts.targetUid ?? null, opts.limit, opts.beforeId ?? null, opts.admin ?? null, opts.action ?? null,
      opts.from ?? null, opts.to ?? null, opts.role ?? null],
  );
  return r.rows.map((row) => ({
    id: Number(row.id), at: row.at.toISOString(), adminEmail: row.admin_email, adminRole: row.admin_role, targetUid: row.target_uid,
    targetCity: row.city, action: row.action, params: row.params, reason: row.reason, before: row.before, after: row.after,
  }));
}

/** 감사 로그에 한 번이라도 나온 관리자 — 화면의 거르기 목록 */
export async function listAuditAdmins(): Promise<string[]> {
  const r = await pool.query<{ admin_email: string }>(`select distinct admin_email from admin_audit_log order by admin_email`);
  return r.rows.map((row) => row.admin_email);
}

// ── 전체 집계 ─────────────────────────────────────────────────

/** 하루의 경계 — 게임의 「하루」(도적떼 · 랭킹)와 같은 KST */
const DAY_TZ = 'Asia/Seoul';
/** 시험 계정을 뺀다 — 이메일이 없는 계정(소셜 · 익명)은 실계정이다 */
const REAL = `coalesce(u.email, '') not like '%@samchess.test'`;

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
            sum((p.data->>'gold')::bigint) filter (where ${REAL}) as gold,
            sum((p.data->>'grain')::bigint) filter (where ${REAL}) as grain,
            sum((p.data->>'materials')::bigint) filter (where ${REAL}) as materials
       from auth.users u left join profiles p on p.uid = u.id`,
  );
  const s = r.rows[0]!;
  return {
    accounts: Number(s.accounts), testAccounts: Number(s.test_accounts), profiles: Number(s.profiles),
    signups7d: Number(s.signups_7d), active24h: Number(s.active_24h), active7d: Number(s.active_7d),
    totals: { gold: Number(s.gold ?? 0), grain: Number(s.grain ?? 0), materials: Number(s.materials ?? 0) },
  };
}

// ── 추이 ──────────────────────────────────────────────────────

/**
 * 최근 `days`일의 추이 — 시험 계정 제외, 하루는 KST.
 *
 * **접속 기록은 없다.** Supabase가 남기는 것은 계정마다 「마지막 로그인」 하나뿐이라 일별 접속자는 셀 수 없다 —
 * 대신 계정마다 남는 대전 이력(`matches[]`, 계정당 최근 `MATCH_LOG_CAP`=200판)으로 일별 대전 수와 그날 대전한
 * 계정 수를 센다. 한 계정이 기간 안에 200판을 넘게 두면 오래된 날이 덜 잡힌다(화면이 알린다).
 */
export async function readTrend(days: number): Promise<Trend> {
  const [daily, levels, recency] = await Promise.all([
    pool.query<{ day: string; signups: string; battles: string; ai: string; online: string; players: string }>(
      `with d as (
         select generate_series((now() at time zone $2)::date - ($1::int - 1), (now() at time zone $2)::date, interval '1 day')::date as day
       ),
       s as (
         select (u.created_at at time zone $2)::date as day, count(*) as n
           from auth.users u where ${REAL} and u.created_at >= now() - make_interval(days => $1::int + 1) group by 1
       ),
       m as (
         select (to_timestamp((x->>'at')::bigint / 1000.0) at time zone $2)::date as day, x->>'opponent' as opp, p.uid
           from profiles p join auth.users u on u.id = p.uid
           cross join lateral jsonb_array_elements(coalesce(p.data->'matches', '[]'::jsonb)) x
          where ${REAL} and (x->>'at')::bigint >= extract(epoch from now() - make_interval(days => $1::int + 1)) * 1000
       ),
       b as (
         select day, count(*) as battles, count(*) filter (where opp = 'ai') as ai,
                count(*) filter (where opp = 'online') as online, count(distinct uid) as players
           from m group by day
       )
       select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(s.n, 0) as signups, coalesce(b.battles, 0) as battles,
              coalesce(b.ai, 0) as ai, coalesce(b.online, 0) as online, coalesce(b.players, 0) as players
         from d left join s on s.day = d.day left join b on b.day = d.day
        order by d.day`,
      [days, DAY_TZ],
    ),
    pool.query<{ level: number; n: string }>(
      `select (p.data->>'cityLevel')::int as level, count(*) as n
         from profiles p join auth.users u on u.id = p.uid where ${REAL} group by 1 order by 1`,
    ),
    pool.query<{ today: string; week: string; month: string; older: string; never: string }>(
      `select count(*) filter (where u.last_sign_in_at >= now() - interval '1 day') as today,
              count(*) filter (where u.last_sign_in_at < now() - interval '1 day' and u.last_sign_in_at >= now() - interval '7 days') as week,
              count(*) filter (where u.last_sign_in_at < now() - interval '7 days' and u.last_sign_in_at >= now() - interval '30 days') as month,
              count(*) filter (where u.last_sign_in_at < now() - interval '30 days') as older,
              count(*) filter (where u.last_sign_in_at is null) as never
         from auth.users u where ${REAL}`,
    ),
  ]);
  const r = recency.rows[0]!;
  return {
    days: daily.rows.map((row) => ({
      day: row.day, signups: Number(row.signups), battles: Number(row.battles),
      ai: Number(row.ai), online: Number(row.online), players: Number(row.players),
    })),
    levels: levels.rows.map((row) => ({ level: row.level, count: Number(row.n) })),
    lastSignIn: {
      today: Number(r.today), week: Number(r.week), month: Number(r.month), older: Number(r.older), never: Number(r.never),
    },
  };
}

// ── 우편 (2026-10-21) ─────────────────────────────────────────
//
// 모양 · 보내기 검사 · 받기 판정은 본체의 `@samchess/meta` `mail.ts`, 받는 쪽 쿼리는 `../mail.ts`(게임 API)다.
// 여기는 보내는 쪽 — `mail` 표에 한 줄 넣고(수천 계정을 고치지 않는다) 같은 트랜잭션에 감사 로그를 적는다.
// **보낸 시각 · 기한은 DB의 `now()`로 적는다** — 게임 쪽이 전체 우편을 `auth.users.created_at`(DB 시각)과 견주어
// 「보낸 시각보다 먼저 가입한 계정」만 보이게 하므로, 같은 시계여야 가입 직후의 우편이 어긋나지 않는다.

interface MailRow {
  id: string; sent_at: Date; expires_at: Date; target_uid: string | null; title: MailText; body: MailText;
  rewards: MailReward[]; revoked_at: Date | null; sent_by: string; target_email: string | null; target_city: string | null;
}

const MAIL_COLS = `m.id, m.sent_at, m.expires_at, m.target_uid, m.title, m.body, m.rewards, m.revoked_at, m.sent_by,
  u.email as target_email, p.data->>'cityName' as target_city`;
const MAIL_FROM = `mail m left join auth.users u on u.id = m.target_uid left join profiles p on p.uid = m.target_uid`;

const STATUS_WHERE: Record<MailStatus, string> = {
  live: 'm.revoked_at is null and m.expires_at > now()',
  expired: 'm.revoked_at is null and m.expires_at <= now()',
  revoked: 'm.revoked_at is not null',
};

/**
 * 읽은 · 받은 계정 수 — 계정마다 `mailbox` 줄을 펼쳐 한 번에 센다(우편마다 전체를 훑지 않는다).
 * 기한이 지난 우편은 줄이 걷혀 가므로 세지 않는다(`null`).
 */
async function withCounts(client: Pick<PoolClient, 'query'>, rows: MailRow[]): Promise<AdminMail[]> {
  const now = Date.now();
  const liveIds = rows.filter((r) => r.expires_at.getTime() > now).map((r) => Number(r.id));
  const counts = new Map<number, { read: number; claimed: number }>();
  if (liveIds.length > 0) {
    const c = await client.query<{ id: string; read: string; claimed: string }>(
      `select (e->>'id')::bigint as id, count(*) as read, count(*) filter (where (e->>'claimed')::boolean) as claimed
         from profiles p, jsonb_array_elements(coalesce(p.data->'mailbox', '[]'::jsonb)) e
        where (e->>'id')::bigint = any($1::bigint[])
        group by 1`,
      [liveIds],
    );
    for (const r of c.rows) counts.set(Number(r.id), { read: Number(r.read), claimed: Number(r.claimed) });
  }
  return rows.map((r) => {
    const live = r.expires_at.getTime() > now;
    const n = counts.get(Number(r.id));
    return {
      id: Number(r.id), sentAt: r.sent_at.getTime(), expiresAt: r.expires_at.getTime(), targetUid: r.target_uid,
      title: r.title, body: r.body, rewards: r.rewards, revokedAt: r.revoked_at?.getTime() ?? null,
      sentBy: r.sent_by, targetEmail: r.target_email, targetCity: r.target_city,
      readCount: live ? n?.read ?? 0 : null, claimedCount: live ? n?.claimed ?? 0 : null,
    };
  });
}

export interface MailFilter {
  status?: MailStatus;
  targetUid?: string;
  beforeId?: number;
  limit: number;
}

/** 보낸 우편 — 최신부터 */
export async function listMail(f: MailFilter): Promise<AdminMail[]> {
  const r = await pool.query<MailRow>(
    `select ${MAIL_COLS} from ${MAIL_FROM}
      where ${f.status ? STATUS_WHERE[f.status] : 'true'}
        and ($1::uuid is null or m.target_uid = $1) and ($2::bigint is null or m.id < $2)
      order by m.id desc
      limit $3`,
    [f.targetUid ?? null, f.beforeId ?? null, f.limit],
  );
  return withCounts(pool, r.rows);
}

/** 지금 전체 우편을 보내면 받을 수 있는 계정 — 게임 쪽 조건(`created_at <= sent_at`)과 같은 시계로 */
export async function readMailAudience(): Promise<MailAudience> {
  const r = await pool.query<{ accounts: string; test: string }>(
    `select count(*) filter (where ${REAL}) as accounts, count(*) filter (where not (${REAL})) as test
       from auth.users u where u.created_at <= now()`,
  );
  return { accounts: Number(r.rows[0]!.accounts), testAccounts: Number(r.rows[0]!.test) };
}

export type MailResult =
  | { ok: true; mail: AdminMail; auditId: number }
  | Refusal;

/**
 * 보낸다 — `draft`는 `parseMailDraft`를 지난 것. 한 사람 우편이면 그 계정이 있어야 한다.
 * CS면 보상을 **지급과 같은 하루 합계**로 잰다(`csGate` — 같은 잠금 · 같은 셈).
 */
export async function sendMail(admin: AdminUser, draft: MailDraft, reason: string): Promise<MailResult> {
  return withCheckout(() => pool.connect(), '관리자 우편 보내기 트랜잭션', async (client): Promise<MailResult> => {
    try {
      await client.query('begin');
      if (draft.targetUid !== null) {
        const u = await client.query('select 1 from auth.users where id = $1', [draft.targetUid]);
        if (u.rowCount === 0) {
          await client.query('rollback');
          return { ok: false, status: 404, reason: '없는 계정이다' };
        }
      }
      const refused = await csGate(client, admin, draft.rewards);
      if (refused) {
        await client.query('rollback');
        return refused;
      }
      const ins = await client.query<{ id: string }>(
        `insert into mail (sent_at, expires_at, target_uid, title, body, rewards, sent_by)
         values (now(), now() + make_interval(secs => $1::double precision / 1000), $2, $3, $4, $5, $6) returning id`,
        [MAIL_TTL_MS, draft.targetUid, JSON.stringify(draft.title), JSON.stringify(draft.body),
          JSON.stringify(draft.rewards), admin.email],
      );
      const id = Number(ins.rows[0]!.id);
      const auditId = await insertAudit(client, admin, {
        targetUid: draft.targetUid, action: 'mail.send', params: { mailId: id, ...draft }, reason, before: null, after: null,
      });
      const mail = await readMailTx(client, id);
      await client.query('commit');
      return { ok: true, mail, auditId };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    }
  });
}

/**
 * 회수 — `revoked_at`을 찍는다. 목록에서 빠지고 더는 못 받는다. **이미 받은 보상은 그대로다**(계정을 고치지 않는다).
 * 이미 회수했거나 기한이 지난 우편은 거절한다(바뀌는 것이 없다).
 */
export async function revokeMail(admin: AdminUser, id: number, reason: string): Promise<MailResult> {
  return withCheckout(() => pool.connect(), '관리자 우편 회수 트랜잭션', async (client): Promise<MailResult> => {
    try {
      await client.query('begin');
      const cur = await client.query<{ target_uid: string | null; revoked_at: Date | null; live: boolean }>(
        'select target_uid, revoked_at, expires_at > now() as live from mail where id = $1 for update', [id]);
      const row = cur.rows[0];
      const fail = async (status: number, reason: string): Promise<MailResult> => {
        await client.query('rollback');
        return { ok: false, status, reason };
      };
      if (!row) return await fail(404, '없는 우편이다');
      if (row.revoked_at) return await fail(400, '이미 회수한 우편이다');
      if (!row.live) return await fail(400, '기한이 지난 우편이다 — 이미 아무도 못 받는다');
      const upd = await client.query<{ revoked_at: Date }>(
        'update mail set revoked_at = now() where id = $1 returning revoked_at', [id]);
      const auditId = await insertAudit(client, admin, {
        targetUid: row.target_uid, action: 'mail.revoke', params: { mailId: id }, reason,
        before: { revokedAt: null }, after: { revokedAt: upd.rows[0]!.revoked_at.toISOString() },
      });
      const mail = await readMailTx(client, id);
      await client.query('commit');
      return { ok: true, mail, auditId };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    }
  });
}

async function readMailTx(client: PoolClient, id: number): Promise<AdminMail> {
  const r = await client.query<MailRow>(`select ${MAIL_COLS} from ${MAIL_FROM} where m.id = $1`, [id]);
  return (await withCounts(client, r.rows))[0]!;
}
