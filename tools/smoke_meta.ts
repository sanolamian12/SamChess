/**
 * 메타 연동 스모크 — 오프라인 한 바퀴가 실제로 도는지 확인한다.
 *
 *   node --experimental-strip-types tools/smoke_meta.ts
 *
 * ```
 * 간판 → 새 계정 → 도시 → 병영 → 부대 편성 → 출정하기 → 구성 → 부대 → 매칭
 *                                              → 전투준비 → 배치 → 정찰 → 전투
 *                        └ 궁궐 → 장수 관리 → 레벨업 → 새로고침
 * ```
 *
 * `npm test`(순수 규칙)와 `smoke:ui`(전투 화면) 사이가 여기다. 규칙도 맞고 전투도 도는데
 * **화면이 그 둘을 잇지 못하는** 종류를 잡는다 — 편성이 엔진에 안 넘어가거나,
 * 저장이 안 되거나, 결과가 계정에 반영되지 않는 것.
 *
 * 개발 서버(`npm run dev`)가 떠 있어야 한다. **H3a부터 계정 API(`server-api`)와
 * 진짜 Supabase 로그인도 필요하다** — `npm run smoke:meta`는 `--env-file=.env`로 돈다.
 */

import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { Client } from 'colyseus.js';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { OFFICERS, UNIQUE_SKILLS } from '@samchess/data';
import { PROFILE_VERSION, SORTIE_TUTORIALS, makeAiOpponent } from '@samchess/meta';
import { BattleRoom, QueueRoom, SERVER_PORT } from '@samchess/server';
import { registerRoutes } from '../packages/server-api/src/routes.ts';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const argv = process.argv.slice(2);
const i = argv.indexOf('--url');
const BASE = i >= 0 && argv[i + 1] ? argv[i + 1]! : 'http://localhost:5173';
/** 계정 API 자리 — 기본 8787. 이미 옛 코드의 `server-api`가 떠 있으면 `SMOKE_API_PORT`로 다른 자리를 준다
    (그 자리에 뜬 것이 있으면 그것을 쓰고, 없으면 제 안에서 띄운다). 그 Vite가 같은 자리를 봐야 한다 */
const API_PORT = Number(process.env['SMOKE_API_PORT'] ?? 8787);
const API = `http://localhost:${API_PORT}`;

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

/*
 * **온라인 매칭(§8.7)을 실제로 지나려면 진짜 서버가 있어야 한다** — `?match=online`
 * 흉내는 대기열이 실제로 도는 지금은 지웠다(H2b, §5-52의 「도는 적 없는 검사」를
 * 다시 만들지 않으려는 것). 클라이언트 기본 주소(`ws://localhost:2567`)와 같은
 * 포트로 띄운다. **이미 `npm run server`가 떠 있어도 괜찮다** — 그 자리를 그대로 쓴다.
 */
let ownServer: Server | null = null;
try {
  ownServer = new Server({ transport: new WebSocketTransport() });
  ownServer.define('battle', BattleRoom);
  ownServer.define('queue', QueueRoom);
  await ownServer.listen(SERVER_PORT);
  console.log(`✓ 대전 서버(스모크 전용) — ws://localhost:${SERVER_PORT}`);
} catch {
  ownServer = null;
  console.log(`✓ 대전 서버 — 이미 떠 있는 것을 그대로 쓴다 (ws://localhost:${SERVER_PORT})`);
}

/*
 * **계정 API(H3a)도 필요하다** — 로그인이 필수가 되며 `storage.ts`가 여길 정본으로
 * 삼는다. `smoke:account`와 같은 방식으로 제 안에서 Fastify를 띄운다. CORS는
 * `packages/server-api/src/main.ts`와 같은 값(`GET,PUT`)으로 연다 — 브라우저가
 * 실제로 호출하기 때문에 `smoke:account`(서버 대 서버 호출)와 달리 CORS가 필요하다.
 */
let ownApi: { close: () => Promise<void> } | null = null;
/*
 * **개발용 지급을 연다** (2026-09-14, A1) — 금화가 서버 소유가 되어 장터의 개발용 금화
 * 단추가 `POST /dev/grant`를 부른다. 그 길은 `SAMCHESS_DEV_GRANTS=1`일 때만 열린다(기본은
 * 닫힘 — 배포에 켜 두면 치팅 경로다). 이 스모크는 계정 API를 **제 안에서** 띄우므로 여기서
 * 켠다. 이미 떠 있는 `server-api`를 쓰는 경우에는 그쪽 `.env`에 켜져 있어야 한다.
 */
process.env['SAMCHESS_DEV_GRANTS'] = '1';
try {
  const Fastify = (await import('fastify')).default;
  const cors = (await import('@fastify/cors')).default;
  const app = Fastify();
  // **`POST`가 빠져 있었다** — 실제 서버(`main.ts`)는 열어 두는데 여기만 낡아,
  // AI 대전 결과 검증(`/battle/ai-result`)과 도시 행위(`/city/*`)가 조용히 막힌다
  await app.register(cors, { origin: true, methods: ['GET', 'PUT', 'POST', 'DELETE'] });
  // 진짜 서버처럼 요청마다 라우트를 맥락에 — 변화 장부의 출처(2026-11-12)
  (await import('../packages/server-api/src/requestContext.ts')).attachRequestContext(app);
  registerRoutes(app);
  await app.listen({ port: API_PORT, host: '127.0.0.1' });
  ownApi = app;
  console.log(`✓ 계정 API(스모크 전용) — ${API}`);
} catch {
  ownApi = null;
  console.log(`✓ 계정 API — 이미 떠 있는 것을 그대로 쓴다 (${API})`);
}

/**
 * 자리 하나마다 진짜 Supabase 계정을 만들고 액세스 토큰을 받는다.
 *
 * `/auth/v1/signup`(공개 가입)은 `.test` TLD를 형식 오류로 막는다 — Admin API로
 * 만들고(`email_confirm: true`) 비밀번호 로그인으로 토큰을 받는다(`smoke:online`과 같다).
 */
const createdUids: string[] = [];
async function newAccount(tag: string): Promise<{ uid: string; email: string; password: string; token: string }> {
  const email = `smoke-meta-${tag}-${randomUUID()}@samchess.test`;
  const password = randomUUID();
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SECRET_KEY!,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!createRes.ok) fail(`「${tag}」 테스트 계정 생성 실패 — ${createRes.status} ${await createRes.text()}`);
  const created = await createRes.json() as { id: string };
  createdUids.push(created.id);

  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) fail(`「${tag}」 로그인 실패 — ${loginRes.status} ${await loginRes.text()}`);
  const { access_token: token } = await loginRes.json() as { access_token: string };
  return { uid: created.id, email, password, token };
}

/** 끝나면 테스트 계정을 전부 지운다 — `profiles`는 cascade로 함께 사라진다 */
async function cleanupAccounts(): Promise<void> {
  await Promise.all(createdUids.map((uid) => fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY!, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  })));
  console.log(`✓ 테스트 계정 ${createdUids.length}개 정리`);
}

/** 이번 스모크의 주인공 — 화면을 직접 조작하는 그 계정 */
const player = await newAccount('player');
console.log(`✓ 테스트 계정 — ${player.uid}`);

/** 화면 밖에서 서버 상태를 직접 읽고 쓴다 — 군량 조작·저장 형식 시뮬레이션에 쓴다 */
async function apiGet(): Promise<Record<string, any>> {
  const res = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${player.token}` } });
  if (!res.ok) fail(`GET /profile 실패 — ${res.status}`);
  return res.json() as Promise<Record<string, any>>;
}
async function apiPut(profile: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API}/profile`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${player.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) fail(`PUT /profile 실패 — ${res.status}`);
}
/**
 * DB 행을 **되접기를 안 거치고 그대로** 심는다 — 옛 저장 형식이 실제로 DB에
 * 남아 있던 상황(그 뒤로 한 번도 안 열어 본 계정)을 흉내 낸다. `PUT /profile`은
 * `saveProfile()`이 매번 `migrateProfile()`을 거치므로 이 흉내를 낼 수 없다.
 */
async function dbSetRaw(profile: unknown): Promise<void> {
  await pool.query('update profiles set data = $1 where uid = $2', [JSON.stringify(profile), player.uid]);
}

/**
 * **거절 흉내를 대신할 가짜 상대** — 대기열에 붙어 확인 없이 기다린다.
 *
 * 「군량이 딱 최소라 [다시 찾기]가 없다」·「거절하면 다른 상대로 바뀐다」를 보려면
 * **매번 다른, 아직 안 거절당한** 상대가 필요하다(§5-63의 거절 기억 때문에 같은
 * 봇과는 다시 안 붙는다). 매번 새 봇을 하나씩 띄운다 — 확인은 안 보낸다, 스모크가
 * 보는 것은 매칭 화면 상태이지 실제 전투가 아니다. `QueueRoom.onAuth`가 토큰을
 * 요구하므로(§5-91) 봇마다 계정도 하나씩 만든다.
 */
async function queueBot(power: number, seed: number): Promise<{ close: () => Promise<void> }> {
  const ai = makeAiOpponent('3v3', power, seed);
  const bot = await newAccount(`bot${seed}`);
  const client = new Client(`ws://localhost:${SERVER_PORT}`);
  client.auth.token = bot.token;
  const room = await client.joinOrCreate('queue', {});
  room.send('search', {
    search: {
      mode: '3v3', power,
      enlist: { playerId: bot.uid, entries: ai.entries, squadName: `봇부대${seed}`, power, deploy: null },
    },
  });
  return { close: (): Promise<void> => room.leave() };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
/*
 * **로그인 직후 `GET /profile` 404는 정상이다** — 방금 만든 계정은 서버에 프로필이
 * 아직 없다(H3a, `loadProfile()`이 그걸로 새 계정 화면을 고른다). 우리 코드가 그
 * 응답을 잡아도 브라우저는 실패한 `fetch()`를 개발자 도구 콘솔에 그대로 찍는다 —
 * 그 문구(URL은 안 실려 있다)까지는 막을 수 없으니 **딱 한 번만** 눈감아 준다.
 * 두 번째부터는(같은 문구라도) 진짜 문제일 수 있으니 그대로 잡는다.
 */
const EXPECTED_404 = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
let seenExpected404 = false;
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (!seenExpected404 && text === EXPECTED_404) { seenExpected404 = true; return; }
  /*
   * **아직 안 온 그림은 넘어간다 — 단, 파일이 정말 없을 때만** (2026-09-14). 전투 씬이
   * 링 그림을 전부 미리 받는데 시전 오라 넷(`cast-S/A/B/E`, 2026-09-07)은 아직 안 구워졌다.
   * 화면은 조용히 접지만 Phaser가 콘솔에 「Failed to process file」을 남긴다. `smoke:ui`는
   * `pageerror`만 들어 이걸 한 번도 못 봤고, 이 스모크는 끝까지 간 적이 없어 못 봤다.
   * 파일이 생기면 이 갈래는 저절로 안 탄다 — 있는 그림이 깨지면 그대로 잡힌다.
   */
  const missingVfx = /image vfx:([\w-]+)$/.exec(text);
  if (text.startsWith('Failed to process file') && missingVfx
      && !existsSync(`packages/client/public/vfx/${missingVfx[1]}.png`)) return;
  errors.push(`[console] ${text}`);
});

/**
 * 배경 그림이 **실제로 받아졌는지** 본다.
 *
 * `background-image` 가 붙어 있는 것만으로는 모자라다 — 에셋이 없으면 URL은 그대로
 * 있고 404만 난다(화면은 바탕색으로 물러난다). 그림이 화면의 뜻을 나르는 자리라
 * 「띄우기로 한 그림」과 「실제로 뜬 그림」을 둘 다 확인한다.
 *
 * **그림은 화면 div 자신이 아니라 `.scr-art` 층에 있다** (2026-08-15). 천천히
 * 움직이게 하면서 떼어 냈다 — 화면 div에 `transform`을 걸면 글자까지 흔들린다.
 * 층이 없는 화면(편성의 `.scr-dim`)도 있어 없으면 제 자신을 본다.
 */
const backdropOf = (sel: string) => page.evaluate((s) => {
  const scr = document.querySelector(s);
  if (!scr) return null;
  const el = scr.querySelector(':scope > .scr-art') ?? scr;
  const url = /url\(["']?(.+?)["']?\)/.exec(getComputedStyle(el).backgroundImage)?.[1] ?? null;
  return url ? { url, name: url.split('/').pop() ?? '' } : null;
}, sel);

const expectBackdrop = async (sel: string, want: string, where: string): Promise<void> => {
  const got = await backdropOf(sel);
  if (!got) fail(`${where} 배경 그림이 지정되지 않았다 (${sel})`);
  if (got!.name !== want) fail(`${where} 배경이 「${want}」여야 하는데 「${got!.name}」다`);
  const ok = await page.evaluate((u) => fetch(u).then((r) => r.ok, () => false), got!.url);
  if (!ok) fail(`${where} 배경 ${want} 을 받아오지 못한다 — npm run backgrounds 를 돌렸는가`);
  console.log(`✓ 배경 ${where} — ${want}`);
};

// ── 간판·로그인 화면 (pptx 33·34쪽) ────────────────────────────

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

if (!await page.$('.scr-title')) fail('게임 URL로 들어왔는데 간판 화면이 뜨지 않는다');
if (await page.textContent('.scr-title .brand') !== '만인의 삼국지') fail('간판의 게임 이름이 「만인의 삼국지」가 아니다');
// 접속 시각의 시간대 그림. 셋 중 하나이기만 하면 된다 — 어느 것인지는 시계가 정한다
{
  const band = await page.evaluate(() => {
    const h = new Date().getHours();
    return h >= 7 && h < 16 ? 'day' : h >= 16 && h < 20 ? 'dusk' : 'night';
  });
  await expectBackdrop('.scr-title', `open-${band}.jpg`, `간판(${band})`);
}

// 배경이 천천히 움직인다 — **그림만** 움직이고 글자는 제자리다 (2026-08-15).
// 층을 도로 합치면(화면 div의 배경으로 되돌리면) 제목·단추가 함께 흔들리는데,
// 자세가 워낙 작아 스크린샷 한 장으로는 알아채기 어렵다. 좌표로 잡는다.
{
  const look = () => page.evaluate(() => {
    const art = document.querySelector('.scr-title > .scr-art') as HTMLElement | null;
    const brand = document.querySelector('.scr-title .brand') as HTMLElement | null;
    if (!art || !brand) return null;
    const b = brand.getBoundingClientRect();
    return { step: art.dataset.drift, tf: getComputedStyle(art).transform, x: b.left, y: b.top };
  });
  const a = await look();
  if (!a) fail('배경의 움직이는 층(.scr-art)이 없다 — 그림이 화면 div로 되돌아갔는가');
  await page.waitForTimeout(2900);          // 한 걸음(DRIFT_MS 2600ms)보다 조금 더
  const b = (await look())!;
  if (a!.step === b.step || a!.tf === b.tf) fail(`배경이 움직이지 않는다 (걸음 ${a!.step} → ${b.step})`);
  if (a!.x !== b.x || a!.y !== b.y) fail('배경이 움직일 때 글자까지 따라 움직인다 — 층이 합쳐졌다');
  console.log(`✓ 배경 움직임 — 걸음 ${a!.step} → ${b.step}, 글자는 제자리`);
}

// 환경설정 — 어느 화면에서든 기어로 연다 (33쪽 오른쪽)
await page.click('.scr-title [data-action="settings"]');
await page.waitForTimeout(150);
const settings = await page.evaluate(() => ({
  open: !!document.querySelector('[data-modal="settings"]'),
  langs: [...document.querySelectorAll('[data-modal="settings"] [data-lang]')].map((el) => (el as HTMLElement).dataset.lang),
}));
if (!settings.open) fail('기어를 눌렀는데 환경설정이 뜨지 않는다');
// 한국어 기본 + 아홉. **다섯에서 열로 늘었는데 이 줄만 낡아 있었다**(2026-09-04에
// 바로잡음) — 지역 변종이 갈리면서 `pt` → `pt_BR`·`pt_PT`, `zh` → `zh_Hans`·`zh_Hant`가
// 됐다. 목록을 여기 적는 이유는 화면이 실제로 그리는 것과 대조하기 위해서다.
const LANGS_EXPECTED = 'ko,en,es_419,it,ja,mn,pt_BR,pt_PT,zh_Hans,zh_Hant';
if (settings.langs.join(',') !== LANGS_EXPECTED) fail(`지원 언어가 다르다: [${settings.langs.join(' ')}]`);
await page.click('[data-modal="settings"] [data-action="settingsClose"]');
await page.waitForTimeout(150);
if (await page.$('[data-modal="settings"]')) fail('환경설정이 닫히지 않는다');
console.log(`✓ 간판 — 환경설정 · 언어 [${settings.langs.join(' ')}]`);

// ── 로그인 → 새 계정 (H3a · GDD §8) ─────────────────────────────
//
// 계정은 Admin API로 이미 만들어 뒀다(위 `player`) — 여기서는 **로그인**(`signIn`)이지
// 회원가입이 아니다. 서버에 프로필이 없으므로(방금 만든 계정이다) 곧바로 새 계정
// 화면으로 간다 — `App.tsx`의 `afterSignIn` → `loadProfile()` → 404 경로.

// 첫 화면은 **단추 셋**이다 (2026-09-11) — 위에서부터 언어·크레딧·입장. 입력칸이
// 화면에 남아 있으면(팝업으로 안 내려갔으면) 여기서 잡는다. 순서까지 보는 이유는
// 「언어가 가장 위」가 지정 자체라서다(국제적으로 내놓는 게임이라 글자가 먼저다).
{
  const title = await page.evaluate(() => ({
    acts: [...document.querySelectorAll('.scr-title .title-form .btn')]
      .map((el) => (el as HTMLElement).dataset.action),
    fields: document.querySelectorAll('.scr-title .title-form [data-field]').length,
  }));
  // 2026-10-19 — [크레딧 보기]를 걷고 [계정 생성]을 간판의 따로 난 길로 냈다(기획자 지정)
  if (title.acts.join(',') !== 'languageOpen,loginOpen,signupOpen') {
    fail(`간판 단추가 「언어·입장·계정 생성」 셋이 아니다: [${title.acts.join(' ')}]`);
  }
  if (title.fields > 0) fail('간판 화면에 입력칸이 그대로 있다 — 입장 팝업으로 내려가지 않았다');
  console.log('✓ 간판 — 단추 셋 [언어 · 입장 · 계정 생성]');
}

// 언어 팝업 — 환경설정까지 안 들어가고 첫 화면에서 바로 언어를 고르는 지름길
await page.click('.scr-title [data-action="languageOpen"]');
await page.waitForSelector('[data-modal="language"]', { timeout: 5_000 });
{
  const langs = await page.evaluate(() => [...document.querySelectorAll('[data-modal="language"] [data-lang]')]
    .map((el) => (el as HTMLElement).dataset.lang));
  if (langs.join(',') !== LANGS_EXPECTED) fail(`언어 팝업의 언어가 환경설정과 다르다: [${langs.join(' ')}]`);
}
await page.click('[data-modal="language"] [data-action="languageClose"]');
await page.waitForTimeout(150);
if (await page.$('[data-modal="language"]')) fail('언어 팝업이 닫히지 않는다');
console.log('✓ 간판 — 언어 팝업');

// 계정 생성 팝업 — 간판의 따로 난 길(2026-10-19). 이메일 · 비밀번호 · 금빛 [계정 생성] · 붉은 [취소]
await page.click('.scr-title [data-action="signupOpen"]');
await page.waitForSelector('[data-modal="signup"]', { timeout: 5_000 });
{
  const look = await page.evaluate(() => {
    const q = (sel: string) => document.querySelector(`[data-modal="signup"] ${sel}`);
    return {
      parts: ['[data-field="email"]', '[data-field="password"]', '[data-action="signup"]', '[data-action="loginCancel"]']
        .filter((sel) => !q(sel)),
      noEnter: !q('[data-action="enter"]') && !q('[data-action="reset"]') && !q('[data-action="loginClose"]'),
      signupArt: getComputedStyle(q('[data-action="signup"]')!).borderImageSource,
      cancelArt: getComputedStyle(q('[data-action="loginCancel"]')!).borderImageSource,
      email: (q('[data-field="email"]') as HTMLInputElement).value,
    };
  });
  if (look.parts.length) fail(`계정 생성 팝업에 빠진 것이 있다: ${look.parts.join(' ')}`);
  if (!look.noEnter) fail('계정 생성 팝업에 [입장] · [비밀번호 초기화] · 구석 X가 있다');
  if (!look.signupArt.includes('btn-alert') || !look.cancelArt.includes('btn-forcedcancel')) fail(`계정 생성 팝업 단추 그림이 어긋났다 — ${JSON.stringify(look)}`);
  if (look.email) fail('계정 생성 팝업이 지난 이메일로 시작한다 — 빈 칸이어야 한다');
}
// 이미 가입한 이메일 — Supabase는 200에 **빈 `identities`**로 답한다(2026-10-19 실측, `meta/auth.ts`의 `signUp`).
// 진짜로 가입시키면 확인 메일이 나가므로 응답만 흉내 낸다. 안내는 [취소] 밑 글줄이 아니라 팝업이고, [입장하러 가기]는 이메일을 들고 간다
await page.route('**/auth/v1/signup', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: 'x', aud: 'authenticated', email: 'dup@example.com', identities: [] }) }));
await page.fill('[data-modal="signup"] [data-field="email"]', 'dup@example.com');
await page.fill('[data-modal="signup"] [data-field="password"]', 'smoke-pass-1');
await page.click('[data-modal="signup"] [data-action="signup"]');
await page.waitForSelector('[data-modal="signupNotice"][data-kind="exists"]', { timeout: 5_000 })
  .catch(() => fail('이미 가입한 이메일인데 「이미 가입한 계정」 안내 팝업이 안 뜬다'));
if (await page.$('[data-modal="signup"] .hint')) fail('계정 생성 안내가 [취소] 밑 글줄로도 떴다 — 팝업만이어야 한다');
await page.click('[data-action="noticeToLogin"]');
await page.waitForSelector('[data-modal="login"]', { timeout: 3_000 }).catch(() => fail('[입장하러 가기]가 입장 팝업으로 안 간다'));
if (await page.inputValue('[data-modal="login"] [data-field="email"]') !== 'dup@example.com') fail('[입장하러 가기]가 이메일을 들고 가지 않는다');
await page.unroute('**/auth/v1/signup');
console.log('✓ 간판 — 계정 생성: 이미 가입한 이메일 → 안내 팝업 → [입장하러 가기](이메일 그대로)');
await page.click('[data-modal="login"] [data-action="loginCancel"]');
await page.waitForTimeout(150);
if (await page.$('[data-modal="login"]')) fail('입장 팝업이 [취소]로 닫히지 않는다');
console.log('✓ 간판 — 계정 생성 팝업(금빛 [계정 생성] · 붉은 [취소])');

// 입장 팝업 — 이메일·비밀번호와 [비밀번호 초기화]·[계정 생성]이 여기 다 모였다
await page.click('.scr-title [data-action="loginOpen"]');
await page.waitForSelector('[data-modal="login"]', { timeout: 5_000 });
{
  const miss = await page.evaluate(() => ['[data-field="email"]', '[data-field="password"]',
    '[data-action="enter"]', '[data-action="reset"]', '[data-action="loginCancel"]']
    .filter((sel) => !document.querySelector(`[data-modal="login"] ${sel}`)));
  if (miss.length > 0) fail(`입장 팝업에 빠진 것이 있다: ${miss.join(' ')}`);
  // 닫기는 바닥의 붉은 [취소] 하나(2026-10-19 — 잠깐 달았던 구석 X는 걷었다). [계정 생성]은 간판으로 나갔다
  const look = await page.evaluate(() => {
    const cancel = document.querySelector('[data-modal="login"] [data-action="loginCancel"]');
    return { x: !!document.querySelector('[data-modal="login"] [data-action="loginClose"]'),
      signup: !!document.querySelector('[data-modal="login"] [data-action="signup"]'),
      cancelArt: cancel ? getComputedStyle(cancel).borderImageSource : '' };
  });
  if (look.x) fail('입장 팝업에 구석 X가 남아 있다 — 걷었다');
  if (look.signup) fail('입장 팝업에 [계정 생성]이 남아 있다 — 간판으로 나갔다');
  if (!look.cancelArt.includes('btn-forcedcancel')) fail(`입장 팝업의 [취소]가 붉은 판이 아니다 — ${look.cancelArt}`);
}
console.log('✓ 간판 — 입장 팝업(이메일·비밀번호·초기화·붉은 [취소])');

