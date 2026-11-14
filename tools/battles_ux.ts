/**
 * 관리자 「전투」 눈 확인 (2026-11-13) — 다섯 갈래의 판을 **진짜로** 세워 두고 `GET /admin/battles`와 화면을 본다.
 *
 *   npm run look:battles      (= node --env-file=.env tools/battles_ux.ts [--out 폴더])
 *
 * 떠 있어야 하는 것 — 관리자 화면(5174) · 관리자 API(8788) · 게임 API · 대전 서버. 다른 세션이 8787 · 2567을 쓰고 있으면
 * 제 것을 따로 띄우고 주소를 넘긴다: `SAMCHESS_SERVER=ws://localhost:2568`(대전 서버 · 관리자 API 둘 다) · `GAME_API=http://localhost:8789`.
 *
 * 세우는 것 — 사람 대 사람 방 하나(계정 둘이 대전 서버의 고정 방에 직접 붙어 편성) · AI 대전(시작 70분 전 — 방치) · 공성전(수성전 판) ·
 * 도적떼 · 튜토리얼 핑(같은 판 두 번 → 시작 시각이 그대로인가, 다른 판 → 다시 찍히는가). 끝나면 방을 떠나고 계정을 지운다.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { chromium } from 'playwright';
import { SORTIE_TUTORIALS, S_TUTORIAL_OFFICERS, createProfile, makeAiOpponent, matchAiBattle, resolvePolicy, sTutorialId, startAiBattle } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';
import { adminSession, cleanupUsers, makeAdmin, makeUser } from './adminLook.ts';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]! : join(tmpdir(), 'samchess-battles-look');
mkdirSync(OUT, { recursive: true });
const WS = process.env['SAMCHESS_SERVER'] ?? 'ws://localhost:2567';
const GAME_API = process.env['GAME_API'] ?? 'http://localhost:8787';
const ADMIN_API = process.env['ADMIN_API'] ?? 'http://localhost:8788';
const ADMIN_WEB = process.env['ADMIN_WEB'] ?? 'http://localhost:5174';

const rooms: Room[] = [];
const ok = (m: string) => console.log(`✓ ${m}`);

const city = (tag: string) => `전투${tag}-${randomUUID().slice(0, 4)}`;
const base = (tag: string, seed: number): PlayerProfile =>
  ({ ...withGarrisons(createProfile(city(tag), seed)), grainAt: Date.now(), tutorial: { done: [...SORTIE_TUTORIALS] } });

/** AI 대전을 굳힌 계정 — `startedAt`을 과거로 주면 방치된 판 */
function withAi(p: PlayerProfile, startedAt: number, seed: number): PlayerProfile {
  const squad = p.squads.find((s) => s.mode === '3v3')!;
  const m = matchAiBattle(p, '3v3', squad.picks, squad.id, seed);
  if (!m.ok) throw new Error(`상대 찾기 실패 ${m.reason}`);
  const s = startAiBattle({ ...m.profile, grain: 999 }, startedAt);
  if (!s.ok) throw new Error(`시작 실패 ${s.reason}`);
  return s.profile;
}

async function ping(token: string, tutorial: string | null) {
  const r = await fetch(`${GAME_API}/presence`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ busy: !!tutorial, tutorial }),
  });
  assert.equal(r.status, 200, `핑 ${r.status}`);
}
const tutorialRow = async (uid: string) =>
  (await pool.query<{ tutorial: string | null; tutorial_at: Date | null }>('select tutorial, tutorial_at from presence where uid = $1', [uid])).rows[0];

