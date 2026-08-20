/**
 * `packages/server-api/sql/schema.sql`을 그대로 실행한다. 몇 번을 다시 돌려도
 * 안전하다(스키마가 전부 `IF NOT EXISTS`). `npm run db:migrate`.
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const connectionString = process.env['SUPABASE_DB_URL'];
if (!connectionString) throw new Error('SUPABASE_DB_URL이 없다 — .env를 확인할 것');

const sql = readFileSync(new URL('../packages/server-api/sql/schema.sql', import.meta.url), 'utf8');

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
await pool.query(sql);
await pool.end();

console.log('✓ 스키마 적용 완료');
