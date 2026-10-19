/**
 * 입장 영상 확인 — 간판 [입장] → (입성 로딩) → 시간대 영상 → 메인 (2026-10-19, `EnterCine.tsx`)
 *
 *   npm run dev · npm run server-api 를 띄운 뒤
 *   node --experimental-strip-types --env-file=.env tools/enter_cine_ux.ts
 *
 * 시험 계정을 Admin API로 만들고 끝에 지운다. 확인하는 것:
 * - 새 계정(도시 이름 짓기로 가는 길)에는 영상이 **안** 선다
 * - 낮 · 황혼 · 밤마다 제 영상이 서고 **실제로 재생된다**(`currentTime`이 흐른다)
 * - 영상 밑에서 메인이 이미 서 있고, 끝나면 영상이 걷혀 메인만 남는다
 * - [건너뛰기]가 영상을 걷는다
 * - 저장된 세션으로 새로고침하면 영상이 안 선다
 *
 * **브라우저는 Edge다** — Playwright의 Chromium은 H.264를 못 풀어 영상이 `error`로 곧장 걷힌다
 * (그러면 「영상 없이 지나간다」 갈래만 시험된다). 사람들이 쓰는 브라우저와 같은 조건이어야 한다.
 * 시간대는 가짜 시계(`page.clock.setFixedTime`)로 고른다 — `bandForHour()`가 시계를 밖에서 받는 그 이유다.
 */
import { randomUUID } from 'node:crypto';
import { chromium, type Page } from 'playwright';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

const admin = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const email = `enter-cine-${randomUUID()}@samchess.test`;
const password = randomUUID();
const uid = (await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
})).json() as { id: string }).id;

const browser = await chromium.launch({ channel: 'msedge' });
const errors: string[] = [];

/** 그 시간대의 시각 — 진짜 지금보다 앞이어야 세션 토큰이 「만료」로 안 읽힌다 */
const timeOf = (hour: number): Date => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d;
};

async function login(page: Page): Promise<void> {
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
}

async function logout(page: Page): Promise<void> {
  await page.click('[data-action="logout"]');
  await page.click('[data-action="logoutConfirm"]');
  await page.waitForSelector('.scr-title', { timeout: 10_000 });
}

