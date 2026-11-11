/**
 * **변화 장부 · 이상 징후 확인** (2026-11-12, `history/2026-11-12_이상징후_설계.md`) — 시험 계정 하나로 진짜 게임 API를 지나
 * 장부 줄이 맞게 남는지, 그리고 **깨진 상태를 일부러 만들면 점검이 징후를 실제로 올리는지** 본다. 개발 DB(`.env`)만 쓴다.
 *
 *   SAMCHESS_API=http://localhost:8787 node --experimental-strip-types --env-file=.env tools/ledger_ux.ts
 *
 * 1. 새 계정(`PUT /profile`) → `create` 한 줄, 판정 없음
 * 2. 장부 밖 쓰기(`saveProfileTrusted` — 도구 전용 길)는 줄을 안 남긴다
 * 3. 가챠 → 그 직전의 장부 밖 변화가 기준 줄(`outside`)로, 가챠가 `action` 한 줄로 남는다
 * 4. 조회는 `action` 줄을 안 남긴다
 * 5. 표에 없는 길(요청 밖 = `tool`)로 금화를 늘린다 → 그 줄에 판정 `gold`
 * 6. 수 덧붙이기 틈 5번(`ai.intentsGap`, 문턱 5) → 거절 5줄
 * 7. 성장 스택 없이 레벨을 올린 계정(장부 밖) → 점검 대상
 * 8. 점검 → 이 계정에 `outside` · `source` · `invariant` · `reject` 징후, `create`는 없다
 * 9. 다시 점검 → 같은 일로 새 줄이 안 열린다
 * 끝나면 시험 계정을 지운다(장부 · 거절 · 징후 줄도 `on delete cascade`로 함께 간다).
 */
import { randomUUID } from 'node:crypto';
import type { OfficerId } from '@samchess/rules';
import { createProfile, gachaPullCost, squadsOf } from '../packages/meta/src/index.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, mutateProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { scanAnomalies } from '../packages/server-api/src/anomaly.ts';
import { refuseProduction } from './devOnly.ts';

refuseProduction('ledger_ux');

const API = process.env['SAMCHESS_API'] ?? 'http://localhost:8787';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SECRET = process.env['SUPABASE_SECRET_KEY']!;
const ANON = process.env['SUPABASE_ANON_KEY']!;

// 던진다 — `process.exit`는 `finally`(시험 계정 지우기)를 건너뛴다
const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`▶ ${m}`);

interface Row { id: string; source: string; phase: string; delta: Record<string, number>; unexpected: string[] | null }
const rows = async (uid: string, after = 0): Promise<Row[]> =>
  (await pool.query<Row>('select id, source, phase, delta, unexpected from account_ledger where uid = $1 and id > $2 order by id', [uid, after])).rows;
const lastId = async (uid: string): Promise<number> => Number((await rows(uid)).at(-1)?.id ?? 0);
const openOf = async (uid: string) =>
  (await pool.query<{ kind: string; key: string; hits: number }>("select kind, key, hits from anomalies where uid = $1 and status = 'open' order by kind, key", [uid])).rows;

