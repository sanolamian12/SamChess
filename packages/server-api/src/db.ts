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

/*
 * ★ 쉬고 있던 연결이 DB 쪽에서 끊기면 `pg`는 풀에 `error` 이벤트를 낸다 — **받는 리스너가 없으면
 * Node가 프로세스를 통째로 내린다.** Supabase가 느리던 날(2026-10-17) 계정 API가 말없이 사라져
 * 도적떼 · 로그인이 전부 「서버에 닿지 못했다」가 됐다. 끊긴 연결은 풀이 이미 버렸으니 적어 두기만 한다 —
 * 다음 쿼리는 새 연결을 연다.
 *
 * ⚠ **꺼내 쓰는 연결(`pool.connect()`)은 여기로 안 온다** — 그 연결 객체에 `error`가 나고, 리스너가 없으면 역시
 * 프로세스가 내려간다(2026-10-20 관리자 API에서 실측). 꺼내 쓰는 자리는 `checkout.ts`의 `withCheckout()`을 지난다.
 */
pool.on('error', (err) => {
  console.error('[db] 쉬던 연결이 끊겼다 — 풀이 버리고 다음 쿼리에 새로 연다:', err.message);
});
