/**
 * 계정 API 스모크 — **진짜 Supabase Auth · 진짜 Postgres**로 로그인→저장→읽기 한 바퀴.
 *
 *   npm run smoke:account
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 진짜 Supabase를 쓰나
 * ────────────────────────────────────────────────────────────────
 *
 * `auth.ts`의 토큰 검증은 Supabase의 `/auth/v1/user`를 그대로 호출한다 — 가짜
 * 토큰으로는 이 경로 자체가 시험되지 않는다. `smoke:online`이 진짜 소켓을 지나야
 * Colyseus 버전 짝을 잡는 것과 같은 이유로, 여기서도 진짜 Auth Admin API로 테스트
 * 계정을 만들고 진짜 로그인으로 액세스 토큰을 받는다.
 *
 * **테스트 계정은 끝나면 지운다** — `auth.users`가 지워지면 `profiles` 행도
 * `on delete cascade`로 함께 지워지는지까지 이 스모크가 확인한다.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createProfile, addCard } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { registerRoutes } from '../packages/server-api/src/routes.ts';
import { pool } from '../packages/server-api/src/db.ts';

const ok = (msg: string): void => console.log(`✓ ${msg}`);
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_ANON_KEY = process.env['SUPABASE_ANON_KEY'];
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY'];
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SECRET_KEY) {
  fail('SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SECRET_KEY가 없다 — .env를 확인할 것');
}

const email = `smoke-${randomUUID()}@samchess.test`;
const password = randomUUID();

// ── 1. Admin API로 테스트 계정을 만든다 ──────────────────────────
const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!createRes.ok) fail(`테스트 계정 생성 실패 — ${createRes.status} ${await createRes.text()}`);
const created = (await createRes.json()) as { id: string };
const uid = created.id;
ok(`테스트 계정 생성 — ${uid}`);

// ── 2. 로그인해서 액세스 토큰을 받는다 ────────────────────────────
const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!loginRes.ok) fail(`로그인 실패 — ${loginRes.status} ${await loginRes.text()}`);
const { access_token: token } = (await loginRes.json()) as { access_token: string };
ok('로그인 — 액세스 토큰을 받았다');

// ── 3. 계정 API를 제 안에서 띄운다 ───────────────────────────────
const Fastify = (await import('fastify')).default;
const app = Fastify();
registerRoutes(app);
const address = await app.listen({ port: 0, host: '127.0.0.1' });
ok(`계정 API — ${address}`);

const auth = { Authorization: `Bearer ${token}` };

try {
  // ── 4. 아직 프로필이 없다 ────────────────────────────────────
  const missRes = await fetch(`${address}/profile`, { headers: auth });
  assert.equal(missRes.status, 404);
  ok('처음엔 404 — 프로필이 없다');

  // ── 5. 저장한다(가져오기와 같은 엔드포인트, upsert) ──────────────
  const profile = createProfile('스모크성', 42);
  const putRes = await fetch(`${address}/profile`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  assert.equal(putRes.status, 200);
  ok('저장됐다(PUT /profile)');

  // ── 6. 읽으면 그대로 돌아온다 ─────────────────────────────────
  const getRes = await fetch(`${address}/profile`, { headers: auth });
  assert.equal(getRes.status, 200);
  const roundTrip = await getRes.json();
  assert.deepEqual(roundTrip, profile);
  ok('읽으면 저장한 그대로다 — 왕복 동일성');

  // ── 7. 덮어쓴다 — 두 번째 PUT이 upsert인지 ─────────────────────
  const firstOfficer = Object.keys(profile.roster)[0] as OfficerId;
  const updated = addCard(profile, firstOfficer, 3);
  await fetch(`${address}/profile`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(updated),
  });
  const getRes2 = await fetch(`${address}/profile`, { headers: auth });
  const roundTrip2 = await getRes2.json();
  assert.deepEqual(roundTrip2, updated);
  ok('두 번째 PUT은 새로 만들지 않고 덮어쓴다(upsert)');

  // ── 8. 토큰 없이는 막힌다 ──────────────────────────────────────
  const noAuthRes = await fetch(`${address}/profile`);
  assert.equal(noAuthRes.status, 401);
  ok('토큰 없이는 401');
} finally {
  await app.close();
  // ── 9. 정리 — 계정을 지우면 프로필도 cascade로 함께 지워지는지 ────
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  const left = await pool.query('select 1 from profiles where uid = $1', [uid]);
  assert.equal(left.rowCount, 0);
  ok('계정을 지우니 프로필도 cascade로 함께 지워졌다');
  await pool.end();
}

console.log('\n계정 API 스모크 통과 — 로그인 · 저장 · 왕복 동일성 · upsert · 인증 · cascade');
