/**
 * 튜토리얼 목록 눈 확인 — 판에 세로 스크롤이 생기는가를 열 언어로 잰다 (2026-11-23 기획자 — 휴대폰에서 스크롤이 생겼다)
 *
 *   node --experimental-strip-types --env-file=.env tools/tutorial_list_ux.ts            # 700×1359 (기획자 화면 897×1741과 같은 비율)
 *   VIEW=700x1400 node --experimental-strip-types --env-file=.env tools/tutorial_list_ux.ts
 *
 * 줄 높이는 열 언어 × 두 갈래 가운데 가장 높은 줄(`--tut-row-h`)이라 언어마다 판 높이가 같아야 한다 — 그래도 언어마다 잰다.
 * 잰 것: 판(`.tut-list`)의 `scrollHeight − clientHeight`(0이면 스크롤 없음) · 줄 높이. 그림은 OS 임시 폴더.
 * 필요한 것: 5173(dev) · 8787(게임 API). 시험 계정을 만들고 끝나면 지운다.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { shotDir } from './shotDir.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const KEY = process.env['SUPABASE_SECRET_KEY']!;
const [W, H] = (process.env['VIEW'] ?? '700x1359').split('x').map(Number) as [number, number];
const OUT = shotDir('tutorial_list');
const LANGS = ['ko', 'en', 'ja', 'zh_Hans', 'zh_Hant', 'es_419', 'pt_BR', 'pt_PT', 'it', 'mn'];

const email = `tut-list-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = ((await created.json()) as { id: string }).id;

const settle = (p: Page, ms = 1_200): Promise<void> => p.waitForTimeout(ms);
const go = (p: Page, s: Record<string, unknown>): Promise<unknown> =>
  p.evaluate((x) => (window as unknown as { __screen: { go: (v: unknown) => void } }).__screen.go(x), s);

let worst = 0;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new', { timeout: 30_000 });
  await settle(page, 2_500);
  await page.fill('.scr-new .newgame-form input', `목록-${randomUUID().slice(0, 4)}`);
  await page.click('.scr-new .newgame-form .btn.primary');
  await page.waitForSelector('[data-action="openingEnter"]', { timeout: 40_000 });
  await settle(page, 800);
  await page.click('[data-action="openingEnter"]');
  await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });

  for (const lang of LANGS) {
    await page.evaluate((l) => localStorage.setItem('samchess.lang', l), lang);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });
    await settle(page, 800);
    await go(page, { name: 'tutorials' });
    await page.waitForSelector('.scr-tutorials .tut-list > .tut-row');
    await settle(page, 1_200);
    const m = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>('.scr-tutorials .tut-list')!;
      return {
        over: list.scrollHeight - list.clientHeight,
        rowH: getComputedStyle(list).getPropertyValue('--tut-row-h').trim(),
        rows: list.querySelectorAll(':scope > .tut-row').length,
        remPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
      };
    });
    worst = Math.max(worst, m.over);
    console.log(`${m.over > 0 ? '✗' : '✓'} ${lang.padEnd(8)} 넘침 ${m.over}px · 줄 높이 ${m.rowH} · 줄 ${m.rows} · 1rem ${m.remPx}px`);
    await page.screenshot({ path: join(OUT, `tutorials-${lang}.png`) });
  }
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
}
console.log(`그림: ${OUT}`);
process.exit(worst > 0 ? 1 : 0);
