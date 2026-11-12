/**
 * **시장 아이템 낱개 추적표 · 들려 보내기 구멍 확인** (2026-11-12, `server-api/src/marketItems.ts`) — 시험 계정 하나로 진짜 게임 API를 지나
 * 낱개 줄이 맞게 남는지, 그리고 **산 적 없는 아이템을 들려 보내는 저장이 막히는지** 본다. 개발 DB(`.env`)만 쓴다.
 *
 *   SAMCHESS_API=http://localhost:8787 node --experimental-strip-types --env-file=.env tools/market_items_ux.ts
 *
 * 1. 추적표 전부터 있던 아이템(장부 밖으로 심음) → 첫 쓰기에 `baseline` 낱개
 * 2. 장바구니 구매 → `buy` 낱개, 금화 전 → 후가 차례로, 징후 없음
 * 3. 들려 보내기(`PUT`) → 보유자 · 양도일
 * 4. ★ 산 적 없는 아이템을 들려 보내는 `PUT` → 서버가 걷어 낸다 + 거절 `market.overCarry`
 * 5. 판이 열림(`/internal/grain` items) → 그 장수가 들던 낱개가 판에 나감 · 실제로 빠진 것만 돌려준다
 * 6. 판이 무름(refund) → 보유로 돌아옴 / 다시 나가 정산 → 사용으로 굳음
 * 7. 우편 보상 받기 → 낱개 · 장부 줄에 `mail:{id}`, 지급 대조 맞음
 * 8. ★ 감사 로그만 있고 계정이 안 바뀐 지급(일부러 만든다) → 대조 「안 들어감」 · 점검이 징후 `grant`
 * 끝나면 시험 계정을 지운다(추적표 · 장부 · 징후 줄도 `on delete cascade`로 함께 간다).
 */
import { randomUUID } from 'node:crypto';
import { marketItemById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { createProfile, settleCarried } from '../packages/meta/src/index.ts';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, mutateProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { scanAnomalies } from '../packages/server-api/src/anomaly.ts';
import { grantsOfAccount } from '../packages/server-api/src/grants.ts';
import { refuseProduction } from './devOnly.ts';

refuseProduction('market_items_ux');

const API = process.env['SAMCHESS_API'] ?? 'http://localhost:8787';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SECRET = process.env['SUPABASE_SECRET_KEY']!;
const ANON = process.env['SUPABASE_ANON_KEY']!;
const INTERNAL = process.env['INTERNAL_API_SECRET']!;

const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`▶ ${m}`);

const TANG = 'tang-yak', YEONG = 'yeong-gi';
const PRICE = (id: string) => marketItemById.get(id)!.gold;

interface Unit {
  unit: string; origin: string; status: string; holder: string | null; handed_at: Date | null; used_by: string | null; used_battle: string | null;
  gold_before: number | null; gold_after: number | null; price: number | null; bought_at: Date | null; flag: string | null;
}
const units = async (uid: string): Promise<Unit[]> =>
  (await pool.query<Unit>('select * from market_items where uid = $1 order by item, seq', [uid])).rows;
const byId = async (uid: string, unit: string): Promise<Unit> => (await units(uid)).find((u) => u.unit === unit) ?? fail(`${unit} 줄이 없다`);

