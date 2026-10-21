/**
 * 우편함 UX 확인 — 메인 머리의 우편 · 사용안내 단추와 우편함 팝업 (2026-10-21)
 *
 *   VW=760 VH=1200 SHOTS=<dir> UI_LANG=mn node --experimental-strip-types --env-file=.env tools/mail_ux.ts
 *
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787). 서버 우편함은 아직 없어 `?mail=demo`(시험 우편 19통)로 본다.
 *
 * ★ 보는 것은 「있는가」가 아니라 **「제자리에 있는가」**다 — 머리 줄의 순서(우편 · 안내 · 기어), 목록 : 본문 = 1 : 3,
 * 목록이 한 쪽에서 넘치지 않는가, 본문만 스크롤되는가, 판이 프레임 밖으로 안 나가는가.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const LANG = process.env['UI_LANG'] ?? '';

const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string): void => console.log(`  ✓ ${m}`);

const email = `mail-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
  deviceScaleFactor: 2,
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname !== '/profile') errors.push(`404 ${new URL(r.url()).pathname}`); });
const shot = (name: string): Promise<Buffer> => page.screenshot({ path: `${SHOTS}/mail-${LANG || 'ko'}-${name}.png` });
const box = async (sel: string): Promise<{ x: number; y: number; width: number; height: number }> =>
  (await (await page.$(sel))?.boundingBox()) ?? fail(`${sel} 없음`);

try {
  console.log('▶ 계정 · 도시');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  if (LANG) await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `우편성${Math.floor(Math.random() * 9000 + 1000)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 });
  }

  console.log('▶ 우편이 없을 때');
  await page.waitForSelector('[data-action="mail"] img', { timeout: 10_000 });
  if (await page.$('[data-action="mail"] .head-dot')) fail('우편이 없는데 붉은 점이 있다');
  await page.click('[data-action="mail"]');
  await page.waitForSelector('[data-modal="mail"] .mail-body-none');
  const emptyText = await page.textContent('[data-modal="mail"] .mail-body-none');
  if (!emptyText?.trim()) fail('빈 우편함 문구가 없다');
  if (await page.$('[data-field="mailPager"]')) fail('우편이 없는데 쪽 넘김이 있다');
  await shot('empty');
  await page.click('[data-action="mailClose"]');
  ok(`빈 우편함 — 「${emptyText!.trim()}」 · 점 없음 · 쪽 넘김 없음`);

  console.log('▶ 시험 우편 19통 (?mail=demo)');
  await page.goto(`${BASE}/?mail=demo`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main [data-action="mail"] .head-dot', { timeout: 20_000 });
  // 머리 줄: 우편 · 안내 · 기어가 왼쪽부터 같은 줄에, 기어는 오른쪽 끝
  const frame = await box('#frame');
  const [m, i, g] = [await box('[data-action="mail"]'), await box('[data-action="info"]'), await box('.scr-main .gear')];
  if (!(m.x < i.x && i.x < g.x)) fail(`머리 줄 순서가 틀렸다 — 우편 ${m.x} · 안내 ${i.x} · 기어 ${g.x}`);
  if (Math.abs(m.y - g.y) > 2 || Math.abs(i.y - g.y) > 2) fail('세 단추가 같은 줄이 아니다');
  if (Math.abs(m.width - g.width) > 1) fail(`우편 단추(${m.width})와 기어(${g.width})의 크기가 다르다`);
  if (frame.x + frame.width - (g.x + g.width) > 0.06 * frame.width) fail('기어가 오른쪽 끝에 붙지 않았다');
  if (!await page.$eval('[data-action="info"]', (e) => (e as HTMLButtonElement).disabled)) fail('사용안내가 잠기지 않았다');
  const broken = await page.$$eval('.head-tool img, .gear img', (els) =>
    els.filter((e) => !(e as HTMLImageElement).naturalWidth).map((e) => e.getAttribute('src')));
  if (broken.length) fail(`그림이 안 떴다 — ${broken.join(', ')}`);
  await page.screenshot({ path: `${SHOTS}/mail-${LANG || 'ko'}-head.png`, clip: { x: frame.x, y: frame.y, width: frame.width, height: 90 } });
  ok('머리 줄 — 우편 · 안내 · 기어 순서, 같은 줄 · 같은 크기, 안내는 잠김, 안 읽음 점');

  await page.click('[data-action="mail"]');
  await page.waitForSelector('[data-modal="mail"] .mail-row');
  const modal = await box('[data-modal="mail"]');
  if (modal.x < frame.x - 1 || modal.x + modal.width > frame.x + frame.width + 1 || modal.y < frame.y - 1 || modal.y + modal.height > frame.y + frame.height + 1) {
    fail('우편함 판이 프레임 밖으로 나갔다');
  }
  const side = await box('[data-modal="mail"] .mail-side');
  const body = await box('[data-modal="mail"] .mail-body');
  const ratio = body.width / side.width;
  if (ratio < 2.7 || ratio > 3.3) fail(`목록 : 본문이 1 : 3이 아니다 — 1 : ${ratio.toFixed(2)}`);
  const rows = await page.$$eval('[data-modal="mail"] .mail-row', (els) => els.length);
  const listOver = await page.$eval('[data-modal="mail"] .mail-list', (e) => e.scrollHeight - e.clientHeight);
  if (listOver > 1) fail(`목록이 한 쪽에서 넘친다 — ${listOver}px`);
  const pager = await page.$eval('[data-field="mailPager"]', (e) => ({ page: e.getAttribute('data-page'), pages: e.getAttribute('data-pages') }));
  if (pager.pages !== '3') fail(`19통이면 세 쪽이다 — ${pager.pages}`);
  const pagerOver = await page.$eval('[data-modal="mail"] .mail-side', (e) => e.scrollWidth - e.clientWidth);
  if (pagerOver > 1) fail(`쪽 넘김 줄이 목록 폭을 넘친다 — ${pagerOver}px`);
  await shot('list');
  ok(`판 — 프레임 안, 1 : ${ratio.toFixed(2)}, 한 쪽 ${rows}통이 안 넘친다, 쪽 넘김 ${pager.page}/${pager.pages}`);

  // 첫 우편(긴 본문) — 본문만 스크롤
  await page.click('[data-modal="mail"] .mail-row[data-mail="demo-1"]');
  await page.waitForSelector('[data-modal="mail"] .mail-body-txt');
  const scroll = await page.$eval('[data-modal="mail"] .mail-body', (e) => e.scrollHeight - e.clientHeight);
  if (scroll <= 0) fail('긴 본문인데 스크롤할 것이 없다');
  const modalOver = await page.$eval('[data-modal="mail"]', (e) => e.scrollHeight - e.clientHeight);
  if (modalOver > 1) fail(`판 전체가 스크롤된다(본문만이어야 한다) — ${modalOver}px`);
  if (await page.$eval('[data-mail="demo-1"]', (e) => e.getAttribute('data-read')) !== '1') fail('고른 우편이 읽음이 안 됐다');
  await shot('open');
  await page.$eval('[data-modal="mail"] .mail-body', (e) => { e.scrollTop = e.scrollHeight; });
  await shot('open-scrolled');
  ok(`본문만 스크롤 (${scroll}px) · 고르면 읽음`);

  await page.click('[data-action="mailNextPage"]');
  if (await page.getAttribute('[data-field="mailPager"]', 'data-page') !== '2') fail('다음 쪽으로 안 넘어갔다');
  await shot('page2');
  ok('쪽 넘김');

  // 바깥(가리개)을 누르면 닫힌다 — 판 안쪽은 아니다
  await page.mouse.click(frame.x + 4, frame.y + frame.height - 4);
  await page.waitForSelector('[data-modal="mail"]', { state: 'detached', timeout: 3_000 });
  ok('가리개를 누르면 닫힌다');

  if (errors.length) fail(`콘솔 · 404 — ${errors.join(' | ')}`);
  console.log('\n✓ 우편함 UX 끝');
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
