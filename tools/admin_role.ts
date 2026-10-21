/**
 * 관리자 역할 주기 · 거두기 — Supabase Admin API로 `app_metadata.role`을 적는다.
 *
 *   npm run admin:role -- <이메일>              # 준다
 *   npm run admin:role -- <이메일> --revoke     # 거둔다
 *   npm run admin:role -- <이메일> --reset-mfa  # MFA(TOTP)를 지운다 — 인증 앱이 든 휴대폰을 잃었을 때
 *   npm run admin:role -- --list               # 지금 관리자들 (MFA 등록 여부와 함께)
 *
 * 역할은 관리자 화면에서 주지 않는다 — 관리자 하나가 털리면 관리자를 마음대로 늘릴 수 있게
 * 되기 때문이다. 서비스 키를 쥔 사람만 이 도구로 정한다.
 *
 * 관리자 API는 MFA를 지난 세션(`aal2`)만 받는다(`server-api/src/admin/auth.ts`). 처음 들어오는 관리자에게는 화면이
 * 등록을 시킨다. **MFA를 지우는 길은 이 도구뿐이다** — 화면에서는 비밀번호만으로(aal1) 못 지운다. 지우면 다음 로그인에
 * 다시 등록하고, 그 관리자가 이미 받아 둔 토큰도 바로 막힌다(서버가 지금 factor가 있는지도 본다).
 */
import { Pool } from 'pg';

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SECRET = process.env['SUPABASE_SECRET_KEY'];
const DB = process.env['SUPABASE_DB_URL'];
if (!SUPABASE_URL || !SECRET || !DB) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY/SUPABASE_DB_URL이 없다 — .env를 확인할 것');

const pool = new Pool({ connectionString: DB, ssl: { rejectUnauthorized: false } });
const args = process.argv.slice(2);
const adminHeaders = { apikey: SECRET, Authorization: `Bearer ${SECRET}` };

try {
  if (args[0] === '--list') {
    const r = await pool.query<{ email: string; mfa: boolean }>(
      `select u.email, exists(select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as mfa
         from auth.users u where u.raw_app_meta_data->>'role' = 'admin' order by u.email`,
    );
    console.log(r.rows.length
      ? r.rows.map((x) => `- ${x.email}${x.mfa ? '' : '  (MFA 아직 없음 — 다음 로그인에 등록)'}`).join('\n')
      : '(관리자 없음)');
  } else {
    const email = args[0];
    if (!email) throw new Error('이메일을 적는다 — 사용법은 파일 머리말');
    const r = await pool.query<{ id: string; app: Record<string, unknown> | null }>(
      'select id, raw_app_meta_data as app from auth.users where lower(email) = lower($1)', [email],
    );
    const user = r.rows[0];
    if (!user) throw new Error(`그런 계정이 없다 — ${email}`);

    if (args.includes('--reset-mfa')) {
      // 등록하다 만 것(unverified)까지 전부 — 다음 로그인의 등록이 깨끗하게 시작한다
      const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}/factors`, { headers: adminHeaders });
      if (!list.ok) throw new Error(`Admin API 실패 — ${list.status} ${await list.text()}`);
      const factors = (await list.json()) as { id: string }[];
      for (const f of factors) {
        const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}/factors/${f.id}`, { method: 'DELETE', headers: adminHeaders });
        if (!del.ok) throw new Error(`Admin API 실패 — ${del.status} ${await del.text()}`);
      }
      console.log(`✓ ${email}의 MFA ${factors.length}개를 지웠다 — 다음 로그인에 다시 등록한다`);
    } else {
      const revoke = args.includes('--revoke');
      // `app_metadata`는 통째로 바뀐다 — provider 같은 기존 칸을 지키려고 읽은 값 위에 얹는다
      const { role: _role, ...rest } = user.app ?? {};
      const app_metadata = revoke ? { ...rest, role: null } : { ...rest, role: 'admin' };
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_metadata }),
      });
      if (!res.ok) throw new Error(`Admin API 실패 — ${res.status} ${await res.text()}`);
      console.log(revoke ? `✓ ${email}의 관리자 역할을 거뒀다` : `✓ ${email}을(를) 관리자로 정했다`);
    }
  }
} finally {
  await pool.end();
}
