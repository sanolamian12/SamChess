/**
 * Postgres 연결 — 계정 저장의 유일한 접점.
 *
 * `SUPABASE_DB_URL`은 Supabase의 **Transaction Pooler** 문자열이어야 한다
 * (`db.<ref>.supabase.co` 직접 연결은 IPv6 전용이라 IPv4밖에 없는 환경에서 막힌다 —
 * `history/2026-08-20_계정_로그인_H3a.md` 참조). pooler는 매 쿼리를 짧게 열고 닫는
 * 쓰임에 맞고, 이 서버가 하는 일이 정확히 그거다.
 */
import { Pool } from 'pg';

const connectionString = process.env['SUPABASE_DB_URL'];
if (!connectionString) throw new Error('SUPABASE_DB_URL이 없다 — .env를 확인할 것');

export const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
