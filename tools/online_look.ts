/**
 * 온라인 대전 눈 확인 — **브라우저 둘 · 계정 둘 · 진짜 대기열**로 한 판을 열어 화면을 찍는다.
 *
 *   npm run look:online -- [--out 폴더] [--lang ja]
 *
 * `npm run dev`(5173) · `npm run server-api`(8787) · `npm run server`(2567)가 **떠 있어야 한다**
 * (스모크와 달리 제 안에서 띄우지 않는다 — 지금 고친 화면 · 엔진을 그대로 보려는 도구다).
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 있나 (전투 UI 개편 8단계, 2026-10-07)
 * ────────────────────────────────────────────────────────────────
 *
 * 「탭 둘에 `?seat=1` · `?seat=2`」로 혼자 온라인을 보던 통로는 **H3a(계정 · 로그인)에서 사라졌다** —
 * 탭 둘은 `localStorage`의 세션을 함께 써서 **같은 계정**이 된다. 지금은 계정이 둘 있어야 하고
 * 브라우저 저장소도 둘이어야 한다(Playwright 컨텍스트 둘). 계정은 Supabase Admin API로 만들고
 * 프로필은 서버 함수로 곧바로 심는다(같은 시드 = 같은 시작 장수 = 같은 전투력 → 서로 매칭된다).
 *
 * 찍는 것 — 온라인으로만 닿는 갈래 둘:
 * 1. **배치 대기(`waiting`)** — A가 먼저 [준비완료], B는 몇 초 뒤.
 * 2. **상대 차례에 장수 팝업을 열어 둘 때의 카메라** — B의 차례에 A가 순서 판 줄로 팝업을 열고,
 *    B가 생각하는 동안(몇 초) · B가 움직인 뒤를 연달아 찍는다.
 * 끝나면 둘 다 항복 · 계정을 지운다.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { addSquad, createProfile } from '@samchess/meta';
import type { RosterPick } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const BASE = flag('url', 'http://localhost:5173');
// 저장소를 어지르지 않게 기본은 OS 임시 폴더다 — 결과 줄이 경로를 찍어 준다
const OUT = flag('out', join(tmpdir(), 'samchess-online-look'));
const LANG = flag('lang', '');
mkdirSync(OUT, { recursive: true });

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_ANON_KEY = process.env['SUPABASE_ANON_KEY'];
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY'];
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SECRET_KEY) {
  console.error('✗ .env에 SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SECRET_KEY가 있어야 한다');
  process.exit(1);
}

const uids: string[] = [];
let browser: Browser | null = null;

const fail = async (msg: string): Promise<never> => {
  console.error(`✗ ${msg}`);
  await cleanup();
  process.exit(1);
};

async function cleanup(): Promise<void> {
  await browser?.close().catch(() => {});
  await Promise.all(uids.map((uid) => fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  })));
  await pool.end().catch(() => {});
  if (uids.length) console.log(`✓ 테스트 계정 ${uids.length}개 정리`);
}

/** 계정 하나 + 3v3 부대 하나를 든 프로필 — 시드가 같으면 시작 장수가 같다 */
async function seat(tag: string): Promise<{ email: string; password: string }> {
  const email = `look-${tag}-${randomUUID()}@samchess.test`;
  const password = randomUUID();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) await fail(`「${tag}」 계정 생성 실패 — ${res.status} ${await res.text()}`);
  const { id } = await res.json() as { id: string };
  uids.push(id);

  let profile = createProfile(`눈확인-${tag}-${randomUUID().slice(0, 4)}`, 7);
  const officers = Object.keys(profile.roster);
  const picks: RosterPick[] = (['King', 'Queen', 'Rock'] as const)
    .map((piece, i) => ({ piece, officer: officers[i]! }) as RosterPick);
  profile = addSquad(profile, { name: `${tag}부대`, mode: '3v3', picks }, Date.now()).profile;
  await saveProfileTrusted(id, { ...profile, grainAt: Date.now() });
  return { email, password };
}

