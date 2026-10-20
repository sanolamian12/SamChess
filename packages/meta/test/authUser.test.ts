/**
 * `/auth/v1/user` 응답 읽기 회귀 (2026-10-20, `src/authUser.ts`).
 *
 * 여기서 고정하는 것.
 *  - **정지는 두 모양 다 정지다** — 실측된 `403 user_banned`와 `200 + banned_until(미래)`
 *  - **403 모양은 토큰의 `sub`로 uid를 읽는다** — 못 읽어도 정지는 정지
 *  - **지난 `banned_until`은 정지가 아니다** — 기간이 끝난 계정은 그대로 들어온다
 *  - 그 밖의 거절 · 모양이 틀린 본문은 `invalid`(401로 간다)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readAuthUser } from '../src/index.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const UID = '11111111-2222-3333-4444-555555555555';
const b64url = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64url({ alg: 'HS256' })}.${b64url({ sub: UID, role: 'authenticated' })}.sig`;

describe('readAuthUser', () => {
  it('200 + id면 ok — email · app_metadata를 싣는다', () => {
    const r = readAuthUser(200, { id: UID, email: 'a@b.c', app_metadata: { role: 'admin' } }, TOKEN, NOW);
    assert.deepEqual(r, { kind: 'ok', uid: UID, email: 'a@b.c', appMetadata: { role: 'admin' } });
  });

  it('403 user_banned(실측 모양)는 정지 — uid는 토큰의 sub', () => {
    const r = readAuthUser(403, { code: 403, error_code: 'user_banned', msg: 'User is banned' }, TOKEN, NOW);
    assert.deepEqual(r, { kind: 'banned', uid: UID });
  });

  it('403 user_banned인데 토큰을 못 읽으면 uid만 null — 정지는 정지', () => {
    assert.deepEqual(readAuthUser(403, { error_code: 'user_banned' }, 'not-a-jwt', NOW), { kind: 'banned', uid: null });
    assert.deepEqual(readAuthUser(403, { error_code: 'user_banned' }, 'a.%%%.c', NOW), { kind: 'banned', uid: null });
  });

  it('200인데 banned_until이 미래면 정지 — 설정에 따라 통과시키는 모양도 막는다', () => {
    const r = readAuthUser(200, { id: UID, banned_until: '2026-10-21T00:00:00Z' }, TOKEN, NOW);
    assert.deepEqual(r, { kind: 'banned', uid: UID });
  });

  it('banned_until이 지났으면 ok', () => {
    const r = readAuthUser(200, { id: UID, banned_until: '2026-10-19T00:00:00Z' }, TOKEN, NOW);
    assert.equal(r.kind, 'ok');
  });

  it('그 밖의 거절 · 모양이 틀린 본문은 invalid', () => {
    assert.deepEqual(readAuthUser(401, { error_code: 'bad_jwt' }, TOKEN, NOW), { kind: 'invalid' });
    assert.deepEqual(readAuthUser(403, { error_code: 'not_admin' }, TOKEN, NOW), { kind: 'invalid' });
    assert.deepEqual(readAuthUser(200, {}, TOKEN, NOW), { kind: 'invalid' });
    assert.deepEqual(readAuthUser(200, null, TOKEN, NOW), { kind: 'invalid' });
  });
});
