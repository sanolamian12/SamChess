/**
 * `packages/server-api/sql/schema.sql`을 그대로 실행한다. 몇 번을 다시 돌려도
 * 안전하다(스키마가 전부 `IF NOT EXISTS`). `npm run db:migrate`.
 *
 * 스키마 뒤에 **수비군 줄이 없는 계정을 채운다** (2026-10-27, `defenses`) — 그 표는 계정을 쓸 때마다 맞춰지는데,
 * 표가 생기기 전부터 있던 계정은 다음에 무언가 바뀔 때까지 줄이 없다. 줄이 이미 있는 계정은 건드리지 않으므로
 * 다시 돌려도 안전하다.
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { migrateProfile } from '@samchess/meta';
import { syncDefenses } from '../packages/server-api/src/defenses.ts';

const connectionString = process.env['SUPABASE_DB_URL'];
if (!connectionString) throw new Error('SUPABASE_DB_URL이 없다 — .env를 확인할 것');

const sql = readFileSync(new URL('../packages/server-api/sql/schema.sql', import.meta.url), 'utf8');

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
await pool.query(sql);
console.log('✓ 스키마 적용 완료');

const missing = (await pool.query<{ uid: string; data: unknown }>(
  'select uid, data from profiles where uid not in (select uid from defenses)')).rows;
let filled = 0;
for (const row of missing) {
  const profile = migrateProfile(row.data);
  if (!profile) continue;
  const client = await pool.connect();
  try {
    await client.query('begin');
    await syncDefenses(client, row.uid, null, profile, { force: true });
    await client.query('commit');
    filled += 1;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
const rows = (await pool.query<{ n: string }>('select count(*) as n from defenses')).rows[0]!.n;
console.log(`✓ 수비군 줄 — 줄이 없던 계정 ${missing.length}개를 훑어 ${filled}개 맞춤 · 표에 ${rows}줄`);
await pool.end();