const email = `ledger-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

try {
  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const token = (await login.json() as { access_token: string }).access_token;
  const call = (method: string, path: string, body?: unknown) => fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  step('1. 새 계정');
  const put = await call('PUT', '/profile', createProfile(`장부${randomUUID().slice(0, 6)}`, 42));
  if (!put.ok) fail(`PUT /profile → ${put.status}`);
  const r1 = await rows(uid);
  if (r1.length !== 1 || r1[0]!.phase !== 'create' || r1[0]!.source !== 'PUT /profile') fail(`create 한 줄이어야 — ${JSON.stringify(r1)}`);
  if (r1[0]!.unexpected) fail(`시작 꾸러미가 판정에 걸렸다 — ${r1[0]!.unexpected}`);
  ok(`create 한 줄 · 출처 ${r1[0]!.source} · 판정 없음`);

  step('2. 장부 밖 쓰기 — 도구 전용 길');
  const cost = gachaPullCost('single').gold;
  const mark2 = await lastId(uid);
  await saveProfileTrusted(uid, { ...(await getProfile(uid))!, gold: cost * 3 });
  if ((await rows(uid, mark2)).length) fail('saveProfileTrusted는 장부를 안 지난다 — 그런데 줄이 생겼다');
  ok('줄 없음');

  step('3. 가챠 — 직전의 장부 밖 변화가 먼저 잡힌다');
  const g = await call('POST', '/market/gacha', { kind: 'single' });
  if (!g.ok) fail(`POST /market/gacha → ${g.status} ${await g.text()}`);
  const r3 = await rows(uid, mark2);
  const outside = r3.find((r) => r.phase === 'baseline');
  if (!outside || !outside.unexpected?.includes('outside') || outside.delta['gold'] !== cost * 3) fail(`장부 밖 금화 +${cost * 3}이 기준 줄로 — ${JSON.stringify(r3)}`);
  ok(`기준 줄 · 판정 outside · ${JSON.stringify(outside.delta)}`);
  const act = r3.filter((r) => r.phase === 'action');
  if (act.length !== 1 || act[0]!.source !== 'POST /market/gacha' || act[0]!.delta['gold'] !== -cost || act[0]!.unexpected) {
    fail(`가챠 action 한 줄 · 판정 없음이어야 — ${JSON.stringify(act)}`);
  }
  ok(`action 한 줄 · ${JSON.stringify(act[0]!.delta)}`);

  step('4. 조회는 action 줄을 안 남긴다');
  const mark4 = await lastId(uid);
  if (!(await call('GET', '/profile')).ok) fail('GET /profile');
  if ((await rows(uid, mark4)).some((r) => r.phase === 'action')) fail('조회가 action 줄을 남겼다');
  ok('action 줄 없음');

  step('5. 표에 없는 길(요청 밖)로 금화를 늘린다');
  const mark5 = await lastId(uid);
  await mutateProfile(uid, (p) => ({ next: p ? { ...p, gold: p.gold + 500 } : null, value: null }));
  const r5 = (await rows(uid, mark5)).filter((r) => r.phase === 'action');
  if (r5.length !== 1 || r5[0]!.source !== 'tool' || !r5[0]!.unexpected?.includes('gold')) fail(`출처 tool · 판정 gold여야 — ${JSON.stringify(r5)}`);
  ok(`action 한 줄 · 출처 tool · 판정 ${r5[0]!.unexpected}`);

  step('6. 수 덧붙이기 틈 5번');
  const ready = withGarrisons({ ...(await getProfile(uid))!, tutorial: { done: ['basic-1', 'basic-2', 'basic-3'] } });
  await saveProfileTrusted(uid, ready);
  const squad = squadsOf(ready, '3v3')[0]!;
  const match = await call('POST', '/battle/ai-match', { mode: '3v3', picks: squad.picks, squadId: squad.id });
  if (!match.ok) fail(`ai-match → ${match.status} ${await match.text()}`);
  const start = await call('POST', '/battle/ai-start');
  if (!start.ok) fail(`ai-start → ${start.status} ${await start.text()}`);
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/battle/ai-intents', { from: 999, intents: [{ t: 'surrender' }] });
    const body = await r.json() as { code?: string };
    if (body.code !== 'ai.intentsGap') fail(`틈이 거절돼야 — ${r.status} ${JSON.stringify(body)}`);
  }
  const rejects = (await pool.query<{ n: string }>("select count(*) as n from account_rejects where uid = $1 and code = 'ai.intentsGap' and source = 'POST /battle/ai-intents'", [uid])).rows[0]!.n;
  if (Number(rejects) !== 5) fail(`거절 5줄이어야 — ${rejects}`);
  ok('거절 5줄 · 출처 POST /battle/ai-intents');

  step('7. 성장 스택 없이 레벨을 올린다(장부 밖)');
  const broken = structuredClone((await getProfile(uid))!);
  const officer = Object.keys(broken.roster)[0]! as OfficerId;
  broken.roster[officer]!.level = 3;
  await saveProfileTrusted(uid, broken);
  ok(`${officer} Lv3 · 성장 0`);

  step('8. 점검');
  const s1 = await scanAnomalies();
  if (!s1) fail('다른 점검이 돌고 있다');
  const open = await openOf(uid);
  const kinds = open.map((o) => `${o.kind}:${o.key}`);
  console.log(`  징후: ${kinds.join(' · ')}`);
  for (const want of ['outside:outside', 'source:tool:gold', `invariant:growth:level.${officer}`, 'reject:ai.intentsGap']) {
    if (!kinds.includes(want)) fail(`${want}이 떠야 한다`);
  }
  if (kinds.some((k) => k.startsWith('create:'))) fail('시작 꾸러미 그대로인 새 계정이 걸렸다');
  ok('outside · source · invariant · reject — create는 없다');

  step('9. 다시 점검 — 같은 일로 새 줄이 안 열린다');
  const before = open.length;
  await scanAnomalies();
  const again = await openOf(uid);
  if (again.length !== before) fail(`열린 징후 ${before} → ${again.length}`);
  ok(`열린 징후 ${again.length} 그대로 · 불변식은 다시 걸림(hits ${again.find((o) => o.kind === 'invariant')?.hits})`);

  console.log('\n✓ 변화 장부 · 이상 징후 확인 완주');
} finally {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });
  await pool.end();
}
