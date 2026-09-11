/**
 * 대장간 실제 플레이 확인 — 진짜 계정으로 로그인해서 제조 → 완료 → 지급 → 회수까지
 * 끝까지 눌러 본다 (2026-09-10).
 *
 *   node --experimental-strip-types --env-file=.env <this>
 *
 * `?forgeLevel=` 같은 화면 오버라이드는 안 쓴다 — 대장간 레벨과 금화는 **서버에**
 * `saveProfileTrusted()`로 심고(계정을 진짜 그 상태로 만든다), 그 뒤로는 전부 화면을
 * 누른다. 제조 기간은 Lv1 = 1분이라 그대로 기다린다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { pool } from '../packages/server-api/src/db.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_ANON_KEY = process.env['SUPABASE_ANON_KEY']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';

const step = (m: string) => console.log(`\n▶ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string): never => { console.error(`  ✗ ${m}`); process.exit(1); };

// ── 진짜 계정 하나 ────────────────────────────────────────────
const email = `forge-play-${randomUUID()}@samchess.test`;
const password = randomUUID();
const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!createRes.ok) fail(`계정 생성 실패 — ${createRes.status} ${await createRes.text()}`);
const uid = (await createRes.json() as { id: string }).id;
step(`테스트 계정 — ${email}`);

const cleanup = async () => {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  console.log('\n✓ 테스트 계정 정리');
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
// 나가는 PUT /profile의 `forgeOwned`만 순서대로 적어 둔다 — 「화면은 바뀌었는데
// 서버에는 안 남는다」가 **안 보냈는가 / 보냈는데 덮였는가** 중 어느 쪽인지 가른다
if (process.env['TRACE_PUT']) {
  page.on('request', (r) => {
    if (r.method() !== 'PUT' || !r.url().endsWith('/profile')) return;
    try {
      const body = JSON.parse(r.postData() ?? '{}') as { forgeOwned?: unknown };
      console.log(`    ↑ PUT forgeOwned = ${JSON.stringify(body.forgeOwned)}`);
    } catch { /* 본문이 없으면 볼 것도 없다 */ }
  });
}
const errors: string[] = [];
// **`window.confirm`을 받는다** — 회수·주문 취소가 확인창을 띄우는데, Playwright는
// 처리기가 없으면 **자동으로 취소**한다. 그래서 [회수]를 눌러도 아무 일이 없었고
// 화면상으로는 「단추가 안 먹는다」와 구별이 안 됐다.
page.on('dialog', (d) => void d.accept());
// 콘솔의 「Failed to load resource」는 **어느 주소인지를 안 적는다** — 404를
// 쫓으려면 응답 쪽에서 URL을 집어야 한다
page.on('response', (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name: string) => { await page.screenshot({ path: `${SHOTS}/${name}.png` }); ok(`📷 ${name}.png`); };

/**
 * 서버가 그 값이 될 때까지 기다린다 — **고정 대기로 보면 안 된다.** 저장은
 * 쓰기 큐를 지나므로(`storage.ts` — 앞 저장의 응답을 기다린 뒤 다음을 보낸다)
 * 화면이 바뀐 시점과 서버에 남는 시점 사이가 그때그때 다르다. 1.5초 `sleep`으로
 * 봤더니 **같은 코드가 붙었다 떨어졌다** 했다.
 */
async function serverForgeOwned(want: string | null, label: string): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    /*
     * **행을 날것으로 읽는다 — `getProfile()`로 폴링하면 안 된다.** 그쪽은 읽으면서
     * `syncCity()` 결과를 **되쓰는** read-modify-write라, 300ms마다 부르면 그 되쓰기가
     * 마침 날아온 `PUT`을 덮어 「회수했는데 서버엔 그대로」가 간헐적으로 났다 —
     * 검사 도구가 스스로 만든 경주였다.
     */
    const r = await pool.query<{ data: { forgeOwned?: Record<string, string | null> } }>(
      'select data from profiles where uid = $1', [uid],
    );
    const p = r.rows[0]!.data;
    const got = Object.values(p.forgeOwned ?? {})[0] ?? null;
    if (got === want) { ok(`${label} — 서버 반영 ${Date.now() - t0}ms (${JSON.stringify(p.forgeOwned)})`); return; }
    if (Date.now() - t0 > 15_000) fail(`${label} — 15초가 지나도 서버가 ${JSON.stringify(want)}가 아니다 (${JSON.stringify(p.forgeOwned)})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

try {
  // ── 로그인 → 새 도시 ────────────────────────────────────────
  step('간판에서 로그인');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  ok('로그인 성공');

  if (await page.$('.scr-new')) {
    step('새 도시 만들기');
    const nameInput = await page.$('.scr-new .newgame-form input');
    if (nameInput) await nameInput.fill('대장간실험');
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    ok('도시 생성');
  }

  // ── 대장간을 지은 상태로 서버에 심는다 ──────────────────────
  step('서버에 대장간 Lv1 · 금화 500을 심는다 (화면 오버라이드 아님)');
  const stored = await getProfile(uid);
  if (!stored) fail('서버에 프로필이 없다');
  await saveProfileTrusted(uid, {
    ...stored,
    gold: 500,
    cityLevel: 5,
    buildings: { ...stored.buildings, forge: 1 },
  } as Parameters<typeof saveProfileTrusted>[1]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  ok('심었다');

  // ── 성 밖 → 대장간 ─────────────────────────────────────────
  step('성 밖으로 나가 대장간에 들어간다');
  await page.click('.city-gate rect');
  await page.waitForSelector('[data-place="forge"]', { timeout: 10_000 });
  await shot('01-city-ext');
  await page.click('[data-place="forge"]');
  await page.waitForSelector('[data-action="craft"]', { timeout: 10_000 });
  await shot('02-forge-home');
  const summary = await page.evaluate(() => ({
    level: document.querySelector('[data-field="level"]')?.textContent,
    total: document.querySelector('[data-field="total"]')?.textContent,
    stock: document.querySelector('[data-field="stock"]')?.textContent,
    assigned: document.querySelector('[data-field="assigned"]')?.textContent,
  }));
  ok(`요약 — ${JSON.stringify(summary)}`);

  // ── 제조 목록 → 상세 → 주문 ────────────────────────────────
  step('제조 목록');
  await page.click('[data-action="craft"]');
  await page.waitForSelector('.frg-tile', { timeout: 10_000 });
  await shot('03-craft-list');
  const tiles = await page.$$eval('.frg-tile', (els) => els.map((e) => (e as HTMLElement).dataset['item']));
  ok(`목록 ${tiles.length}종 — ${tiles.join(', ')}`);

  /*
   * **쪽 나누기는 만렙에서만 보인다** (2026-09-11). 새 계정의 대장간은 Lv1이라
   * 목록이 세 종뿐이고 한 쪽에 다 들어간다 — 「한 쪽에 두 레벨(= 두 줄)」이라는
   * 규칙이 **한 번도 안 도는 갈래**다. `?forgeLevel=5`는 화면만 속이는 개발용
   * 통로라(`ForgeScreen`의 그 블록 주석 참조) 배치를 보는 데 딱 맞는다 —
   * 실제 주문은 여전히 서버가 진짜 레벨로 재검증한다.
   */
  step('만렙 배치 — 한 쪽에 두 레벨(두 줄)');
  await page.goto(`${BASE}?forgeLevel=5`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.city-gate rect');
  await page.waitForSelector('[data-place="forge"]');
  await page.click('[data-place="forge"]');
  await page.waitForSelector('[data-action="craft"]', { timeout: 10_000 });
  await page.click('[data-action="craft"]');
  await page.waitForSelector('.frg-tile', { timeout: 10_000 });
  const perPage: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(200);
    perPage.push((await page.$$('.frg-tile')).length);
    if (i === 0) await shot('03a-craft-lv5');
    const next = await page.$('.frg-pager [data-action="nextPage"]:not([disabled])');
    if (!next) break;
    await next.click();
  }
  // 레벨마다 품목이 셋, 한 줄이 3열 — 두 레벨이면 여섯 장이 위끝이다
  console.log(perPage.every((n) => n > 0 && n <= 6)
    ? `  ✓ 쪽마다 ${perPage.join('/')}장 — 여섯(두 줄)을 안 넘는다`
    : `  ✗ 한 쪽에 두 줄이 안 지켜진다 — 쪽별 ${perPage.join('/')}장`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.city-gate rect');
  await page.waitForSelector('[data-place="forge"]');
  await page.click('[data-place="forge"]');
  await page.waitForSelector('[data-action="craft"]', { timeout: 10_000 });
  await page.click('[data-action="craft"]');
  await page.waitForSelector('.frg-tile', { timeout: 10_000 });

  step('첫 품목 상세 패널');
  await page.click('.frg-tile');
  await page.waitForSelector('[data-action="startOrder"]', { timeout: 10_000 });
  await shot('04-detail');
  const durText = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.frg-item-meta, .frg-detail-meta, .frg-item-wrap span')]
      .map((e) => e.textContent ?? '').filter((s) => /분|min|週|周/.test(s));
    return el;
  });
  ok(`제조 기간 표기 — ${JSON.stringify(durText)}`);

  step('주문 시작');
  await page.click('[data-action="startOrder"]');
  /*
   * 서버를 기다리는 가리개(`BusyVeil`)를 **지나가는 길에 확인한다**
   * (2026-09-11). 도는 그림이 6프레임 스프라이트에서 **한 장 회전**으로
   * 바뀐 자리라, 잘못되면 원반이 통째로 안 보인다 — 그런데 이 가리개는
   * 왕복이 끝나면 사라져서 「없다」와 「원래 빨랐다」가 구별되지 않는다.
   * 그래서 **못 잡으면 조용히 넘어가되**(왕복이 빠른 날), 잡았으면 그림이
   * 실제로 내려받혔는지까지 본다.
   */
  const veil = await page.waitForSelector('[data-modal="busy"]', { timeout: 2_000 }).catch(() => null);
  if (veil) {
    /* 그림이 **내려받히기를 기다린다** — 이 가리개가 이 화면에서 처음 쓰는
       자산이라, 뜨자마자 재면 늘 「안 떴다」가 된다(확인 팝업이 이미 밟은
       지뢰다). 3초 안에 안 오면 그때는 진짜 고장이다. */
    const loaded = await page.waitForFunction(() => {
      const el = document.querySelector('.busy-spin') as HTMLElement | null;
      if (!el) return false;
      const url = getComputedStyle(el).backgroundImage.match(/url\("(.+?)"\)/)?.[1];
      if (!url) return false;
      const img = new Image();
      img.src = url;
      return img.complete && img.naturalWidth > 0;
    }, undefined, { timeout: 3_000 }).then(() => true).catch(() => false);
    const spin = await page.evaluate(() => {
      const el = document.querySelector('.busy-spin') as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { src: cs.backgroundImage.slice(-22), anim: cs.animationName, dur: cs.animationDuration };
    });
    console.log(loaded && spin && /spin2/.test(spin.src)
      ? `  ✓ 로딩 원반 — ${spin.src} ${spin.anim} ${spin.dur}`
      : `  ✗ 로딩 원반이 이상하다 — loaded=${loaded} ${JSON.stringify(spin)}`);
    /* 가리개는 **뜸을 들여 나타난다**(`BusyVeil`의 `SHOW_AFTER_MS` 180ms +
       페이드 200ms) — 바로 찍으면 투명한 채로 찍혀 「아무것도 없다」가 된다 */
    await page.waitForTimeout(420);
    await shot('04a-busy');
  } else {
    console.log('  · 로딩 가리개를 못 잡았다(왕복이 빨랐다) — 이번엔 안 본다');
  }
  await page.waitForSelector('[data-field="inProgress"]', { timeout: 15_000 });
  await shot('05-in-progress');
  /*
   * [제작 취소] 확인 팝업을 **열어만 보고 [취소]로 닫는다**(2026-09-11).
   * 브라우저 `confirm()`에서 화면 안 팝업으로 바뀐 자리인데, 이 갈래는
   * 여태 **스모크가 한 번도 안 지났다** — 진짜로 취소해 버리면 뒤따르는
   * 「완성까지 기다린다」가 통째로 못 돌므로 열고 닫기만 한다.
   */
  await page.click('[data-action="cancelOrder"]');
  await page.waitForSelector('[data-modal="forgeConfirm"]', { timeout: 5_000 });
  await page.waitForTimeout(300);
  await shot('05a-cancel-confirm');
  await page.click('[data-action="confirmCancel"]');
  await page.waitForSelector('[data-modal="forgeConfirm"]', { state: 'detached', timeout: 5_000 });
  ok('제작 취소 확인 팝업 — 떴다가 [취소]로 닫힌다');

  const remaining = await page.textContent('[data-field="inProgress"]');
  ok(`제작 중 — ${remaining?.replace(/\s+/g, ' ').trim()}`);

  const afterOrder = await getProfile(uid);
  ok(`서버 금화 500 → ${afterOrder!.gold}, 주문 = ${JSON.stringify(afterOrder!.forgeOrder)}`);

  // ── 1분 기다린다 ───────────────────────────────────────────
  step('완성까지 기다린다 (Lv1 = 1분)');
  const t0 = Date.now();
  await page.waitForSelector('[data-modal="forgeDone"]', { timeout: 150_000 });
  ok(`완성 팝업이 떴다 — ${Math.round((Date.now() - t0) / 1000)}초 뒤`);
  await shot('06-done-popup');
  await page.click('[data-action="ackDone"]');
  await page.waitForTimeout(500);

  // ── 지급 ───────────────────────────────────────────────────
  step('지급 관리');
  if (await page.$('[data-action="back"]')) await page.click('[data-action="back"]');
  await page.waitForSelector('[data-action="assign"]', { timeout: 10_000 });
  await shot('07-forge-home-after');
  await page.click('[data-action="assign"]');
  await page.waitForSelector('.frg-row', { timeout: 10_000 });
  await shot('08-assign-list');

  step('[지급] → 장수 목록');
  await page.click('[data-action="give"]');
  await page.waitForSelector('[data-action="equipPick"]', { timeout: 10_000 });
  await shot('09-officer-pick');
  const rows = await page.$$('[data-action="equipPick"]');
  ok(`장수 ${rows.length}명 목록`);
  /* 줄의 나무판은 **표시만** 하고, 실제 지급은 목록 맨 아래 [선택하기]다
     (2026-09-11 — 예전엔 줄 단추를 누르는 순간 나갔다). */
  await rows[0]!.click();
  await page.click('[data-action="equipConfirm"]');
  await page.waitForSelector('.frg-row[data-assigned="1"]', { timeout: 10_000 });
  await shot('10-assigned');
  const assignedRow = await page.textContent('.frg-row[data-assigned="1"]');
  ok(`지급됨 — ${assignedRow?.replace(/\s+/g, ' ').trim()}`);

  await serverForgeOwned('ma-cho', '지급');

  // ── 회수 ───────────────────────────────────────────────────
  step('회수');
  await page.click('[data-action="revoke"]');
  /* 확인은 **화면 안 팝업**이다(2026-09-11) — 예전엔 브라우저 `confirm()`이라
     스모크가 `page.on('dialog')`로 받아 넘겼고, 그래서 팝업이 죽어도 통과했다.
     이제는 실제로 떠 있는 판의 [확인]을 누른다. */
  await page.waitForSelector('[data-modal="forgeConfirm"]', { timeout: 5_000 });
  /* 판때기 그림(`ui/panel-settings.png`)은 이 팝업이 **이 화면에서 처음 쓰는**
     자산이라 뜬 직후에는 아직 안 그려져 있다 — 바로 찍으면 「그림이 안 나온다」로
     보인다(실제로 그렇게 한참 헤맸다, 2026-09-11). 실제로 내려받혔는지 본다. */
  await page.waitForFunction(() => {
    const el = document.querySelector('.frg-confirm') as HTMLElement | null;
    if (!el) return false;
    const url = getComputedStyle(el).borderImageSource.match(/url\("(.+?)"\)/)?.[1];
    if (!url) return false;
    const img = new Image();
    img.src = url;
    return img.complete && img.naturalWidth > 0;
  }, undefined, { timeout: 5_000 });
  await shot('11a-revoke-confirm');
  await page.click('[data-action="confirmOk"]');
  await page.waitForSelector('.frg-row[data-assigned="0"]', { timeout: 10_000 });
  await shot('11-revoked');
  await serverForgeOwned(null, '회수');

  console.log(`\n${errors.length ? '⚠ 콘솔 오류:\n' + errors.join('\n') : '✓ 콘솔 오류 없음'}`);
  console.log('\n✓ 제조 → 완료 → 지급 → 회수 한 바퀴 완주');
} catch (e) {
  console.error(`\n✗ 중단 —`, e);
  try { await page.screenshot({ path: `${SHOTS}/99-fail.png` }); console.error(`  📷 ${SHOTS}/99-fail.png`); } catch {}
} finally {
  await browser.close();
  await cleanup();
  process.exit(0);
}