/** 간판 → 로그인 → 메인 → 병영 → [출정하기] → 3v3 → 부대 → [대전상대 찾기] */
async function toQueue(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (LANG) {
    await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.click('.scr-title [data-action="loginOpen"]');
  await page.fill('[data-modal="login"] [data-field="email"]', who.email);
  await page.fill('[data-modal="login"] [data-field="password"]', who.password);
  await page.click('[data-modal="login"] [data-action="enter"]');
  await page.waitForSelector('.scr-main', { timeout: 20_000 }).catch(() => fail('로그인했는데 메인이 안 뜬다'));
  await page.click('.scr-main [data-place="barracks"]', { force: true });
  await page.click('[data-action="sortie"]');
  await page.click('[data-mode="3v3"]');
  await page.click('.srt-row [data-action="pickSquad"]');
  await page.click('[data-action="seek"]');
}

const phaseOf = (page: Page): Promise<string> =>
  page.evaluate(() => (window as any).__battle?.scene?.debugPlayback?.phase ?? '');

async function shot(page: Page, name: string): Promise<void> {
  const frame = await page.$('#frame');
  await (frame ?? page).screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  📷 ${name}.png`);
}

// ── 한 판 ─────────────────────────────────────────────────────

try {

const A = await seat('A');
const B = await seat('B');
console.log('✓ 계정 둘 · 3v3 부대');

browser = await chromium.launch();
// 판이 700px — 프레임이 1:2라 세로 1400
const viewport = { width: 1000, height: 1400 };
const pa = await (await browser.newContext({ viewport })).newPage();
const pb = await (await browser.newContext({ viewport })).newPage();
for (const [p, n] of [[pa, 'A'], [pb, 'B']] as const) {
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 아직 안 구운 시전 오라(`cast-S/A/B/E`)는 넘어간다 — 파일이 정말 없을 때만 (`smoke_meta`와 같은 규약)
    const missing = /image vfx:([\w-]+)$/.exec(m.text());
    if (m.text().startsWith('Failed to process file') && missing
        && !existsSync(`packages/client/public/vfx/${missing[1]}.png`)) return;
    console.log(`  [${n} 콘솔] ${m.text().slice(0, 160)}`);
  });
}

await Promise.all([toQueue(pa, A), toQueue(pb, B)]);
for (const p of [pa, pb]) {
  await p.waitForFunction(() => (document.querySelector('[data-screen="match"]') as HTMLElement | null)?.dataset.state === 'found', null, { timeout: 40_000 })
    .catch(() => fail('서로 못 찾았다 — 대전 서버(2567) · 계정 API(8787)가 떠 있나?'));
}
const kinds = await Promise.all([pa, pb].map((p) => p.evaluate(() => (document.querySelector('[data-screen="match"]') as HTMLElement).dataset.kind)));
if (kinds.some((k) => k !== 'online')) await fail(`온라인으로 안 붙었다 — ${kinds}`);
console.log('✓ 진짜 대기열에서 서로 매칭');
await shot(pa, '01-match-found');
await Promise.all([pa, pb].map((p) => p.click('.mtc-acts [data-action="ready"]')));
for (const p of [pa, pb]) {
  await p.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'deploying', null, { timeout: 30_000 })
    .catch(() => fail('전투 화면의 배치 단계로 안 들어간다'));
}
await pa.waitForTimeout(1500);
await shot(pa, '02-deploy');

// 1. 배치 대기 — A만 먼저
await pa.click('#ctx-prep button[data-action="ready"]');
await pa.waitForFunction(() => (document.getElementById('ctx-prep') as HTMLElement).dataset.phase === 'waiting', null, { timeout: 10_000 })
  .catch(() => fail('A가 준비했는데 대기 화면이 안 선다'));
await pa.waitForTimeout(600);
await shot(pa, '03-waiting-A');
await shot(pb, '03-deploying-B');
await pb.waitForTimeout(2500);
await pb.click('#ctx-prep button[data-action="ready"]');
for (const p of [pa, pb]) {
  await p.waitForFunction(() => (document.getElementById('ctx-prep') as HTMLElement).dataset.phase === 'scouting', null, { timeout: 15_000 })
    .catch(() => fail('둘 다 준비했는데 정찰로 안 간다'));
}
await shot(pa, '04-scouting');
await Promise.all([pa, pb].map((p) => p.click('#ctx-prep button[data-action="begin"]')));
console.log('✓ 배치 대기 → 정찰 → 전투');

// 2. 상대 차례 — 사람 쪽 진영과 지금 차례를 재생기에서 읽는다
const sideOf = (p: Page): Promise<string> => p.evaluate(() => (window as any).__battle.scene.debugPlayback.humanSide);
const sa = await sideOf(pa);
let waiter: Page | null = null;
let thinker: Page | null = null;
for (let i = 0; i < 200 && !waiter; i++) {
  const [fa, fb] = await Promise.all([phaseOf(pa), phaseOf(pb)]);
  if (fa === 'aiThinking' && fb === 'awaitingInput') { waiter = pa; thinker = pb; }
  else if (fb === 'aiThinking' && fa === 'awaitingInput') { waiter = pb; thinker = pa; }
  else if (fa === 'awaitingInput') {
    // 상대 차례를 기다리며 A의 차례는 넘긴다 — [대기] → 확인
    await pa.evaluate(() => (window as any).__battle.scene.debugPlayback.submit({ t: 'endTurn' }));
  }
  await pa.waitForTimeout(250);
}
if (!waiter || !thinker) await fail('「한쪽은 기다리고 한쪽은 생각하는」 순간에 닿지 않았다');
console.log(`✓ 상대 차례 — 기다리는 쪽 ${waiter === pa ? 'A' : 'B'}(${waiter === pa ? sa : '상대'})`);
await waiter!.waitForTimeout(800);
await shot(waiter!, '05-their-turn');

// 순서 판의 둘째 줄(지금 차례가 아닌 장수)을 눌러 팝업을 연다
await waiter!.click('#order [data-unit]:nth-child(2)').catch(async () => {
  await waiter!.click('#order [data-unit]');
});
for (const ms of [400, 3000, 7000]) {
  await waiter!.waitForTimeout(ms === 400 ? 400 : ms - 400);
  await shot(waiter!, `06-their-turn-popup-${ms}ms`);
}
// 생각하던 쪽이 차례를 넘긴다 — 그 뒤 카메라가 어디로 가는지
// (명상은 MP가 가득이면 서버가 거절한다 — 거절은 화면에 안 돌아오므로 늘 받는 [대기]로 넘긴다)
await thinker!.evaluate(() => (window as any).__battle.scene.debugPlayback.submit({ t: 'endTurn' }));
for (const ms of [300, 1500, 3500]) {
  await waiter!.waitForTimeout(ms === 300 ? 300 : ms === 1500 ? 1200 : 2000);
  await shot(waiter!, `07-after-their-move-${ms}ms`);
}
const cam = await waiter!.evaluate(() => {
  const sc = (window as any).__battle.scene;
  const v = sc.cameras.main.worldView;
  return { popup: document.getElementById('unitpop')?.dataset.unit ?? '', zoom: sc.cameras.main.zoom, x: Math.round(v.x), y: Math.round(v.y) };
});
console.log(`✓ 팝업 ${cam.popup || '(닫힘)'} · 카메라 zoom ${cam.zoom.toFixed(2)} @ (${cam.x},${cam.y})`);

// 끝 — 둘 다 항복을 시도(내 차례인 쪽만 받아 준다) 뒤 결과 화면
for (let i = 0; i < 80; i++) {
  const [fa, fb] = await Promise.all([phaseOf(pa), phaseOf(pb)]);
  if (fa === 'finished' || fb === 'finished') break;
  for (const [p, f] of [[pa, fa], [pb, fb]] as const) {
    if (f === 'awaitingInput') await p.evaluate(() => (window as any).__battle.scene.debugPlayback.submit({ t: 'surrender' }));
  }
  await pa.waitForTimeout(250);
}
await pa.waitForTimeout(2500);
await shot(pa, '08-result-A');
await shot(pb, '08-result-B');
console.log(`완주 — 스크린샷은 ${OUT}/`);
} catch (e) {
  console.error(`✗ ${(e as Error).message.split(/\r?\n/)[0]}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
