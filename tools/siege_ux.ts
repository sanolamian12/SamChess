/**
 * 공성전 눈 확인 · 흐름 검사 (2026-10-27, GDD §8.8 단계 2) — **시험 계정 넷 · 진짜 DB**로 한 판을 끝까지 민다.
 *
 *   npm run smoke:siege-ux -- [--url http://localhost:5173] [--out 폴더]
 *
 * dev 화면과 그 화면이 부르는 server-api가 **새 코드로** 떠 있어야 한다(스모크처럼 제 안에서 띄우지 않는다).
 *
 * 계정 — 공격(A, 도시 Lv2) · 같은 레벨 수비(D, Lv2, 3v3 수비군의 북군 배치를 **기본과 다르게**) · 낮은 도시(L, Lv1) · 높은 도시(U, Lv3)
 *        · 접속 중인 같은 레벨(O, Lv2, 수비군 전투력이 **D보다 낮은** 시드 — 위에 서는 까닭이 정렬이어야 한다).
 *  1. 서버 목록 — 추천에 D만, 상위 도전에 U만, L은 어디에도 없다(`listSiegeTargets` — SQL + `pickSiegeRows`)
 *  1-1. 접속 표시(단계 3) — O가 `online`이고 추천의 접속 중 도시 묶음(맨 위)에 선다 · `/siege/match`가 O를 `siege.online`으로 거절한다
 *  2-1. 화면 — 로그인한 A의 핑이 `presence`에 닿았다 · O의 줄에 초록 점 · 상세에 [선전포고](단계 4 — 흐름은 `war_ux.ts`) · 마지막 핑을 2분 전으로 되돌리면
 *       서버 목록 · 화면 모두 꺼지고 [전투준비]가 선다 · 그 상세를 든 채 O가 다시 접속하면 [전투준비]가 「방금 접속」으로 거절되고
 *       상세가 선전포고 모양으로 바뀐다(판도 군량도 그대로)
 *  2. 화면 — [출정하기] → 3v3 → 부대 → [대전상대 찾기] → 도시 목록 → D의 줄 → 상세 → [전투준비] → 판
 *  3. 판 — 북군 장수가 **D가 저장한 배치**에 섰다 · 서버에 굳힌 판에 방어자가 실렸다
 *  4. 항복 → 결과 · 이력은 공성전(상대 = D) · `defense_log`에 D의 승리(P2) 한 줄 · 그 판의 수와 배치가 실렸다
 * 끝나면(실패해도) 계정을 지운다 — 방어 기록은 `on delete cascade`로 함께 사라진다.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { BASIC_TUTORIALS, PRESENCE_ONLINE_MS, createProfile, defaultSquadCells, garrisonOf, garrisonSnapshot, withDeployment } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { listSiegeTargets, matchSiegeAction } from '../packages/server-api/src/siege.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const BASE = flag('url', 'http://localhost:5173');
const OUT = flag('out', join(tmpdir(), 'samchess-siege-ux'));
mkdirSync(OUT, { recursive: true });

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY'];
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('✗ .env에 SUPABASE_URL · SUPABASE_SECRET_KEY가 있어야 한다');
  process.exit(1);
}

const uids: string[] = [];
let browser: Browser | null = null;
let failed = false;
const ok = (msg: string): void => console.log(`✓ ${msg}`);
class Stop extends Error {}
const fail = (msg: string): never => { failed = true; console.error(`✗ ${msg}`); throw new Stop(msg); };

async function cleanup(): Promise<void> {
  await browser?.close().catch(() => {});
  await Promise.all(uids.map((uid) => fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  })));
  await pool.end().catch(() => {});
  if (uids.length) console.log(`✓ 시험 계정 ${uids.length}개 정리`);
}

/** 계정 하나 — 기본 튜토리얼을 끝냈고 3v3 · 5v5 수비군이 선 도시 */
async function account(tag: string, level: number, shape: (p: PlayerProfile) => PlayerProfile = (p) => p, seed = 7 + level):
  Promise<{ uid: string; email: string; password: string; profile: PlayerProfile }> {
  const email = `siege-${tag}-${randomUUID()}@samchess.test`;
  const password = randomUUID();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) fail(`「${tag}」 계정 생성 실패 — ${res.status} ${await res.text()}`);
  const { id } = await res.json() as { id: string };
  uids.push(id);
  const base = createProfile(`공성-${tag}-${randomUUID().slice(0, 4)}`, seed);
  const profile = shape(withGarrisons({
    ...base, cityLevel: level, grain: 20, grainAt: Date.now(), tutorial: { done: [...BASIC_TUTORIALS] },
  }));
  await saveProfileTrusted(id, profile);
  return { uid: id, email, password, profile };
}

