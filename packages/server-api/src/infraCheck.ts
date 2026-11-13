/**
 * 인프라 점검 (2026-10-22 `tools/db_check.ts`에서 시작, 2026-11-13 모듈로) — **읽기만 한다.**
 *
 * 부르는 자리가 둘이고 같은 이 함수를 부른다 — 두 벌이면 한쪽만 낡는다.
 *  · `npm run db:check`(`:prod`) — 운영 프로젝트를 새로 만든 뒤 **이것이 ✓로 끝나야** 서버를 띄운다(`docs/운영_Supabase.md`)
 *  · 관리자 「시스템 · 점검」(`GET /admin/system/checks`, 권한 `system`)
 *
 * 보는 것.
 *  - 환경 — 어느 프로젝트 · `SAMCHESS_ENV`, 게임 화면이 같은 프로젝트로 로그인하는가, 내부 비밀의 길이(값은 안 보인다)
 *  - DB — **스키마**(`schema.sql`이 만드는 표 · 인덱스가 다 있는가, 목록은 그 파일에서 읽는다) · **RLS**(public 표 전부, CLAUDE.md
 *    「public 표는 RLS를 켠다」) · 계정 수(운영이면 관리자가 있어야 하고 시험 계정이 없어야 한다)
 *  - Auth — 이메일 가입 · 익명 로그인 · 확인 메일(개발과 운영이 같아야 한다) · 서비스 키로 Admin API에 닿는가
 *  - 백그라운드 작업 — 이상 징후 점검이 최근에 돌았나 · 실패했나, 보관 기간이 지난 줄이 지워지고 있나(`anomaly.ts`, 1시간마다 게임 API가 돌린다)
 */
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { INTERNAL_SECRET_MIN, samchessEnv } from './environment.ts';
import { KEEP_DAYS, SCAN_EVERY_MS } from './anomaly.ts';
import type { InfraCheck, InfraGroup } from './admin/types.ts';

type Env = Record<string, string | undefined>;

const SCHEMA = new URL('../sql/schema.sql', import.meta.url);

/** 이상 징후 점검이 이보다 오래 안 돌았으면 「멈췄다」 — 한 번 거른 것(잠금 · 재시작)까지는 봐준다 */
const SCAN_STALE_MS = SCAN_EVERY_MS * 2 + 10 * 60_000;

