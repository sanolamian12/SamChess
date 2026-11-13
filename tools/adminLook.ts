/**
 * 관리자 화면 눈 확인 도구들이 함께 쓰는 것 (2026-11-13) — 시험 계정 만들기 · 관리자 MFA 통과 · 화면에 세션 넣기 · 정리.
 * `battles_ux.ts` · `gacha_ux.ts`가 쓴다. 전부 `.env`(개발 Supabase)를 읽는다.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { Page } from 'playwright';

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const ANON = process.env['SUPABASE_ANON_KEY']!;
const SECRET = process.env['SUPABASE_SECRET_KEY']!;
const H = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' };

/** 만든 계정 — `cleanupUsers()`가 지운다 */
export const madeUsers: string[] = [];

export interface LookUser { uid: string; email: string; password: string; token: string }

/** `{prefix}-{tag}-…@samchess.test` 계정을 만들고 비밀번호로 로그인한 토큰을 돌려준다 */
export async function makeUser(prefix: string, tag: string, role?: string): Promise<LookUser> {
  const email = `${prefix}-${tag}-${randomUUID().slice(0, 8)}@samchess.test`;
  const password = randomUUID();
  const c = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true, ...(role ? { app_metadata: { role } } : {}) }),
  });
  if (!c.ok) throw new Error(`계정 생성 실패 ${c.status} ${await c.text()}`);
  const uid = ((await c.json()) as { id: string }).id;
  madeUsers.push(uid);
  const l = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return { uid, email, password, token: ((await l.json()) as { access_token: string }).access_token };
}

function totp(secret: string, at = Date.now()): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map((c) => A.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export interface LookAdmin { uid: string; email: string; token: string; refresh: string; expiresIn: number }

/** 시험 관리자 — 만들고 TOTP를 등록해 aal2 토큰까지(관리자 API는 MFA를 지난 세션만 받는다) */
export async function makeAdmin(prefix: string): Promise<LookAdmin> {
  const a = await makeUser(prefix, 'admin', 'admin');
  const h = { apikey: ANON, Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' };
  const en = await fetch(`${SUPABASE_URL}/auth/v1/factors`, { method: 'POST', headers: h, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'look' }) });
  const { id, totp: { secret } } = (await en.json()) as { id: string; totp: { secret: string } };
  const ch = await fetch(`${SUPABASE_URL}/auth/v1/factors/${id}/challenge`, { method: 'POST', headers: h, body: '{}' });
  const challengeId = ((await ch.json()) as { id: string }).id;
  const v = await fetch(`${SUPABASE_URL}/auth/v1/factors/${id}/verify`, { method: 'POST', headers: h, body: JSON.stringify({ challenge_id: challengeId, code: totp(secret) }) });
  const t = (await v.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { uid: a.uid, email: a.email, token: t.access_token, refresh: t.refresh_token, expiresIn: t.expires_in };
}

/** 관리자 화면은 세션을 처음 뜰 때 한 번 읽는다 — 첫 `goto` 전에 부른다 */
export async function adminSession(page: Page, admin: LookAdmin): Promise<void> {
  await page.addInitScript((s) => sessionStorage.setItem('samchess-admin.session', s), JSON.stringify({
    email: admin.email, accessToken: admin.token, refreshToken: admin.refresh, expiresAt: Date.now() + admin.expiresIn * 1000,
  }));
}

export async function cleanupUsers(): Promise<void> {
  await Promise.all(madeUsers.map((uid) => fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H })));
  console.log(`✓ 시험 계정 ${madeUsers.length}개 정리`);
}