/** 3v3 수비군의 북군 배치 — 첫 두 장수의 자리를 맞바꾼다(기본 배치와 다르게) */
function swapNorth(p: PlayerProfile): PlayerProfile {
  const squad = garrisonOf(p, '3v3')!;
  const cells = defaultSquadCells('3v3', 'P2', squad.picks);
  const swapped = cells.map((c, i) => (i === 0 ? { ...c, x: cells[1]!.x, y: cells[1]!.y } : i === 1 ? { ...c, x: cells[0]!.x, y: cells[0]!.y } : c));
  return { ...p, squads: p.squads.map((s) => (s.id === squad.id ? withDeployment(s, 'P2', swapped) : s)) };
}

/** 3v3 수비군 전투력 — 계정을 만들기 전에 시드를 고르려고(서버가 표에 쓰는 것과 같은 `garrisonSnapshot`) */
const power3 = (seed: number): number => garrisonSnapshot(withGarrisons(createProfile('x', seed)), '3v3')!.power;

/** 마지막 핑을 적는다 — `agoMs`만큼 지난 시각으로(0이면 지금). 시각은 DB 시계다(서버가 핑을 찍는 것과 같다) */
async function seen(uid: string, agoMs: number): Promise<void> {
  await pool.query(
    `insert into presence (uid, last_seen_at) values ($1, now() - make_interval(secs => $2))
       on conflict (uid) do update set last_seen_at = excluded.last_seen_at`,
    [uid, agoMs / 1000],
  );
}

async function shot(page: Page, name: string): Promise<void> {
  const frame = await page.$('#frame');
  await (frame ?? page).screenshot({ path: join(OUT, `${name}.png`) });
}