export async function runInfraChecks(env: Env, pool: Pool): Promise<InfraCheck[]> {
  const out: InfraCheck[] = [];
  const add = (group: InfraGroup, id: string, status: InfraCheck['status'], title: string, detail: string | null = null) => {
    out.push({ id, group, status, title, detail });
  };
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`${k}이 없다 — 읽은 env 파일을 확인할 것`);
    return v;
  };
  const SUPABASE_URL = need('SUPABASE_URL');
  const ANON = need('SUPABASE_ANON_KEY');
  const SECRET = need('SUPABASE_SECRET_KEY');
  const DB_URL = need('SUPABASE_DB_URL');
  const which = samchessEnv(env);
  const prod = which === 'production';

  // ── 환경 ──
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  add('env', 'project', 'info', `프로젝트 ${ref} · SAMCHESS_ENV=${env['SAMCHESS_ENV'] || 'development'}`, `DB ${new URL(DB_URL).hostname}`);
  if (which === null) add('env', 'env', 'fail', `SAMCHESS_ENV=${env['SAMCHESS_ENV']} — development 또는 production만 된다`);
  if (env['VITE_SUPABASE_URL'] && env['VITE_SUPABASE_URL'] !== SUPABASE_URL) {
    add('env', 'viteUrl', 'fail', `VITE_SUPABASE_URL이 SUPABASE_URL과 다르다 — 게임 화면이 다른 프로젝트로 로그인한다`, env['VITE_SUPABASE_URL']);
  }
  const secretLen = (env['INTERNAL_API_SECRET'] ?? '').length;
  if (!secretLen) add('env', 'internalSecret', 'fail', 'INTERNAL_API_SECRET이 없다 — 대전 서버 · 관리자 API가 게임 API에 못 닿는다');
  else if (secretLen < INTERNAL_SECRET_MIN) {
    add('env', 'internalSecret', prod ? 'fail' : 'warn', `INTERNAL_API_SECRET이 ${INTERNAL_SECRET_MIN}자보다 짧다(${secretLen}자)`,
      prod ? '운영 게임 API가 뜨지 않는다 — openssl rand -hex 32로 새로' : '개발에서는 된다 — 운영에서는 게임 API가 거절한다');
  } else add('env', 'internalSecret', 'ok', `내부 비밀 ${secretLen}자`);

  // ── DB: 스키마 · RLS · 계정 수 ──
  const sql = readFileSync(SCHEMA, 'utf8');
  const wantTables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]!);
  const wantIndexes = [...sql.matchAll(/create (?:unique )?index if not exists (\w+)/g)].map((m) => m[1]!);
  const tables = (await pool.query<{ name: string; rls: boolean }>(
    `select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows;
  const indexes = new Set((await pool.query<{ name: string }>(
    `select indexname as name from pg_indexes where schemaname = 'public'`)).rows.map((r) => r.name));
  const missingT = wantTables.filter((t) => !tables.some((x) => x.name === t));
  const missingI = wantIndexes.filter((i) => !indexes.has(i));
  if (missingT.length || missingI.length) {
    add('db', 'schema', 'fail', `스키마가 모자란다 — npm run db:migrate${prod ? ':prod' : ''}`,
      `표 ${missingT.join(', ') || '없음'} · 인덱스 ${missingI.join(', ') || '없음'}`);
  } else add('db', 'schema', 'ok', `스키마 — 표 ${wantTables.length}개 · 인덱스 ${wantIndexes.length}개`, wantTables.join(' · '));
  const open = tables.filter((t) => !t.rls).map((t) => t.name);
  if (open.length) add('db', 'rls', 'fail', 'RLS가 꺼진 public 표가 있다 — 공개 키 하나로 읽고 쓸 수 있다', open.join(', '));
  else add('db', 'rls', 'ok', `RLS — public 표 ${tables.length}개 전부 켜짐`);

  const c = (await pool.query<{ users: string; test: string; profiles: string; admins: string; cs: string }>(
    `select (select count(*) from auth.users) as users,
            (select count(*) from auth.users where email like '%@samchess.test') as test,
            (select count(*) from profiles) as profiles,
            (select count(*) from auth.users where raw_app_meta_data->>'role' = 'admin') as admins,
            (select count(*) from auth.users where raw_app_meta_data->>'role' = 'cs') as cs`)).rows[0]!;
  add('db', 'accounts', 'info', `계정 ${c.users}(시험 ${c.test}) · 도시 ${c.profiles} · 관리자 ${c.admins} · CS ${c.cs}`);
  if (prod && Number(c.admins) === 0) add('db', 'admins', 'fail', '관리자 역할을 가진 계정이 없다 — npm run admin:role:prod -- <이메일>');
  if (prod && Number(c.test) > 0) add('db', 'testAccounts', 'fail', `운영에 시험 계정(@samchess.test)이 ${c.test}개 있다 — 스모크를 운영에 돌린 흔적`);

  // ── 백그라운드 작업: 이상 징후 점검 · 보관 정리 ──
  if (tables.some((t) => t.name === 'anomaly_scans')) {
    const last = (await pool.query<{ started_at: Date; finished_at: Date | null; error: string | null; accounts: number; found: number }>(
      'select started_at, finished_at, error, accounts, found from anomaly_scans order by id desc limit 1')).rows[0];
    const ok = (await pool.query<{ at: Date | null }>(
      'select max(finished_at) as at from anomaly_scans where finished_at is not null and error is null')).rows[0]!.at;
    const ago = (d: Date) => `${Math.round((Date.now() - d.getTime()) / 60_000)}분 전`;
    if (last?.error) add('jobs', 'anomalyScan', 'fail', '이상 징후 점검 — 마지막 실행이 실패했다', `${ago(last.started_at)} · ${last.error}`);
    else if (!ok) add('jobs', 'anomalyScan', 'warn', '이상 징후 점검 — 아직 한 번도 안 돌았다', '게임 API가 뜨고 1분 뒤 첫 점검, 그 뒤 1시간마다');
    else if (Date.now() - ok.getTime() > SCAN_STALE_MS) {
      add('jobs', 'anomalyScan', 'warn', `이상 징후 점검 — ${ago(ok)}에 마지막으로 돌았다`, '1시간마다 도는 일이다 — 게임 API가 꺼져 있거나 점검이 멈췄다');
    } else add('jobs', 'anomalyScan', 'ok', `이상 징후 점검 — ${ago(ok)}`, last ? `계정 ${last.accounts} · 새 징후 ${last.found}` : null);

    // 정리는 점검과 같은 트랜잭션이다 — 보관 기간을 하루 넘게 지난 거절 · 점검 기록이 남아 있으면 정리가 안 돌고 있다
    const old = (await pool.query<{ rejects: Date | null; scans: Date | null }>(
      `select (select min(at) from account_rejects) as rejects, (select min(started_at) from anomaly_scans) as scans`)).rows[0]!;
    const oldest = [old.rejects, old.scans].filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
    const days = oldest ? Math.floor((Date.now() - oldest.getTime()) / 86_400_000) : 0;
    if (days > KEEP_DAYS + 1) add('jobs', 'retention', 'warn', `보관 정리 — ${days}일 된 기록이 남아 있다(보관 ${KEEP_DAYS}일)`, '이상 징후 점검이 함께 지운다 — 점검이 돌고 있는지 먼저');
    else add('jobs', 'retention', 'ok', `보관 정리 — 가장 오래된 거절 · 점검 기록 ${days}일(보관 ${KEEP_DAYS}일)`);
  }

  // ── Auth 설정 ──
  const s = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: ANON }, signal: AbortSignal.timeout(10_000) }).catch((e: Error) => e);
  if (s instanceof Error || !s.ok) {
    add('auth', 'settings', 'fail', 'Auth 설정을 못 읽었다 — SUPABASE_ANON_KEY가 이 프로젝트 것인가', s instanceof Error ? s.message : `${s.status}`);
  } else {
    const a = await s.json() as { disable_signup: boolean; mailer_autoconfirm: boolean; external: Record<string, boolean> };
    if (a.disable_signup) add('auth', 'signup', 'fail', '가입이 꺼져 있다', 'Authentication → Sign In / Providers → Allow new users to sign up');
    if (!a.external['email']) add('auth', 'email', 'fail', '이메일 로그인이 꺼져 있다');
    if (a.external['anonymous_users']) add('auth', 'anonymous', 'fail', '익명 로그인이 켜져 있다 — 이 게임은 쓰지 않는다');
    const others = Object.entries(a.external).filter(([k, v]) => v && k !== 'email').map(([k]) => k);
    if (!a.disable_signup && a.external['email'] && !a.external['anonymous_users']) {
      add('auth', 'signup', 'ok', `Auth — 이메일 가입 열림${others.length ? ` · 다른 로그인 ${others.join(', ')}` : ''}`);
    }
    add('auth', 'confirmMail', 'info', `확인 메일 ${a.mailer_autoconfirm ? '꺼짐(가입하면 바로 로그인)' : '켜짐(메일함 확인 뒤 로그인)'}`, '개발과 운영이 같아야 한다');
  }

  // ── 서비스 키 ──
  const k = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1`, {
    headers: { apikey: SECRET, authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(10_000),
  }).catch((e: Error) => e);
  if (k instanceof Error || !k.ok) {
    add('auth', 'serviceKey', 'fail', '서비스 키로 Admin API에 못 닿는다 — SUPABASE_SECRET_KEY가 이 프로젝트 것인가', k instanceof Error ? k.message : `${k.status}`);
  } else add('auth', 'serviceKey', 'ok', '서비스 키 — Admin API에 닿는다');

  return out;
}