await page.fill('[data-modal="login"] [data-field="email"]', player.email);
await page.fill('[data-modal="login"] [data-field="password"]', player.password);
await page.click('[data-modal="login"] [data-action="enter"]');
await page.waitForResponse((r) => r.url().includes('/profile'), { timeout: 10_000 })
  .catch(() => fail('로그인했는데 계정 API를 부르지 않는다'));
// 입장 하늘(`EnterSky`)에 닿은 뒤에야 화면이 바뀐다 — 정해진 틈이 아니라 화면을 기다린다
await page.waitForSelector('.scr-new', { timeout: 15_000 })
  .catch(() => fail('로그인했는데 새 계정 화면이 뜨지 않는다'));
// 도시 이름은 계정 사이에 고유하다(2026-09-19) — 고정 이름이면 지난 실행이 남긴 도시와 부딪힌다
const CITY = `스모크-${randomUUID().slice(0, 4)}`;
await page.fill('.field', CITY);
await page.click('.scr-new .btn.primary');
await page.waitForResponse((r) => r.url().includes('/profile') && r.request().method() === 'PUT', { timeout: 10_000 })
  .catch(() => fail('새 계정을 시작했는데 저장되지 않는다'));
// 가입 오프닝(대사 · 장수 W 대형, 약 14초)을 지나야 메인이다 — 끝의 [성 안으로 들어가기], 메인이 자리 잡는 1초 연출까지
await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 });

const main = await page.evaluate(() => ({
  city: document.querySelector('.scr-main .title')?.textContent ?? '',
  stats: [...document.querySelectorAll('.scr-main .stat')].map((el) => el.textContent ?? ''),
  places: [...document.querySelectorAll('.scr-main [data-place]')].map((el) => (el as HTMLElement).dataset.place),
}));
if (main.city !== CITY) fail(`도시 이름이 반영되지 않았다: "${main.city}"`);
// 초기 지급은 S·A·B·C·D 각 1명 (GDD §8). **상한은 궁궐 Lv1의 60이다**
// (2026-09-04에 도시 레벨 → 건물로 갈렸다 — 예전에는 도시 Lv1의 10이었다)
if (!main.stats.some((s) => s.includes('5/60'))) fail(`초기 지급이 5명이 아니다: ${main.stats.join(' ')}`);
// 궁궐·병영·장터 + 랭킹 (pptx 35쪽 · 랭킹은 2026-08-25에 더해졌는데 이 줄이 안 따라갔다).
// **산 쪽 문은 여기 없다** — 추가 건물을 하나라도 지어야 보인다(pptx 58쪽).
if (main.places.join(',') !== 'palace,barracks,market,ranking') fail(`도시의 자리가 다르다: [${main.places.join(' ')}]`);
if (await page.$('.scr-main .city-gate')) fail('추가 건물이 없는데 산 쪽 문이 보인다');
console.log(`✓ 새 계정 — ${main.city}, ${main.stats.join(' · ')}, 자리 [${main.places.join(' ')}]`);

/**
 * 도시의 자리를 누른다.
 *
 * **`force`를 쓴다 ★** — 배경(`.scr-art`)이 계속 흔들리므로(`useBackdropDrift`)
 * Playwright의 「멈출 때까지 기다린다」가 영원히 안 끝난다(`element is not stable`).
 * 흔들림은 **의도된 연출**이라 없앨 수 없고, 「진짜로 눌리는가」는 바로 위에서
 * `elementFromPoint`로 따로 확인한다 — 그래서 여기서 기다림을 건너뛰어도
 * 검사가 헐거워지지 않는다.
 */
const clickPlace = async (place: string): Promise<void> => {
  const el = await page.$(`.scr-main [data-place="${place}"]`);
  if (!el) fail(`도시에 「${place}」 자리가 없다`);
  await el!.click({ force: true });
  await page.waitForTimeout(300);
};

/*
 * 간판이 그림에 **가려지지 않아야** 한다. 좌표로 잡는 이유는 「화면에 칠했으면 누를 수
 * 있어야 한다」와 같다 — 그림 위에 얹은 것이라 배치가 어긋나면 화면 밖으로 나간다.
 *
 * ★ **이 검사는 오늘까지 한 번도 돈 적이 없다** (2026-09-04). `[data-place]`를 거는데
 * 화면에 그 속성이 없어 목록이 언제나 비어 있었고, 빈 목록 위의 `for`는 조용히
 * 지나간다 — 「검사가 기본값과 같은 값을 확인하면 아무것도 확인하지 않는 것」의
 * 가장 나쁜 형태다. 속성을 붙이자 곧바로 걸렸다.
 *
 * **재는 것은 네모가 아니라 이름표다.** 병영·랭킹의 클릭 네모는 그림의 **왼쪽 끝에
 * 붙여** 잡혀 있어(`x: 0`), `cover`로 채우면 그 끝은 프레임 밖으로 잘려 나간다 —
 * 일부러 그렇게 잡은 것이라 잘못이 아니다. 사람이 보고 누르는 것은 **이름표**이고,
 * 그것이 프레임 안에 있고 그 자리가 실제로 눌리면 된다.
 */
const spots = await page.evaluate(() => {
  const frame = document.getElementById('frame')!.getBoundingClientRect();
  return [...document.querySelectorAll('.scr-main [data-place]')].map((el) => {
    const g = el.parentElement!;
    const lbl = (g.querySelector('.city-lbl') ?? el).getBoundingClientRect();
    const cx = (lbl.left + lbl.right) / 2;
    const cy = (lbl.top + lbl.bottom) / 2;
    return {
      place: (el as HTMLElement).dataset.place!,
      inside: lbl.left >= frame.left - 1 && lbl.right <= frame.right + 1
        && lbl.top >= frame.top - 1 && lbl.bottom <= frame.bottom + 1,
      // 이름표는 `pointer-events: none`이라 그 자리에서 잡히는 것은 네모여야 한다
      hit: document.elementFromPoint(cx, cy)?.closest('[data-place]') === el,
    };
  });
});
if (spots.length === 0) fail('도시 간판을 하나도 못 찾았다 — 검사가 빈손으로 지나간다');
for (const s of spots) {
  if (!s.inside) fail(`「${s.place}」 이름표가 프레임 밖으로 나갔다`);
  if (!s.hit) fail(`「${s.place}」 간판이 무언가에 가려 눌리지 않는다`);
}
console.log(`✓ 도시 간판 — ${spots.length}개가 프레임 안에서 눌린다`);
{
  const band = await page.evaluate(() => {
    const h = new Date().getHours();
    return h >= 7 && h < 16 ? 'day' : h >= 16 && h < 20 ? 'dusk' : 'night';
  });
  await expectBackdrop('.scr-main', `main-${band}.jpg`, `도시(${band})`);
}

/*
 * 배경음악 — 화면마다 한 곡 (2026-08-14 기획자 지정).
 *
 * **소리가 실제로 났는지는 볼 수 없다.** 브라우저는 사용자가 화면을 건드리기 전에는
 * 재생을 막고, 헤드리스에는 출력 장치도 없다. 그래서 「지금 어느 곡을 틀기로 했는가」를
 * 본다 — 화면과 곡이 어긋나는 것은 그것으로 잡힌다.
 */
const bgm = (): Promise<string | null> =>
  page.evaluate(() => ((window as any).__bgm?.track ?? null) as string | null);
const expectBgm = async (want: string, where: string): Promise<void> => {
  const got = await bgm();
  if (got !== want) fail(`${where} 배경음악이 「${want}」여야 하는데 「${got}」다`);
  console.log(`✓ 배경음악 ${where} — ${want}`);
};
await expectBgm('main', '메인');

// ── 병영 — 지금까지 만든 전투 길의 입구 (pptx 35·36쪽) ─────────

await clickPlace('barracks');
await page.waitForTimeout(300);
if (!await page.$('.scr-place-barracks')) fail('병영을 눌렀는데 병영 화면이 아니다');
// 도시 Lv1이므로 첫째 그림이다 (Lv5부터 place-2)
await expectBackdrop('.scr-place', 'place-1-barracks.jpg', '병영');

/*
 * **문이 하나로 합쳐졌다** (F · 45쪽 · §5-32). 예전에는 병영에 `3:3`·`5:5` 두 단추가
 * 있었고 그것이 곧 AI 대전이었다. 지금은 셋이다 — `[부대 편성]`·`[출정하기]`·
 * `[튜토리얼 시나리오]`(잠김). 참여 인원은 [출정하기] 안의 첫 걸음으로 내려갔다.
 */
{
  const doors = await page.evaluate(() =>
    [...document.querySelectorAll('.scr-place-barracks .place-panel > .btn')].map((el) => ({
      action: (el as HTMLElement).dataset.action ?? '',
      locked: (el as HTMLButtonElement).disabled,
    })));
  const has = (a: string) => doors.some((d) => d.action === a);
  if (!has('squads')) fail('병영에 [부대 편성]이 없다 (42쪽)');
  if (!has('sortie')) fail('병영에 [출정하기]가 없다 — 문 통합이 안 됐다 (§5-32)');
  if (!has('tutorial')) fail('병영에 [튜토리얼 시나리오]가 없다 (45쪽)');
  // 옛 문이 남아 있으면 안 된다 — 상대를 고를 수 있으면 보상이 갈리는 근거가 되살아난다
  if (await page.$('.scr-place-barracks [data-mode]')) {
    fail('병영에 3:3 / 5:5 단추가 아직 있다 — [출정하기]로 합쳐졌어야 한다');
  }
  // 튜토리얼이 열렸다 (G3, 2026-10-22) — 가입 직후에는 [튜토리얼]이 열려 있고 [출정하기]가 잠겨 있다(`sortieGate`)
  if (doors.find((d) => d.action === 'tutorial')?.locked) fail('[튜토리얼]이 잠겨 있다 — 가입 직후 열려 있어야 한다 (G3)');
  if (!doors.find((d) => d.action === 'sortie')?.locked) fail('기본 튜토리얼 전인데 [출정하기]가 열려 있다 (G3)');
  if (!await page.$('.stw[data-say="sortieBlocked"][data-say-code="tutorial.required"]')) {
    fail('[출정하기]가 잠긴 이유(기본 튜토리얼)가 안 적혀 있다 (G3)');
  }
  /*
   * **차례가 지정이다** (2026-09-16) — 튜토리얼 · 부대 편성 · 출정하기. 처음 온
   * 사람이 밟을 차례대로 위에서 아래이고, 맨 아래의 [출정하기]만 옥색이라
   * 「오늘 누를 단추」가 눈의 끝에 온다. 셋이 다 있는지만 보면 **순서가
   * 뒤집혀도 통과한다** — 뜻이 차례에 실려 있으므로 차례를 본다.
   *
   * ⚠ 「튜토리얼이 잠겼는데 왜인지 적혀 있는가」(`tutorialWhy`)는 **같은 날
   * 뺐다**(기획자 지정) — 잠긴 단추가 눌리지 않는 것 자체로 말한다는 판단이다.
   * §5-20과 부딪히는 자리라 여기 적어 둔다.
   */
  const order = doors.map((d) => d.action).join(',');
  if (order !== 'tutorial,squads,sortie') fail(`병영의 문 차례가 다르다 — [${order}]`);
  console.log(`✓ 병영 — 문 셋 [${doors.map((d) => d.action + (d.locked ? '(잠김)' : '')).join(' ')}]`);
}

