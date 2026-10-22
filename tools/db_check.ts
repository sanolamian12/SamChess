/**
 * Supabase 프로젝트 점검 (2026-10-22) — `npm run db:check`(개발, `.env`) · `npm run db:check:prod`(운영, `.env.production`).
 *
 * 개발 / 운영을 둘로 가르면서 만들었다(`docs/운영_Supabase.md`). 운영 프로젝트를 새로 만든 뒤 **이것이 ✓로 끝나야** 서버를 띄운다.
 * 읽기만 한다 — 아무것도 쓰거나 고치지 않는다.
 *
 * 보는 것.
 *  - 어느 프로젝트인가(`SUPABASE_URL`의 ref) · `SAMCHESS_ENV` — 엉뚱한 파일을 읽고 있지 않은지 사람이 눈으로
 *  - **스키마** — `schema.sql`이 만드는 표 · 인덱스가 다 있는가(목록은 그 파일에서 읽는다 — 스키마가 늘면 검사도 는다)
 *  - **RLS** — public 스키마의 표 **전부**가 켜져 있는가(`schema.sql` 밖에서 생긴 표도 잡는다, CLAUDE.md 「public 표는 RLS를 켠다」)
 *  - **Auth 설정**(`/auth/v1/settings`) — 이메일 가입이 열려 있는가, 익명 로그인이 꺼져 있는가, 「확인 메일」이 켜져 있는가.
 *    확인 메일은 어느 쪽이든 코드가 받지만(`client/src/meta/auth.ts`의 `signUp`), 개발과 운영이 **같아야** 개발에서 본 화면이 운영에서도 뜬다
 *  - **서비스 키** — 관리자 API · 도구가 쓰는 Admin API에 닿는가 · 관리자 역할을 가진 계정 수(운영이면 0이 아니어야 관리자 화면에 들어간다)
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k}이 없다 — 읽은 env 파일을 확인할 것`);
  return v;
};
const SUPABASE_URL = need('SUPABASE_URL');
const ANON = need('SUPABASE_ANON_KEY');
const SECRET = need('SUPABASE_SECRET_KEY');
const DB_URL = need('SUPABASE_DB_URL');
const ENV = process.env['SAMCHESS_ENV'] || 'development';

let bad = 0;
const ok = (m: string) => console.log(`✓ ${m}`);
const no = (m: string) => { bad += 1; console.log(`✗ ${m}`); };
const info = (m: string) => console.log(`· ${m}`);

const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
info(`프로젝트 ${ref} · SAMCHESS_ENV=${ENV} · DB ${new URL(DB_URL).hostname}`);
if (process.env['VITE_SUPABASE_URL'] && process.env['VITE_SUPABASE_URL'] !== SUPABASE_URL) {
  no(`VITE_SUPABASE_URL(${process.env['VITE_SUPABASE_URL']})이 SUPABASE_URL과 다르다 — 게임 화면이 다른 프로젝트로 로그인한다`);
}

// ── 스키마 · RLS ──
const sql = readFileSync(new URL('../packages/server-api/sql/schema.sql', import.meta.url), 'utf8');
const wantTables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]!);
const wantIndexes = [...sql.matchAll(/create (?:unique )?index if not exists (\w+)/g)].map((m) => m[1]!);

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
try {
  const tables = (await pool.query<{ name: string; rls: boolean }>(
    `select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows;
  const indexes = new Set((await pool.query<{ name: string }>(
    `select indexname as name from pg_indexes where schemaname = 'public'`)).rows.map((r) => r.name));
  const missingT = wantTables.filter((t) => !tables.some((x) => x.name === t));
  const missingI = wantIndexes.filter((i) => !indexes.has(i));
  if (missingT.length || missingI.length) no(`스키마가 모자란다 — 표 ${missingT.join(', ') || '없음'} · 인덱스 ${missingI.join(', ') || '없음'} → npm run db:migrate(:prod)`);
  else ok(`스키마 — 표 ${wantTables.length}개(${wantTables.join(' · ')}) · 인덱스 ${wantIndexes.length}개`);
  const open = tables.filter((t) => !t.rls).map((t) => t.name);
  if (open.length) no(`RLS가 꺼진 public 표 — ${open.join(', ')} (공개 키 하나로 읽고 쓸 수 있다)`);
  else ok(`RLS — public 표 ${tables.length}개 전부 켜짐`);

  const counts = (await pool.query<{ users: string; test: string; profiles: string; admins: string; cs: string }>(
    `select (select count(*) from auth.users) as users,
            (select count(*) from auth.users where email like '%@samchess.test') as test,
            (select count(*) from profiles) as profiles,
            (select count(*) from auth.users where raw_app_meta_data->>'role' = 'admin') as admins,
            (select count(*) from auth.users where raw_app_meta_data->>'role' = 'cs') as cs`)).rows[0]!;
  info(`계정 ${counts.users}(시험 ${counts.test}) · 도시 ${counts.profiles} · 관리자 ${counts.admins} · CS ${counts.cs}`);
  if (ENV === 'production' && Number(counts.admins) === 0) no('관리자 역할을 가진 계정이 없다 — npm run admin:role:prod -- <이메일>');
  if (ENV === 'production' && Number(counts.test) > 0) no(`운영에 시험 계정(@samchess.test)이 ${counts.test}개 있다 — 스모크를 운영에 돌린 흔적`);
} finally {
  await pool.end();
}

// ── Auth 설정 ──
const s = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: ANON } });
if (!s.ok) no(`Auth 설정을 못 읽었다 — ${s.status} (SUPABASE_ANON_KEY가 이 프로젝트 것인가)`);
else {
  const a = await s.json() as { disable_signup: boolean; mailer_autoconfirm: boolean; external: Record<string, boolean> };
  if (a.disable_signup) no('가입이 꺼져 있다(Authentication → Sign In / Providers → Allow new users to sign up)');
  if (!a.external['email']) no('이메일 로그인이 꺼져 있다');
  if (a.external['anonymous_users']) no('익명 로그인이 켜져 있다 — 이 게임은 쓰지 않는다');
  const others = Object.entries(a.external).filter(([k, v]) => v && k !== 'email').map(([k]) => k);
  if (!a.disable_signup && a.external['email'] && !a.external['anonymous_users']) ok(`Auth — 이메일 가입 열림${others.length ? ` · 다른 로그인 ${others.join(', ')}` : ''}`);
  info(`확인 메일 ${a.mailer_autoconfirm ? '꺼짐(가입하면 바로 로그인)' : '켜짐(메일함 확인 뒤 로그인)'} — 개발과 운영이 같아야 한다`);
}

// ── 서비스 키 ──
const admin = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1`, { headers: { apikey: SECRET, authorization: `Bearer ${SECRET}` } });
if (admin.ok) ok('서비스 키 — Admin API에 닿는다');
else no(`서비스 키로 Admin API에 못 닿는다 — ${admin.status} (SUPABASE_SECRET_KEY가 이 프로젝트 것인가)`);

console.log(bad === 0 ? `\n✓ 점검 끝 — ${ref}` : `\n✗ ${bad}건 — 위를 고친 뒤 다시`);
process.exit(bad === 0 ? 0 : 1);
