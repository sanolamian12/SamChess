/**
 * 입장 확인 — 간판 [입장] → 입장 하늘(`EnterSky`) → 메인 · 가입 오프닝 (2026-10-19)
 *
 *   npm run dev · npm run server-api 를 띄운 뒤
 *   node --experimental-strip-types --env-file=.env tools/enter_ux.ts
 *
 * 시험 계정을 Admin API로 만들고 끝에 지운다. 확인하는 것:
 * - 새 계정은 하늘을 지나 **도시 이름 짓기**로 내려앉고, 가입 오프닝이 끝까지 돈다
 * - 낮 · 황혼 · 밤마다 제 하늘로 올라가고(in → up → hold → down → out), 하늘에 닿은 **뒤에야** 밑의 화면이 메인으로 바뀌며,
 *   내려앉은 땅 그림이 메인 배경과 같은 그림이고, 다 걷히면 메인만 남는다
 * - 저장된 세션으로 새로고침하면 하늘이 안 선다
 *
 * 프레임 사진(`SHOTS/enter-sky-{band}-NN.png`)을 0.25초마다 남긴다 — 이음매는 눈으로 본다.
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
const email = `enter-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const uid = (await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
})).json() as { id: string }).id;

const browser = await chromium.launch();
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
    // 새 계정은 하늘로 올라가되 **내려오지 않는다**(도시 이름 짓기 화면은 노을 한 장뿐이라 낮 · 밤엔 시간이 지나 보인다) —
    // 하늘에 머문 채 흰 전환으로 도시 이름 짓기에 간다(2026-10-19 기획자 지정).
    // 하늘 층의 단계와 흰 전환의 걸음을 페이지 안에서 프레임마다 적는다
    const trace = async (): Promise<void> => page.evaluate(() => {
      const w = window as unknown as { __tr: string[] };
      w.__tr = [];
      const tick = (): void => {
        const sky = document.querySelector<HTMLElement>('[data-modal="enterSky"]')?.dataset['phase'] ?? '-';
        const fl = document.getElementById('frame')?.dataset['flash'] ?? '-';
        const scr = document.querySelector('.scr-new') ? 'new' : document.querySelector('.scr-title') ? 'title' : '?';
        const v = `${sky}|${fl}|${scr}`;
        if (w.__tr.at(-1) !== v) w.__tr.push(v);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const traced = (): Promise<string[]> => page.evaluate(() => (window as unknown as { __tr: string[] }).__tr);
    await trace();
    await login(page);
    await page.waitForSelector('#frame:not([data-flash]) .scr-new', { timeout: 20_000 }).catch(() => fail('새 계정이 도시 이름 짓기로 안 간다'));
    {
      const tr = await traced();
      const phase = (v: string): string => v.split('|')[0]!;
      if (!tr.some((v) => phase(v) === 'up') || !tr.some((v) => phase(v) === 'hold')) fail(`새 계정인데 하늘로 안 올라갔다 — ${tr.join(' → ')}`);
      if (tr.some((v) => phase(v) === 'down')) fail(`새 계정인데 하늘에서 땅으로 내려왔다(시간대가 바뀌어 보인다) — ${tr.join(' → ')}`);
      const outAt = tr.findIndex((v) => v.startsWith('hold|out|'));
      const inAt = tr.findIndex((v) => v.includes('|in|new'));
      if (outAt < 0 || inAt < outAt) fail(`새 계정: 하늘에서 흰 전환(out) → 도시 이름 짓기(in)를 안 거쳤다 — ${tr.join(' → ')}`);
    }
    ok('새 계정 → 하늘(내려오지 않음) → 흰 전환 → 도시 이름 짓기');
    // [뒤로 가기]도 흰 전환으로 간판에 — 그리고 다시 들어온다
    await trace();
    await page.click('[data-action="newgameBack"]');
    await page.waitForSelector('#frame:not([data-flash]) .scr-title', { timeout: 10_000 }).catch(() => fail('[뒤로 가기]가 간판으로 안 간다'));
    {
      const tr = await traced();
      if (!tr.some((v) => v.includes('|out|new')) || !tr.some((v) => v.includes('|in|title'))) fail(`[뒤로 가기]가 흰 전환을 안 거쳤다 — ${tr.join(' → ')}`);
    }
    ok('[뒤로 가기] → 흰 전환 → 간판');
    await login(page);
    await page.waitForSelector('#frame:not([data-flash]) .scr-new', { timeout: 20_000 });
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
    if (!say.includes(`${myId}는`) || !say.includes(`「${cityName}」에서`)) fail(`첫 대사의 조사가 어긋났다 — ${say}`);
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
    if (await page.$('[data-modal="enterSky"]')) fail('가입 오프닝 뒤에 입장 하늘이 섰다(기획: 바로 메인)');
    ok('[성 안으로 들어가기] → 파고들기 · 번쩍 → 메인이 줄어들며 자리 잡음');
    await page.close();
  }

  // ② 시간대마다 — 하늘로 올라갔다가 메인으로 내려앉는다
  for (const [band, hour] of [['day', 10], ['dusk', 18], ['night', 2]] as const) {
    const ctx = await browser.newContext({ viewport: { width: 700, height: 1400 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    await page.clock.setFixedTime(timeOf(hour));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // [입장] 뒤 패널 · 단추가 **서서히** 흐려지는가 — 페이지 안에서 프레임마다 잰다(밖에서 들여다보면 짧은 순간을 놓친다)
    await page.evaluate(() => {
      const w = window as unknown as { __fade: number[][] };
      w.__fade = [];
      const tick = (): void => {
        const back = document.querySelector('.scr-title > .modal-back');
        const form = document.querySelector('.scr-title > .title-form');
        if (back && form) w.__fade.push([Number(getComputedStyle(back).opacity), Number(getComputedStyle(form).opacity)]);
        if (document.querySelector('.scr-title')) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await login(page);

    const sky = await page.waitForSelector('[data-modal="enterSky"]', { timeout: 20_000 })
      .catch(() => fail(`${band}: 하늘이 안 선다`));
    const got = await sky.getAttribute('data-band');
    if (got !== band) fail(`${band} 시각인데 ${got} 하늘이 섰다`);
    // 프레임 사진과 단계 기록 — 걷힐 때까지
    const phases: string[] = [];
    let n = 0;
    let mainBeforeCovered = false;
    for (;;) {
      const ph = await page.evaluate(() => document.querySelector<HTMLElement>('[data-modal="enterSky"]')?.dataset['phase'] ?? 'gone');
      if (ph === 'gone') break;
      if (phases.at(-1) !== ph) phases.push(ph);
      if ((ph === 'in' || ph === 'up') && await page.$('.scr-main')) mainBeforeCovered = true;
      await page.screenshot({ path: `${SHOTS}/enter-sky-${band}-${String(n++).padStart(2, '0')}.png` });
      if (n > 60) fail(`${band}: 하늘이 15초 넘게 안 걷힌다 — 단계 ${phases.join('→')}`);
      await page.waitForTimeout(250);
    }
    if (phases.join('') !== 'inupholddownout' && phases.join('') !== 'upholddownout') fail(`${band}: 단계가 ${phases.join('→')}`);
    const fade = await page.evaluate(() => (window as unknown as { __fade: number[][] }).__fade);
    const mid = fade.filter(([a, b]) => a > 0.15 && a < 0.85 && b > 0.15 && b < 0.85).length;
    if (mid < 5 || fade.at(-1)![0] > 0.05) fail(`${band}: 패널 · 단추가 서서히 안 흐려진다 — 중간값 ${mid}프레임, 끝 ${fade.at(-1)}`);
    if (mainBeforeCovered) fail(`${band}: 하늘에 닿기 전에 밑의 화면이 메인으로 바뀌었다(반투명할 때 비친다)`);
    if (!(await page.isVisible('.scr-main'))) fail(`${band}: 하늘이 걷힌 뒤 메인이 안 보인다`);
    const art = await page.$eval('.scr-main .scr-art', (e) => (e as HTMLElement).style.backgroundImage);
    if (!art.includes(`main-${band}`) && !art.includes(`main-em-${band}`)) fail(`${band}: 메인 배경이 ${art}`);
    ok(`${band}: 패널 · 단추 페이드아웃(중간 ${mid}프레임) → ${phases.join(' → ')} · 하늘에 닿은 뒤 메인 · 사진 ${n}장`);

    // ③ 저장된 세션으로 새로고침 — 하늘 없이 곧장 메인 (한 번만 본다)
    if (band === 'day') {
      await page.reload();
      await page.waitForSelector('.scr-main', { timeout: 20_000 });
      await page.waitForTimeout(500);
      if (await page.$('[data-modal="enterSky"]')) fail('새로고침(저장된 세션)인데 하늘이 섰다');
      ok('새로고침 → 하늘 없이 메인');
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
