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
import { createProfile } from '@samchess/meta';
import { registerRoutes } from '../packages/server-api/src/routes.ts';
import { pool } from '../packages/server-api/src/db.ts';
import { saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

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
/** 도시 이름은 계정 사이에 고유하다(2026-09-19) — 고정 이름을 쓰면 지난 실행이 남긴 도시와 부딪힌다.
    로마자로 짓는 것은 아래 8b가 **대소문자 무시**를 재기 때문이다 */
const CITY = `Smoke-${randomUUID().slice(0, 4)}`;

/** 테스트 계정을 만들고 로그인한다 — 도시 이름 고유성(8b)을 재려면 계정이 둘 필요하다 */
async function makeUser(): Promise<{ uid: string; token: string; email: string; password: string }> {
  const em = `smoke-${randomUUID()}@samchess.test`;
  const pw = randomUUID();
  const c = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em, password: pw, email_confirm: true }),
  });
  if (!c.ok) fail(`테스트 계정 생성 실패 — ${c.status}`);
  const id = ((await c.json()) as { id: string }).id;
  const l = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em, password: pw }),
  });
  if (!l.ok) fail(`로그인 실패 — ${l.status}`);
  return { uid: id, token: ((await l.json()) as { access_token: string }).access_token, email: em, password: pw };
}
const deleteUser = (id: string): Promise<Response> => fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
  method: 'DELETE',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
});

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
  const profile = createProfile(CITY, 42);
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
  const roundTrip = (await getRes.json()) as typeof profile;
  // `grainAt`만은 다르다 — 읽을 때 서버가 제 시계로 군량을 정산하며 찍는다(H3d, `getProfile()`).
  // 이 검사가 그걸 모른 채 낡아 있었다(2026-09-19에 바로잡음)
  assert.deepEqual({ ...roundTrip, grainAt: 0 }, { ...profile, grainAt: 0 });
  ok('읽으면 저장한 그대로다 — 왕복 동일성(서버가 찍는 grainAt 빼고)');

  // ── 7. 덮어쓴다 — 두 번째 PUT이 upsert인지 ─────────────────────
  // **클라이언트가 정하는 칸**으로 잰다 — 카드는 2026-09-14(A2)부터 서버 소유라 `PUT`이
  // 버린다. 예전엔 여기서 `addCard`로 쟀는데 그 뒤로 이 검사가 낡아 있었다
  const updated = { ...roundTrip, squadSeq: roundTrip.squadSeq + 1 };
  await fetch(`${address}/profile`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(updated),
  });
  const getRes2 = await fetch(`${address}/profile`, { headers: auth });
  const roundTrip2 = (await getRes2.json()) as typeof profile;
  assert.deepEqual({ ...roundTrip2, grainAt: 0 }, { ...updated, grainAt: 0 });
  ok('두 번째 PUT은 새로 만들지 않고 덮어쓴다(upsert)');

  // ── 8. 토큰 없이는 막힌다 ──────────────────────────────────────
  const noAuthRes = await fetch(`${address}/profile`);
  assert.equal(noAuthRes.status, 401);
  ok('토큰 없이는 401');

  // ── 8b. 도시 이름은 계정 사이에 고유하다 (2026-09-19) ──────────────
  // DB의 고유 인덱스(`profiles_city_name_key`)가 거절하고 서버가 409로 돌린다.
  // **대소문자·앞뒤 공백만 다른 이름도 같은 이름이다** — 그걸 재려고 일부러 섞는다
  const other = await makeUser();
  try {
    const oAuth = { Authorization: `Bearer ${other.token}`, 'Content-Type': 'application/json' };
    const clash = await fetch(`${address}/profile`, {
      method: 'PUT', headers: oAuth, body: JSON.stringify(createProfile(`  ${CITY.toUpperCase()} `, 7)),
    });
    assert.equal(clash.status, 409, '대소문자·공백만 다른 이름으로 도시를 세웠다');
    assert.equal(((await clash.json()) as { error: string }).error, 'city_name_taken');
    const none = await fetch(`${address}/profile`, { headers: { Authorization: oAuth.Authorization } });
    assert.equal(none.status, 404, '거절됐는데 프로필이 남았다');
    ok('겹치는 이름(대소문자·공백만 다름)으로는 도시를 못 세운다 — 409, 행도 안 남는다');

    const mine = await fetch(`${address}/profile`, {
      method: 'PUT', headers: oAuth, body: JSON.stringify(createProfile(`${CITY}-2`, 7)),
    });
    assert.equal(mine.status, 200);
    // 이름 변경은 금화를 내야 하니 넉넉히 쥐여 준다 — **겹쳐서** 거절되는 것을 재야 한다
    const rich = { ...((await mine.json()) as ReturnType<typeof createProfile>), gold: 9999 };
    await saveProfileTrusted(other.uid, rich);
    const ren = await fetch(`${address}/city/rename`, {
      method: 'POST', headers: oAuth, body: JSON.stringify({ name: CITY.toLowerCase() }),
    });
    assert.equal(ren.status, 409, '남의 도시 이름으로 바꿨다');
    const after = (await (await fetch(`${address}/profile`, { headers: { Authorization: oAuth.Authorization } })).json()) as { cityName: string; gold: number };
    assert.equal(after.cityName, `${CITY}-2`);
    assert.equal(after.gold, 9999, '거절됐는데 금화가 나갔다');
    ok('남의 도시 이름으로는 못 바꾼다 — 409, 금화도 이름도 그대로');

    // PUT으로 이름을 바꾸려 해도 서버 값이 남는다 — 이름은 서버 소유다(`guardServerOwned`)
    await fetch(`${address}/profile`, { method: 'PUT', headers: oAuth, body: JSON.stringify({ ...rich, cityName: '몰래바꾼성' }) });
    const kept = (await (await fetch(`${address}/profile`, { headers: { Authorization: oAuth.Authorization } })).json()) as { cityName: string };
    assert.equal(kept.cityName, `${CITY}-2`);
    ok('PUT으로는 이름이 안 바뀐다 — 서버 소유');
  } finally {
    await deleteUser(other.uid);
  }
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