/*
 * 튜토리얼 (G3, 2026-10-22) — 목록은 기본 1만 열려 있다. 판 자체는 `tools/tutorial_ux.ts`가 대본대로 끝까지 누른다
 * (여기서 세 판을 다 두면 몇 분이 더 든다). 완료는 서버 경로로 적고 새로고침해 [출정하기]가 열리는 것을 본다 —
 * 이 뒤의 출전 검사 전부가 그 문 너머에 있다.
 */
{
  await page.click('.scr-place-barracks [data-action="tutorial"]');
  await page.waitForSelector('.scr-tutorials', { timeout: 5000 }).catch(() => fail('[튜토리얼]을 눌렀는데 목록이 아니다'));
  // 갈래 둘(2026-11-11) — 처음 골린 것은 [전투 기초]이고, S급 판은 [S급 장수 튜토리얼] 갈래 뒤에 있다
  const listed = (): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.scr-tutorials [data-tutorial]')]
    .map((b) => `${b.dataset.tutorial}:${b.dataset.status}`));
  if (await page.getAttribute('.scr-tutorials .tut-list', 'data-tab') !== 'basic') fail('튜토리얼 화면의 첫 갈래가 [전투 기초]가 아니다');
  const basics = await listed();
  // 일기토 · 설전 기초(2026-11-12, 2026-11-14부터 필수)가 기본 셋 뒤에 선다 — 기본 셋을 끝내야 열린다
  if (basics.join(',') !== 'basic-1:open,basic-2:locked,basic-3:locked,basic-duel:locked,basic-debate:locked') fail(`가입 직후 튜토리얼 목록이 다르다 — ${basics.join(' ')}`);
  if (await page.getAttribute('[data-tutorial="basic-1"]', 'data-mark') !== 'next') fail('기본 1에 「다음 목표」 표가 없다');
  await page.click('[data-action="tutTab"][data-tab="s"]');
  const sRows = await listed();
  const rows = [...basics, ...sRows];
  if (sRows.length !== 1) fail(`보이는 S급 튜토리얼이 ${sRows.length}개다 — 처음 받은 S급 하나여야 한다`);
  console.log(`✓ 튜토리얼 목록 — ${rows.join(' ')}`);

  // 출정에 드는 판은 전투 기초 다섯이다(2026-11-14 — 일기토 · 설전까지 필수)
  for (const id of ['basic-1', 'basic-2', 'basic-3', 'basic-duel', 'basic-debate']) {
    const res = await fetch(`${API}/tutorial/complete`, {
      method: 'POST', headers: { Authorization: `Bearer ${player.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) fail(`POST /tutorial/complete ${id} — ${res.status}`);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 }).catch(() => fail('새로고침 뒤 메인으로 오지 않는다'));
  await page.waitForTimeout(4500);   // 입장 하늘 층이 걷힐 때까지
  await clickPlace('barracks');
  await page.waitForSelector('.scr-place-barracks', { timeout: 5000 });
  // 기본 셋을 끝내도 부대가 없으면 막힌다 — 이유는 이제 튜토리얼이 아니라 수비군이다(2026-10-27, GDD §8.8).
  // 3v3 · 5v5 부대를 하나씩 만든 뒤에 열리는 것은 아래 「수비군」 절이 본다
  if (!await page.$('.scr-place-barracks [data-action="sortie"][disabled]')) fail('부대가 하나도 없는데 [출정하기]가 열려 있다');
  const code = await page.getAttribute('.scr-place-barracks [data-action="sortie"]', 'data-blocked');
  if (code !== 'sortie.noGarrison') fail(`기본 셋을 끝낸 뒤 [출정하기]를 막는 이유가 수비군이 아니다 — "${code}"`);
  // 수비군 이유는 단추 밑에 안 적는다 — 내관이 말한다(2026-11-12 기획자)
  if (await page.$('.stw[data-say="sortieBlocked"]')) fail('수비군이 없어 막힌 이유가 [출정하기] 밑에 글로 남아 있다');
  console.log('✓ 기본 튜토리얼 셋을 끝내면 다음 막힘은 수비군이다 — 부대를 만들라고 말한다');
}

/*
 * 현황 판 (2026-09-16, 트랙 10d) — 「문 앞에서 말한다」.
 *
 * [출정하기]가 왜 안 되는지를 예전에는 **안쪽에 들어가야만** 알았다. 가진 군량과
 * 부대 수를 문 앞에 세웠으므로, 그 셋(군량·부대·통산 전적)이 실제로 떠 있는지를
 * **글자가 아니라 `data-field`로** 본다 — 화풍이 또 바뀌어도 이 검사는 안 무너진다.
 * (참가비 줄은 2026-09-16에 뺐다 — 기획자 지정.)
 *
 * **군량 값은 계정과 맞는지까지 본다** — 「있는가」만 보면 0을 그려 놓고도
 * 통과한다(§「기본값과 같은 값을 확인하면 아무것도 확인하지 않는 것이다」).
 */
{
  const status = await page.evaluate(() => {
    const at = (f: string) => document.querySelector(`.scr-place-barracks [data-field="${f}"]`);
    const grain = at('grain');
    return {
      grain: grain?.querySelector('.v')?.textContent?.trim() ?? null,
      low: (grain as HTMLElement | null)?.dataset.low ?? null,
      // 편성 여부 넷(2026-11-16) — 칸마다 채웠는가
      squads: [...document.querySelectorAll('.scr-place-barracks .bar-sq[data-slot]')].map((e) => (e as HTMLElement).dataset.filled).join('') || null,
      record: (at('record') as HTMLElement | null)?.dataset.plays ?? null,
      tutorial: (at('tutorial') as HTMLElement | null)?.dataset.basic ?? null,
    };
  });
  for (const [f, v] of Object.entries(status)) {
    if (v === null || v === '') fail(`병영 현황에 [${f}]가 없다 — 문 앞에서 말하지 않는다`);
  }
  const mine = await apiGet();
  if (status.grain !== String(mine['grain'])) {
    fail(`병영 현황의 군량이 계정과 다르다 — 화면 "${status.grain}" vs 계정 ${mine['grain']}`);
  }
  if (status.squads !== '0000') fail(`부대가 없는데 병영 현황의 칸이 「${status.squads}」다 — 넷 다 비어야 한다`);
  if (status.record !== '0') fail(`공격대가 없는데 병영 전적의 출전 수가 ${status.record}다`);
  // 참가비를 낼 수 있는데 「모자란다」를 켜 두면 있지도 않은 벽을 그리는 것이다
  const wantLow = (mine['grain'] as number) < 3 ? '1' : '0';
  if (status.low !== wantLow) fail(`군량 부족 표시가 어긋난다 — ${status.low}, 군량 ${mine.grain}`);
  console.log(`✓ 병영 현황 — 군량 ${status.grain} · 부대 칸 ${status.squads} · 출전 ${status.record} · 튜토리얼 기본 ${status.tutorial}`);
}

// ── 부대 편성 · 배치 프리셋 (E · pptx 42·43쪽) ─────────────────
//
// **단위 테스트는 「화면이 그 함수를 부르는가」를 모른다.** 부대를 저장했는데
// 전투에 안 실리거나, 배치 프리셋이 깔리지 않거나, 이력의 부대 이름이 비는 것은
// 전부 여기서만 잡힌다 (B의 되접기·C2의 군량 충전과 같은 자리다).

await page.click('[data-action="squads"]');
await page.waitForTimeout(300);
if (!await page.$('[data-screen="squads"]')) fail('[부대 관리]를 눌렀는데 목록이 뜨지 않는다');
{
  // 칸 넷 (2026-11-14 부대 개편) — 위 3v3 · 아래 5v5, 왼쪽 공격대 · 오른쪽 수비대. 부대 수 · 정렬 · 쪽 넘김 · [새 편성] · [수비군 지정]은 없다
  const cells = await page.$$eval('.sql-row', (els) => els.map((e) => `${(e as HTMLElement).dataset.slot}:${(e as HTMLElement).dataset.filled}`));
  if (cells.join(',') !== 'atk-3v3:0,atk-5v5:0,def-3v3:0,def-5v5:0') fail(`부대 칸이 [${cells.join(' ')}]다 — 빈 칸 넷이 돌격대 3v3 · 5v5, 수성군 3v3 · 5v5 차례라야 한다`);
  const acts = await page.evaluate(() => [...document.querySelectorAll('.place-body > .sqd-acts > .btn')]
    .map((el) => (el as HTMLElement).dataset.action));
  if (acts.join(',') !== 'backBottom') fail(`부대 관리 단추 판이 [${acts.join(' ')}]다 — [뒤로 가기] 하나라야 한다`);
  // 2026-11-17 기획자 — [공격대 편성] · [수비대 편성] · 기물 머리 줄을 걷었다. 빈 줄은 주홍 획 「미편성」
  if (await page.$('[data-action="formAttack"], [data-action="formDefense"], .sql-pieces')) fail('부대 관리에 [공격대 편성] · [수비대 편성] · 기물 머리 줄이 남아 있다');
  if (await page.$$eval('.sql-row[data-filled="0"] .sql-unformed', (els) => els.length) !== 4) fail('빈 줄 넷에 「미편성」 획이 다 서지 않았다');
  if ((await page.textContent('.place-bar .place-nm'))?.trim() !== '부대 관리') fail('제목이 「부대 관리」가 아니다');
  if (await page.$('.scr-squads [data-field="cap"], .scr-squads [data-field="sort"], .scr-squads .pg-btn')) fail('부대 목록에 부대 수 · 정렬 · 쪽 넘김이 아직 있다');
  // 전적은 병영 현황판으로 옮겼다(2026-11-16 기획자) — 이 화면은 편성판(기물 칸 + 꼬마)만
  if (await page.$('.sql-row .bar-rec')) fail('부대 관리 줄에 전적이 남아 있다 — 병영 현황판으로 옮겼다');
}

/**
 * 칸 하나를 채운다 — 빈 칸 → 부대 편집(포지션·장수) → 배치 편집 → [배치 완료] → [저장] (2026-09-17, 70~72쪽 · 2026-11-14 칸 ·
 * 2026-11-17 농지 틀).
 *
 * **저장은 [저장] 한 번이다** — [배치 완료]는 편집으로 돌아올 뿐 계정을 안 바꾼다. `pieces`는 줄 차례대로의 기물이고,
 * 처음 포지션(King·Rock·Queen)과 다른 줄은 기물 아이콘을 눌러 바꾼다(농지와 같은 팝업).
 */
const makeSquad = async (slot: string, pieces: string[], deploy: boolean): Promise<void> => {
  await page.click(`.sql-row[data-slot="${slot}"]`);
  await page.waitForTimeout(250);
  if (!await page.$('[data-screen="squadEdit"][data-new="1"]')) fail(`빈 칸(${slot})이 새 부대 편성(부대원)으로 가지 않는다`);
  // 부대원이 차기 전에는 배치로 못 간다
  if (await page.isEnabled('[data-action="toDeploy"]')) fail('부대원이 비었는데 [부대 배치]가 열려 있다');

  for (const [row, piece] of pieces.entries()) {
    const now = await page.getAttribute(`.sqe-row[data-row="${row}"]`, 'data-piece');
    if (now !== piece) {
      await page.click(`[data-field="piece-${row}"]`);
      await page.waitForSelector('[data-modal="swapPiece"]');
      // 목록에는 King이 없다 — King은 맨 윗줄에 박혀 있다
      if (await page.$('[data-modal="swapPiece"] [data-piece="King"]')) fail('기물 바꾸기 목록에 King이 있다');
      await page.click(`[data-modal="swapPiece"] [data-piece="${piece}"]`);
      await page.waitForTimeout(120);
    }
    await page.click(`[data-action="pickOfficer"][data-row="${row}"]`);
    await page.waitForSelector('[data-modal="officerPick"]');
    // 줄을 누르면 카드 — 카드의 [선택하기]가 곧 고르기다(농지와 같다, 2026-11-17)
    const rows = await page.$$('[data-modal="officerPick"] .ofc-row[data-officer]');
    if (!rows[row]) fail(`보유 장수가 모자라 부대를 채울 수 없다 (${piece})`);
    await rows[row]!.click();
    await page.click('.ofcard [data-action="cardSelect"]');
    await page.waitForSelector('[data-modal="officerPick"]', { state: 'detached' });
    await page.waitForFunction((r) => !!document.querySelector(`.sqe-row[data-row="${r}"]`)?.getAttribute('data-officer'), row, { timeout: 5_000 })
      .catch(() => fail(`${row}번째 줄에 장수가 안 들어간다`));
  }
  const size = pieces.length;
  const title = (await page.textContent('[data-field="count"]'))?.trim();
  if (title !== `구성원 변경 (${size}/${size} 명)`) fail(`부대원을 다 채웠는데 제목이 「${title}」다`);
  await page.click('[data-action="toDeploy"]');
  await page.waitForTimeout(300);
  if (!await page.$('[data-screen="squadDeploy"]')) fail('[부대 배치]가 배치 편집으로 가지 않는다');

  if (deploy) {
    /*
     * **기본 배치에서 한 칸 옮겨 둔다.** 기본 그대로 저장하면 아래의 「프리셋이
     * 깔렸는가」가 **깔리지 않아도 통과한다** — 판이 어차피 같은 자리에 세우기
     * 때문이다. 방어를 넣었으면 그것이 발동하는 입력을 만들어 본다(B의 교훈).
     */
    // King 카드(2026-11-18 — 장수 카드, 한 명씩) → F16을 누르면 서고 차례가 꺼진다
    await page.click('[data-action="deployPlace"][data-piece="King"]');
    if (await page.getAttribute('.sqb-board', 'data-placing') !== 'King') fail('King의 카드를 눌렀는데 King 차례가 아니다');
    await page.click('.sqb-cell[data-x="5"][data-y="15"]');
    await page.waitForTimeout(120);
    if (await page.getAttribute('.sqb-board', 'data-placing')) fail('한 명을 세웠는데 차례가 안 꺼졌다');
    if (!await page.$('.sqb-cell[data-x="5"][data-y="15"][data-piece="King"]')) fail('배치 편집기에서 기물이 안 옮겨진다');
    await page.click('[data-action="deploySave"]');
  } else {
    // 한 번도 안 만지고 끝내면 「기본 배치로 설정됩니다」를 한 번 묻는다 (72쪽)
    await page.click('[data-action="deploySave"]');
    await page.waitForTimeout(150);
    if (!await page.$('[data-modal="deployDefault"]')) fail('배치를 안 건드리고 끝냈는데 기본 배치 안내가 없다');
    await page.click('[data-action="deployDefaultOk"]');
  }
  await page.waitForSelector('[data-screen="squadEdit"]', { timeout: 5_000 }).catch(() => fail('[배치 완료]가 부대 편집으로 돌아오지 않는다'));
  if (await page.evaluate((id) => (window as any).__profile.current.squads.some((s: { id: string }) => s.id === id), slot)) {
    fail(`[배치 완료]만으로 칸(${slot})이 저장됐다 — 저장은 [저장]에서`);
  }
  await page.click('[data-action="saveSquad"]');
  await page.waitForTimeout(300);
  // 저장하면 **목록**으로 간다 (2026-11-17 — 부대 현황이 없어졌다)
  if (!await page.$('[data-screen="squads"]')) fail(`[저장]이 목록으로 가지 않는다 (${slot})`);
  if (await page.getAttribute(`.sql-row[data-slot="${slot}"] [data-field="mark"]`, 'data-state') !== 'done') fail(`채운 칸(${slot})이 완성 표지가 아니다`);
};

await makeSquad('atk-3v3', ['King', 'Rock', 'Pawn'], false);
{
  const cell = await page.evaluate(() => {
    const el = document.querySelector('.sql-row[data-slot="atk-3v3"]') as HTMLElement | null;
    // 명단은 꼬마 장수 그림이다(2026-11-13) — 이름은 줄의 `data-names`에. 역할은 줄의 `data-role`, 칸 이름 · 전투력 글자는 목록에 없다
    // (전투력은 부대 현황 머리가 말한다 — 아래 「부대 현황」 검사)
    return { filled: el?.dataset.filled, role: el?.dataset.role ?? '', members: el?.dataset.names ?? '', stands: el?.querySelectorAll('.ofc-stand').length ?? 0 };
  });
  if (cell.filled !== '1') fail('3v3 공격대를 채웠는데 칸이 비어 있다');
  if (cell.role !== 'attack') fail(`칸의 역할이 공격대가 아니다 — "${cell.role}"`);
  if (cell.members.split(',').length !== 3 || cell.stands !== 3) fail(`구성이 세 명이 아니다 — "${cell.members}" · 꼬마 ${cell.stands}`);
  console.log(`✓ 칸 채우기 — 3v3 공격대 · ${cell.members}`);
}

/*
 * 비우기 (2026-11-17) — 부대 현황 · [부대 비우기]가 없어졌다. 부대 편집에서 부대원을 다 빼고 [저장]하면 칸이 빈다.
 */
await page.click('.sql-row[data-slot="atk-3v3"]');
await page.waitForTimeout(300);
if (!await page.$('[data-screen="squadEdit"][data-new="0"]')) fail('채운 칸을 눌렀는데 부대 편집이 아니다');
{
  const acts = await page.$$eval('.sqe-grid > .btn', (els) => els.map((b) => `${(b as HTMLElement).dataset.action}:${(b as HTMLButtonElement).disabled ? 0 : 1}`).join(','));
  if (acts !== 'toDeploy:1,garrisonPolicy:0,saveSquad:1') fail(`공격대 편집 명령이 [${acts}]다 — AI 수비 방침만 꺼져야 한다`);
}
for (let i = 0; i < 3; i += 1) {
  await page.click('.sqe-row[data-officer] >> nth=0');
  await page.click('.ofcard [data-action="cardRelease"]');
  await page.waitForTimeout(120);
}
if ((await page.textContent('[data-field="count"]'))?.trim() !== '구성원 변경 (0/3 명)') fail('다 뺐는데 (0/3 명)이 아니다');
await page.click('[data-action="saveSquad"]');
await page.waitForTimeout(300);
if (!await page.$('[data-screen="squads"]')) fail('비우고 저장했는데 목록으로 돌아오지 않는다');
if (await page.getAttribute('.sql-row[data-slot="atk-3v3"]', 'data-filled') !== '0') fail('비웠는데 칸이 아직 차 있다');
console.log('✓ 칸 비우기 — 부대원을 다 빼고 [저장]하면 칸이 빈다');

// 실제로 출전할 공격대. **배치 프리셋을 저장해 둔다** — 아래 배치 단계에서 확인한다
await makeSquad('atk-3v3', ['King', 'Rock', 'Pawn'], true);
const squadPlan = await page.evaluate(() => {
  const p = (window as any).__profile.current;
  const sq = p.squads.find((s: { id: string }) => s.id === 'atk-3v3');
  return {
    id: sq.id as string, has: 'name' in sq, count: p.squads.length as number,
    picks: (sq.picks as { piece: string; officer: string }[]),
    deploy: (sq.deploy.P1 as { piece: string; x: number; y: number }[]),
  };
});
if (squadPlan.has) fail('부대에 이름 필드가 남아 있다 — 이름은 없어졌다');
if (!squadPlan.deploy || squadPlan.deploy.length !== 3) fail('배치 프리셋이 저장되지 않았다');
// 기본 배치와 **달라야** 아래 검사가 뜻을 갖는다 (King을 F16 = 5,15 로 옮겨 뒀다)
if (!squadPlan.deploy.some((c) => c.piece === 'King' && c.x === 5 && c.y === 15)) {
  fail(`옮긴 자리가 저장되지 않았다 — ${JSON.stringify(squadPlan.deploy)}`);
}
console.log(`✓ 배치 프리셋 저장 — 남군 ${squadPlan.deploy.map((c) => `${c.piece}@${c.x},${c.y}`).join(' ')}`);

// 다시 열면 **부대 편집**이다 — 레벨은 고르는 것이 아니라 보여 주는 것이다 (2026-09-16 —
// 부대는 장수를 가리킬 뿐이고 레벨은 궁궐에서만 바뀐다). 예전 「레벨 눈금」 단추가 되살아나면 여기서 잡는다.
await page.click('.sql-row[data-slot="atk-3v3"]');
await page.waitForTimeout(300);
{
  const view = await page.evaluate(() => {
    const roster = (window as any).__profile.current.roster as Record<string, { level: number }>;
    return {
      screen: document.querySelector('[data-screen="squadEdit"][data-new="0"]') !== null,
      rows: document.querySelectorAll('.sqe-members .sqe-row').length,
      filled: [...document.querySelectorAll('.sqe-row[data-officer]')].map((el) => {
        const officer = (el as HTMLElement).dataset.officer ?? '';
        return {
          piece: (el as HTMLElement).dataset.piece ?? '',
          shown: `Lv${el.querySelector('.lv-badge')?.getAttribute('data-level') ?? ''}`,
          owned: roster[officer]?.level ?? -1,
          status: el.querySelector('[data-field="status"]')?.getAttribute('data-injured') ?? '',
        };
      }),
      buttons: document.querySelectorAll('button[data-level]').length,
      head: document.querySelector('.sqe-top [data-field="squadHead"]')?.textContent ?? '',
    };
  });
  if (!view.screen) fail('칸을 눌렀는데 부대 편집이 아니다');
  // 3v3도 **다섯 줄짜리 판**이다 — 아래 두 줄은 「자리 없음」
  if (view.rows !== 5) fail(`부대 편집이 다섯 줄이 아니다 — ${view.rows}`);
  if (view.filled.length !== 3) fail(`채워진 줄이 3이 아니다 — ${view.filled.length}`);
  if (view.buttons > 0) fail('레벨을 고르는 단추가 남아 있다');
  // ⚠ 새 계정의 장수는 전부 Lv1이라 「보유 레벨과 같은가」는 **기본값과 같은 값**을 보는
  // 검사다 — 레벨업이 모든 부대에 반영되는지는 `squads.test.ts` §5가 키운 장수로 고정한다
  if (view.filled.some((x) => x.shown !== `Lv${x.owned}`)) fail(`표시 레벨이 보유 레벨이 아니다: ${JSON.stringify(view.filled)}`);
  if (view.filled.some((x) => x.status !== '0' && x.status !== '1')) fail('상태(건강/부상) 칸이 비었다');
  if (view.head.trim() !== '돌격대') fail(`부대 편집 맨 위 판이 「돌격대」가 아니다 — "${view.head}"`);
  console.log(`✓ 부대 편집 — [${view.filled.map((x) => x.piece).join(' ')}] · 레벨은 읽기 전용(보유 레벨)`);
}
await page.click('[data-action="back"]');
await page.waitForTimeout(250);
await page.click('[data-action="back"]');
await page.waitForTimeout(300);
if (!await page.$('.scr-place-barracks')) fail('부대 목록에서 병영으로 돌아오지 못한다');
{
  // 병영 현황판의 편성 여부 — 방금 채운 3v3 공격대만 「편성 완료」 (2026-11-16)
  const board = await page.evaluate(() => [...document.querySelectorAll('.scr-place-barracks .bar-sq[data-slot]')].map((e) => `${(e as HTMLElement).dataset.slot}:${(e as HTMLElement).dataset.filled}`).sort());
  if (board.join(',') !== 'atk-3v3:1,atk-5v5:0,def-3v3:0,def-5v5:0') fail(`병영 현황의 편성 여부가 [${board.join(' ')}]다`);
  console.log(`✓ 병영 부대 칸 — [${board.join(' ')}]`);
}

/*
 * 수비군 (2026-10-27, GDD §8.8 단계 1 · 2026-11-14 수비대) — 두 모드의 **수비대**가 서야 [출정하기]가 열린다.
 * **공격대만 있는 지금 막혀 있어야** 「채우면 열린다」가 뜻을 갖는다(검사할 상태를 먼저 만든다).
 */
{
  const blocked = await page.getAttribute('.scr-place-barracks [data-action="sortie"]', 'data-blocked');
  if (blocked !== 'sortie.noGarrison') fail(`공격대만 있는데 [출정하기]를 막는 이유가 수비군이 아니다 — "${blocked}"`);
  await page.click('[data-action="squads"]');
  await page.waitForTimeout(300);
  await makeSquad('def-3v3', ['King', 'Rock', 'Pawn'], false);
  if (await page.getAttribute('.sql-row[data-slot="def-3v3"]', 'data-filled') !== '1') fail('3v3 수비대를 채웠는데 줄이 비어 있다');
  await makeSquad('def-5v5', ['King', 'Rock', 'Queen', 'Bishop', 'Knight'], false);
  // 꼬마는 기물 차례(King · Rock · Bishop · Knight · Queen · Pawn)대로 왼쪽부터 붙는다 — 편성한 차례가 아니다 (2026-11-17)
  const placed = await page.$$eval('.sql-row[data-slot="def-5v5"] .sql-cell', (els) => els.filter((e) => e.querySelector('.ofc-stand') && e.querySelector('.sql-piece')).map((e) => (e as HTMLElement).dataset.piece).join(','));
  if (placed !== 'King,Rock,Bishop,Knight,Queen') fail(`5v5 수비대의 꼬마가 기물 차례로 안 섰다 — [${placed}]`);
  // 수성군 편집 — [행동 방침]이 켜진다(돌격대는 꺼진다). 옛 부대 현황의 [수비군 설정] 자리 (2026-11-17)
  await page.click('.sql-row[data-slot="def-5v5"]');
  await page.waitForTimeout(250);
  if (!await page.$('[data-screen="squadEdit"][data-squad="def-5v5"]')) fail('5v5 수비대를 눌렀는데 부대 편집이 아니다');
  if (!await page.isEnabled('[data-action="garrisonPolicy"]')) fail('수성군 편집에 [행동 방침]이 꺼져 있다');
  if (await page.$('[data-action="garrison"], [data-action="delete"]')) fail('옛 [수비군으로 지정] · [부대 비우기]가 남아 있다');
  await page.click('[data-action="back"]');
  await page.waitForTimeout(250);
  await page.click('[data-action="back"]');
  await page.waitForTimeout(300);
  if (await page.$('.scr-place-barracks [data-action="sortie"][disabled]')) {
    const why = await page.getAttribute('.scr-place-barracks [data-action="sortie"]', 'data-blocked');
    fail(`두 모드의 수비대가 다 있는데 [출정하기]가 잠겨 있다 — "${why}"`);
  }
  const stored = await apiGet();
  if ('garrison' in stored || 'squadSeq' in stored) fail('없어진 필드(garrison · squadSeq)가 저장됐다');
  const ids = (stored['squads'] as { id: string }[]).map((x) => x.id).join(',');
  if (ids !== 'atk-3v3,def-3v3,def-5v5') fail(`서버에 저장된 부대가 칸 차례가 아니다 — [${ids}]`);
  console.log('✓ 수비대 — 공격대만 있을 땐 막히고 두 모드의 수비대를 채우면 열린다 · 수비대마다 수비군 표지 · 비우기 경고');
}

// ── 출전 · 매칭 (pptx 45쪽 · F · H2b) ───────────────────────────
//
// **단위 테스트는 「화면이 그 판정을 그리는가」를 모른다.** 「딱 최소면 [다시 찾기]가
// 아예 안 나오는가」·「거절을 반복해 바닥에 닿으면 사라지는가」는 여기서만 잡힌다.
//
// 온라인은 **진짜 대기열**을 지난다(H2b) — 흉내 통로(`?match=online`)는 지웠다
// (§5-52의 「도는 적 없는 검사」를 다시 만들지 않으려는 것). 온라인 상대가 필요한
// 자리마다 `queueBot()`으로 진짜 상대 하나를 대기열에 세워 둔다 — 거절 기억
// (§5-63) 때문에 같은 봇과는 다시 안 붙으므로 **거절할 때마다 새 봇**이 필요하다.

/**
 * 군량을 갈아 끼우고 새로고침해 병영까지 온다 — 20/20에서 17번 거절할 수는 없다.
 *
 * **서버에 직접 써야 한다** — 클라이언트 캐시(`samchess.profile.cache`)를 건드려도
 * 새로고침하면 `GET /profile`이 진짜 값으로 덮어써 버린다(캐시는 서버가 안 닿을
 * 때만 읽는 자리다). 세션은 처음 로그인 이후로 안 지웠으니 `page.goto`만으로
 * 간판을 건너뛰고 곧바로 메인으로 간다.
 */
const setGrain = async (grain: number, query: string): Promise<void> => {
  /*
   * **`PUT`으로는 못 바꾼다 ★** (2026-09-04). `PUT /profile`은 `grain`을 조용히
   * 버리고 서버 값으로 되쓴다(H3d) — 그게 규칙이므로 검사 쪽이 맞춰야 한다.
   * 스모크는 계정 API를 **제 안에서** 띄우므로 서버 함수를 직접 부른다. 시험용
   * 뒷문을 API에 뚫는 대신 이렇게 하면 **제품에 남는 표면이 없다.**
   *
   * **정산 시각도 함께 찍는다** — 안 찍으면 1분 tick이 흘러간 만큼 되채워 경계가 흐트러진다.
   */
  const stored = await getProfile(player.uid);
  if (!stored) fail('군량을 맞추려는데 서버에 계정이 없다');
  await saveProfileTrusted(player.uid, { ...stored!, grain, grainAt: Date.now() });
  await page.goto(`${BASE}/${query}`, { waitUntil: 'networkidle' });
  await page.waitForResponse((r) => r.url().includes('/profile'), { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(300);
  if (!await page.$('.scr-main')) {
    const where = await page.evaluate(() => ({
      screen: document.querySelector('#frame > *')?.className ?? '(없음)',
      body: (document.body.innerText || '').slice(0, 200),
    }));
    fail(`새로고침 뒤 메인이 아니다 — [${where.screen}] ${where.body}`);
  }
  await clickPlace('barracks');
  await page.waitForTimeout(300);
};

/**
 * 서버가 가진 군량이 `want`가 될 때까지 기다렸다가 돌려준다.
 *
 * **화면이 먼저 바뀐다** — Colyseus가 `server-api`를 부르는 것은 판을 막지 않는
 * 「알리기」라 응답을 안 기다린다(§5-61). 바로 읽으면 아직 옛 값일 수 있는데
 * 그건 어긋난 것이 아니라 **아직 도착하지 않은 것**이다. 끝내 안 오면 마지막
 * 값을 그대로 돌려주고 부르는 쪽이 실패로 적는다.
 */
const waitServerGrain = async (want: number): Promise<number> => {
  /*
   * ★ **`GET /profile`로 폴링하면 안 된다.** 그 라우트는 읽으면서 **되쓴다** —
   * 되접기·정산 결과가 저장된 것과 다르면 그 자리에서 갱신한다(의도된 설계다).
   * 반복해서 부르면 그 되쓰기가 **동시에 들어온 쓰기를 덮어쓸 수 있다** — 실제로
   * 거절 군량이 반영됐다가 다음 폴링에 4로 되돌아갔다. 그래서 여기서는 행을
   * 그대로 읽는다.
   */
  const read = async (): Promise<number> => {
    const r = await pool.query<{ data: { grain: number } }>(
      'select data from profiles where uid = $1', [player.uid]);
    return r.rows[0]?.data.grain ?? -1;
  };
  let got = await read();
  for (let i = 0; i < 20 && got !== want; i++) {
    await page.waitForTimeout(250);
    got = await read();
  }
  return got;
};

/** 병영 → [출정하기] → 구성 → 부대 고르기까지 */
const toSquadStep = async (): Promise<void> => {
  await page.click('[data-action="sortie"]');
  await page.waitForTimeout(300);
  // 3v3 부대가 있으므로 **이미 3v3이 골라진 채로** 열린다(`defaultMode`, 2026-09-25)
  if (!await page.$('.scr-sortie [data-mode="3v3"][data-on="1"]')) {
    fail('[출정하기]가 부대 있는 구성(3v3)을 미리 고르지 않았다');
  }
  await page.click('[data-mode="3v3"]');
  await page.waitForTimeout(250);
  if (!await page.$('[data-screen="sortie"][data-step="squad"]')) fail('구성을 골랐는데 부대 고르기가 아니다');
};

/** 매칭 화면이 지금 무엇을 그리고 있나 */
/**
 * [대전상대 찾기] → 공성전 도시 목록(GDD §8.8 단계 2) → [자동 매칭] — 지금까지의 매칭 화면(대기열 → AI)으로 가는 길.
 * 목록이 먼저 서는지 보고 나서 누른다(목록을 건너뛰면 그 화면이 깨져도 여기서는 모른다).
 */
async function seekAuto(): Promise<void> {
  await page.click('[data-action="seek"]');
  await page.waitForSelector('[data-screen="siege"]', { timeout: 5_000 }).catch(() => fail('[대전상대 찾기]가 공성전 도시 목록으로 가지 않는다'));
  await page.click('[data-action="autoMatch"]');
}

const matchView = () => page.evaluate(() => {
  const bar = document.querySelector('[data-screen="match"]') as HTMLElement | null;
  const q = (f: string) => document.querySelector(`[data-field="${f}"]`)?.textContent ?? '';
  return {
    state: bar?.dataset.state ?? '', kind: bar?.dataset.kind ?? '',
    name: q('foeName'), members: q('foeMembers'), odds: q('odds'), why: document.querySelector('.stw[data-say="noDecline"] [data-field="guideText"]')?.textContent ?? '',
    power: Number(document.querySelector('.mtc-foe')?.getAttribute('data-power') ?? '0'),
    decline: document.querySelector('[data-action="decline"]') !== null,
  };
});

/** 눈 확인용 — `SHOTS=폴더`를 주면 몇 장면을 찍는다(smoke:raid와 같은 통로). 안 주면 아무것도 안 찍는다 */
const shotTo = process.env['SHOTS'];
const shot = async (name: string): Promise<void> => {
  if (shotTo) await page.screenshot({ path: `${shotTo}/${name}.png` });
};

/** 매칭 바닥의 [AI 대전하기] — 없으면 null */
const aiButton = () => page.evaluate(() => {
  const b = document.querySelector('[data-action="aiNow"]') as HTMLButtonElement | null;
  return b ? { off: b.disabled, left: Number(b.dataset.left ?? '0'), label: b.textContent ?? '' } : null;
});

/** 화면이 지금 들고 있는 값 — `App.tsx`의 `window.__profile`(확인용 통로)에서 읽는다.
 *  React 상태는 저장(비동기 `PUT`)을 기다리지 않고 클릭과 **같은 틱에** 바뀌므로
 *  네트워크 완료를 안 기다려도 된다 */
const savedGrain = () => page.evaluate(() =>
  (window as any).__profile.current.grain as number);

// ── ① 군량이 넉넉할 때 — 안내문 없이 곧바로 매칭으로 (AI 갈래) ──

await setGrain(10, '?match=fast');
await toSquadStep();
await expectBgm('roster', '출전·부대 고르기');
await expectBackdrop('.scr-sortie', 'place-1-barracks.jpg', '출전');

// 45쪽의 「부대명 | 멤버 | 전투력」
const myPower = await page.evaluate(() => {
  const el = document.querySelector('.srt-row');
  const q = (f: string) => el?.querySelector(`[data-field="${f}"]`);
  return {
    name: q('name')?.textContent ?? '', members: q('members')?.textContent ?? '',
    power: Number(q('power')?.getAttribute('data-power') ?? '0'),
  };
});
if (myPower.name !== '3vs3 공격대') fail(`출전 판에 3v3 공격대가 안 뜬다 — "${myPower.name}"`);
if (!(myPower.power > 0)) fail(`전투력이 안 나온다 — ${myPower.power}`);
if (myPower.members.split(',').length !== 3) fail(`구성이 세 명이 아니다 — "${myPower.members}"`);
console.log(`✓ 출전 부대 — 「${myPower.name}」 ${myPower.power} 점 · ${myPower.members}`);

// 공격대가 곧 출전 부대라 고르지 않는다(2026-11-14) — 처음부터 체크돼 있고 [대전상대 찾기]가 열려 있다
if (await page.getAttribute('.srt-row', 'data-on') !== '1') fail('출전 판의 공격대가 체크돼 있지 않다');
if (!await page.isEnabled('[data-action="seek"]')) fail('공격대가 있는데 [대전상대 찾기]가 잠겨 있다');
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);

const grainBefore = await savedGrain();
await seekAuto();
await page.waitForTimeout(200);
// 군량이 넉넉하면 안내문 없이 지나간다 (§5-16의 표에서 `> cost` 줄)
if (await page.$('[data-modal="minGrain"]')) fail('군량이 넉넉한데 최소군량 안내가 떴다');
if (!await page.$('[data-screen="match"]')) fail('[대전상대 찾기]가 매칭 화면으로 가지 않는다');
{
  // 세 상태 중 첫째 — 「대전 상대를 찾고 있습니다..」
  const now = await matchView();
  if (now.state !== 'searching') fail(`매칭 첫 상태가 「찾는 중」이 아니다 — ${now.state}`);
  if (!await page.$('[data-field="left"]')) fail('찾는 중인데 남은 시간이 안 보인다');
  // [AI 대전하기 (N)] — 처음엔 꺼져 있고 숫자를 단다(2026-10-07). 켜진 채로 시작하면 아래 「켜진다」 검사가 아무것도 안 본다
  const ai = await aiButton();
  if (!ai || !ai.off || !(ai.left > 0) || !/\(\d\)/.test(ai.label)) fail(`[AI 대전하기]가 꺼진 채 카운트로 시작하지 않는다: ${JSON.stringify(ai)}`);
}
// AI 상대는 이제 서버가 찾는다(2026-10-15) — 서버가 막 뜬 뒤 첫 요청은 3초 넘게 걸린 적이 있어 고정 4.5초 대신 상태를 기다린다
await page.waitForFunction(() => (document.querySelector('[data-screen="match"]') as HTMLElement | null)?.dataset.state === 'found',
  null, { timeout: 10_000 }).catch(() => {});
{
  const found = await matchView();
  if (found.state !== 'found') fail(`상대를 못 찾았다 — 상태 ${found.state}`);
  // 온라인은 아직 아무도 없으므로 AI로 떨어진다
  if (found.kind !== 'ai') fail(`온라인이 안 붙었는데 상대가 ${found.kind}다`);
  if (found.name !== 'AI 부대') fail(`AI 상대의 이름이 이상하다 — "${found.name}"`);
  if (found.members.split(',').length !== 3) fail(`상대가 세 명이 아니다 — "${found.members}"`);
  /*
   * **AI 상대의 전투력이 내 부대와 가깝다** (§5-32). 등급 점수로 뽑던 시절에는
   * Lv9 S급 셋이 Lv1 S급 셋을 만났다 — 온라인이 `MATCH_BAND`로 고르는 것과 같은
   * 눈금이라야 「상대가 바뀐 것뿐」이 성립한다.
   */
  const gap = Math.abs(found.power - myPower.power);
  if (gap > 20) fail(`AI 상대가 내 부대와 멀다 — 내 ${myPower.power} 대 상대 ${found.power} (차 ${gap}, 구간 ±20)`);
  if (!found.odds.includes('예상 승률')) fail(`예상 승률이 안 보인다 — "${found.odds}"`);
  // AI에게는 거절할 상대가 없다 (§5-15 — 문이 하나가 되어도 이 경계는 남는다)
  if (found.decline) fail('AI 상대인데 [다시 찾기]가 떠 있다');
  // 「AI라 다시 찾을 수 없다」 안내는 2026-09-18에 뺐다(기획자 지정) — 남아 있으면 되살아난 것이다
  if (await page.$('[data-field="aiNote"]')) fail('뺀 안내(「AI 상대는 다시 찾을 수 없다」)가 다시 떠 있다');
  console.log(`✓ 매칭(AI) — 내 ${myPower.power} 대 상대 ${found.power} (차 ${gap}) · [다시 찾기] 없음`);
}

// **참가비는 아직 안 나갔다** — [뒤로 가기]로 나가도 한 톨도 안 준다 (§5-16)
await page.click('[data-screen="match"] [data-action="back"]');
await page.waitForTimeout(300);
if (!await page.$('[data-screen="sortie"]')) fail('매칭에서 뒤로 가기가 안 산다');
{
  const now = await savedGrain();
  if (now !== grainBefore) fail(`매칭만 하고 나왔는데 군량이 줄었다 — ${grainBefore} → ${now}`);
  console.log(`✓ 참가비 — 매칭만 하고 나오면 안 나간다 (군량 ${now} 그대로)`);
}

// ── ①-2 [AI 대전하기] — 카운트가 끝나면 켜지고, 누르면 30초를 안 기다리고 AI 상대에 선다 (2026-10-07) ──
// `?match=fast`: 켜지기 1초 · 못 찾고 AI로 3초. **켜지자마자 누르고 3초 전에 도착했는가**를 본다 —
// 늦게 누르면 시간 초과 갈래가 먼저 AI를 세워, 단추가 죽어 있어도 「찾았습니다」가 떠 통과한다.
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);
{
  await seekAuto();
  const t0 = Date.now();
  await shot('match-ai-countdown');
  await page.waitForSelector('[data-action="aiNow"]:not([disabled])', { timeout: 2_500 })
    .catch(() => fail('[AI 대전하기]가 카운트 뒤에 켜지지 않는다'));
  const lit = await aiButton();
  if (lit!.label.includes('(')) fail(`켜졌는데 카운트 숫자가 남아 있다: "${lit!.label}"`);
  await shot('match-ai-ready');
  if ((await matchView()).state !== 'searching') fail('[AI 대전하기]가 켜졌을 때 이미 찾는 중이 아니다 — 시간 초과 갈래와 구별이 안 된다');
  await page.click('[data-action="aiNow"]');
  // AI 상대는 이제 **서버가 찾는다**(시드를 서버가 뽑는다, 2026-10-15) — 인증 + DB 왕복이 끼어 1초는 빠듯하다
  await page.waitForFunction(() => (document.querySelector('[data-screen="match"]') as HTMLElement | null)?.dataset.state === 'found', null, { timeout: 5_000 })
    .catch(() => fail('[AI 대전하기]를 눌렀는데 상대 화면이 안 선다'));
  const took = Date.now() - t0;
  const got = await matchView();
  if (got.kind !== 'ai' || got.name !== 'AI 부대') fail(`[AI 대전하기] 뒤의 상대가 AI가 아니다: ${got.kind} · "${got.name}"`);
  if (took >= 3_000) fail(`[AI 대전하기]가 시간 초과(3초)보다 늦게 도착했다 — 단추가 아니라 시간 초과가 세웠을 수 있다 (${took}ms)`);
  if (await aiButton()) fail('AI 상대가 섰는데 [AI 대전하기]가 남아 있다');
  if (!await page.$('[data-action="ready"]')) fail('[AI 대전하기] 뒤에 [전투준비]가 없다 — 30초 뒤와 같은 화면이어야 한다');
  await shot('match-ai-found');
  console.log(`✓ [AI 대전하기] — 꺼진 채 (N) 카운트 → 켜짐 → 누르면 ${took}ms에 AI 부대(${got.power}) · [전투준비]`);
  await page.click('[data-screen="match"] [data-action="back"]');
  await page.waitForTimeout(300);
  if ((await savedGrain()) !== grainBefore) fail('[AI 대전하기]로 상대만 보고 나왔는데 군량이 줄었다');
}

// ── ② 딱 최소 군량 — 안내문이 뜨고 [다시 찾기]가 아예 없다 (§5-16) ──

const bot2 = await queueBot(myPower.power, 2002);
await setGrain(3, '?match=fast');
await toSquadStep();
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);
await seekAuto();
await page.waitForTimeout(250);
{
  if (!await page.$('[data-modal="minGrain"]')) fail('딱 최소 군량(3)인데 안내문이 안 뜬다 — 들어간 뒤에 알면 늦다');
  const warn = await page.textContent('[data-modal="minGrain"] [data-field="warn"]');
  if (!warn?.includes('거절을 할 수 없습니다')) fail(`안내문이 45쪽 문구가 아니다 — "${warn}"`);
  // 「있는가」와 「제자리에 있는가」는 다른 검사다 (2026-08-15에 밟은 자리)
  const spot = await page.evaluate(() => {
    const back = document.querySelector('[data-modal="minGrain"]') as HTMLElement;
    const frame = document.getElementById('frame')!.getBoundingClientRect();
    const r = back.getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2 - (frame.left + frame.width / 2)), pos: getComputedStyle(back).position };
  });
  if (spot.pos !== 'absolute' || Math.abs(spot.cx) > 2) {
    fail(`최소군량 안내가 화면 한가운데가 아니다 (${spot.pos}, 중심 어긋남 ${spot.cx}px)`);
  }
}
await shot('popup-min-grain');
await page.click('[data-action="minGrainOk"]');
// AI 상대는 이제 서버가 찾는다(2026-10-15) — 서버가 막 뜬 뒤 첫 요청은 3초 넘게 걸린 적이 있어 고정 4.5초 대신 상태를 기다린다
await page.waitForFunction(() => (document.querySelector('[data-screen="match"]') as HTMLElement | null)?.dataset.state === 'found',
  null, { timeout: 10_000 }).catch(() => {});
// 「왜 없나」는 무관이 말한다(`Say`, 2026-11-19) — 글은 서고 나서 조금 뒤에 찬다. 찾은 순간 읽으면 빈 글이다
await page.waitForFunction(() => (document.querySelector('.stw[data-say="noDecline"] [data-field="guideText"]')?.textContent ?? '') !== '',
  null, { timeout: 5_000 }).catch(() => {});
{
  const found = await matchView();
  if (found.state !== 'found') fail(`대기열의 상대를 못 찾았다 — ${found.state}`);
  if (found.kind !== 'online') fail(`대기열에 봇이 있는데 상대가 ${found.kind}다`);
  if (found.decline) fail('군량이 딱 최소(3)인데 [다시 찾기]가 떠 있다 — 매칭된 상대와 반드시 싸운다');
  if (!found.why.includes('거절을 할 수 없습니다')) fail(`[다시 찾기]가 없는 이유를 안 적는다 — "${found.why}"`);
  console.log('✓ 매칭(온라인) — 군량 3이면 [다시 찾기]가 아예 없다');
}
await bot2.close();
// **정리하고 나간다** — 열린 소켓을 안고 그대로 `page.goto()`로 넘어가면 브라우저가
// 강제로 끊으며 콘솔에 「WebSocket is already in CLOSING…」이 남는다
await page.click('[data-screen="match"] [data-action="back"]');
await page.waitForTimeout(300);

// ── ③ 거절을 반복하면 바닥에서 단추가 사라진다 ──

// 거절 기억(§5-63) 때문에 **거절 전용 봇**과 **재매칭용 봇**을 따로, **시차를 두고**
// 세운다 — 둘을 한꺼번에 대기열에 넣으면 봇끼리 먼저 매칭돼 버린다(둘 다 전투력이
// 같다). 재매칭용 봇은 **거절한 뒤에** 세워야 브라우저와 만난다.
const bot3 = await queueBot(myPower.power, 3003);
let bot4: { close: () => Promise<void> } | null = null;
await setGrain(4, '?match=fast');
await toSquadStep();
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);
await seekAuto();
await page.waitForTimeout(4500);
{
  const before = await matchView();
  if (!before.decline) fail('군량 4면 한 번은 거절할 수 있어야 한다');
  if (before.kind !== 'online') fail(`대기열의 상대를 못 찾았다 — ${before.kind}`);
  await page.click('[data-action="decline"]');
  /*
   * **거절당한 쪽(bot3)이 먼저 빠져야 한다.** `decline()`은 거절당한 쪽에게
   * 「대기열 앞자리」를 준다(§5-63) — bot3가 그대로 남아 있으면 bot4가 들어왔을 때
   * **bot3부터 집어간다**(bot3은 잘못한 게 없으니 우선이다). 표본을 하나로
   * 좁히려고 여기서 내보낸다 — 실제 대기열에선 그냥 조금 더 기다릴 뿐이다.
   */
  await bot3.close();
  bot4 = await queueBot(myPower.power, 3004);   // 거절한 뒤에야 세운다 — 위 참조
  await page.waitForTimeout(4500);
  const after = await matchView();
  const grain = await savedGrain();
  if (grain !== 3) fail(`거절이 군량 −1이 아니다 — 4 → ${grain}`);
  if (after.state !== 'found') fail(`거절 뒤 다시 찾지 않는다 — ${after.state}`);
  if (after.kind !== 'online') fail(`거절 뒤 대기열의 다른 상대를 못 찾았다 — ${after.kind}`);
  // 「다시 찾기」는 **다른 상대**를 물어 와야 한다 — 거절한 상대와는 다시 안 붙는다(§5-63)
  if (after.members === before.members) fail(`거절했는데 같은 상대다 — "${after.members}"`);
  // **바닥에 닿으면 화면 안에서 사라진다** — 진입 전 안내문만으로는 못 막는 자리다
  if (after.decline) fail('군량이 참가비(3)에 닿았는데 [다시 찾기]가 남아 있다');
  console.log('✓ 거절 — 군량 4 → 3, 상대가 바뀌고, 바닥에서 단추가 사라진다');

  /*
   * **화면의 값(`savedGrain`)만으로는 H3b를 증명하지 못한다** — 클라이언트가
   * 여전히 `declineMatch()`를 로컬로 계산해 화면에 낸다(이번 세션에서 안 바꿨다).
   * `QueueRoom.doDecline()`이 `server-api`를 직접 불러 **DB에 남긴 값**을
   * `apiGet()`(서버 GET, 화면을 안 거친다)으로 따로 확인해야 서버 재검증이
   * 실제로 도는지 안다.
   */
  const serverGrainAfterDecline = await waitServerGrain(3);
  if (serverGrainAfterDecline !== 3) {
    fail(`거절 군량이 server-api에 안 남았다(H3b) — 서버 grain=${serverGrainAfterDecline}, 화면=3`);
  }
  console.log('✓ 거절 군량 — server-api가 직접 반영했다(H3b, 클라이언트 값이 아니라 서버 GET으로 확인)');
}
await bot4?.close();
await page.click('[data-screen="match"] [data-action="back"]');   // 위 참조 — 정리하고 나간다
await page.waitForTimeout(300);

// ── ④ 전투준비 — **여기서** 참가비가 나간다 ──

await setGrain(10, '?match=fast');
await toSquadStep();
await page.click('.srt-row [data-action="pickSquad"]');
await page.waitForTimeout(150);
await seekAuto();
await page.waitForTimeout(4500);
if (!await page.$('[data-action="ready"]')) fail('상대를 찾았는데 [전투준비]가 없다');
const grainAtReady = await savedGrain();

// ── 전투준비 → 배치 → 정찰 → 전투 (GDD §3.9) ──────────────────

await page.click('[data-action="ready"]');
await page.waitForTimeout(4500);

// **참가비는 [전투준비]에서만 나간다** (§5-16 · GDD §6.1). 3v3이므로 −3
{
  const now = await savedGrain();
  if (now !== grainAtReady - 3) fail(`참가비가 [전투준비]에서 안 나갔다 — ${grainAtReady} → ${now}`);
  console.log(`✓ 참가비 — [전투준비]에서 ${grainAtReady} → ${now} (3v3 −3)`);

  // 거절과 같은 이유로 서버 GET을 직접 물어 H3b를 확인한다 — `QueueRoom.openBattle()`이
  // 좌석을 예약하기 **전에** `chargeGrain`을 기다리므로(economy.ts) 이 시점엔 이미 반영돼 있다
  const serverGrainAfterFee = await waitServerGrain(now);
  if (serverGrainAfterFee !== now) {
    fail(`참가비가 server-api에 안 남았다(H3b) — 서버 grain=${serverGrainAfterFee}, 화면=${now}`);
  }
  console.log('✓ 참가비 — server-api가 직접 반영했다(H3b, 클라이언트 값이 아니라 서버 GET으로 확인)');
}

/** 씬에서 지금 단계를 뽑아 온다 */
const stage = () => page.evaluate(() => {
  const pb = (window as any).__battle?.scene?.debugPlayback;
  return pb ? {
    phase: pb.phase as string,
    engine: pb.state.phase as string,
    ready: pb.state.ready as Record<string, boolean>,
    remain: pb.remainingSec as number | null,
    button: document.querySelector('#ctx-prep button.go')?.textContent ?? '',
    // 배치 판(`#ctx-prep`, 전투 UI 개편 5단계)은 배치 · 정찰이 아니면 비어서 `data-phase`가 `''`다
    hidden: ((document.getElementById('ctx-prep') as HTMLElement | null)?.dataset.phase ?? '') === '',
    mine: Object.values(pb.state.units as Record<string, any>)
      .filter((u: any) => u.side === 'P1').map((u: any) => `${u.pos.x},${u.pos.y}`) as string[],
  } : null;
});

let stg = await stage();
if (stg?.phase !== 'deploying') fail(`출전 뒤 배치 단계가 아니다 (${stg?.phase} / ${stg?.engine})`);
if (stg.hidden) fail('배치 단계인데 배치 패널이 숨겨져 있다');
// 상대(AI)는 기다릴 것이 없으므로 곧바로 준비를 마친다 — 「매칭 대기」가 눈에 안 보인다
if (!stg.ready['P2']) fail('AI가 준비를 마치지 않았다 — 배치에서 멈춘다');
if (stg.ready['P1']) fail('내가 준비를 누르지도 않았는데 준비 상태다');
// 배치 30초 · 정찰 30초 (2026-08-04 조정) — 배치가 길면 판이 늘어진다
if (!stg.remain || stg.remain > 30) fail(`배치 제한시간이 이상하다: ${stg.remain} (30초여야 한다)`);

/*
 * **배치 프리셋이 실제로 깔렸는가** (E · §5-14). 저장은 됐는데 전투에 안 실리면
 * 화면에는 「어라, 기본 배치네」로만 보인다 — 규칙 테스트로는 잡히지 않는 자리다.
 * 프리셋은 「초기값」이지 「확정」이 아니라, 아래에서 그대로 한 칸 옮겨 본다.
 */
{
  const want = [...squadPlan.deploy].map((c) => `${c.x},${c.y}`).sort().join(' ');
  const got = [...stg.mine].sort().join(' ');
  if (want !== got) fail(`저장한 배치가 안 깔렸다 — 저장 [${want}] / 판 [${got}]`);
  console.log(`✓ 배치 프리셋 적용 — [${got}] (전투 시작 때 이대로 깔린다)`);
}
console.log(`✓ 배치 단계 — 남은 ${stg.remain}초, 버튼 "${stg.button}", 내 기물 [${stg.mine.join(' ')}]`);
// 배치·정찰은 전투와 **다른 곡**이다. 화면은 그 경계를 모르고 단계만 안다
await expectBgm('prep', '배치·정탐');

// 내 기물을 골라 진영 안 다른 칸으로 옮긴다
const placedBefore = stg.mine.join(' ');
const spot = await page.evaluate(() => {
  const pb = (window as any).__battle.scene.debugPlayback;
  const u = Object.values(pb.state.units as Record<string, any>).find((x: any) => x.side === 'P1') as any;
  /*
   * **옮길 자리는 배치 구역 안이어야 한다.** 예전에는 `y - 2`였는데, E의 배치
   * 프리셋이 기물을 구역 맨 윗줄로 옮겨 두자 목적지가 **구역 밖**이 되어 엔진이
   * 거부했다 — 화면에서는 「안 옮겨진다」로만 보인다. 한 칸씩만 움직인다.
   */
  return {
    from: { x: u.pos.x, y: u.pos.y },
    to: { x: u.pos.x + 1, y: u.pos.y < 19 ? u.pos.y + 1 : u.pos.y - 1 },
  };
});
const cell = (x: number, y: number) => page.evaluate(([px, py]) => {
  const sc = (window as any).__battle.scene;
  const r = (sc.game.canvas as HTMLCanvasElement).getBoundingClientRect();
  const v = sc.cameras.main.worldView;
  return {
    x: r.left + ((px * 96 + 48 - v.x) / v.width) * r.width,
    y: r.top + ((py * 120 + 60 - v.y) / v.height) * r.height,
  };
}, [x, y]);

let at = await cell(spot.from.x, spot.from.y);
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(200);
// 고르면 진영 안 빈 칸이 칠해진다 (엔진의 배치 구역과 같은 자리)
if (await page.evaluate(() => (window as any).__battle.scene.debugMarkCommands()) === 0) {
  fail('기물을 골라도 배치 가능한 칸이 표시되지 않는다');
}
at = await cell(spot.to.x, spot.to.y);
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(300);

stg = await stage();
if (stg!.mine.join(' ') === placedBefore) fail(`배치에서 기물이 옮겨지지 않았다: ${placedBefore}`);
console.log(`✓ 배치 이동 — [${placedBefore}] → [${stg!.mine.join(' ')}]`);

// 준비완료 → 정찰
await page.click('#ctx-prep button.go');
await page.waitForTimeout(400);
stg = await stage();
if (stg?.phase !== 'scouting') fail(`준비완료 뒤 정찰이 아니다 (${stg?.phase} / ${stg?.engine})`);
if (!stg.ready['P1']) fail('준비완료를 눌렀는데 ready가 서지 않았다');
if (!stg.remain || stg.remain > 30) fail(`정찰 제한시간이 이상하다: ${stg.remain} (30초여야 한다)`);
// 정찰은 끝까지 세되 마지막 5초만 숫자를 보여준다 (GDD §3.9)
// 카운트는 판 한가운데(`#countdown`, pptx 100쪽). 글자 칸이 **있는데 비어 있는가**를 본다 — 칸째 없으면 이 검사는 언제나 통과한다
const clockShown = await page.evaluate(() => document.querySelector('#countdown .cd-num')?.textContent ?? 'missing');
if (clockShown !== '') fail(`정찰 초반에는 카운트다운을 숨겨야 한다: "${clockShown}"`);
console.log(`✓ 정찰 단계 — 남은 ${stg.remain}초, 버튼 "${stg.button}" (카운트다운은 마지막 5초부터)`);

// 전투 시작
await page.click('#ctx-prep button.go');
await page.waitForTimeout(1500);
stg = await stage();
if (stg?.engine === 'scout' || stg?.engine === 'deploy') fail(`전투가 시작되지 않았다 (${stg?.engine})`);
if (!stg!.hidden) fail('전투가 시작됐는데 배치 패널이 남아 있다');
console.log(`✓ 전투 시작 — ${stg!.phase} / ${stg!.engine}`);
await expectBgm('battle', '전투');

const battle = await page.evaluate(() => {
  const scene = (window as any).__battle?.scene;
  const state = scene?.debugPlayback?.state;
  return state ? {
    mode: state.mode as string,
    units: Object.keys(state.units).length,
    mine: Object.values(state.units as Record<string, any>).filter((u: any) => u.side === 'P1').map((u: any) => u.officer),
    board: !!document.getElementById('board'),
  } : null;
});
if (!battle) fail('출전했는데 전투가 뜨지 않는다');
if (battle.units !== 6) fail(`3v3인데 유닛이 ${battle.units}개다`);
if (!battle.board) fail('전투 화면의 판 자리가 없다');
console.log(`✓ 전투 진입 — ${battle.mode}, 유닛 ${battle.units} (내 편성 ${battle.mine.join(', ')})`);

/*
 * 참가비가 **얼마 나갔는지는 위에서 이미 봤다** ([전투준비] 앞뒤로 10 → 7).
 * 여기서는 아래 「결과가 계정에 반영되는가」의 기준값으로만 들고 간다 —
 * 예전에는 `20 → 17`을 여기서 못박고 있었는데, 그것은 **새 계정의 상한(20)에서
 * 시작한다**는 말없는 전제였다. 군량을 갈아 끼우는 검사가 생기자 곧바로 깨졌다.
 */
const grain = await page.evaluate(() => (window as any).__profile.current.grain as number);
if (grain !== grainAtReady - 3) fail(`참가비가 어긋난다 — ${grainAtReady} → ${grain}`);

/*
 * **패배 카드가 새 장수를 데려올 수 있다** (2026-09-14) — C·D 후보에 「아직 없는 C·D」가
 * 들어 있어, 풀에 자리가 있으면 여섯째가 들어온다. 어느 쪽인지는 시드가 정한다.
 * 그래서 아래의 「다섯 줄」·「5 / 최대 60」은 고정값이 아니라 **판 전의 명단 + 받은 카드**로
 * 기대값을 짓는다 — 화면이 보여 주는 명단을 거꾸로 기대값으로 삼으면 아무것도 안 잰다.
 */
const rosterBeforeBattle = await page.evaluate(() =>
  Object.keys((window as any).__profile.current.roster) as string[]);
// 시작 다섯 + **튜토리얼 첫 클리어 보상**(2026-11-11 — C~D급 카드 1장, 아직 없는 장수면 풀에 든다)이 출정 필수 판마다 많아야 하나.
// 「다섯」으로 못박았다가 그 보상이 생긴 뒤 8에서 떨어졌고(2026-11-12), 「≤3」으로 적어 둔 것은 필수 판이 다섯이 되며(일기토 · 설전,
// 2026-11-14) 10에서 떨어졌다 — **상한은 숫자로 적지 않고 필수 판 수에서 낸다.** 아래 기대값은 이 명단에서 짓는다
const rosterMax = 5 + SORTIE_TUTORIALS.length;
if (rosterBeforeBattle.length < 5 || rosterBeforeBattle.length > rosterMax) fail(`판 전 명단이 시작 다섯 + 튜토리얼 보상(≤${SORTIE_TUTORIALS.length}) 밖이다 — ${rosterBeforeBattle.length}`);
let lossCard: { officer: string; grade: string; isNew: boolean } | null = null;
/** 항복 직전에 서버가 덧붙여 둔 수 — 정산 뒤 같은 기록을 다시 보내 거절되는지 본다 */
let aiIntentsBeforeSurrender: unknown[] = [];

// ── 항복 → 결과 화면 → 계정 반영 (pptx 45쪽 보상표 · C1) ────────
//
// 전투를 끝까지 두면 몇 분이 걸리므로 **항복으로 끊는다.** 여기서 보는 것은 승패가
// 아니라 **잇는 자리**다 — 엔진이 낸 결말이 보상표를 지나 계정에 남는가. 규칙 자체는
// `npm test`가 열두 조합으로 보고, 화면이 그 둘을 잇지 못하는 것은 여기서만 잡힌다.
{

  // **내 차례가 아니면 항복도 못 낸다** — `Playback.submit()`이 `awaitingInput`이
  // 아닌 의도를 조용히 버린다(연출 중에도 마찬가지다). 예전 [항복](기록 안)은 그때도
  // 눌리는데 아무 일이 없어, 고정 대기로 눌렀다가 「결과가 안 뜬다」로 보였다.
  // 지금 [항복]은 게임 정보(위 칸)에 있고 내 차례에만 켜진다(전투 UI 개편 3단계).
  await page.waitForFunction(() => {
    const pb = (window as any).__battle?.scene?.debugPlayback;
    return pb?.phase === 'awaitingInput';
  }, undefined, { timeout: 30_000 }).catch(() => fail('30초를 기다려도 내 차례가 오지 않는다'));

  /*
   * **끊긴 AI 대전은 같은 판으로 돌아온다** (2026-10-15) — 판 시작을 서버가 굳히고(시드 · 명단), 싸우는 동안 낸 수를
   * 덧붙여 둔다. 새로고침하면 그 수까지 재생한 **끊긴 자리**로 곧바로 간다. 같은 시각 · 같은 난수 자리여야 같은 판이다.
   */
  const pb = () => page.evaluate(() => {
    const s = (window as any).__battle?.scene?.debugPlayback?.state;
    return s ? { time: s.time as number, rng: s.rngCursor as number, seed: s.seed as number } : null;
  });
  const before = await pb();
  let saved = (await getProfile(player.uid))?.aiBattle;
  for (let i = 0; i < 20 && (saved?.intents?.length ?? 0) === 0; i++) {
    await page.waitForTimeout(250);
    saved = (await getProfile(player.uid))?.aiBattle;
  }
  if (saved?.status !== 'fighting') fail(`서버에 굳힌 AI 대전이 없다 — ${saved?.status ?? '없음'}`);
  if (saved!.seed !== before?.seed) fail(`판의 시드가 서버 것이 아니다 — 화면 ${before?.seed} · 서버 ${saved!.seed}`);
  await page.waitForTimeout(800);   // 마지막 수(준비)가 덧붙여질 틈
  aiIntentsBeforeSurrender = (await getProfile(player.uid))!.aiBattle!.intents ?? [];
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'awaitingInput',
    undefined, { timeout: 30_000 }).catch(() => fail('새로고침했는데 끊긴 AI 대전으로 돌아오지 않는다'));
  const after = await pb();
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    fail(`돌아온 판이 끊긴 자리가 아니다 — 전 ${JSON.stringify(before)} · 후 ${JSON.stringify(after)}`);
  }
  console.log(`  ✓ 끊긴 AI 대전 — 새로고침 → 같은 판(시드 ${after!.seed} · 시각 ${after!.time} · 난수 ${after!.rng}, 덧붙인 수 ${aiIntentsBeforeSurrender.length})`);

  await page.click('#gameinfo .gi-act[data-action="surrender"]:not([disabled])');
  // 되돌릴 수 없어 한 번 더 묻는다 — 판 위 목판 팝업(2026-10-10, 브라우저 기본 창이 아니다)
  await page.click('[data-modal="surrender"] button[data-action="surrender"]', { timeout: 5_000 })
    .catch(() => fail('[항복] 물음 팝업이 안 뜬다'));
  // **곧바로 끝나지 않는다** — 판은 자기가 설명하는 것을 기다린다(`systemLog.timeToDrain()`).
  // 밀린 말풍선이 많을수록 길어지므로 고정 대기는 어쩌다 한 번 실패한다
  await page.waitForSelector('[data-screen="result"]', { timeout: 20_000 })
    .catch(() => fail('항복했는데 결과 화면이 안 뜬다 (20초)'));
  if (await page.$('[data-modal="burst"], [data-modal="rewardCards"]')) fail('결말 장보다 먼저 카드 공개가 떴다 — 결말 장과 보상 장 사이여야 한다');
  await page.waitForTimeout(300);

  // **같은 판은 한 번만 정산된다** — 예전에는 같은 승리 기록을 다시 보내면 보상이 다시 나왔다(2026-10-15)
  {
    const stored = await getProfile(player.uid);
    if (stored?.aiBattle) fail(`정산했는데 서버에 판이 남았다 — ${stored.aiBattle.status}`);
    const again = await fetch(`${API}/battle/ai-result`, {
      method: 'POST', headers: { Authorization: `Bearer ${player.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ humanIntents: [...aiIntentsBeforeSurrender, { t: 'surrender' }] }),
    });
    const code = ((await again.json().catch(() => ({}))) as { code?: string }).code;
    if (again.status !== 409 || code !== 'ai.notFighting') fail(`같은 판을 다시 정산했는데 받아 줬다 — ${again.status} ${code}`);
    console.log('  ✓ 같은 기록을 다시 보내면 거절 — 409 ai.notFighting');
  }

  /*
   * **두루마리를 넘기며 읽는다** (2026-10-12 화풍) — 결말 → 보상 → 전과. 장마다 글자를 지웠다 다시
   * 쓰므로 세 장의 값이 한 번에 화면에 있지 않다. 그리고 **마지막 장 전에는 나가는 단추가 없어야 한다** —
   * 무승부 택1 중에 나가 보상을 놓치는 길을 그것으로 닫았다(장 넘김을 고치다 단추를 늘 띄우면 여기서 깨진다).
   */
  const turn = async (to: string): Promise<void> => {
    if (await page.$('[data-screen="result"] [data-action="home"]')) fail(`마지막 장 전인데 [도시로]가 있다 (「${to}」 장 앞)`);
    await page.click('[data-screen="result"] .brs-stage');
    await page.waitForSelector(`[data-screen="result"][data-page="${to}"]`, { timeout: 5_000 })
      .catch(() => fail(`두루마리를 눌러도 「${to}」 장으로 안 넘어간다`));
    await page.waitForTimeout(300);
  };
  await page.waitForSelector('[data-screen="result"][data-page="title"]', { timeout: 5_000 })
    .catch(() => fail('결과 화면이 첫 장(결말)으로 시작하지 않는다'));
  /*
   * 결말 장 — 「승 리 / 패 배」 → 사유 → 받은 보상 줄이 하나씩 튀어나온다(2026-11-26 기획자). 받은 보상은 **이 장에** 적힌다(군량 · 재료 ·
   * 「캐릭터 보상 n명」 — 안 준 것은 줄째 없다). 다 선 뒤 누르면 「보상」이 서고 화면째 어두워져 캐릭터 보상(장수 모집 결과와 같은 무대),
   * 닫으면 밝아지며 「보상」 아래 받은 장수 줄. 패배도 카드 한 장이라 언제나 뜬다 — 「보상 장의 장수 = 연출의 장수 = 결말 장의 수」를 본다
   */
  const revealed: string[] = [];
  await page.waitForSelector('[data-screen="result"][data-page="title"][data-settled="1"]', { timeout: 10_000 })
    .catch(() => fail('결말 장의 줄이 다 서지 않는다'));
  await shot('result-1-title');
  const gains = await page.evaluate(() => {
    const scr = document.querySelector('[data-screen="result"]') as HTMLElement;
    const shown = (sel: string): Element | null => scr.querySelector(`.brs-beat:not([data-wait]) ${sel}`);
    return {
      grain: shown('[data-field="grain"]')?.textContent?.trim() ?? '',
      cardCount: Number(shown('[data-field="cardCount"]')?.getAttribute('data-n') ?? 0),
      // 안 준 보상은 줄째 없다 — 「없음」이 보이면 안 된다
      none: [...scr.querySelectorAll('.brs-beat')].some((b) => /없음/.test(b.textContent ?? '')),
    };
  });
  if (gains.none) fail('결말 장에 「없음」 줄이 있다 — 안 준 보상은 줄째 빼야 한다');
  await page.click('[data-screen="result"] .brs-stage');
  await page.waitForSelector('[data-screen="result"][data-page="reward"] .brs-beat:not([data-wait]) [data-field="rewardsTitle"]', { timeout: 5_000 })
    .catch(() => fail('결말 장을 넘겼는데 「보상」이 안 선다'));
  if (await page.$('[data-modal="rewardCards"]')) fail('「보상」이 서기도 전에 캐릭터 보상이 떴다');
  await page.waitForSelector('[data-screen="result"][data-veil]', { timeout: 5_000 })
    .catch(() => fail('「보상」이 섰는데 두루마리가 어두워지지 않는다'));
  await page.waitForTimeout(300);
  await shot('result-2-veil');
  await page.waitForSelector('[data-modal="rewardCards"]', { timeout: 10_000 })
    .catch(() => fail('어두워진 뒤 캐릭터 보상이 안 뜬다'));
  if (await page.$('[data-screen="result"] .brs-beat:not([data-wait]) [data-field="rewards"]')) fail('캐릭터 보상 중인데 받은 장수 줄이 이미 섰다');
  if (await page.$('[data-modal="burst"]')) fail('전투 보상 카드에 섬광이 떴다 — 2026-10-23에 뺐다');
  await page.waitForTimeout(900);
  await shot('result-3-cards');
  revealed.push(...await page.$$eval('[data-modal="rewardCards"] .rcr-member[data-officer]',
    (els) => els.map((el) => (el as HTMLElement).dataset.officer ?? '')));
  await page.click('[data-action="rewardCardsOk"]');
  await page.waitForTimeout(350);
  await shot('result-4-lift');
  await page.waitForSelector('[data-screen="result"][data-page="reward"]:not([data-veil]) .brs-beat:not([data-wait]) [data-field="rewards"]', { timeout: 5_000 })
    .catch(() => fail('캐릭터 보상을 닫았는데 밝아지며 받은 장수 줄이 안 선다'));
  await page.waitForTimeout(900);
  await shot('result-5-reward');
  const reward = await page.evaluate(() => {
    const scr = document.querySelector('[data-screen="result"]') as HTMLElement;
    return {
      // 받은 카드의 등급 — **글자가 아니라 속성**으로 본다 (2026-09-14, 카드가 0~2장이 됐다)
      cards: [...scr.querySelectorAll('[data-field="card"][data-officer]')]
        .map((el) => (el as HTMLElement).dataset.grade ?? ''),
      cardOfficers: [...scr.querySelectorAll('[data-field="card"][data-officer]')]
        .map((el) => (el as HTMLElement).dataset.officer ?? ''),
    };
  });
  if (revealed.join(',') !== reward.cardOfficers.join(',')) {
    fail(`캐릭터 보상 연출 [${revealed}]과 보상 장의 장수 [${reward.cardOfficers}]가 다르다`);
  }
  if (gains.cardCount !== reward.cardOfficers.length) fail(`결말 장의 「캐릭터 보상 ${gains.cardCount}명」과 받은 장수 ${reward.cardOfficers.length}명이 다르다`);
  console.log(`  ✓ 받은 카드 공개 — 카드 판 [${revealed}] → 두루마리 보상 장과 같다`);
  await turn('record');
  if (!(await page.$('[data-screen="result"][data-last="1"] [data-action="home"]'))) fail('마지막 장(전과)에 [도시로]가 없다');

  const seen = await page.evaluate(() => {
    const scr = document.querySelector('[data-screen="result"]') as HTMLElement | null;
    if (!scr) return null;
    const p = (window as any).__profile.current;
    // 계정 전적 칸 — 장수 전적 칸은 2026-11-20에 없어졌다(전적은 부대로 본다)
    const cells = Object.entries((p.record ?? {}) as Record<string, unknown>);
    return {
      kind: scr.dataset.result,
      // 전과 장 — 출전한 장수마다 한 칸(꼬마 장수 · 격파 수)
      units: [...scr.querySelectorAll('.brs-unit[data-officer]')].map((el) => (el as HTMLElement).dataset.officer ?? ''),
      cells,
      matches: (p.matches as {
        opponent: string; result: string; myPower: number; chance: number;
        mySquad: string | null; theirSquad: string | null;
      }[]),
      seq: p.matchSeq as number,
      grainSaved: p.grain as number,
    };
  });
  const result = seen && { ...seen, ...reward, grain: gains.grain };
  if (!result) fail(`항복했는데 결과 화면이 뜨지 않는다 — 콘솔 [${errors.join(' | ')}]`);
  // 전과 장의 칸은 **판 전 명단**이 아니라 이 판에 낸 셋이다 — 3v3 AI
  if (result!.units.length !== 3) fail(`전과 장에 장수가 셋이 아니다: ${JSON.stringify(result!.units)}`);
  if (result!.kind !== 'lose') fail(`항복은 패배다 — 결과가 「${result!.kind}」다`);
  // 패배도 승리와 같은 양의 군량을 받는다 (2026-08-18 보상표). 3v3이므로 +1
  // AI 상대는 내 전투력에 맞춰 만들어져 언제나 「센 상대」다 — 패배는 `strongLose` 줄(2026-10-27): 군량 +1, 카드 한 장
  if (result!.grain !== '+1') fail(`패배 군량이 「${result!.grain}」다 (센 상대에게 진 판은 +1)`);
  if (result!.cards.length !== 1 || !['B', 'C', 'D'].includes(result!.cards[0]!)) {
    fail(`패배 카드는 B 이하 한 장이어야 한다: ${JSON.stringify(result!.cards)}`);
  }
  {
    const officer = result!.cardOfficers[0] ?? '';
    const grade = result!.cards[0]!;
    // 등급은 화면 속성이 아니라 데이터에서 다시 본다 — 속성이 거짓말해도 잡는다
    const real = OFFICERS.find((o) => o.id === officer)?.grade;
    if (real !== grade) fail(`패배 카드의 등급 속성(${grade})이 장수(${officer})의 실제 등급(${real})과 다르다`);
    // 보유한 B · C · D, 아니면 **새 D만** — 새 B · C는 이긴 판에서만 들어온다
    if (!rosterBeforeBattle.includes(officer) && grade !== 'D') fail(`패배에서 새 ${grade}급이 들어왔다 — 새 장수는 D급뿐이다`);
    lossCard = { officer, grade, isNew: !rosterBeforeBattle.includes(officer) };
    console.log(`✓ 패배 카드 — ${officer} (${grade}급, ${lossCard.isNew ? '새 장수' : '보유한 장수'})`);
  }
  if (result!.grainSaved !== grain + 1) fail(`군량이 계정에 안 들어갔다 — ${grain} → ${result!.grainSaved}`);

  // **순수 AI 대전은 전적 · 이력에 안 남는다** (2026-10-28 기획자 확정) — 보상(군량 · 카드)만. 「센다」로 되돌아가면 여기서 깨진다
  if (result!.cells.length !== 0) fail(`AI 대전인데 전적 칸이 생겼다: ${JSON.stringify(result!.cells)}`);
  if (result!.matches.length !== 0) fail(`AI 대전인데 이력이 남았다 — ${result!.matches.length}줄`);
  if (result!.seq !== 1) fail(`AI 대전인데 이력 줄 번호가 올랐다: ${result!.seq}`);
  console.log(`✓ 결과 반영 — 패배 · 군량 ${grain} → ${result!.grainSaved} · AI 대전은 전적 · 이력에 안 남는다`);

  /*
   * **화면 값만으로는 §5-96(AI 대전 재생 검증)을 증명 못 한다** — H3b와 같은 이유다.
   * `settleAiBattle()`이 실제로 서버를 지나 `/battle/ai-result`가 재생·저장까지
   * 했는지는 서버 GET(화면을 안 거친다)으로 따로 봐야 안다.
   */
  const serverGrainAfterResult = (await apiGet())['grain'];
  if (serverGrainAfterResult !== result!.grainSaved) {
    fail(`AI 대전 결과가 server-api에 안 남았다(§5-96) — 서버 grain=${serverGrainAfterResult}, 화면=${result!.grainSaved}`);
  }
  console.log('✓ AI 대전 결과 — server-api가 재생 검증 뒤 직접 반영했다(§5-96, 클라이언트 값이 아니라 서버 GET으로 확인)');
}

// ── 궁궐 → 장수 일람 → 상세 → 레벨업 (pptx 37·38쪽 · GDD §4.2·§4.3) ──

/*
 * **검사는 글자가 아니라 `data-*`로 건다.** 「적 책략은 가린다」를 「적군」이라는
 * 글자로 골라내고 있다가 그 글자를 빼자 검사가 조용히 통과하게 됐던 자리다
 * (2026-08-13). 여기서도 열 이름·정렬 이름은 다국어로 바뀔 수 있다.
 */

/**
 * 새로고침 — 「게임 URL로 들어오면 가장 먼저 보이는 화면」은 간판이지만, **세션이
 * 남아 있으면 `App.tsx`의 부팅 절차가 그 자리를 건너뛴다**(H3a) — 로그인은 한 번만
 * 하고, 그 뒤로는 `page.goto`만으로 곧바로 메인(또는 새 계정)으로 간다.
 *
 * **`page.goto`보다 먼저 `flush()`로 밀린 저장을 다 내보낸다.** 저장은 부르고
 * 기다리지 않으므로(§5-16과 같은 결 — 화면이 매번 막히면 안 된다) 클릭 직후에는
 * `PUT`이 아직 날아가는 중일 수 있다. 실제 새로고침(F5)이 그 요청을 끊어버릴 수
 * 있는 것은 브라우저의 일반적인 동작이지 이 계약이 막을 일이 아니다 — 하지만
 * **여기서는 "끝난 저장이 실제로 남는가"를 보려는 것**이라, 끊기지 않게 먼저 다
 * 흘려보낸다.
 */
const reenter = async (): Promise<void> => {
  await page.evaluate(() => (window as any).__profile.flush());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForResponse((r) => r.url().includes('/profile'), { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(400);
};
const toPalace = async (): Promise<void> => {
  await clickPlace('palace');
  await page.waitForTimeout(300);
};

await reenter();
await toPalace();
await expectBackdrop('.scr-place', 'place-1-palace.jpg', '궁궐');

// 37쪽의 두 갈래. **[도시 관리]는 C2(41쪽)가 열었다** — 잠겨 있으면 그게 회귀다
const palace = await page.evaluate(() => ({
  officers: !!document.querySelector('.scr-place [data-action="officers"]'),
  city: !!document.querySelector('.scr-place [data-action="city"]'),
  cityLocked: (document.querySelector('.scr-place [data-action="city"]') as HTMLButtonElement | null)?.disabled ?? false,
}));
if (!palace.officers) fail('궁궐에 [장수 일람]이 없다');
if (!palace.city) fail('궁궐에 [도시 관리] 자리가 없다 (37쪽)');
if (palace.cityLocked) fail('[도시 관리]가 안 눌린다 — C2가 연 화면이다 (41쪽)');
console.log('✓ 궁궐 — [장수 일람] · [도시 관리]');

await page.click('[data-action="officers"]');
await page.waitForTimeout(300);
if (!await page.$('[data-screen="officer-list"]')) fail('장수 일람이 뜨지 않는다');

/** 지금 표에 보이는 줄들 — 이름과 능력치 셋 */
const listRows = () => page.evaluate(() =>
  [...document.querySelectorAll('.ofc-rows .ofc-row')].map((el) => ({
    officer: (el as HTMLElement).dataset.officer!,
    name: el.querySelector('.c-nm-text')?.textContent ?? '',
    stats: [...el.querySelectorAll('.c-st')].map((s) => Number(s.textContent)),
    flag: (el as HTMLElement).dataset.levelup === '1',
  })));

let rows = await listRows();
// 초기 지급은 S·A·B·C·D 각 1명 (GDD §8) — **여기에 패배 카드가 데려온 새 장수가 더해질 수 있다**(위 참조)
const poolAfterLoss = rosterBeforeBattle.length + (lossCard?.isNew ? 1 : 0);
// 일람은 한 쪽에 여덟 줄이다(2026-11-19 — 전엔 열) — 출정 필수 튜토리얼이 다섯이 되며(2026-11-14) 보상 장수로 넘을 수 있다. 첫 쪽은 여덟까지,
// 나머지는 아래 등급 요약(`data-tally`)이 센다
const firstPage = Math.min(poolAfterLoss, 8);
if (rows.length !== firstPage) {
  fail(`일람 첫 쪽에 ${firstPage}줄이 있어야 한다(판 전 ${rosterBeforeBattle.length} + 패배 카드의 새 장수 ${lossCard?.isNew ? 1 : 0}) — 지금 ${rows.length}줄`);
}
if (lossCard?.isNew && poolAfterLoss <= 8 && !rows.some((r) => r.officer === lossCard!.officer)) {
  fail(`패배 카드로 들어온 ${lossCard.officer}가 일람에 없다`);
}
const tally = await page.getAttribute('.ofc-tally', 'data-tally');
{
  // 등급마다 = 판 전 명단의 그 등급 수 + 패배 카드의 새 장수. 「등급마다 하나」로 못박았다가 튜토리얼 첫 클리어 보상(C~D급, 2026-11-11)이
  // 생긴 뒤 떨어졌다(2026-11-12) — 위의 줄 수처럼 판 전 명단에서 짓는다
  const gradeOf = (id: string): string | undefined => OFFICERS.find((o) => o.id === id)?.grade;
  const count = (g: string): number =>
    rosterBeforeBattle.filter((id) => gradeOf(id) === g).length + (lossCard?.isNew && lossCard.grade === g ? 1 : 0);
  const want = `N/${count('S')}/${count('A')}/${count('B')}/${count('C')}/${count('D')}`;
  if (tally !== want) fail(`요약 줄이 ${want}이 아니다: ${tally}`);
}
if (rows.some((r) => r.flag)) fail('카드가 없는데 레벨업 Flag가 켜져 있다');
console.log(`✓ 장수 일람 — ${rows.length}줄, 요약 ${tally}, Flag 전부 꺼짐`);

// 정렬 — 무력순은 높은 쪽이 위다 (37쪽 「무력/지력/통솔력 sorting」)
//
// **늘 펴 둔 칩(`[data-sort]`)이 아니라 [정렬 필터] 팝업이다** — 2026-09-02에
// 랭킹의 `SortMenu`를 재사용하도록 바뀌었는데 이 줄이 안 따라와, 그 뒤로
// 스모크가 여기서 30초를 기다리다 죽고 **뒤따르는 검사가 한 번도 안 돌았다**
// (2026-09-11에 발견). 「스모크는 첫 실패에서 멈춘다」의 재발이다.
// **2026-11-19부터는 열 머리를 누른다**(`SortHead` — 초록 네온 = 큰 것이 위, 한 번 더 누르면 주홍 = 반대). 처음엔 이름에 초록
const sortBy = async (key: string): Promise<void> => {
  await page.click(`.ofc-thead [data-sort="${key}"]`);
  await page.waitForTimeout(150);
};
if (await page.getAttribute('.ofc-thead [data-sort="name"]', 'data-neon') !== 'green') fail('처음 들어왔는데 이름 머리에 초록 네온이 없다');
if (await page.$('.ofc-sortrow, [data-action="sortMenu"]')) fail('옛 정렬 단추 · 지금 기준 나무판이 남아 있다');
await sortBy('might');
if (await page.getAttribute('.ofc-thead [data-sort="might"]', 'data-neon') !== 'green') fail('무력 머리를 눌렀는데 초록 네온이 아니다');
rows = await listRows();
for (let n = 1; n < rows.length; n++) {
  if (rows[n - 1]!.stats[0]! < rows[n]!.stats[0]!) {
    fail(`무력 정렬이 어긋난다: ${rows.map((r) => `${r.name}(${r.stats[0]})`).join(' ')}`);
  }
}
console.log(`✓ 정렬(무력) — ${rows.map((r) => `${r.name} ${r.stats[0]}`).join(' · ')}`);
await sortBy('might');
if (await page.getAttribute('.ofc-thead [data-sort="might"]', 'data-neon') !== 'orange') fail('무력 머리를 한 번 더 눌렀는데 주홍 네온이 아니다');
rows = await listRows();
for (let n = 1; n < rows.length; n++) {
  if (rows[n - 1]!.stats[0]! > rows[n]!.stats[0]!) fail(`주홍(반대) 무력 정렬이 어긋난다: ${rows.map((r) => r.stats[0]).join(' ')}`);
}
console.log('✓ 정렬(무력 주홍) — 작은 것이 위');

// 검색 — 이름 부분일치. 어느 장수가 지급됐는지는 시드가 정하므로 **한 줄에서 뽑아** 쓴다
await sortBy('name');
const target = (await listRows())[0]!;
// 장수 일람의 검색칸은 **타이핑하는 대로** 걸러진다(랭킹의 `SearchBar`와 달리
// 제출 버튼이 없다 — 서버에 묻지 않고 이미 가진 줄을 거르기 때문이다).
const searchFor = async (text: string): Promise<void> => {
  await page.fill('[data-field="search"]', text);
  await page.waitForTimeout(150);
};
await searchFor(target.name);
rows = await listRows();
if (!rows.some((r) => r.officer === target.officer)) fail(`「${target.name}」를 검색했는데 안 나온다`);
if (rows.length !== 1) fail(`「${target.name}」 검색에 ${rows.length}줄이 나왔다`);
await searchFor('없는이름');
if ((await listRows()).length !== 0) fail('없는 이름을 검색했는데 줄이 남는다');
await page.fill('[data-field="search"]', '');
await page.waitForTimeout(150);
console.log(`✓ 검색 — 「${target.name}」 1줄, 없는 이름 0줄`);

/*
 * 장수 카드 (38쪽). ★ **2026-09-02부터 전면 화면이 아니라 카드 팝업이다** — 줄을 누르면
 * 랭킹의 장수 카드(`OfficerCardModal`)가 뜨고 [레벨/스킬 관리]는 그 위에 판
 * (`LevelUpPanel`)으로 겹친다. 옛 상세·레벨업 화면(`OfficerDetailScreen`·`LevelUpScreen`)은
 * 일람에서 가는 길이 없어졌는데 스모크가 계속 그 화면을 찾았다 — 앞의 H3b 막힘에 가려
 * **한 번도 안 돌아서** 2026-09-14에야 드러났다. 개발용 카드·금화 지급도 장터로 옮겨 갔다.
 */
const openCardOf = async (officer: string): Promise<void> => {
  await page.click(`.ofc-row[data-officer="${officer}"]`);
  await page.waitForSelector('.ofcard-modal', { timeout: 5_000 })
    .catch(() => fail(`일람에서 ${officer} 줄을 눌렀는데 장수 카드가 뜨지 않는다`));
};
const closeCard = async (): Promise<void> => {
  await page.click('.ofcard-modal [data-action="closeCard"]');
  await page.waitForTimeout(150);
  if (await page.$('.ofcard-modal')) fail('장수 카드의 [X]를 눌렀는데 닫히지 않는다');
};
await openCardOf(target.officer);
const detail = await page.evaluate(() => {
  const card = document.querySelector('.ofcard-modal')!;
  return {
    name: card.querySelector('.ofcard-name')?.textContent?.trim() ?? '',
    lv: card.querySelector('.ofcard-bar-lv')?.textContent?.trim() ?? '',
    // 전적은 승 · 무 · 패 · 격파 아이콘 + 숫자다(2026-10-26) — 칸의 값으로 「승 / 무 / 패」를 만든다
    // 장수 전적은 카드에 없다(2026-11-19 기획자 — 전적은 부대만). 여섯 값만: 무력 · 지력 · 통솔 / HP · MP · AT
    rec: !!card.querySelector('.ofcard-bar-rec, .gic-tally'),
    six: ['might', 'intellect', 'leadership', 'hp', 'mp', 'at'].filter((f) => card.querySelector(`.ofcard-layout [data-field="${f}"]`)).length,
    skill: !!card.querySelector('[data-action="skill"]'),
    levels: !!card.querySelector('[data-action="levels"]'),
    records: !!card.querySelector('[data-action="records"]'),
    items: !!card.querySelector('[data-action="heldOpen"]'),
    back: !!card.querySelector('[data-action="cardBack"]'),
    story: !!card.querySelector('.ofcard-story'),
  };
});
if (detail.name !== target.name) fail(`다른 장수의 카드가 떴다: "${detail.name}" (기대 「${target.name}」)`);
// 「HP, MP, 공격력(최소-최대)」 — AT는 매 타격 내림이라 범위여야 한다 (GDD §4.2).
// 2026-10-26부터 HP · MP · AT 이름은 아이콘이라 글자가 없다 — 줄이 「최소-최대」로 끝나는지만 본다(AT가 마지막 칸)
if (!/\d+-\d+$/.test(detail.lv)) fail(`AT가 범위 표기가 아니다: "${detail.lv}"`);
if (!detail.levels || !detail.items || !detail.back) fail(`내 장수 카드인데 [아이템] · [강화] · [뒤로 가기]가 다 있지 않다: ${JSON.stringify(detail)}`);
if (detail.records) fail('[전적 보기]가 아직 있다(2026-11-19에 걷었다)');
if (detail.rec) fail('장수 카드에 전적 줄이 남아 있다(2026-11-19에 걷었다)');
if (detail.six !== 6) fail(`장수 카드의 여섯 값이 다 있지 않다 — ${detail.six}칸`);
// 인물 서사는 **데이터에 있을 때만** 줄이 있다 — 없으면 줄째로 물러난다 (G1이 218/260명을 채웠다)
{
  const hasStory = !!OFFICERS.find((o) => o.id === target.officer)?.story?.['ko'];
  if (detail.story !== hasStory) fail(`인물 서사 줄이 데이터와 어긋난다 — 데이터 ${hasStory}, 화면 ${detail.story}`);
}
console.log(`✓ 장수 카드 — ${detail.name} / ${detail.lv} / 여섯 값 · 전적 줄 없음`);

// 고유기술 팝업 (38쪽 아래). 지급이 S·A·B급을 포함하므로 기술이 있는 장수가 반드시 있다
{
  let holder = detail.skill ? target : null;
  if (!holder) {
    // 지금 열린 장수에 기술이 없으면 카드를 닫고 하나씩 열어 본다 (C·D급 134명)
    await closeCard();
    for (const r of await listRows()) {
      await openCardOf(r.officer);
      if (await page.$('.ofcard-modal [data-action="skill"]')) { holder = r; break; }
      await closeCard();
    }
  }
  if (!holder) fail('고유기술을 가진 장수가 하나도 없다 — 초기 지급에 S·A·B가 들어간다');
  await page.click('[data-action="skill"]');
  await page.waitForTimeout(200);
  const popup = await page.evaluate(() => {
    const m = document.querySelector('[data-modal="skill"]');
    return m ? {
      effect: m.querySelector('[data-field="effect"]')?.textContent?.trim() ?? '',
      origin: !!m.querySelector('[data-field="origin"]'),
      castDelay: m.querySelector('[data-field="castDelay"]')?.textContent?.trim() ?? '',
    } : null;
  });
  if (!popup) fail('고유기술을 눌렀는데 팝업이 뜨지 않는다');
  if (!popup!.effect) fail('기술 효과가 비어 있다');
  // S·E급(고사가 있는 30+1종)만 유래 줄이 있고, A·B급 9종은 정형 효과뿐이라
  // 애초에 없다 — 어느 쪽이든 팝업 자체는 정상이어야 한다.

  /*
   * **발동 시간 줄** (2026-09-07 시전 지연). 「있는가」가 아니라 **「이 기술의 값과
   * 맞는가」**를 본다 — 줄만 보면 「즉시」를 늘 찍어도 통과한다(기본값과 같은 값을
   * 확인하면 아무것도 확인하지 않는 것이다, §5-40).
   *
   * 어느 장수가 뽑힐지 모르므로 **그 장수의 `castDelay`를 데이터에서 읽어** 기댓값을
   * 만든다. 지연 13종 중 하나가 걸리면 「0.3일」이, 나머지면 「즉시」가 떠야 한다.
   */
  if (!popup!.castDelay) fail('발동 시간 줄이 없다');
  const delayOf = UNIQUE_SKILLS.find((k) => k.holders.includes(holder!.officer))?.castDelay ?? 0;
  const wantsDays = delayOf > 0;
  const showsDays = /[\d.]+\s*일/.test(popup!.castDelay);
  if (wantsDays !== showsDays) {
    fail(`발동 시간이 데이터와 어긋난다 — castDelay=${delayOf}인데 "${popup!.castDelay}"`);
  }
  if (wantsDays && !popup!.castDelay.includes((delayOf / 100).toFixed(1))) {
    fail(`발동 시간의 숫자가 castDelay(${delayOf})와 다르다 — "${popup!.castDelay}"`);
  }

  /*
   * **[발동 영상 보기]** (2026-09-18) — 전투의 연출(`SkillFx`)이 팝업 위에 그대로 돈다.
   * 단 길이를 여기 다시 적지 않고 실제 단계(`data-stage`)가 바뀌기를 기다린다(smoke_ui와 같은 규칙).
   * 「떠 있는가」만이 아니라 **「화면 전체를 덮는가」**를 좌표로 본다 — 팝업 폭에 갇혀도
   * 떠 있기는 하다. 누르면 **연출만** 닫히고 팝업은 남아야 한다(`modal-back`의 닫기로 새면 안 된다).
   */
  await page.click('[data-modal="skill"] [data-action="preview"]');
  const fxStage = (want: string): Promise<boolean> => page.waitForFunction(
    (w) => document.querySelector<HTMLElement>('[data-modal="skill"] .skl-fx')?.dataset.stage === w,
    want, { timeout: 6000 },
  ).then(() => true, () => false);
  // 1단(떠오르기)은 0.5초뿐이다 — 그 사이를 놓쳐도 2단이면 시작한 것이다(2026-10-23)
  const started = await page.waitForFunction(
    () => ['rise', 'action'].includes(document.querySelector<HTMLElement>('[data-modal="skill"] .skl-fx')?.dataset.stage ?? ''),
    undefined, { timeout: 6000 },
  ).then(() => true, () => false);
  if (!started) fail('[발동 영상 보기]를 눌렀는데 연출이 시작되지 않는다');
  const cover = await page.evaluate(() => {
    const fx = document.querySelector('[data-modal="skill"] .skl-fx')!.getBoundingClientRect();
    const back = document.querySelector('[data-modal="skill"]')!.getBoundingClientRect();
    const frame = document.querySelector<HTMLElement>('[data-modal="skill"] .fx-scroll')?.dataset.frame ?? '';
    return { full: Math.abs(fx.width - back.width) < 2 && Math.abs(fx.height - back.height) < 2, frame };
  });
  if (!cover.full) fail('발동 영상이 화면 전체를 덮지 않는다');
  if (!(Number(cover.frame) >= 1)) fail(`두루마리 띠에서 보이는 칸이 없다 ("${cover.frame}")`);
  if (!await fxStage('action')) fail('발동 영상이 2단(기술 장면)으로 넘어가지 않는다');
  await page.click('[data-modal="skill"] .skl-fx');
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    hidden: document.querySelector('[data-modal="skill"] .skl-fx')?.classList.contains('hidden') ?? false,
    modal: !!document.querySelector('[data-modal="skill"] .ofc-skill-modal'),
  }));
  if (!after.hidden) fail('발동 영상을 눌렀는데 닫히지 않는다');
  if (!after.modal) fail('발동 영상을 닫았더니 기술 팝업까지 닫혔다');
  console.log('✓ 고유기술 팝업 — [발동 영상 보기] 재생 · 화면 전체 · 눌러서 닫기');

  await page.click('[data-modal="skill"] [data-action="close"]');
  await page.waitForTimeout(150);
  if (await page.$('[data-modal="skill"]')) fail('기술 팝업이 닫히지 않는다');
  console.log(`✓ 고유기술 팝업 — ${holder!.name} · 효과 있음 · 유래 ${popup!.origin ? '있음' : '없음(A/B급)'}`
    + ` · ${popup!.castDelay}`);
}

// ── 강화(레벨업) · 재설계 (pptx 39쪽 · GDD §4.2·§4.3) ──────────
//
// 카드의 [강화](옛 [레벨/스킬 관리], 2026-11-20 기획자)가 곧장 「고르기」를 열고, 거기서 [확정]을
// 눌러야 오른다 — 오르면 판이 닫히고 카드로 돌아온다. [강화]는 올릴 수 있을 때만 켜진다.
// 화면 골격이 바뀌면 스모크의 경로도 함께 고친다(2026-08-15에 간판 화면을 넣고 이 파일이 통째로 막혔던 자리다).

const who = await page.getAttribute('.ofcard-modal', 'data-officer');
if (!who) fail('장수 카드에 장수가 없다');
if (await page.isEnabled('.ofcard-modal [data-action="levels"]')) fail('도시 Lv1인데 [강화]가 켜져 있다 — 장수 레벨 상한은 도시 레벨이다');

/** 성장 상태 — 판의 걸음 · 성장 스택 길이 · 스탯 찍은 횟수(계정) · 카드의 레벨(속성으로) · 배운 책략 수 */
const lvState = async () => await page.evaluate((id: string) => {
  const inst = (window as any).__profile.current.roster?.[id];
  if (!inst) return null;
  const g = (inst.growth ?? []) as { stat: string; tactics: string[] }[];
  const n = (k: string) => g.filter((s) => s.stat === k).length;
  const scr = document.querySelector('[data-screen="levelup-panel"]') as HTMLElement | null;
  const lv = document.querySelector(`.ofcard-modal[data-officer="${id}"] .ofcard-title [data-level]`)?.getAttribute('data-level');
  return {
    step: scr?.dataset.step ?? 'card',
    growth: g.length,
    taps: `${n('hp')}/${n('mp')}/${n('at')}`,
    name: `Lv${lv ?? '?'}`,
    tactics: g.reduce((a, s) => a + s.tactics.length, 0),
  };
}, who!);
const before = (await lvState())!.name;

/** 궁궐 → 일람 → 그 장수의 카드. 새로고침 뒤에 다시 들어올 때 쓴다 */
const openLevels = async (): Promise<void> => {
  await toPalace();
  await page.click('[data-action="officers"]');
  await page.waitForTimeout(250);
  await openCardOf(who!);
};
/** [강화] → 고르기 판 */
const openEnhance = async (): Promise<void> => {
  if (!await page.isEnabled('.ofcard-modal [data-action="levels"]')) fail('올릴 수 있어야 하는데 [강화]가 꺼져 있다');
  await page.click('.ofcard-modal [data-action="levels"]');
  await page.waitForSelector('[data-screen="levelup-panel"][data-step="levelup"]', { timeout: 5_000 })
    .catch(() => fail('[강화]를 눌렀는데 고르기 판이 안 뜬다'));
};
/** 개발용 지급은 장터에 있다(2026-09-02) — 누르고, 저장을 흘려보내고, 카드로 돌아온다 */
const devAtMarket = async (selector: string, times: number): Promise<void> => {
  await reenter();
  await clickPlace('market');
  // 도시의 장터 자리가 곧장 장터 홈이다(2026-09-24). 개발용 지급은 **[금화 충전] 판에만** 있다
  await page.waitForSelector('[data-screen="market"]', { timeout: 5_000 })
    .catch(() => fail('장터 자리를 눌렀는데 장터 화면이 안 뜬다'));
  await page.click('[data-action="openGold"]');
  await page.waitForSelector(selector, { timeout: 5_000 }).catch(() => fail(`장터에 개발용 단추(${selector})가 없다`));
  for (let n = 0; n < times; n++) {
    // **개발용 지급은 서버 왕복이다**(2026-09-14 — A1 금화, A2 카드) — 응답을 기다린다. 안
    // 기다리고 바로 새로고침하면 요청이 끊겨 지급이 안 된 채로 다음 검사가 엉뚱하게 죽는다
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/dev/grant'), { timeout: 8_000 }),
      page.click(selector),
    ]).catch(() => fail(`개발용 지급(${selector})이 서버에서 돌아오지 않는다`));
    await page.waitForTimeout(150);
  }
  await reenter();
  await openLevels();
};

// 개발용 카드 지급 — AI 대전이 카드를 주지 않아 성장을 시험할 길이 없어서 둔 문.
// **두 번 누른다** — Lv1→Lv2가 3장이라 5장이면 올린 뒤 2장만 남아 Flag가 다시 꺼진다.
// 10장이면 7장이 남아 Lv2→Lv3(5장)이 되므로, 아래에서 Flag가 켜지는 것까지 볼 수 있다.
await devAtMarket(`[data-dev="cards"][data-officer="${who}"]`, 2);
{
  /*
   * ★ **장수 레벨의 상한은 도시 레벨이다** (2026-09-14). 새 계정은 도시 Lv1이라 카드를
   * 채워도 잠겨야 하고 **왜인지 말해야** 한다(카드 위의 사람, `data-say="levelCap"`). 막히는 것을 본 뒤 도시를 올린 계정으로
   * 다시 들어와 원래 시험을 잇는다 — `cityLevel`은 클라이언트도 `PUT`으로 올리므로
   * **먼저 흘려보내고** 서버에 쓴 다음 새로 읽는다(안 그러면 옛 값이 덮어쓴다).
   */
  if (await page.isEnabled('.ofcard-modal [data-action="levels"]')) fail('도시 Lv1인데 장수를 Lv2로 올릴 수 있다 — 상한은 도시 레벨이다');
  await page.waitForSelector('.stw[data-say="levelCap"]', { timeout: 5_000 })
    .catch(() => fail('강화가 도시 레벨에 막혔는데 아무도 이유를 말하지 않는다'));
  await page.evaluate(() => (window as any).__profile.flush());
  const stored = await getProfile(player.uid);
  if (!stored) fail('강화 절에서 서버 계정을 못 읽었다');
  await saveProfileTrusted(player.uid, { ...stored!, cityLevel: 3 } as Parameters<typeof saveProfileTrusted>[1]);
  await reenter();
  await openLevels();
  if (await page.$('.stw[data-say="levelCap"]')) fail('도시를 올렸는데 아직 상한 이유를 말한다');
  console.log('✓ 장수 레벨 상한 — 도시 Lv1에서는 카드가 있어도 [강화]가 꺼지고 이유를 말한다 (도시 Lv3으로 올려 잇는다)');
}
{
  const cards = await page.evaluate(() => [...document.querySelectorAll('.ofcard-modal [data-field="enhanceCards"]')].map((e) => ({
    text: e.textContent?.replace(/\s+/g, ' ').trim() ?? '', icon: !!e.querySelector('img'),
  })));
  if (cards.length !== 1 || !/^\d+ \/ 3$/.test(cards[0]!.text) || !cards[0]!.icon) fail(`[강화] 오른쪽이 「보유 / 3 (카드)」가 아니다: ${JSON.stringify(cards)}`);
}

const start = await lvState();
if (start!.taps !== '0/0/0') fail(`Lv1인데 스탯 찍은 횟수가 0이 아니다: ${start!.taps}`);

// [강화] → 「고르기」. **아직 오르지 않았다** — 확정 전에 프로필이 바뀌면 안 된다
await openEnhance();
const picking = await lvState();
if (picking!.step !== 'levelup') fail(`[강화]를 눌렀는데 고르기로 안 간다: ${picking!.step}`);
if (picking!.growth !== start!.growth) fail('고르기를 열었을 뿐인데 성장 스택이 늘었다');

// 39쪽의 증분 미리보기 — **고른 줄만 증분이 붙는다.** `+5`를 화면이 손으로 적으면
// 엑셀의 statChoices가 바뀌었을 때 표시만 어긋난다(`AT +1`이 실제로 그랬다)
const preview = await page.evaluate(() =>
  [...document.querySelectorAll('.lv-stat-row')].map((el) => ({
    stat: (el as HTMLElement).dataset.stat!,
    add: (el as HTMLElement).dataset.add!,
    on: el.classList.contains('on'),
    now: el.querySelector('.c-now')?.textContent ?? '',
    next: el.querySelector('.c-next')?.textContent ?? '',
  })));
if (preview.length !== 3) fail(`전투력(능력 성장)이 세 줄이 아니다 — ${preview.length}줄`);
const hpRow = preview.find((r) => r.stat === 'hp')!;
if (!hpRow.on || hpRow.add === '0') fail(`고른 줄에 증분이 없다: ${JSON.stringify(hpRow)}`);
// **세 줄 모두 자기를 골랐을 때의 증분을 보여준다**(2026-09-03 — 예전엔 고른 줄에만
// 붙고 나머지는 `+0`이었다). 「안 고른 줄은 +0」으로 되돌아가면 여기서 걸린다.
if (preview.some((r) => r.add === '0')) fail(`증분이 안 붙은 줄이 있다: ${JSON.stringify(preview)}`);
// 그래도 **고른 줄은 하나뿐**이다 — 증분을 다 보여준다고 택1이 풀리는 게 아니다
if (preview.filter((r) => r.on).length !== 1) fail(`택1인데 고른 줄이 하나가 아니다: ${JSON.stringify(preview)}`);
// ★ **회색 증분은 「고르면 오를 양」이지 더해지는 값이 아니다** — 안 고른 줄의
// 결과 칸은 지금 값 그대로여야 한다(`MP 5 +2 → 5`). 증분을 결과에까지 반영하면
// 「MP가 7이 된다」는 거짓말이 되는데, 화면만 봐서는 그럴듯해 보여 안 걸린다.
for (const r of preview.filter((r) => !r.on)) {
  if (r.next !== r.now) fail(`안 고른 줄인데 결과가 더해져 있다: ${JSON.stringify(r)}`);
}
const onRow = preview.find((r) => r.on)!;
if (onRow.next === onRow.now) fail(`고른 줄인데 결과가 안 늘었다: ${JSON.stringify(onRow)}`);
// AT는 언제나 범위다 (GDD §4.2 — 매 타격 내림이라 `2.5`는 평타 2 · 크리티컬 5)
const atRow = preview.find((r) => r.stat === 'at')!;
if (!/^\d+-\d+$/.test(atRow.now)) fail(`AT가 범위 표기가 아니다: "${atRow.now}"`);

// 책략은 **토글 둘 + 설명 판 하나**(2026-11-20 기획자 개편) — 토글마다 이름, 설명 판에는 두 학파의 설명이 같은 칸에 겹쳐
// 있고 **고른 쪽만 보인다.** 두 학파의 설명이 다 있어야 하므로 양쪽 다 본다(보이는 것 · 안 보이는 것 모두).
await page.click('.lvu-tab[data-school="illusion"]');
await page.waitForTimeout(250);
const schools = await page.evaluate(() =>
  [...document.querySelectorAll('[data-field="tacticDesc"] > .lvu-desc-item')].map((el) => {
    const school = (el as HTMLElement).dataset.school!;
    return {
      school,
      on: document.querySelector(`.lvu-tab[data-school="${school}"]`)?.classList.contains('on') ?? false,
      shown: getComputedStyle(el).visibility === 'visible',
      name: document.querySelector(`.lvu-tab[data-school="${school}"] [data-field="tacticName"]`)?.textContent?.trim() ?? '',
      text: el.querySelector('.lv-tactic-text')?.textContent?.trim() ?? '',
      mp: el.querySelector('.lv-tactic-mp')?.textContent?.trim() ?? '',
    };
  }));
if (schools.length !== 2) fail(`책략 설명이 두 학파가 아니다 — ${schools.length}`);
for (const s of schools) {
  if (!s.name) fail(`${s.school} 토글에 책략 이름이 없다`);
  if (s.text.length < 10) fail(`${s.school} 설명이 없다: "${s.text}"`);
  // 소모 MP는 **데이터에서 온 값**이다 — 이름 옆에 실제 숫자가 찍혀야 한다
  // (`tactics.json`의 `mpCost`는 1~3이라 0이 나오면 그것 자체가 이상하다)
  if (!/\(MP:\s*[1-9]\d*\)/.test(s.mp)) fail(`${s.school} 설명에 소모 MP가 없다: "${s.mp}"`);
}
const ill = schools.find((s) => s.school === 'illusion')!;
const sup = schools.find((s) => s.school === 'support')!;
if (!ill.on || !ill.shown) fail('환술을 눌렀는데 토글 · 설명이 안 옮겨 온다');
if (sup.on || sup.shown) fail('택1인데 지원책 토글 · 설명이 아직 켜져 있다');

await page.click('[data-action="confirm"]');
// **레벨업은 서버 왕복이다**(2026-09-14, A2) — 고정 대기 대신 판이 닫혀 카드로 돌아올 때까지 본다.
// 판은 결과가 올 때까지 닫지 않는다(`LevelUpPanel`). 거절이면 판이 남고 그 말을 싣는다
const waitLevelUp = async (what: string): Promise<void> => {
  // 오르면 축하 판(`Celebrate`, 2026-11-20)이 뜬다 — 오른 레벨 · 고른 능력 줄을 보고 [확인]으로 카드에
  const celebrated = await page.waitForSelector('[data-modal="levelUpDone"]', { timeout: 8_000 }).then(() => true).catch(() => false);
  if (celebrated) {
    const cel = await page.evaluate(() => ({
      level: document.querySelector('[data-modal="levelUpDone"] [data-field="doneLevel"] [data-level]')?.getAttribute('data-level') ?? '',
      stat: document.querySelector('[data-modal="levelUpDone"] [data-field="doneStat"]')?.getAttribute('data-stat') ?? '',
    }));
    if (!/^\d+$/.test(cel.level) || !cel.stat) fail(`${what} — 축하 판에 오른 레벨 · 능력 줄이 없다: ${JSON.stringify(cel)}`);
    await page.click('[data-modal="levelUpDone"] [data-action="doneOk"]');
    await page.waitForSelector('.cel-back[data-leaving]', { state: 'detached', timeout: 5_000 });   // 축하 화면의 닫힘 연출(.36초)이 끝날 때까지
    await page.waitForSelector('[data-modal="levelUpDone"]', { state: 'detached', timeout: 5_000 });
  }
  const closed = await page.waitForSelector('[data-screen="levelup-panel"]', { state: 'detached', timeout: 8_000 })
    .then(() => true, () => false);
  if (!closed) {
    const note = await page.textContent('.stw[data-say="respecNote"] [data-field="guideText"]').catch(() => null);
    fail(`${what} — [확정] 뒤 8초가 지나도 카드로 안 돌아온다${note ? `: 서버가 거절했다 "${note}"` : ''}`);
  }
  await page.waitForTimeout(150);
};
await waitLevelUp('레벨업');

const grown = await lvState();
if (grown!.step !== 'card') fail('확정했는데 카드로 안 돌아온다');
if (grown!.growth !== start!.growth + 1) fail(`성장 스택이 한 걸음 늘지 않았다: ${grown!.growth}`);
if (grown!.taps !== '1/0/0') fail(`HP를 찍었는데 횟수가 안 맞는다: ${grown!.taps}`);
const after = grown!.name;
if (before === after) fail(`레벨업했는데 카드 표시가 그대로다: "${before}"`);
const tactics = grown!.tactics;
if (tactics === 0) fail('레벨업했는데 책략을 배우지 않았다 (능력 택1 + 책략 택1)');
console.log(`✓ 강화 — ${before} → ${after}, 책략 ${tactics}종, 찍은 횟수 ${grown!.taps}`);

// ── 재설계(둔갑천서) — **쓴 카드를 돌려주고 Lv1로 되감는다** ─────
//
// 「레벨 유지 + 다시 고르기」에서 「되감기」로 바뀌었다(2026-08-17 기획자 확정).
// 되돌려주는 양이 정확히 누적 필요분이라 **다시 올리면 카드가 딱 떨어진다** —
// 그게 이 규칙의 핵심이고, 화면까지 그렇게 도는지는 여기서만 볼 수 있다.
{
  /** 저장된 그 장수의 카드 수 — 화면 글자가 아니라 저장분에서 읽는다 */
  const cardsOf = async () => await page.evaluate((id: string) =>
    ((window as any).__profile.current.cards?.[id] ?? 0) as number, who!);

  // **[재설계]는 장터 [도시 물자]로 옮겼다** (2026-09-24, pptx 88쪽) — 장수 카드에는 없다
  if (await page.$('.ofcard-modal [data-action="respec"]')) fail('장수 카드에 [재설계]가 남아 있다 — 장터로 옮겼다');
  await devAtMarket('[data-dev="gold-respec"]', 1);
  const heldBefore = await cardsOf();

  /** 장터 → 도시 물자 → 장수 재설계 → 그 장수 → 확인 팝업 */
  const openRespec = async (): Promise<void> => {
    await reenter();
    await clickPlace('market');
    await page.waitForSelector('[data-screen="market"]', { timeout: 5_000 });
    await page.click('[data-action="openGoods"]');
    // 줄을 누르면 곧장 장수 고르기 판(2026-11-13 — 체크 → [구매하기]를 한 번으로)
    if (await page.getAttribute('[data-good="respec"]', 'data-can') !== '1') {
      fail(`둔갑천서 값을 받았는데 재설계가 잠겨 있다: "${await page.textContent('.stw[data-say="goodsWhy"]').catch(() => '')}"`);
    }
    await page.click('[data-good="respec"]');
    await page.waitForSelector('[data-modal="officerPick"]', { timeout: 5_000 });
    // Lv2 이상만 뜬다 — 지금 올린 장수 하나뿐이다
    const rows = await page.$$eval('[data-modal="officerPick"] .ofc-rows .ofc-row[data-officer]', (els) => els.map((e) => e.getAttribute('data-officer')));
    if (rows.length !== 1 || rows[0] !== who) fail(`재설계 목록이 ${JSON.stringify(rows)}다 — Lv2인 ${who} 하나라야 한다`);
    // 줄을 누르면 곧장 확인 판(2026-11-25 기획자 — 체크 칸 · [선택하기]를 걷었다)
    await page.click(`[data-modal="officerPick"] .ofc-row[data-officer="${who}"]`);
    await page.waitForSelector('[data-modal="respecAsk"]', { timeout: 5_000 });
  };

  // 확인 팝업 — **되돌릴 수 없고 값이 나가는 한 수**라 한 번 묻는다.
  // 「있는가」가 아니라 「제자리에 있는가」를 본다 — 배경 위의 팝업이 내용 맨 아래에
  // 흘러 붙었던 자리다(2026-08-17, A). `.scr-dim > *`가 absolute를 덮는다.
  await openRespec();
  const modal = await page.evaluate(() => {
    const m = document.querySelector('[data-modal="respecAsk"]') as HTMLElement | null;
    const frame = document.querySelector('#frame') as HTMLElement | null;
    if (!m || !frame) return null;
    const a = m.getBoundingClientRect(), b = frame.getBoundingClientRect();
    return {
      what: m.textContent?.trim() ?? '',
      covers: Math.abs(a.top - b.top) < 4 && Math.abs(a.height - b.height) < 4,
    };
  });
  if (!modal) fail('재설계를 골랐는데 확인 팝업이 안 뜬다');
  if (!modal!.covers) fail('재설계 확인 팝업이 화면을 덮지 않는다 — 내용 맨 아래에 흘러 붙었다');
  if (!/카드\s*3장/.test(modal!.what)) fail(`돌려받을 카드 수가 안 적혀 있다: "${modal!.what}"`);

  // [뒤로 가기]로 나가면 아무 일도 없어야 한다
  await page.click('[data-modal="respecAsk"] [data-action="confirmCancel"]');
  await page.waitForTimeout(200);
  if (await page.$('[data-modal="respecAsk"]')) fail('[뒤로 가기]를 눌렀는데 팝업이 안 닫힌다');
  {
    const stored = await getProfile(player.uid);
    if (stored!.roster[who!]!.level < 2) fail('[뒤로 가기]를 눌렀는데 되감겼다');
    if ((stored!.cards[who!] ?? 0) !== heldBefore) fail('[뒤로 가기]를 눌렀는데 카드가 바뀌었다');
  }

  // 이번엔 확정 — **재설계는 서버 왕복이다**(A1 — 금화가 서버 소유). 완료 판이 뜰 때까지 본다
  await openRespec();
  await page.click('[data-modal="respecAsk"] [data-action="confirmOk"]');
  await page.waitForSelector('[data-modal="respecDone"]', { timeout: 8_000 })
    .catch(async () => fail(`[확정]을 눌렀는데 8초가 지나도 완료 판이 안 뜬다: "${await page.textContent('.stw[data-say="refused"] [data-field="guideText"]').catch(() => '')}"`));
  const refunded = await page.textContent('[data-modal="respecDone"] [data-field="refund"]');
  if (!refunded?.includes('3')) fail(`완료 판의 회수 카드가 「${refunded}」다 — ×3이라야 한다`);
  // [궁궐로 이동] → 장수 일람 + 그 장수의 카드 (2026-09-25 기획자 지정 — 예전에는 전면
  // 레벨/스킬 관리 화면이었다. 행선지가 바뀐 뒤 이 검사만 옛 화면을 기다리고 있었다)
  await page.click('[data-action="toPalace"]');
  await page.waitForSelector(`.ofcard-modal[data-officer="${who}"]`, { timeout: 5_000 })
    .catch(() => fail('[궁궐로 이동]을 눌렀는데 장수 일람에서 그 장수의 카드가 안 열린다'));
  if (!(await page.$('[data-screen="officer-list"]'))) fail('[궁궐로 이동]이 장수 일람으로 가지 않았다');
  // 나머지 검사는 일람 위의 판에서 잇는다 — 도시로 돌아가 다시 연다
  await reenter();
  await openLevels();
  const reset = await lvState();
  if (reset!.step !== 'card') fail('재설계했는데 장수 카드가 아니다');
  if (reset!.growth !== 0) fail(`재설계했는데 성장 스택이 남았다: ${reset!.growth}`);
  if (reset!.taps !== '0/0/0') fail(`재설계했는데 찍은 횟수가 남았다: ${reset!.taps}`);
  if (reset!.name !== before) fail(`Lv1로 안 돌아갔다: "${before}" 기대, "${reset!.name}"`);
  // Lv1→Lv2에 3장이 들었으니 정확히 3장이 돌아와야 한다 (GDD §4.3)
  const heldAfter = await cardsOf();
  if (heldAfter !== heldBefore + 3) fail(`카드를 3장 돌려받지 않았다 — ${heldBefore} → ${heldAfter}`);
  console.log(`✓ 재설계 — ${after} → ${reset!.name}, 카드 ${heldBefore} → ${heldAfter}장 (쓴 만큼 돌아왔다)`);

  // **되감은 뒤에는 정상 레벨업 절차 그대로다** — 재설계 전용 절차가 없다는 것이 요점이다
  if (!await page.isEnabled('.ofcard-modal [data-action="levels"]')) fail('돌려받은 카드로 다시 올릴 수 없다');
  await openEnhance();
  await page.click('[data-stat="hp"]');
  await page.waitForTimeout(120);
  await page.click('[data-action="confirm"]');
  await waitLevelUp('되감은 뒤 재성장');
  const again = await lvState();
  if (again!.name !== after) fail(`다시 올렸는데 레벨이 다르다: "${after}" 기대, "${again!.name}"`);
  if (again!.taps !== '1/0/0') fail(`다시 올린 성장이 안 맞는다: ${again!.taps}`);
  console.log(`✓ 되감은 뒤 재성장 — ${again!.name}, 찍은 횟수 ${again!.taps} (절차는 레벨업 하나뿐)`);
}

// 레벨업 Flag가 일람까지 돌아오는가 — 카드가 남아 있으면 ON이다 (37쪽)
// 고르기 판의 [X] — 오르지 않고 카드로 돌아온다
await openEnhance();
await page.click('[data-action="closeLevelUp"]');
await page.waitForTimeout(200);
if (await page.$('[data-screen="levelup-panel"]')) fail('고르기 판의 [X]를 눌렀는데 닫히지 않는다');
if ((await lvState())!.name !== after) fail('고르기 판을 [X]로 닫았는데 레벨이 바뀌었다');
await closeCard();
const back = await listRows();
const flagged = back.find((r) => r.officer === who);
if (!flagged) fail(`일람으로 돌아왔는데 ${who}가 없다`);
// 카드가 다음 레벨분만큼 남아 있으므로 켜져야 한다 (37쪽 「보유하고 있다면 ON」)
if (!flagged!.flag) fail(`${flagged!.name}는 카드가 남았는데 레벨업 Flag가 꺼져 있다`);
if (back.filter((r) => r.flag).length !== 1) fail('카드를 준 장수 말고도 Flag가 켜져 있다');
console.log(`✓ 일람 복귀 — ${flagged!.name} 레벨업 Flag ON (나머지는 OFF)`);

// ── 저장 (온라인이 붙으면 이 자리가 서버 API가 된다) ───────────

await reenter();
if (await page.$('.scr-new')) fail('새로고침했더니 계정이 사라졌다');
await toPalace();
await page.click('[data-action="officers"]');
await page.waitForTimeout(300);
/** 일람이 열린 채로 그 장수의 레벨을 카드에서 읽는다 — 화면 글자가 아니라 `data-level`로 */
const levelOf = async (officer: string): Promise<string> => {
  await openCardOf(officer);
  const lv = await page.getAttribute(`.ofcard-modal[data-officer="${officer}"] .ofcard-title [data-level]`, 'data-level').catch(() => null);
  return `Lv${lv ?? '?'}`;
};
const kept = await levelOf(who!);
if (kept !== after) fail(`새로고침 뒤 상태가 다르다: "${after}" → "${kept}"`);
console.log(`✓ 저장 유지 — ${kept}`);

// ── 옛 저장분(v1)을 실제로 되접는가 ★ (2026-08-17, 저장 형식 v2) ──
//
// `migrateProfile()` 자체는 `npm test`가 조목조목 본다. **여기서 보는 것은 다른 것이다** —
// `loadProfile()`이 그 함수를 실제로 부르는가. 예전에는 버전이 다르면 곧바로 `null`이라
// 계정을 통째로 버렸는데, 그 줄이 되살아나도 단위 테스트는 아무 말도 하지 않는다.
{
  /*
   * **DB 행에 직접 심는다** — `PUT /profile`은 `saveProfile()`이 매번
   * `migrateProfile()`을 거쳐 저장하므로 옛 형식을 DB에 남길 수 없다. 여기서
   * 흉내 내는 것은 "그 뒤로 한 번도 안 열어 본, 정말 v1인 채로 남은 행"이다.
   */
  const now = await apiGet();
  const roster: Record<string, unknown> = {};
  for (const [id, inst] of Object.entries(now['roster'] as Record<string, {
    level: number; growth: { stat: string; tactics: string[] }[]; record: unknown;
  }>)) {
    roster[id] = {
      officer: id,
      level: inst.level,
      statPicks: inst.growth.map((s) => s.stat),
      tactics: inst.growth.flatMap((s) => s.tactics),
      record: inst.record,
    };
  }
  const old = { ...now, version: 1, roster };
  const v1Level = (old.roster as Record<string, { level: number }>)[who!]?.level ?? 0;
  await dbSetRaw(old);

  await reenter();
  if (await page.$('.scr-new')) fail('v1 저장분을 만나자 계정을 버렸다 — 되접어야 한다');
  await toPalace();
  await page.click('[data-action="officers"]');
  await page.waitForTimeout(300);
  const rebuilt = await listRows();
  if (rebuilt.length !== firstPage) fail(`되접은 뒤 일람 첫 쪽이 ${rebuilt.length}줄이다 (기대 ${firstPage}줄)`);
  const folded = await levelOf(who!);
  if (folded !== after) fail(`v1을 되접었더니 레벨이 달라졌다: "${after}" → "${folded}"`);
  // **저장 형식 번호는 상수에서 읽는다** — 여기 `3`을 박아 둔 채 v4·v5가 지나갔다
  const kind = await page.evaluate(() => (window as any).__profile.current.version as number);
  if (kind !== PROFILE_VERSION) fail(`되접은 뒤에도 version이 ${kind}다 — 화면은 v${PROFILE_VERSION}를 본다`);
  // **저장(DB 행)까지 올라왔는가**는 화면이 아니라 서버에 직접 물어야 안다
  const persisted = (await apiGet())['version'];
  if (persisted !== PROFILE_VERSION) fail(`읽었을 때만 v${PROFILE_VERSION}고 DB 행은 아직 v${persisted}다 — 되접은 값을 되쓰지 않는다`);
  console.log(`✓ v1 되접기 — ${old.cityName} · 장수 ${rebuilt.length}명 · ${folded} (Lv${v1Level} 유지) · version 1 → ${kind}(저장까지 확인)`);
}

// ── 옛 저장분(v2)을 실제로 되접는가 ★ (2026-08-18, 저장 형식 v3) ──
//
// v1 때와 **같은 이유로** 여기에 있다 — 단위 테스트는 `migrateProfile()`이 옳은지만
// 알고 `loadProfile()`이 그걸 부르는지는 모른다. v3는 전적의 **뜻이** 바뀐 판이라
// (평평한 `{wins,losses,kills}` → 기물 × 모드 × 상대 교차) 옛 값은 버리는데,
// **계정까지 버리면 안 된다.**
{
  {
    const now = await apiGet();
    const roster: Record<string, unknown> = {};
    for (const [id, inst] of Object.entries(now['roster'] as Record<string, object>)) {
      roster[id] = { ...inst, record: { wins: 5, losses: 2, kills: 9 } };   // v2의 평평한 전적
    }
    const old: Record<string, unknown> = { ...now, version: 2, roster };
    delete old['record']; delete old['matches']; delete old['matchSeq'];
    await dbSetRaw(old);
  }

  await reenter();
  if (await page.$('.scr-new')) fail('v2 저장분을 만나자 계정을 버렸다 — 되접어야 한다');
  await toPalace();
  await page.click('[data-action="officers"]');
  await page.waitForTimeout(300);
  const kept = await listRows();
  if (kept.length !== firstPage) fail(`v2를 되접은 뒤 일람 첫 쪽이 ${kept.length}줄이다 (기대 ${firstPage}줄)`);
  const folded = await apiGet().then((p) => {
    const insts = Object.values(p['roster']) as Record<string, unknown>[];
    return {
      version: p['version'] as number,
      // 장수 전적 칸은 2026-11-20에 없어졌다 — 옛 저장분의 칸은 되접기가 버려야 한다
      cells: insts.filter((i) => 'record' in i).length,
      matches: Array.isArray(p['matches']) ? p['matches'].length : -1,
      seq: p['matchSeq'] as number,
    };
  });
  if (folded.version !== PROFILE_VERSION) fail(`v2를 되접었는데 version이 ${folded.version}다 (저장까지 확인)`);
  if (folded.cells !== 0) fail(`옛 장수 전적 칸이 되접은 뒤에도 남았다 (장수 ${folded.cells}명)`);
  if (folded.matches !== 0 || folded.seq !== 1) fail(`이력 자리가 초기화되지 않았다: ${JSON.stringify(folded)}`);
  console.log(`✓ v2 되접기 — 장수 ${kept.length}명 유지 · version 2 → ${PROFILE_VERSION} · 옛 평평한 전적은 0에서 시작`);
}

// ── 도시 관리 (pptx 41쪽) ★ C2가 연 자리 ────────────────────────
//
// 여기서만 잡히는 것이 둘이다.
//  ① **`App.tsx`가 `syncGrain()`을 실제로 부르는가** — 단위 테스트는 함수가 옳은지만
//     알고 「누가 그걸 부르는가」는 모른다. v1 되접기와 똑같은 종류의 구멍이라
//     저장분의 `grainAt`을 과거로 밀어 놓고 **새로고침**해서 확인한다.
//  ② **증축 뒤 풀·상한·요율이 화면에서 함께 따라오는가** — 셋이 `cityLevel` 하나를
//     보고 있어 규칙에서는 갈릴 수 없지만, 화면이 옛 값을 들고 있으면 여기서 드러난다.
{
  /**
   * 저장분을 손보고 새로고침 — 화면이 다시 읽게 한다.
   *
   * **`PUT`으로는 못 바꾼다** (`setGrain`과 같은 자리) — `grain`·`grainAt`에 더해
   * `materials`까지 서버 소유 필드가 됐다(2026-09-04). 스모크는 계정 API를 제
   * 안에서 띄우므로 서버 함수를 직접 부른다 — 제품에 남는 시험용 표면이 없다.
   */
  /** 궁궐 현황 판에서 읽은 황제 — **황제 줄은 2026-09-18에 도시 관리에서 궁궐 첫 화면으로 옮겼다** */
  let palaceEmperor: string | undefined;
  const reload = async (patch: Record<string, unknown>): Promise<void> => {
    const stored = await getProfile(player.uid);
    if (!stored) fail('도시 화면을 보려는데 서버에 계정이 없다');
    await saveProfileTrusted(player.uid, { ...stored!, ...patch } as Parameters<typeof saveProfileTrusted>[1]);
    await reenter();
    await toPalace();
    palaceEmperor = await page.evaluate(() =>
      (document.querySelector('[data-field="palaceStatus"] [data-field="emperor"]') as HTMLElement | null)?.dataset.emperor);
    await page.click('[data-action="city"]');
    await page.waitForTimeout(300);
  };

  /** 화면이 내보내는 41쪽 여섯 줄 */
  const info = async () => {
    const dom = await page.evaluate(() => {
      const scr = document.querySelector('[data-screen="city"]') as HTMLElement | null;
      if (!scr) return null;
      const at = (f: string) => document.querySelector(`[data-field="${f}"]`);
      const txt = (f: string) => at(f)?.querySelector('.v')?.textContent?.trim() ?? '';
      return {
        level: Number(scr.dataset.cityLevel),
        // **등용 장수·군량 줄은 2026-09-05에 현황판에서 빠졌다**(건물 일곱 줄이 그 자리다) —
        // 스모크가 계속 그 줄을 읽어 빈 글자를 받았다. 풀은 아래 저장분에서, 상한·요율을
        // 정하는 것은 건물이므로 건물 레벨(`data-level`)로 본다
        materials: txt('materials'),
        buildings: Object.fromEntries([...document.querySelectorAll('[data-building]')].map((el) =>
          [(el as HTMLElement).dataset.building!, Number((el as HTMLElement).dataset.level)])),
      };
    });
    if (!dom) return null;
    // 저장분의 실제 값 — 화면 글자와 어긋나면 그것도 잡힌다. **서버에서 직접 읽는다** —
    // 여기서는 `App.tsx`가 `syncGrain()`을 부른 뒤 실제로 저장했는지까지 봐야 한다.
    // `syncGrain()`의 결과를 담은 `saveProfile()`은 비동기라 약간의 여유를 둔다
    await page.waitForTimeout(400);
    const saved = await apiGet() as { grain: number; grainAt: number; roster: Record<string, unknown> };
    return { ...dom, emperor: palaceEmperor, saved, pool: Object.keys(saved.roster).length };
  };

  /**
   * [도시 증축]은 **도시 관리** 바닥에 있다(2026-11-23 — 건물 관리가 없어지며 돌아왔다). 단추가 눌리는지 · 막힌 이유를 읽는다
   */
  const upgradeState = async () => {
    await page.waitForSelector('[data-screen="city"]');
    return page.evaluate(() => ({
      upgradeOn: !((document.querySelector('[data-action="upgrade"]') as HTMLButtonElement).disabled),
      why: document.querySelector('.stw[data-say="why"] [data-field="guideText"]')?.textContent ?? '',
    }));
  };

  const HOUR = 3_600_000;
  const now = await page.evaluate(() => Date.now());

  // ① 세 시간을 놀았다 — Lv1은 시간당 1이므로 셋이 들어온다
  // 도시는 Lv1로 되돌린다 — 레벨업 절이 장수 상한을 풀려고 올려 두었다(2026-09-14)
  await reload({ grain: 5, grainAt: now - 3 * HOUR, materials: 0, cityLevel: 1 });
  let it = await info();
  if (!it) fail('궁궐의 [도시 관리]를 눌렀는데 41쪽 화면이 안 뜬다');
  if (it!.saved.grain !== 8) fail(`세 시간에 군량이 셋 안 찼다 — ${it!.saved.grain} (App이 syncGrain을 부르는가)`);
  // 41쪽의 나머지 줄들이 다 있는가
  if (it!.emperor !== '0') fail('헌제가 없는데 황제가 「옹립」이다');
  if (it!.pool !== poolAfterLoss) fail(`등용 장수가 ${it!.pool}명이다(${poolAfterLoss}명이어야 한다)`);
  // 현황판은 **지금 열린 건물만** 적는다(Lv1은 넷) — 일곱 줄은 증축 팝업의 고르기 목록이고 아래에서 본다.
  // 증축 뒤 비교에 쓰는 셋(풀 = 궁궐, 군량 = 병영·농지)은 반드시 있어야 한다
  for (const b of ['palace', 'barracks', 'farm']) {
    if (!(b in it!.buildings)) fail(`현황판에 ${b} 줄이 없다: ${JSON.stringify(it!.buildings)}`);
  }
  // 자재 줄은 「가진 수 / 다음 레벨에 드는 수」다(2026-09-18)
  if (!it!.materials.includes('/ 10')) fail(`증축 자재 줄이 다르다: "${it!.materials}"`);
  {
    const up = await upgradeState();
    if (up.upgradeOn) fail('재료가 0인데 [증축]이 눌린다');
    // 막힌 이유는 **말하지 않는다**(2026-11-23 기획자 — 모자란 조건은 조건 칸이 붉게 보여 준다).
    // 이 계정은 장수 10명(Lv2 조건)을 채웠고 AI 대전에서 지기만 했다 — 남은 것은 누적 승리 칸이다(2026-11-14 조건)
    if (up.why) fail(`막힌 이유를 내관이 말한다(말하지 않기로 했다): "${up.why}"`);
    if (!await page.$('[data-screen="city"] [data-cond="wins"]:not([data-ok="1"])')) fail('이긴 적이 없는데 누적 승리 칸이 채움으로 뜬다');
  }
  console.log(`✓ 도시 관리 — 3시간에 군량 5 → ${it!.saved.grain} · ${it!.pool} · ${it!.materials}`);

  // ② 상한을 넘지 않는다 — 백 시간을 놀아도 20이다
  await reload({ grain: 19, grainAt: now - 100 * HOUR });
  it = await info();
  if (it!.saved.grain !== 20) fail(`상한을 넘었다 — ${it!.saved.grain}/20`);
  // ③ 시계가 앞서 있어도(= 뒤로 갔어도) 줄지 않는다
  await reload({ grain: 7, grainAt: now + 5 * HOUR });
  it = await info();
  if (it!.saved.grain !== 7) fail(`시계가 뒤로 갔는데 군량이 ${it!.saved.grain}이 됐다 (7이어야 한다)`);
  console.log('✓ 군량 충전 — 상한 20에서 멈추고, 시계가 뒤로 가도 7 그대로');

  // ④ 증축 — 재료를 넣고 확인 팝업을 지나 실제로 올린다.
  //    **개발용 [재료 +10] 단추는 없어졌다** (2026-09-04) — 장터에서 금화로 살 수
  //    있게 됐으므로. 여기서는 위 `reload()`와 같은 자리(서버 함수)로 넣는다.
  //    **보유 장수 10명도 필요하다**(2026-09-14) — 다섯을 **보관함**(카드만)으로 넣는다.
  //    풀에 자리가 있으니 `syncCity()`가 풀로 올려야 한다 — 그것까지 여기서 본다
  {
    const stored = await getProfile(player.uid);
    const extra = OFFICERS.filter((o) => o.grade === 'D' && !stored!.roster[o.id as keyof typeof stored.roster])
      .slice(0, 5).map((o) => [o.id, 1] as const);
    // 누적 승리 1도 증축 조건이다(2026-11-14) — 여기까지 둔 판은 AI 대전 패배라 승리가 없다
    await reload({ materials: 10, battleWins: 1, cards: { ...stored!.cards, ...Object.fromEntries(extra) } });
  }
  it = await info();
  if (it!.pool !== poolAfterLoss + 5) fail(`보관함의 다섯이 풀로 안 올라왔다 — ${it!.pool}명(${poolAfterLoss + 5}명이어야 한다)`);
  const buildingsBefore = JSON.stringify(it!.buildings);
  {
    const up = await upgradeState();
    if (!up.upgradeOn) fail(`재료·장수를 넣었는데 [증축]이 안 눌린다: "${it!.materials}" · "${up.why}"`);
  }
  await page.click('[data-action="upgrade"]');
  await page.waitForTimeout(250);

  // **「있는가」와 「제자리에 있는가」는 다른 검사다** — `.scr-bg > *`의 일괄 규칙이
  // 팝업의 `absolute`를 덮으면 화면 한가운데가 아니라 내용 맨 아래에 흘러 붙는다
  const modal = await page.evaluate(() => {
    const back = document.querySelector('[data-modal="upgrade"]') as HTMLElement | null;
    if (!back) return null;
    const f = document.getElementById('frame')!.getBoundingClientRect();
    const r = back.getBoundingClientRect();
    return {
      pos: getComputedStyle(back).position,
      dy: Math.abs((r.top + r.bottom) / 2 - (f.top + f.bottom) / 2),
      what: document.querySelector('[data-field="what"]')?.textContent ?? '',
    };
  });
  if (!modal) fail('[증축]을 눌렀는데 확인 팝업이 안 뜬다');
  if (modal!.pos !== 'absolute' || modal!.dy > 2) fail(`증축 팝업이 제자리에 없다 (${modal!.pos}, 중앙에서 ${modal!.dy}px)`);
  await shot('popup-upgrade');
  if (!modal!.what.includes('Lv1 → Lv2')) fail(`팝업이 무엇을 사는지 안 적는다: "${modal!.what}"`);

  /*
   * 올릴 건물 고르기 (2026-11-23 기획자) — 일곱 줄 · 셋을 골라야 [증축한다]가 켜진다 · 넷째는 안 골라진다.
   * 고른 셋만 한 단계 오르고 나머지는 그대로다 — 「기본값과 같은 값」이 안 되게 **궁궐은 고르지 않는다**(풀이 그대로인지 본다)
   */
  const PICKS = ['barracks', 'farm', 'academy'] as const;
  {
    const rows = await page.$$eval('[data-modal="upgrade"] [data-action="pickBuilding"]', (els) => els.length);
    if (rows !== 7) fail(`증축 팝업의 고르기 줄이 일곱이 아니다 — ${rows}`);
    const off = () => page.$eval('[data-action="upgradeConfirm"]', (b) => (b as HTMLButtonElement).disabled);
    if (!await off()) fail('아무것도 안 골랐는데 [증축한다]가 눌린다');
    for (const id of PICKS) await page.click(`[data-modal="upgrade"] [data-action="pickBuilding"][data-building="${id}"]`);
    await page.click('[data-modal="upgrade"] [data-action="pickBuilding"][data-building="hospital"]');
    const head = await page.$eval('[data-field="pickHead"]', (e) => (e as HTMLElement).dataset['picked']);
    if (head !== '3') fail(`넷째를 눌렀는데 고른 수가 ${head}다 — 셋에서 멈춰야 한다`);
    if (await off()) fail('셋을 골랐는데 [증축한다]가 안 눌린다');
    await shot('popup-upgrade-picked');
  }
  await page.click('[data-action="upgradeConfirm"]');
  // **증축은 서버 왕복이다**(`POST /city/upgrade`) — 고정 대기 대신 결과(완료 팝업) 또는
  // 거절(이유 한 줄)이 뜰 때까지 본다. 거절이면 그 말을 그대로 실패에 싣는다
  await page.waitForSelector('[data-modal="upgradeDone"], .stw[data-say="refused"]', { timeout: 8_000 })
    .catch(() => fail('[증축 확인]을 눌렀는데 8초가 지나도 완료도 거절도 안 뜬다'));
  {
    const refused = await page.textContent('.stw[data-say="refused"] [data-field="guideText"]').catch(() => null);
    if (refused) fail(`서버가 증축을 거절했다: "${refused}"`);
    const doneRows = await page.$$eval('[data-modal="upgradeDone"] .cty-done-bldrow', (els) => els.map((e) => (e as HTMLElement).dataset['building']));
    if (doneRows.join(',') !== PICKS.join(',')) fail(`완료 팝업의 함께 오른 건물이 다르다: [${doneRows.join(' ')}]`);
  }
  await page.click('[data-action="doneOk"]');
  await page.waitForSelector('.cel-back[data-leaving]', { state: 'detached', timeout: 5_000 });   // 축하 화면의 닫힘 연출(.36초)이 끝날 때까지
  await page.waitForTimeout(200);
  it = await info();
  if (it!.level !== 2) fail(`증축했는데 레벨이 ${it!.level}이다`);
  {
    const before = JSON.parse(buildingsBefore) as Record<string, number>;
    const saved = (await getProfile(player.uid))!.buildings as Record<string, number>;
    for (const [id, lv] of Object.entries(saved)) {
      const want = (before[id] ?? 0) + ((PICKS as readonly string[]).includes(id) ? 1 : 0);
      if (lv !== want) fail(`증축 뒤 ${id}가 Lv${lv}다 (Lv${want}이어야 한다 — 고른 셋만 오른다)`);
    }
  }
  if (it!.pool !== poolAfterLoss + 5) fail(`궁궐을 안 골랐는데 풀이 바뀌었다 — ${it!.pool}`);
  if (!it!.materials.includes('/ 15')) fail(`다음 레벨 재료가 안 바뀌었다: "${it!.materials}"`);
  // [건물 관리]와 짓기 단추는 없어졌다(2026-11-23)
  if (await page.$('[data-action="buildings"], .scr-city [data-action="build"]')) fail('도시 관리에 옛 [건물 관리]/[짓기]가 남았다');
  console.log(`✓ 증축 — Lv2 · 고른 셋(${PICKS.join(' · ')})만 한 단계 · 풀 그대로(${it!.pool})`);

  /*
   * ⑤ 랭킹 — 전투 · 도시화 · 컬렉션 (2026-11-20 기획자, 옛 「도시 전적은 장수 전적의 합이 아니다」 절을 바꿨다).
   *
   * 전투 랭킹은 **공격대의 부대 전적**이다 — 계정 전적(`PlayerProfile.record`)은 안 읽는다. 그래서 둘에
   * **서로 다른 값**을 심는다: 공격대 3v3 4판(3승 1패), 계정 전적 7판. 어느 칸을 읽었는지가 숫자로 갈린다
   * (「기본값과 같은 값을 보면 아무것도 확인하지 않는다」). 5v5 공격대는 안 뛰었다 → 5v5에서는 줄에 안 선다.
   */
  {
    const p = await apiGet();
    p['record'] = { 'field/3v3': { plays: 7, wins: 2, draws: 2, losses: 3, kills: 1, points: 40 } };
    const squads = p['squads'] as { id: string; record: Record<string, unknown> }[];
    const atk = squads.find((s) => s.id === 'atk-3v3');
    if (!atk) fail(`3v3 공격대가 없다 — 전투 랭킹을 잴 부대가 없다 [${squads.map((s) => s.id).join(' ')}]`);
    atk!.record = { 'field/3v3': { plays: 4, wins: 3, draws: 0, losses: 1, kills: 9, points: 150 } };
    // `roster` · `squads`가 서버 소유라 `PUT`으로는 안 심긴다 — 서버 함수로 쓴다
    await page.evaluate(() => (window as any).__profile.flush());
    await saveProfileTrusted(player.uid, p as Parameters<typeof saveProfileTrusted>[1]);
  }
  const cityName = String((await apiGet())['cityName']);
  await reenter();
  await clickPlace('ranking');
  // 게시판 자리는 대자보로 먼저 든다(2026-10-13) — 위 판 「랭킹」 제목 + 세 줄(전투 · 도시화 · 컬렉션, 2026-11-20) · [컬렉션 보기] · [랭킹 보기]
  await page.waitForSelector('[data-screen="board"]', { timeout: 5_000 })
    .catch(() => fail('메인의 「대자보」를 눌렀는데 대자보 화면이 안 뜬다'));
  {
    const board = await page.evaluate(() => ({
      lines: [...document.querySelectorAll('[data-field="board"] .rk-sum-line')].map((l) => (l as HTMLElement).dataset['mine']),
      title: document.querySelector('[data-field="board"] [data-field="boardTitle"]')?.textContent ?? '',
      // 줄마다 둥근 메달 — 승리 · 궁궐 · 관우 꼬마 얼굴(2026-11-20). 그림이 실제로 실렸는지 너비로 본다
      icons: [...document.querySelectorAll('[data-field="board"] .rk-sum-icon img')]
        .map((i) => `${(i as HTMLImageElement).getAttribute('src')}:${(i as HTMLImageElement).naturalWidth > 0 ? 1 : 0}`),
      collectionOff: (document.querySelector('.scr-board [data-action="collection"]') as HTMLButtonElement | null)?.disabled,
    }));
    if (board.lines.join(',') !== 'battle,city,collection') fail(`대자보 위 판의 줄이 다르다: [${board.lines.join(' ')}]`);
    if (board.title.trim() !== '랭킹') fail(`대자보 위 판의 제목이 「${board.title}」다 (「랭킹」)`);
    const wantIcons = ['icons/record/rec-win.png:1', 'icons/city/bld-palace.png:1', 'icons/record/rec-collection.png:1'];
    if (board.icons.join(',') !== wantIcons.join(',')) fail(`대자보 위 판의 메달이 다르다: [${board.icons.join(' ')}]`);
    if (board.collectionOff !== false) fail('[컬렉션 보기]가 꺼져 있다 — 컬렉션 화면이 붙었다(2026-10-13)');
  }
  // 컬렉션 — 들어가 목록이 뜨고 [대자보로]로 돌아온다. 칸 등록 · 두루마리는 `tools/collection_ux.ts`가 본다
  await page.click('.scr-board [data-action="collection"]');
  await page.waitForSelector('[data-screen="collection"] ~ .place-body .clx-row', { timeout: 5_000 })
    .catch(() => fail('[컬렉션 보기]를 눌렀는데 컬렉션 목록이 안 뜬다'));
  await page.click('[data-screen="collection"] [data-action="back"]');
  await page.waitForSelector('[data-screen="board"]', { timeout: 5_000 })
    .catch(() => fail('컬렉션의 [대자보로]를 눌렀는데 대자보로 안 돌아온다'));
  await page.click('.scr-board [data-action="ranking"]');
  await page.waitForSelector('[data-screen="ranking"]', { timeout: 5_000 })
    .catch(() => fail('대자보의 [랭킹 보기]를 눌렀는데 랭킹 화면이 안 뜬다'));
  {
    // 랭킹 메뉴 — 위 판 세 줄(전투 · 도시화 · 컬렉션) · 단추 셋 + [뒤로 가기]. 전투 점수는 공격대 승점(150)이다
    const menu = await page.evaluate(() => ({
      lines: [...document.querySelectorAll('[data-field="mine"] .rk-sum-line')].map((l) => (l as HTMLElement).dataset['mine']),
      battle: document.querySelector('[data-field="mine"] [data-mine="battle"] [data-field="total"]')?.textContent ?? '',
      buttons: [...document.querySelectorAll('.rk-menu button')].map((b) => (b as HTMLElement).dataset['action']),
    }));
    if (menu.lines.join(',') !== 'battle,city,collection') fail(`랭킹 메뉴 위 판의 줄이 다르다: [${menu.lines.join(' ')}]`);
    if (menu.buttons.join(',') !== 'rankingBattle,rankingCity,rankingCollection,backRanking') fail(`랭킹 메뉴 단추가 다르다: [${menu.buttons.join(' ')}]`);
    if (!/\b150\b/.test(menu.battle)) fail(`전투 점수가 공격대 승점(150)이 아니다: "${menu.battle}" — 계정 전적(40)을 읽었나`);
  }
  await page.click('[data-action="rankingBattle"]');
  await page.waitForSelector('[data-screen="rankingBoard"][data-board="battle"]', { timeout: 5_000 })
    .catch(() => fail('[전투 랭킹]을 눌렀는데 화면이 안 뜬다'));
  // 남의 도시가 위를 채우고 있을 수 있다 — 이름으로 좁힌다(스모크 도시 이름은 무작위 꼬리가 붙는다).
  // 검색은 단추 없이 입력 뒤 잠깐 기다렸다 저절로 나간다(`RANK_SEARCH_DEBOUNCE_MS`)
  await page.fill('.scr-ranking-battle [data-field="search"]', cityName);
  const rowSel = `.scr-ranking-battle .rk-row[data-city="${cityName}"]`;
  await page.waitForSelector(`${rowSel} .rk-wdl`, { timeout: 8_000 })
    .catch(() => fail(`전투 랭킹 검색에 내 도시(${cityName}) 줄이 안 뜬다`));
  const wdl = (await page.textContent(`${rowSel} .rk-wdl`))!.replace(/\s+/g, '');
  if (wdl === '2/2/3') fail('전투 랭킹이 계정 전적을 읽었다 — 공격대의 부대 전적이라야 한다');
  if (wdl !== '3/0/1') fail(`전투 랭킹(전체)이 「3/0/1」이 아니다: "${wdl}"`);
  // 5v5 — 5v5 공격대로는 안 뛰었다 → 줄에 안 선다(검색해도 안 나온다)
  await page.click('.scr-ranking-battle [data-field="mode"]');
  await page.click('.scr-ranking-battle .rk-pop [data-value="5v5"]');
  await page.waitForFunction((sel) => !document.querySelector(sel), rowSel, { timeout: 5_000 })
    .catch(() => fail('5v5 공격대로 한 판도 안 뛰었는데 5v5 전투 랭킹에 줄이 섰다'));
  await page.click('.scr-ranking-battle [data-action="backRanking"]');
  // 도시화 — 모든 도시가 선다. 점수 = 도시 레벨 × 100 + 보유 장수 × 10 + 올린 레벨 합
  await page.click('[data-action="rankingCity"]');
  await page.waitForSelector('[data-screen="rankingBoard"][data-board="city"]', { timeout: 5_000 })
    .catch(() => fail('[도시화 랭킹]을 눌렀는데 화면이 안 뜬다'));
  await page.fill('.scr-ranking-city [data-field="search"]', cityName);
  const cityScoreText = await page.waitForSelector(`.scr-ranking-city .rk-row[data-city="${cityName}"] [data-field="score"]`, { timeout: 8_000 })
    .then((el) => el.textContent())
    .catch(() => fail(`도시화 랭킹 검색에 내 도시(${cityName}) 줄이 안 뜬다`));
  if (!(Number(String(cityScoreText).replace(/\D/g, '')) >= 100)) fail(`도시화 점수가 도시 레벨 몫(100)보다 작다: "${cityScoreText}"`);
  console.log(`✓ 랭킹 — 메뉴 셋 · 전투 ${wdl}(공격대 전적, 계정 전적 아님) · 5v5 줄 없음 · 도시화 ${cityScoreText}점`);

  /*
   * ⑥ 부상 — 장수 카드의 라벨 · 붉은 능력치 · [입원시키기] (트랙 11g, GDD §8.2 · §5.7)
   *
   * 부상은 전투에서 쓰러져야 생기고 1시간 뒤 저절로 풀려서, 스모크 흐름에서는
   * **그 상태에 닿지 않는다** — 계정에 직접 심는다(CLAUDE.md 「도달할 수 없는 상태에 걸린 검사」).
   * 병원은 처음엔 **없게** 두어 [입원시키기]가 없는 갈래부터 보고, 지은 뒤 실제로 입원시킨다.
   */
  {
    const base = OFFICERS.find((o) => o.id === who)!;
    const plant = async (hospital: number): Promise<void> => {
      await page.evaluate(() => (window as any).__profile.flush());
      const stored = await getProfile(player.uid);
      const inst = { ...stored!.roster[who!]!, injuredAt: Date.now() } as { healingAt?: number };
      delete inst.healingAt;
      await saveProfileTrusted(player.uid, {
        ...stored!,
        roster: { ...stored!.roster, [who!]: inst },
        buildings: { ...stored!.buildings, hospital },
        hospitalBusy: [],
      } as Parameters<typeof saveProfileTrusted>[1]);
    };
    const readCard = () => page.evaluate(() => {
      const card = document.querySelector('.ofcard-modal')!;
      const num = (f: string) => Number(card.querySelector(`[data-field="${f}"] .v`)?.textContent ?? NaN);
      const abl = card.querySelector('.ofcard-bar-abl') as HTMLElement | null;
      return {
        injured: abl?.dataset.injured ?? '',
        color: abl ? getComputedStyle(abl.querySelector('.v')!).color : '',
        might: num('might'), intellect: num('intellect'), leadership: num('leadership'),
        tag: !!card.querySelector('[data-field="injury"] [data-action="injury"]'),
      };
    });
    const openInjured = async (): Promise<void> => {
      await reenter();
      await toPalace();
      await page.click('[data-action="officers"]');
      await page.waitForTimeout(300);
      await searchFor(base.name);
      await openCardOf(who!);
    };

    await plant(0);
    await openInjured();
    const hurt = await readCard();
    if (hurt.injured !== '1' || !hurt.tag) fail(`부상인데 카드에 라벨이 없다: ${JSON.stringify(hurt)}`);
    // **깎인 값 하나만** — 「40 (−10)」처럼 나란히 두지 않는다 (GDD §8.2)
    const want = (v: number) => Math.max(1, v - 10);
    if (hurt.might !== want(base.might) || hurt.intellect !== want(base.intellect) || hurt.leadership !== want(base.leadership)) {
      fail(`부상 능력치가 깎인 값이 아니다 — 화면 ${hurt.might}/${hurt.intellect}/${hurt.leadership}, 원래 ${base.might}/${base.intellect}/${base.leadership}`);
    }
    if (hurt.color === 'rgb(0, 0, 0)') fail('부상 능력치가 붉지 않다 — 순검정 그대로다');
    await page.click('.ofcard-modal [data-action="injury"]');
    const info = await page.evaluate(() => ({
      left: document.querySelector('.ofcard-modal [data-field="injuryLeft"]')?.textContent ?? '',
      heal: !!document.querySelector('.ofcard-modal [data-action="healOfficer"]'),
    }));
    if (!/\d/.test(info.left)) fail(`[부상]을 눌렀는데 언제 낫는지가 없다: "${info.left}"`);
    if (info.heal) fail('병원이 없는데 [입원시키기]가 있다 — 「병원이 있으면 [치료]」');
    console.log(`✓ 부상 카드 — ${hurt.might}/${hurt.intellect}/${hurt.leadership} (원래 ${base.might}/${base.intellect}/${base.leadership}) 붉게 · 「${info.left}」 · 병원 없음 → 단추 없음`);
    await closeCard();

    // 병원을 짓고 다시 — [입원시키기]가 생기고, 누르면 서버가 치료실에 넣는다
    await plant(1);
    await openInjured();
    await page.click('.ofcard-modal [data-action="injury"]');
    const btn = await page.$('.ofcard-modal [data-action="healOfficer"]');
    if (!btn) fail('병원이 있는데 카드에 [입원시키기]가 없다');
    if (await btn!.isDisabled()) {
      fail(`빈 치료실이 있는데 [입원시키기]가 잠겼다: "${await page.textContent('.stw[data-say="healBlocked"] [data-field="guideText"]').catch(() => '')}"`);
    }
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/city/heal'), { timeout: 8_000 }),
      btn!.click(),
    ]);
    await page.waitForSelector('.ofcard-modal [data-field="injury"][data-healing="1"]', { timeout: 5_000 })
      .catch(async () => fail(`입원시켰는데 카드가 「치료 중」이 아니다: "${await page.textContent('.stw[data-say="healError"] [data-field="guideText"]').catch(() => '')}"`));
    const healed = await getProfile(player.uid);
    if (healed!.roster[who!]!.healingAt === undefined) fail('입원이 서버에 안 남았다 — 화면만 바뀌었다');
    console.log('✓ 부상 카드 — 병원 Lv1 → [입원시키기] → 서버에 치료 기록 · 카드는 「치료 중」');
    await closeCard();
  }
}

// **전부 찍는다** — 첫 건만 찍으면 한 번 돌 때마다 하나씩만 드러난다(2026-09-14, 네 건 중 하나만 보였다)
if (errors.length) fail(`콘솔 오류 ${errors.length}건:\n${errors.map((e, n) => `  ${n + 1}. ${e.split('\n')[0]}`).join('\n')}`);
await browser.close();
if (ownServer) await ownServer.gracefullyShutdown(false);
if (ownApi) await ownApi.close();
await cleanupAccounts();
console.log('\n메타 연동 스모크 통과');
process.exit(0);