try {
  const A = await account('A', 2);
  const D = await account('D', 2, swapNorth);
  const L = await account('L', 1);
  const U = await account('U', 3);
  // O — D보다 전투력이 낮은 시드. 높으면 「맨 위」가 정렬 없이도 참이 되어 검사가 아무것도 안 본다
  const oSeed = Array.from({ length: 60 }, (_, i) => i + 1).find((sd) => power3(sd) < power3(7 + 2));
  if (oSeed === undefined) fail('D보다 약한 수비군 시드를 못 찾았다');
  const O = await account('O', 2, (p) => p, oSeed);
  await seen(O.uid, 0);

  // ── 1. 서버 목록 ──
  const rec = (await listSiegeTargets(A.uid, '3v3', 'recommended'))!;
  const upp = (await listSiegeTargets(A.uid, '3v3', 'upper'))!;
  const ids = (rows: { defenderId: string }[]) => new Set(rows.map((r) => r.defenderId));
  if (!ids(rec).has(D.uid)) fail('같은 레벨 도시(D)가 추천에 없다');
  if (ids(rec).has(U.uid) || ids(rec).has(L.uid)) fail('추천에 다른 레벨 도시가 섞였다');
  if (!ids(upp).has(U.uid)) fail('높은 도시(U)가 상위 도전에 없다');
  if (ids(upp).has(D.uid) || ids(upp).has(L.uid)) fail('상위 도전에 같거나 낮은 도시가 섞였다');
  if (ids(rec).has(A.uid) || ids(upp).has(A.uid)) fail('내 도시가 목록에 있다');
  if (rec.some((r) => r.cityLevel !== 2) || upp.some((r) => r.cityLevel <= 2)) fail('탭의 도시 레벨이 규칙과 다르다');
  const dRow = rec.find((r) => r.defenderId === D.uid)!;
  ok(`서버 목록 — 추천 ${rec.length}곳(D 포함 · 전투력 ${dRow.power}) · 상위 도전 ${upp.length}곳(U 포함) · 낮은 도시 L은 어디에도 없다`);

  // ── 1-1. 접속 표시 ──
  const oRow = rec.find((r) => r.defenderId === O.uid);
  if (!oRow?.online) fail(`접속 중인 O가 online이 아니다 — ${JSON.stringify(oRow && { online: oRow.online })}`);
  if (dRow.online) fail('핑이 없는 D가 online이다');
  if (oRow!.power >= dRow.power) fail(`O(${oRow!.power})가 D(${dRow.power})보다 약하지 않다 — 정렬을 못 본다`);
  const oAt = rec.indexOf(oRow!);
  if (rec.slice(0, oAt).some((r) => !r.online)) fail(`O 앞에 미접속 도시가 있다 — 접속 중인 도시가 위가 아니다 (O는 ${oAt + 1}번째)`);
  if (rec.indexOf(dRow) < oAt) fail('전투력이 높은 미접속 D가 접속 중인 O보다 위다');
  const refused = await matchSiegeAction(A.uid, O.uid, '3v3', garrisonOf(A.profile, '3v3')!.picks, null);
  if (refused.ok || refused.code !== 'siege.online') fail(`접속 중인 O를 공성전으로 칠 수 있다 — ${JSON.stringify(refused)}`);
  ok(`접속 표시 — O(전투력 ${oRow!.power} < D ${dRow.power})가 online으로 ${oAt + 1}번째(앞은 전부 접속 중) · /siege/match가 siege.online으로 거절`);

  // ── 2. 화면 ──
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 700, height: 1000 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('.scr-title [data-action="loginOpen"]');
  await page.fill('[data-modal="login"] [data-field="email"]', A.email);
  await page.fill('[data-modal="login"] [data-field="password"]', A.password);
  await page.click('[data-modal="login"] [data-action="enter"]');
  await page.waitForSelector('.scr-main', { timeout: 20_000 }).catch(() => fail('로그인했는데 메인이 안 뜬다'));
  // 입장 하늘(`EnterSky`)이 걷힌 뒤에 누른다 — 덮인 채 `force`로 누르면 아무 일도 없다
  await page.waitForFunction(() => !document.getElementById('frame')?.hasAttribute('data-sky'), undefined, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.click('[data-action="sortie"]');
  await page.click('[data-mode="3v3"]');
  await page.click('.srt-row [data-action="pickSquad"]');
  await page.click('[data-action="seek"]');
  await page.waitForSelector('[data-screen="siege"][data-load="ok"]', { timeout: 15_000 }).catch(() => fail('도시 목록이 안 선다'));
  // D의 줄을 찾을 때까지 쪽을 넘긴다 — 개발 DB에 같은 레벨 도시가 더 있을 수 있다
  for (let i = 0; i < 10 && !await page.$(`[data-city="${D.uid}"]`); i++) {
    const next = await page.$('.scr-siege .srt-list [data-action="nextPage"]:not([disabled])');
    if (!next) break;
    await next.click();
  }
  if (!await page.$(`.srt-row[data-city="${D.uid}"]`)) fail('화면 목록에 D가 없다');
  const shown = await page.evaluate((uid) => {
    const row = document.querySelector(`.srt-row[data-city="${uid}"]`)!;
    const f = (k: string) => row.querySelector(`[data-field="${k}"]`)!;
    return { level: row.getAttribute('data-level'), tier: row.getAttribute('data-tier'), power: Number(f('power').getAttribute('data-power')), members: f('members').textContent!.split(',').length };
  }, D.uid);
  if (shown.level !== '2' || shown.power !== dRow.power || shown.members !== 3 || !shown.tier) fail(`D의 줄이 서버 값과 다르다 — ${JSON.stringify(shown)}`);
  await shot(page, 's1-list-recommended');
  await page.click('[data-tab="upper"]');
  await page.waitForSelector('[data-screen="siege"][data-tab="upper"][data-load="ok"]', { timeout: 15_000 }).catch(() => fail('상위 도전 탭이 안 선다'));
  if (await page.$(`.srt-row[data-city="${D.uid}"]`)) fail('상위 도전 탭에 같은 레벨 D가 있다');
  await shot(page, 's2-list-upper');
  await page.click('[data-tab="recommended"]');
  await page.waitForSelector('[data-screen="siege"][data-tab="recommended"][data-load="ok"]', { timeout: 15_000 });
  for (let i = 0; i < 10 && !await page.$(`[data-city="${D.uid}"]`); i++) await page.click('.scr-siege .srt-list [data-action="nextPage"]');
  ok(`화면 목록 — D의 줄(Lv${shown.level} · ${shown.power} · ${shown.tier}) · 탭을 바꾸면 빠진다`);

  // ── 2-1. 화면의 접속 표시 ──
  const pinged = await pool.query(`select 1 from presence where uid = $1 and last_seen_at > now() - interval '2 minutes'`, [A.uid]);
  if (!pinged.rowCount) fail('로그인한 A의 핑이 presence에 없다');
  /** 목록을 다시 받는다(탭을 갔다 온다) — 그리고 그 도시의 줄이 보일 때까지 쪽을 넘긴다 */
  const reloadTo = async (uid: string): Promise<void> => {
    await page.click('[data-tab="upper"]');
    await page.waitForSelector('[data-screen="siege"][data-tab="upper"][data-load="ok"]', { timeout: 15_000 });
    await page.click('[data-tab="recommended"]');
    await page.waitForSelector('[data-screen="siege"][data-tab="recommended"][data-load="ok"]', { timeout: 15_000 });
    for (let i = 0; i < 10 && !await page.$(`.srt-row[data-city="${uid}"]`); i++) {
      const next = await page.$('.scr-siege .srt-list [data-action="nextPage"]:not([disabled])');
      if (!next) break;
      await next.click();
    }
    if (!await page.$(`.srt-row[data-city="${uid}"]`)) fail(`화면 목록에 ${uid}가 없다`);
  };
  const dotOf = (uid: string) => page.getAttribute(`.srt-row[data-city="${uid}"] [data-field="presence"]`, 'data-online');
  await reloadTo(O.uid);
  if (await dotOf(O.uid) !== '1') fail('O의 줄에 접속 점이 없다');
  await shot(page, 's2b-list-online');
  await page.click(`.srt-row[data-city="${O.uid}"] [data-action="openCity"]`);
  await page.waitForSelector('[data-modal="siegeTarget"][data-online="1"]', { timeout: 5_000 }).catch(() => fail('O의 상세가 접속 중 모양이 아니다'));
  if (!await page.$('[data-modal="siegeTarget"] [data-action="declare"]:not([disabled])')) fail('O의 상세에 [선전포고]가 없다');
  if (await page.$('[data-modal="siegeTarget"] [data-action="siegeReady"]')) fail('접속 중인 O의 상세에 [전투준비]가 있다');
  if (!await page.$('[data-modal="siegeTarget"] [data-field="declareHint"]')) fail('선전포고 안내가 없다');
  await shot(page, 's2c-target-online');
  await page.click('[data-action="siegeClose"]');

  // 2분 전으로 되돌리면 꺼진다 — 서버도 화면도
  await seen(O.uid, PRESENCE_ONLINE_MS + 5_000);
  const recOff = (await listSiegeTargets(A.uid, '3v3', 'recommended'))!;
  if (recOff.find((r) => r.defenderId === O.uid)?.online !== false) fail('마지막 핑이 2분 전인데 O가 아직 online이다');
  await reloadTo(O.uid);
  if (await dotOf(O.uid) !== '0') fail('되돌린 뒤에도 O의 점이 초록이다');
  await page.click(`.srt-row[data-city="${O.uid}"] [data-action="openCity"]`);
  await page.waitForSelector('[data-modal="siegeTarget"][data-online="0"] [data-action="siegeReady"]', { timeout: 5_000 })
    .catch(() => fail('미접속이 된 O의 상세에 [전투준비]가 없다'));
  // 상세를 든 채 O가 다시 접속했다 — 서버가 그 순간을 보고 거절해야 한다(판도 군량도 그대로)
  const grainStale = (await getProfile(A.uid))!.grain;
  await seen(O.uid, 0);
  await page.click('[data-action="siegeReady"]');
  await page.waitForSelector('[data-modal="siegeTarget"][data-online="1"] [data-field="error"]', { timeout: 10_000 })
    .catch(() => fail('낡은 목록으로 접속 중인 O를 눌렀는데 「방금 접속」이 안 뜬다'));
  if (!await page.$('[data-modal="siegeTarget"] [data-action="declare"]')) fail('거절된 뒤 상세가 선전포고 모양으로 안 바뀌었다');
  const afterStale = (await getProfile(A.uid))!;
  if (afterStale.aiBattle || afterStale.grain !== grainStale) fail('거절됐는데 판이 서거나 군량이 나갔다');
  await shot(page, 's2d-target-stale');
  await page.click('[data-action="siegeClose"]');
  ok('화면 접속 표시 — A의 핑이 닿았다 · O의 초록 점 · [선전포고] · 2분 지나면 [전투준비] · 낡은 목록은 서버가 「방금 접속」으로 거절');
  await reloadTo(D.uid);

  await page.click(`.srt-row[data-city="${D.uid}"] [data-action="openCity"]`);
  await page.waitForSelector('[data-modal="siegeTarget"]');
  const odds = await page.textContent('[data-modal="siegeTarget"] [data-field="odds"]');
  if (!odds?.includes('%')) fail(`상세에 예상 승률이 없다 — ${odds}`);
  await shot(page, 's3-target');
  const grainBefore = (await getProfile(A.uid))!.grain;
  await page.click('[data-action="siegeReady"]');
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.state, undefined, { timeout: 20_000 })
    .catch(() => fail('[전투준비]를 눌렀는데 판이 안 선다'));
  ok(`상세 → [전투준비] → 판 (${odds})`);

  // ── 3. 판 ──
  const fighting = (await getProfile(A.uid))!.aiBattle;
  if (fighting?.status !== 'fighting' || fighting.defender?.uid !== D.uid) fail(`서버에 굳힌 판에 방어자가 없다 — ${JSON.stringify(fighting?.defender)}`);
  if ((await getProfile(A.uid))!.grain !== grainBefore - 3) fail('참가비(3)가 안 나갔다');
  const deploy = fighting!.defender!.deploy;
  if (!deploy) fail('D의 북군 배치가 판에 안 실렸다');
  const placed = await page.evaluate(() => {
    const s = (window as any).__battle.scene.debugPlayback.state;
    return Object.fromEntries(Object.values(s.units as Record<string, any>).filter((u: any) => u.side === 'P2').map((u: any) => [u.id, u.pos]));
  });
  for (const d of deploy!) {
    if (JSON.stringify(placed[d.unit]) !== JSON.stringify(d.pos)) fail(`${d.unit}이 D의 배치에 안 섰다 — ${JSON.stringify(placed[d.unit])} ≠ ${JSON.stringify(d.pos)}`);
  }
  await page.waitForTimeout(1_500);
  await shot(page, 's4-battle');
  ok(`판 — 참가비 −3 · 방어자 D · 북군 ${deploy!.length}명이 D가 저장한 자리에 섰다`);

  // ── 4. 항복 → 정산 · 방어 기록 ──
  await page.click('#ctx-prep button.go');
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'awaitingInput'
    && (window as any).__battle.scene.debugPlayback.state.phase === 'control', undefined, { timeout: 60_000 })
    .catch(() => fail('준비를 마쳤는데 내 차례가 안 온다'));
  await page.click('#gameinfo .gi-act[data-action="surrender"]:not([disabled])');
  await page.click('[data-modal="surrender"] button[data-action="surrender"]', { timeout: 5_000 }).catch(() => fail('[항복] 물음 팝업이 안 뜬다'));
  await page.waitForSelector('[data-screen="result"]', { timeout: 30_000 }).catch(() => fail('항복했는데 결과 화면이 안 뜬다'));
  await page.waitForTimeout(800);
  await shot(page, 's5-result');
  const after = (await getProfile(A.uid))!;
  if (after.aiBattle) fail('정산했는데 판이 남았다');
  const row = after.matches.at(-1)!;
  if (row.opponent !== 'siege' || row.opponentId !== D.uid || row.result !== 'lose') fail(`이력이 공성전 · 상대 D · 패배가 아니다 — ${JSON.stringify(row)}`);
  const log = (await pool.query<{ attacker_id: string; winner: string | null; reason: string; mode: string; replay: any; attacker_city: string }>(
    'select attacker_id, winner, reason, mode, replay, attacker_city from defense_log where defender_id = $1', [D.uid])).rows;
  if (log.length !== 1) fail(`방어 기록이 한 줄이 아니다 — ${log.length}줄`);
  const l = log[0]!;
  if (l.attacker_id !== A.uid || l.winner !== 'P2' || l.reason !== 'settled' || l.mode !== '3v3' || l.attacker_city !== A.profile.cityName) {
    fail(`방어 기록이 이상하다 — ${JSON.stringify({ ...l, replay: undefined })}`);
  }
  if (!l.replay?.deploy?.P2 || !Array.isArray(l.replay?.intents) || l.replay.intents.at(-1)?.t !== 'surrender') fail('방어 기록에 그 판의 배치 · 수가 안 실렸다');
  ok(`항복 → 결과 · 이력(공성전 · 상대 D · 패배) · 방어 기록 한 줄(수비 승 P2 · 수 ${l.replay.intents.length}개 · 배치 실림)`);
  if (errors.length) fail(`페이지 오류 — ${errors.join(' | ')}`);
  console.log(`\n사진: ${OUT}`);
} catch (e) {
  if (!(e instanceof Stop)) { failed = true; console.error(e); }
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await shot(page, 'zz-failed').catch(() => {});
} finally {
  await cleanup();
  process.exit(failed ? 1 : 0);
}
