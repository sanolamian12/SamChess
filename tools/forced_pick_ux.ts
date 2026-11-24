/**
 * 홀수 레벨 증축의 궁궐 강제 — 눈 확인 (2026-11-24 기획자). 도시 Lv2 → 3 증축 팝업에서 궁궐이 처음부터 골라져 「필수」 표가 붙고,
 * 눌러도 빠지지 않으며, 나머지 둘만 골라 증축하면 서버의 궁궐이 Lv2가 되는지 본다. 한국어 · 몽골어(가장 긴 글)로 찍는다.
 *
 *   node --env-file=.env tools/forced_pick_ux.ts [--out 폴더]
 *
 * 필요한 것: 게임 화면 5173 · 게임 API 8787. 끝나면 계정을 지운다.
 */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { SORTIE_TUTORIALS, createProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { cleanupUsers, makeUser } from './adminLook.ts';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]! : join(tmpdir(), 'samchess-forced-pick');
mkdirSync(OUT, { recursive: true });
const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string): void => console.log(`  ✓ ${m}`);

/** Lv3 증축 조건이 찬 Lv2 계정 — 보유 20명 · 승리 5 · 자재 15 */
const seed = (): PlayerProfile => {
  const p = { ...createProfile(`궁궐강제-${randomUUID().slice(0, 4)}`, 5), tutorial: { done: [...SORTIE_TUTORIALS] } } as PlayerProfile;
  const extra = OFFICERS.filter((o) => !p.roster[o.id as keyof typeof p.roster]).slice(0, 25);
  return {
    ...p, cityLevel: 2, materials: 99, battleWins: 99, grainAt: Date.now(),
    roster: { ...p.roster, ...Object.fromEntries(extra.map((o) => [o.id, { ...Object.values(p.roster)[0]!, officer: o.id }])) },
  } as PlayerProfile;
};

try {
  const u = await makeUser('forcedpick', 'u');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 623, height: 1150 } });
  await saveProfileTrusted(u.uid, seed());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', u.email);
  await page.fill('[data-field="password"]', u.password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });

  for (const lang of ['ko', 'mn'] as const) {
    console.log(`\n▶ ${lang}`);
    await saveProfileTrusted(u.uid, seed());
    await page.evaluate((l) => localStorage.setItem('samchess.lang', l), lang);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.waitForTimeout(600);
    await page.click('.city-hot[data-place="palace"]', { force: true });
    await page.click('[data-action="city"]');
    await page.click('[data-action="upgrade"]');
    await page.waitForSelector('[data-modal="upgrade"]');
    const sel = '[data-modal="upgrade"] [data-action="pickBuilding"]';
    const state = () => page.evaluate((s) => ({
      palaceOn: document.querySelector<HTMLElement>(`${s}[data-building="palace"]`)?.dataset['on'],
      forced: [...document.querySelectorAll<HTMLElement>(`${s}[data-forced]`)].map((e) => e.dataset['building']),
      picked: document.querySelector<HTMLElement>('[data-field="pickHead"]')?.dataset['picked'],
    }), sel);
    const s0 = await state();
    if (s0.palaceOn !== '1' || s0.forced.join() !== 'palace' || s0.picked !== '1') fail(`처음 — ${JSON.stringify(s0)} (궁궐만 골라져 있어야 한다)`);
    await page.click(`${sel}[data-building="palace"]`);
    if ((await state()).palaceOn !== '1') fail('궁궐을 누르니 빠졌다');
    for (const id of ['farm', 'forge']) await page.click(`${sel}[data-building="${id}"]`);
    const s1 = await state();
    if (s1.picked !== '3') fail(`둘을 더 골랐는데 ${s1.picked}`);
    const tag = await page.evaluate(() => {
      const row = document.querySelector('[data-modal="upgrade"] .cty-up-row[data-forced]')!.getBoundingClientRect();
      const t = document.querySelector('[data-modal="upgrade"] [data-field="forced"]')!.getBoundingClientRect();
      return { inside: t.left >= row.left && t.right <= row.right, h: Math.round(row.height) };
    });
    if (!tag.inside) fail('「필수」 표가 줄 밖으로 나간다');
    await page.screenshot({ path: join(OUT, `${lang}-pick.png`) });
    ok(`궁궐이 처음부터 골라짐 · 「필수」 · 눌러도 안 빠짐 · 셋 ${s1.picked}/3 · 줄 높이 ${tag.h}px`);
    await page.click('[data-action="upgradeConfirm"]');
    await page.waitForSelector('[data-modal="upgradeDone"]', { timeout: 20_000 });
    const saved = (await getProfile(u.uid))!;
    if (saved.cityLevel !== 3 || saved.buildings.palace !== 2) fail(`서버 — 도시 Lv${saved.cityLevel} · 궁궐 Lv${saved.buildings.palace}`);
    ok('서버 — 도시 Lv3 · 궁궐 Lv2');
    await page.click('[data-modal="upgradeDone"] [data-action="celebrateClose"], [data-modal="upgradeDone"] .btn').catch(() => {});
  }
  await browser.close();
  console.log(`\n궁궐 강제 확인 통과 — 사진 ${OUT}`);
} finally {
  await cleanupUsers();
  await pool.end();
}