const email = `market-ux-${randomUUID()}@samchess.test`;
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
  const internal = (body: unknown) => fetch(`${API}/internal/grain`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL }, body: JSON.stringify(body),
  });

  const put0 = await call('PUT', '/profile', createProfile(`추적${randomUUID().slice(0, 6)}`, 7));
  if (!put0.ok) fail(`PUT /profile → ${put0.status}`);
  const officers = Object.keys((await getProfile(uid))!.roster).sort() as OfficerId[];
  const [A, B, C] = officers as [OfficerId, OfficerId, OfficerId];

  step('1. 추적표 전부터 있던 아이템 — 첫 쓰기에 baseline');
  const seeded = (await getProfile(uid))!;
  // 장부 밖(도구 전용 길)으로 시장 Lv5 · 금화 · 영기 1개(구매 시각 있음)를 심는다
  await saveProfileTrusted(uid, {
    ...seeded, gold: 1000, buildings: { ...seeded.buildings, market: 5 },
    marketOwned: { [YEONG]: 1 }, marketBoughtAt: { [YEONG]: [Date.UTC(2026, 10, 1)] },
  });
  if ((await units(uid)).length) fail('장부 밖 쓰기가 추적표를 지났다');
  const buy = await call('POST', '/market/items', { basket: { [TANG]: 2 } });
  if (!buy.ok) fail(`POST /market/items → ${buy.status} ${await buy.text()}`);
  const y = await byId(uid, `${YEONG}#1`);
  if (y.origin !== 'baseline' || y.bought_at?.getTime() !== Date.UTC(2026, 10, 1) || y.flag) fail(`baseline 줄이 이상하다 — ${JSON.stringify(y)}`);
  ok(`${YEONG}#1 · baseline · 구매일 ${y.bought_at.toISOString().slice(0, 10)}`);

  step('2. 장바구니 구매 — 금화 전 → 후');
  const t1 = await byId(uid, `${TANG}#1`), t2 = await byId(uid, `${TANG}#2`);
  const p = PRICE(TANG);
  if (t1.origin !== 'buy' || t1.gold_before !== 1000 || t1.gold_after !== 1000 - p || t1.price !== p) fail(`#1 — ${JSON.stringify(t1)}`);
  if (t2.gold_before !== 1000 - p || t2.gold_after !== 1000 - 2 * p) fail(`#2 — ${JSON.stringify(t2)}`);
  if (t1.flag || t2.flag) fail('정상 구매가 징후에 걸렸다');
  ok(`#1 ${t1.gold_before}→${t1.gold_after} · #2 ${t2.gold_before}→${t2.gold_after} (값 ${p})`);

  step('3. 들려 보내기 — 보유자 · 양도일');
  const cur = (await getProfile(uid))!;
  const put1 = await call('PUT', '/profile', { ...cur, marketCarry: { [B]: TANG } });
  if (!put1.ok) fail(`PUT → ${put1.status}`);
  const h = await byId(uid, `${TANG}#1`);
  if (h.holder !== B || !h.handed_at) fail(`보유자 · 양도일 — ${JSON.stringify(h)}`);
  ok(`${TANG}#1 → ${B}`);

  step('4. ★ 산 적 없는 아이템을 들려 보낸다 — 서버가 걷는다');
  const rejBefore = Number((await pool.query("select count(*) n from account_rejects where uid = $1 and code = 'market.overCarry'", [uid])).rows[0].n);
  const forged = { ...(await getProfile(uid))!, marketCarry: { [A]: TANG, [B]: TANG, [C]: TANG } };   // 탕약 2개인데 셋에게 + 아래 영기 없는 척
  const put2 = await call('PUT', '/profile', forged);
  if (!put2.ok) fail(`PUT → ${put2.status}`);
  const after = (await getProfile(uid))!;
  const carried = Object.values(after.marketCarry ?? {}).filter((x) => x === TANG).length;
  if (carried !== 2) fail(`가진 2개보다 많이 남았다 — ${JSON.stringify(after.marketCarry)}`);
  const rejAfter = Number((await pool.query("select count(*) n from account_rejects where uid = $1 and code = 'market.overCarry'", [uid])).rows[0].n);
  if (rejAfter !== rejBefore + 1) fail('거절 market.overCarry가 안 남았다');
  ok(`셋 → 둘로 걷음 (${JSON.stringify(after.marketCarry)}) · 거절 기록 1`);

  step('5. 판이 열림 — 들던 낱개가 나가고, 실제로 빠진 것만 돌려준다');
  const holderOf1 = (await byId(uid, `${TANG}#1`)).holder!;
  const res = await internal({ uid, mode: '3v3', action: 'items', officers: [holderOf1] });
  if (!res.ok) fail(`/internal/grain → ${res.status}`);
  const body = await res.json() as { carried?: Record<string, string> };
  if (JSON.stringify(body.carried) !== JSON.stringify({ [holderOf1]: TANG })) fail(`돌려준 것 — ${JSON.stringify(body)}`);
  const played = await byId(uid, `${TANG}#1`);
  if (played.status !== 'inPlay' || played.used_by !== holderOf1 || played.used_battle !== 'online') fail(`판에 나간 줄 — ${JSON.stringify(played)}`);
  ok(`${TANG}#1 · 판에 나감 · 사용자 ${played.used_by}`);
  // 안 들린 장수(C)만 내보내면 아무것도 안 빠진다
  const none = await (await internal({ uid, mode: '3v3', action: 'items', officers: [C] })).json() as { carried?: Record<string, string> };
  if (Object.keys(none.carried ?? {}).length) fail(`안 든 장수에게서 빠졌다 — ${JSON.stringify(none)}`);
  ok('안 든 장수 → 빠진 것 없음');

  step('6. 무르면 돌아오고, 끝나면 사용으로 굳는다');
  await internal({ uid, mode: '3v3', action: 'refund' });
  const back = await byId(uid, `${TANG}#1`);
  if (back.status !== 'held' || back.used_by) fail(`환불 — ${JSON.stringify(back)}`);
  ok(`${TANG}#1 · 보유로 돌아옴`);
  // 다시 들려 보내 내보낸 뒤 정산(도구 길 — 판 정산과 같은 settleCarried)
  const again = (await getProfile(uid))!;
  await call('PUT', '/profile', { ...again, marketCarry: { [A]: TANG } });
  await internal({ uid, mode: '3v3', action: 'items', officers: [A] });
  const goneUnit = (await units(uid)).find((u) => u.status === 'inPlay') ?? fail('다시 나간 낱개가 없다');
  await mutateProfile(uid, (pr) => { const n = settleCarried(pr!, true, 'online'); return { next: n, value: n }; });
  const used = await byId(uid, goneUnit.unit);
  if (used.status !== 'used' || used.used_by !== A) fail(`사용 — ${JSON.stringify(used)}`);
  ok(`${used.unit} · 사용 · 사용자 ${used.used_by}`);

  step('7. 우편 보상 — 지급 · 우편 번호가 장부 줄 · 낱개에 이어지고 대조가 맞는다');
  const mailId = Number((await pool.query<{ id: string }>(
    `insert into mail (expires_at, target_uid, title, body, rewards, sent_by) values (now() + interval '1 day', $1, $2, $3, $4, 'market_items_ux') returning id`,
    [uid, JSON.stringify({ ko: '추적 시험' }), JSON.stringify({ ko: '본문' }), JSON.stringify([{ kind: 'item', item: YEONG, delta: 1 }])])).rows[0]!.id);
  const claim = await call('POST', `/mail/${mailId}/claim`);
  if (!claim.ok) fail(`우편 받기 → ${claim.status} ${await claim.text()}`);
  const mailUnit = (await units(uid)).find((u) => u.origin === 'mail') ?? fail('우편 낱개가 없다');
  if ((mailUnit as Unit & { ref: string | null }).ref !== `mail:${mailId}`) fail(`낱개의 짝 — ${JSON.stringify(mailUnit)}`);
  const lref = (await pool.query<{ ref: string | null }>("select ref from account_ledger where uid = $1 and source = 'POST /mail/:id/claim' order by id desc limit 1", [uid])).rows[0];
  if (lref?.ref !== `mail:${mailId}`) fail(`장부 줄의 짝 — ${JSON.stringify(lref)}`);
  const checks = await grantsOfAccount(pool, uid);
  const mailCheck = checks.find((g) => g.ref === `mail:${mailId}`) ?? fail(`대조에 우편이 없다 — ${JSON.stringify(checks)}`);
  if (mailCheck.status !== 'ok') fail(`우편 대조 — ${JSON.stringify(mailCheck)}`);
  ok(`${mailUnit.unit} · 지급(우편 #${mailId}) · 대조 맞음`);

  step('8. ★ 지급했다는 감사 로그만 있고 계정은 안 바뀌었다 — 대조가 「안 들어감」, 점검이 징후로');
  const fakeAudit = Number((await pool.query<{ id: string }>(
    `insert into admin_audit_log (admin_uid, admin_email, target_uid, action, params, reason) values ($1, 'market_items_ux@samchess.test', $1, 'adjust.gold', $2, '대조 시험') returning id`,
    [uid, JSON.stringify({ kind: 'gold', delta: 500 })])).rows[0]!.id);
  const missing = (await grantsOfAccount(pool, uid)).find((g) => g.ref === `audit:${fakeAudit}`);
  if (missing?.status !== 'missing') fail(`대조 — ${JSON.stringify(missing)}`);
  ok(`감사 #${fakeAudit} · 안 들어감`);
  const scanned = await scanAnomalies();
  if (!scanned) fail('다른 점검이 돌고 있다 — 다시 돌릴 것');
  const grantAnomaly = (await pool.query<{ key: string }>("select key from anomalies where uid = $1 and kind = 'grant' and status = 'open'", [uid])).rows;
  if (!grantAnomaly.some((a) => a.key === `missing:audit:${fakeAudit}`)) fail(`징후 — ${JSON.stringify(grantAnomaly)}`);
  ok(`점검 #${scanned.scanId} → 징후 grant ${grantAnomaly.map((a) => a.key).join(', ')}`);
  await pool.query('delete from admin_audit_log where id = $1', [fakeAudit]);
  await pool.query('delete from mail where id = $1', [mailId]);

  const flagged = (await units(uid)).filter((u) => u.flag);
  if (flagged.length) fail(`정상 흐름에 징후 — ${JSON.stringify(flagged)}`);
  const open = (await pool.query("select key from anomalies where uid = $1 and kind = 'market'", [uid])).rows;
  if (open.length) fail(`market 징후가 열렸다 — ${JSON.stringify(open)}`);
  ok('정상 흐름 — market 징후 없음');
  console.log('\n✓ 시장 아이템 추적표 확인 완주');
} finally {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });
  await pool.end();
}