try {
  const admin = await makeAdmin('battles');
  const [a, b, c, d, t] = await Promise.all(['a', 'b', 'c', 'd', 't'].map((x) => makeUser('battles', x)));

  // ── 계정 셋: 도시 · 수비군. c는 방치된 AI 대전 + 도적떼, d는 c를 치는 공성전 ──
  for (const [u, s] of [[a, 1], [b, 2], [t, 5]] as const) await saveProfileTrusted(u.uid, base(u.email.slice(8, 9), s));
  const now = Date.now();
  const pc = withAi(base('c', 3), now - 70 * 60_000, 31);
  const guards = pc.squads.find((s) => s.mode === '3v3')!.picks;
  await saveProfileTrusted(c.uid, {
    ...pc,
    raid: { day: '2026-11-13', bandits: 3, spawnedAt: now - 5 * 60_000, grainAtSpawn: 100, status: 'fighting',
      battle: { seed: 9, startedAt: now - 4 * 60_000, guards, intents: [] } },
  });
  const pd = withAi(base('d', 4), now - 2 * 60_000, 41);
  const dSquad = pc.squads.find((s) => s.mode === '3v3')!;
  await saveProfileTrusted(d.uid, {
    ...pd,
    aiBattle: { ...pd.aiBattle!, defender: { uid: c.uid, cityName: pc.cityName!, cityLevel: 1, squadName: dSquad.name, deploy: null, policy: resolvePolicy(pc, dSquad) } },
  });
  ok('계정 다섯 — 사람 대 사람 둘 · AI 대전(70분 전) + 도적떼 · 공성전 · 튜토리얼');

  // ── 튜토리얼 핑: 같은 판은 시작 시각을 그대로, 다른 판이면 다시 ──
  await ping(t.token, 'basic-2');
  const t1 = await tutorialRow(t.uid);
  assert.equal(t1?.tutorial, 'basic-2');
  await new Promise((r) => setTimeout(r, 1100));
  await ping(t.token, 'basic-2');
  assert.equal((await tutorialRow(t.uid))?.tutorial_at?.getTime(), t1!.tutorial_at!.getTime(), '같은 판인데 시작 시각이 바뀌었다');
  const sId = sTutorialId(S_TUTORIAL_OFFICERS[0]!);
  await ping(t.token, sId);
  const t2 = await tutorialRow(t.uid);
  assert.equal(t2?.tutorial, sId);
  assert.ok(t2!.tutorial_at!.getTime() > t1!.tutorial_at!.getTime(), '다른 판인데 시작 시각이 그대로다');
  await ping(t.token, 'not-a-tutorial');
  assert.equal((await tutorialRow(t.uid))?.tutorial, null, '모르는 id는 없는 것으로');
  await ping(t.token, sId);
  ok(`튜토리얼 핑 — 같은 판은 시작 시각 그대로 · 다른 판은 다시 · 모르는 id는 비움 (지금 ${sId})`);

  // ── 대전 서버: 비밀 없이는 401, 사람 대 사람 방 하나 ──
  const httpBase = WS.replace(/^ws/, 'http');
  assert.equal((await fetch(`${httpBase}/internal/battles`)).status, 401);
  assert.equal((await fetch(`${httpBase}/internal/nope`, { headers: { 'x-internal-secret': process.env['INTERNAL_API_SECRET']! } })).status, 404);
  ok('대전 서버 내부 길 — 비밀 없으면 401 · 모르는 길 404');
  const roomName = `look-${randomUUID().slice(0, 6)}`;
  for (const [u, seed] of [[a, 11], [b, 12]] as const) {
    const cl = new Client(WS);
    cl.auth.token = u.token;
    const room = await cl.joinOrCreate('battle', { mode: '3v3', room: roomName });
    room.onMessage('*', () => {});
    rooms.push(room);
    const opp = makeAiOpponent('3v3', 800, seed);
    room.send('enlist', { enlist: { playerId: 'ignored', entries: opp.entries, squadName: `부대${seed}`, power: opp.power, deploy: null } });
  }

  // ── 관리자 API ── 방은 아이템을 빼고 나서 열린다(게임 API 왕복) — 열릴 때까지 다시 묻는다
  type Res = import('../packages/server-api/src/admin/types.ts').AdminBattlesResponse;
  let body: Res | null = null;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${ADMIN_API}/admin/battles`, { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(res.status, 200, `관리자 API ${res.status}`);
    body = (await res.json()) as Res;
    if (body.rows.some((r) => r.via === 'queue' && r.attacker.player && [a.uid, b.uid].includes(r.attacker.player.uid))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!body) throw new Error('응답 없음');
  assert.ok(body.rooms.ok, `대전 서버에 못 닿았다: ${JSON.stringify(body.rooms)}`);
  const mine = body.rows.filter((r) => [a, b, c, d, t].some((u) => r.attacker.player?.uid === u.uid));
  const kinds = mine.map((r) => `${r.kind}${r.via ? `/${r.via}` : ''}`).sort();
  assert.deepEqual(kinds, ['field/ai', 'field/queue', 'raid', 'siege', 'tutorial'], `줄이 다르다: ${kinds}`);
  const q = mine.find((r) => r.via === 'queue')!;
  assert.deepEqual([q.attacker.player?.uid, q.defender?.player?.uid].sort(), [a.uid, b.uid].sort());
  assert.equal(q.phase, 'deploy');
  assert.equal(q.attacker.room?.total, 3);
  const ai = mine.find((r) => r.via === 'ai')!;
  assert.ok(new Date(ai.autoEndAt!).getTime() < Date.now(), '70분 전 판인데 자동 정산 시각이 안 지났다');
  const sg = mine.find((r) => r.kind === 'siege')!;
  assert.equal(sg.defender?.player?.uid, c.uid);
  assert.equal(sg.siegeFort, true);
  assert.equal(mine.find((r) => r.kind === 'raid')!.bandits, 3);
  assert.equal(mine.find((r) => r.kind === 'tutorial')!.tutorial, sId);
  ok('관리자 API — 대기열 방(배치 · 3명) · AI(방치) · 공성전(수비 c · 수성전) · 도적떼(3) · 튜토리얼(S급) 다섯 줄');

  // ── 화면 ──
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await adminSession(page, admin);
  await page.goto(`${ADMIN_WEB}/#/battles`);
  await page.waitForSelector('table[data-battles="field"] tbody tr[data-key]', { timeout: 15_000 }).catch(async (e: Error) => {
    await page.screenshot({ path: join(OUT, 'battles-fail.png'), fullPage: true });
    throw new Error(`화면에 줄이 안 뜬다 — ${join(OUT, 'battles-fail.png')} (${e.message.split(String.fromCharCode(10))[0]})`);
  });
  for (const k of ['field', 'siege', 'raid', 'tutorial']) {
    await page.click(`.tabs button[data-tab="${k}"]`);
    await page.waitForSelector(`table[data-battles="${k}"] tbody tr[data-key]`);
    const over = await page.evaluate(() => { const w = document.querySelector('.tablewrap')!; return w.scrollWidth - w.clientWidth; });
    await page.screenshot({ path: join(OUT, `battles-${k}.png`), fullPage: true });
    console.log(`  📷 battles-${k}.png (가로 넘침 ${over}px)`);
  }
  await browser.close();
  ok(`화면 네 탭 — ${OUT}`);
} finally {
  for (const r of rooms) await r.leave(true).catch(() => {});
  await cleanupUsers();
  await pool.end().catch(() => {});
}