try {
  // ① 새 계정 — 도시 이름 짓기로 간다. 성 안 장면을 틀면 안 된다
  {
    const page = await browser.newPage({ viewport: { width: 700, height: 1400 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await login(page);
    await page.waitForSelector('.scr-new', { timeout: 20_000 });
    if (await page.$('[data-modal="enterCine"]')) fail('새 계정(도시 이름 짓기)에 입장 영상이 섰다');
    ok('새 계정 → 도시 이름 짓기, 영상 없음');
    const cityName = `입장영상-${randomUUID().slice(0, 4)}`;
    await page.fill('.scr-new .newgame-form input', cityName);
    await page.click('.scr-new .newgame-form .btn.primary');

    // 가입 오프닝 — 그림이 2부터 8까지 넘어가 8에서 서고, 그 뒤에야 [성으로 들어가기]
    await page.waitForSelector('[data-modal="signupOpening"]', { timeout: 20_000 })
      .catch(() => fail('도시를 지었는데 가입 오프닝이 안 선다'));
    if (await page.$('.scr-main')) fail('가입 오프닝 중인데 벌써 메인이다');
    // 실제로 그림이 받아졌는가 — 404면 칸만 깔리고 배경만 보인다
    const loaded = await page.$$eval('.ngo-frame', (els) => Promise.all(els.map((el) => new Promise<boolean>((res) => {
      const url = getComputedStyle(el).backgroundImage.slice(5, -2);
      const img = new Image(); img.onload = () => res(img.naturalWidth > 0); img.onerror = () => res(false); img.src = url;
    }))));
    if (loaded.length !== 7 || loaded.includes(false)) fail(`가입 오프닝 그림 ${loaded.filter(Boolean).length}/7장만 받아진다`);
    // 「정확히 4」를 기다리면 위의 그림 확인이 늦을 때 지나쳐 버린다 — 4 이상이면 된다
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-modal="signupOpening"]')?.dataset['frame']) >= 4, null, { timeout: 5_000 });
    await page.screenshot({ path: `${SHOTS}/signup-1-frames.png` });

    // 첫 대사 — 그림이 넘어가기 시작할 때부터, 계정 ID(이메일 @ 앞)와 도시 이름이 들어간다
    const say = await page.$eval('[data-modal="signupOpening"] .ngo-say', (e) => e.textContent ?? '');
    const myId = email.split('@')[0]!;
    if (!say.includes(myId) || !say.includes(cityName)) fail(`첫 대사에 ID · 도시 이름이 없다 — ${say}`);
    if (!say.includes(`${myId}는`) || !say.includes(`「${cityName}」라`)) fail(`첫 대사의 조사가 어긋났다 — ${say}`);
    ok(`첫 대사 — 「${say.slice(0, 40)}…」`);

    // 장수 — 그림이 8에 선 뒤 판이 뜨고, 섬광 없이 판 위에 한 명씩 낮은 등급부터
    await page.waitForSelector('[data-field="starters"]', { timeout: 15_000 })
      .catch(() => fail('그림이 다 넘어간 뒤 판이 안 뜬다'));
    const at = await page.getAttribute('[data-modal="signupOpening"]', 'data-frame');
    if (at !== '8') fail(`판이 떴는데 그림이 ${at}에 있다`);
    const grades: string[] = [];
    const t0 = Date.now();
    for (let n = 1; n <= 5; n++) {
      await page.waitForSelector(`[data-field="starters"][data-popped="${n}"]`, { timeout: 3_000 })
        .catch(() => fail(`${n}번째 장수가 판에 안 나온다`));
      const now = await page.$$eval('.ngo-member', (ms) => ms.map((m) => (m as HTMLElement).dataset['grade']!));
      if (now.length !== n) fail(`${n}번째에 판 위 장수가 ${now.length}명`);
      grades.push(now.find((g) => !grades.includes(g))!);
      if (n === 3) await page.screenshot({ path: `${SHOTS}/signup-2-pop.png` });
    }
    if (await page.$('[data-modal="rewardCards"]')) fail('가입 오프닝에 섬광 · 카드 공개가 떴다(기획: 판 위 「팡」만)');
    if (grades.join('') !== 'DCBAS') fail(`나오는 순서가 ${grades.join('')} — D부터 S까지 올라가야 한다`);
    ok(`장수 ${grades.join('→')} — 판 위에 한 명씩, ${((Date.now() - t0) / 1000).toFixed(1)}초`);

    // W 대형 — 왼쪽부터 D B S A C, 위 줄 B A, 크기 S 1.2 · A B 1.1 · C D 1, 판은 2:1
    await page.waitForTimeout(600);
    const w = await page.evaluate(() => {
      const panel = document.querySelector('[data-field="starters"]')!.getBoundingClientRect();
      const ms = [...document.querySelectorAll<HTMLElement>('.ngo-member')].map((m) => {
        const r = m.getBoundingClientRect();
        const art = m.querySelector('.ngo-member-art')!.getBoundingClientRect();
        return { g: m.dataset['grade']!, x: r.left + r.width / 2, bottom: r.bottom, size: art.width, name: m.querySelector('.nm')?.textContent ?? '', font: getComputedStyle(m).fontFamily };
      }).sort((a, b) => a.x - b.x);
      return { ratio: panel.width / panel.height, ms, inside: ms.every((m) => m.bottom <= panel.bottom + 1) };
    });
    const order = w.ms.map((m) => m.g).join('');
    if (order !== 'DBSAC') fail(`W 대형 순서가 ${order} — 왼쪽부터 DBSAC여야 한다`);
    const top = w.ms.filter((m) => m.bottom < w.ms.find((x) => x.g === 'S')!.bottom - 20).map((m) => m.g).sort().join('');
    if (top !== 'AB') fail(`위 줄이 ${top} — B · A여야 한다`);
    const base = w.ms.find((m) => m.g === 'D')!.size;
    const rel = Object.fromEntries(w.ms.map((m) => [m.g, +(m.size / base).toFixed(2)]));
    if (rel['S'] !== 1.2 || rel['A'] !== 1.1 || rel['B'] !== 1.1 || rel['C'] !== 1) fail(`크기 비율이 어긋났다 — ${JSON.stringify(rel)}`);
    if (Math.abs(w.ratio - 2) > 0.02) fail(`판 비율이 ${w.ratio.toFixed(2)} — 2:1이어야 한다`);
    if (w.ms.some((m) => !m.name)) fail('이름이 빈 장수가 있다');
    if (await page.$('[data-action="openingEnter"]')) fail('W 대형과 함께 [성 안으로 들어가기]가 벌써 떴다');
    await page.screenshot({ path: `${SHOTS}/signup-2b-roster.png` });
    ok(`W 대형 ${order} · 위 줄 B A · 크기 ${JSON.stringify(rel)} · 판 ${w.ratio.toFixed(2)}:1 · 글꼴 ${w.ms[0]!.font.split(',')[0]}`);

    await page.waitForSelector('[data-field="say2"]', { timeout: 5_000 }).catch(() => fail('W 대형 뒤 둘째 대사가 안 뜬다'));
    await page.waitForSelector('[data-action="openingEnter"]', { timeout: 10_000 })
      .catch(() => fail('둘째 대사 뒤 [성 안으로 들어가기]가 안 뜬다'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/signup-3-say2.png` });
    ok('둘째 대사 → [성 안으로 들어가기]');

    await page.click('[data-action="openingEnter"]');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${SHOTS}/signup-4-dive.png` });
    await page.waitForSelector('#frame[data-arrive] .scr-main', { timeout: 3_000 })
      .catch(() => fail('파고든 뒤 메인이 「도착」 전환으로 안 선다'));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/signup-5-arrive.png` });
    await page.waitForSelector('#frame:not([data-arrive])', { timeout: 3_000 }).catch(() => fail('도착 전환이 안 끝난다'));
    if (await page.$('[data-modal="enterCine"]')) fail('가입 오프닝 뒤에 입장 영상이 섰다(기획: 바로 메인)');
    ok('[성 안으로 들어가기] → 파고들기 · 번쩍 → 메인이 줄어들며 자리 잡음');
    await page.close();
  }

  // ② 시간대마다 — 낮은 끝까지 보고, 황혼 · 밤은 [건너뛰기]
  for (const [band, hour, watch] of [['day', 10, true], ['dusk', 18, false], ['night', 2, false]] as const) {
    const ctx = await browser.newContext({ viewport: { width: 700, height: 1400 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    await page.clock.setFixedTime(timeOf(hour));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await login(page);

    const cine = await page.waitForSelector('[data-modal="enterCine"]', { timeout: 20_000 })
      .catch(() => fail(`${band}: 입장 영상이 안 섰다`));
    const got = await cine.getAttribute('data-band');
    if (got !== band) fail(`${band} 시각인데 ${got} 영상이 섰다`);
    if (!(await page.$('.scr-main'))) fail(`${band}: 영상 밑에 메인이 아직 없다`);
    // 실제로 흐르는가 — 포스터만 깔린 채 멈춰 있으면 화면은 멀쩡해 보인다
    await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('[data-modal="enterCine"] video')?.currentTime ?? 0) > 1.5, null, { timeout: 8_000 })
      .catch(() => fail(`${band}: 영상이 재생되지 않는다`));
    const info = await page.$eval('[data-modal="enterCine"] video', (v) => ({ src: (v as HTMLVideoElement).currentSrc, muted: (v as HTMLVideoElement).muted, w: (v as HTMLVideoElement).videoWidth }));
    ok(`${band}: 영상 재생 중 (${info.src.startsWith('blob:') ? '미리 받은 것' : info.src}, ${info.w}px, 소리 ${info.muted ? '끔' : '켬'})`);

    if (watch) {
      await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('[data-modal="enterCine"] video')?.currentTime ?? 0) > 5, null, { timeout: 8_000 });
      await page.screenshot({ path: `${SHOTS}/enter-cine-${band}-sky.png` });
      await page.waitForSelector('[data-modal="enterCine"][data-leaving]', { timeout: 10_000 })
        .catch(() => fail(`${band}: 영상이 끝나도 걷히기 시작하지 않는다`));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/enter-cine-${band}-reveal.png` });
    } else {
      await page.click('[data-action="cineSkip"]');
    }
    await page.waitForSelector('[data-modal="enterCine"]', { state: 'detached', timeout: 3_000 })
      .catch(() => fail(`${band}: 영상이 걷히지 않는다`));
    if (!(await page.isVisible('.scr-main'))) fail(`${band}: 영상이 걷힌 뒤 메인이 안 보인다`);
    ok(`${band}: ${watch ? '끝까지 본 뒤' : '[건너뛰기]로'} 메인`);

    // ③ 저장된 세션으로 새로고침 — 영상 없이 곧장 메인 (한 번만 본다)
    if (band === 'day') {
      await page.reload();
      await page.waitForSelector('.scr-main', { timeout: 20_000 });
      await page.waitForTimeout(500);
      if (await page.$('[data-modal="enterCine"]')) fail('새로고침(저장된 세션)인데 입장 영상이 섰다');
      ok('새로고침 → 영상 없이 메인');
    }
    await logout(page);
    await ctx.close();
  }

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' / ')}`);
  console.log(`\n사진: ${SHOTS}`);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: admin });
}
