/**
 * Supabase 프로젝트 점검 (2026-10-22) — `npm run db:check`(개발, `.env`) · `npm run db:check:prod`(운영, `.env.production`).
 *
 * 개발 / 운영을 둘로 가르면서 만들었다(`docs/운영_Supabase.md`). 운영 프로젝트를 새로 만든 뒤 **이것이 ✓로 끝나야** 서버를 띄운다.
 * 읽기만 한다 — 아무것도 쓰거나 고치지 않는다.
 *
 * 무엇을 보는지는 `packages/server-api/src/infraCheck.ts`에 있다(2026-11-13 옮김) — 관리자 「시스템 · 점검」이 같은 함수를 부른다.
 * 여기는 찍기만 한다: ✓ 됨 · ✗ 고칠 것 · ! 볼 것 · · 사실. `✗`가 하나라도 있으면 종료 코드 1.
 */
import { Pool } from 'pg';
import { runInfraChecks } from '../packages/server-api/src/infraCheck.ts';

const url = process.env['SUPABASE_DB_URL'];
if (!url) throw new Error('SUPABASE_DB_URL이 없다 — 읽은 env 파일을 확인할 것');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const MARK = { ok: '✓', fail: '✗', warn: '!', info: '·' } as const;
let checks;
try {
  checks = await runInfraChecks(process.env, pool);
} finally {
  await pool.end();
}
for (const c of checks) console.log(`${MARK[c.status]} ${c.title}${c.detail ? ` — ${c.detail}` : ''}`);
const bad = checks.filter((c) => c.status === 'fail').length;
const ref = new URL(process.env['SUPABASE_URL']!).hostname.split('.')[0];
console.log(bad === 0 ? `\n✓ 점검 끝 — ${ref}` : `\n✗ ${bad}건 — 위를 고친 뒤 다시`);
process.exit(bad === 0 ? 0 : 1);
