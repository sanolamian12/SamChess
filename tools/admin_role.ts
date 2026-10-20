/**
 * 관리자 역할 주기 · 거두기 — Supabase Admin API로 `app_metadata.role`을 적는다.
 *
 *   npm run admin:role -- <이메일>            # 준다
 *   npm run admin:role -- <이메일> --revoke   # 거둔다
 *   npm run admin:role -- --list             # 지금 관리자들
 *
 * 역할은 관리자 화면에서 주지 않는다 — 관리자 하나가 털리면 관리자를 마음대로 늘릴 수 있게
 * 되기 때문이다. 서비스 키를 쥔 사람만 이 도구로 정한다.
 */
import { Pool } from 'pg';

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SECRET = process.env['SUPABASE_SECRET_KEY'];
const DB = process.env['SUPABASE_DB_URL'];
if (!SUPABASE_URL || !SECRET || !DB) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY/SUPABASE_DB_URL이 없다 — .env를 확인할 것');

const pool = new Pool({ connectionString: DB, ssl: { rejectUnauthorized: false } });
const args = process.argv.slice(2);

try {
  if (args[0] === '--list') {
    const r = await pool.query<{ email: string }>(
      `select email from auth.users where raw_app_meta_data->>'role' = 'admin' order by email`,
    );
    console.log(r.rows.length ? r.rows.map((x) => `- ${x.email}`).join('\n') : '(관리자 없음)');
  } else {
    const email = args[0];
    if (!email) throw new Error('이메일을 적는다 — 사용법은 파일 머리말');
    const revoke = args.includes('--revoke');
    const r = await pool.query<{ id: string; app: Record<string, unknown> | null }>(
      'select id, raw_app_meta_data as app from auth.users where lower(email) = lower($1)', [email],
    );
    const user = r.rows[0];
    if (!user) throw new Error(`그런 계정이 없다 — ${email}`);

    // `app_metadata`는 통째로 바뀐다 — provider 같은 기존 칸을 지키려고 읽은 값 위에 얹는다
    const { role: _role, ...rest } = user.app ?? {};
    const app_metadata = revoke ? { ...rest, role: null } : { ...rest, role: 'admin' };
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_metadata }),
    });
    if (!res.ok) throw new Error(`Admin API 실패 — ${res.status} ${await res.text()}`);
    console.log(revoke ? `✓ ${email}의 관리자 역할을 거뒀다` : `✓ ${email}을(를) 관리자로 정했다`);
  }
} finally {
  await pool.end();
}
