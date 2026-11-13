/**
 * 완료 팝업 한 줄 글 — 열 언어 눈 확인 (2026-11-13). 도시 증축 완료와 **건물 일곱의 짓기 · 증축 완료**를 언어마다 실제로 띄워, 제목(「증 축 완 료」)과
 * 큰 글씨(「도시 Lv2」 · 「대장간 Lv1」)가 한 줄에 들어 판 안에 있는지 본다(`FitLine.tsx`가 글마다 배율을 잰다). 언어마다 도시 · 대장간을 찍고,
 * 글마다 배율을 표로 남긴다.
 *
 *   npm run look:doneLang      (= node --env-file=.env tools/done_lang_ux.ts [--out 폴더])
 *
 * 필요한 것: 게임 화면 5173 · 게임 API 8787. 끝나면 계정을 지운다.
 */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { BUILDINGS, OFFICERS } from '@samchess/data';
import { getProfile } from '../packages/server-api/src/profileStore.ts';
import { BASIC_TUTORIALS, createProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { cleanupUsers, makeUser } from './adminLook.ts';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]! : join(tmpdir(), 'samchess-done-lang');
mkdirSync(OUT, { recursive: true });
const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const LANGS = ['ko', 'en', 'es_419', 'it', 'ja', 'mn', 'pt_BR', 'pt_PT', 'zh_Hans', 'zh_Hant'] as const;
const fail = (m: string): never => { throw new Error(m); };

/** 증축 조건이 찬 Lv1 계정 — 언어마다 다시 심는다(한 번 증축하면 Lv2가 되므로) */
const seed = (): PlayerProfile => {
  const p = { ...createProfile(`완료글-${randomUUID().slice(0, 4)}`, 5), tutorial: { done: [...BASIC_TUTORIALS] } } as PlayerProfile;
  const extra = OFFICERS.filter((o) => !p.roster[o.id as keyof typeof p.roster]).slice(0, 20);
  return {
    ...p, materials: 99, grainAt: Date.now(),
    roster: { ...p.roster, ...Object.fromEntries(extra.map((o) => [o.id, { ...Object.values(p.roster)[0]!, officer: o.id }])) },
  } as PlayerProfile;
};

try {
  const u = await makeUser('donelang', 'u');
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

  /** 떠 있는 완료 팝업 — 제목 · 큰 글씨가 한 줄이고 판 안에 있는가. 배율을 돌려준다 */
  const check = async (modal: string, where: string): Promise<{ ttl: string; lv: string; ttlScale: string; lvScale: string }> => {
    await page.waitForSelector(modal, { timeout: 10_000 });
    await page.waitForTimeout(550);   // 큰 글씨가 떠오르는 애니메이션(.45초)이 끝난 뒤
    const r = await page.evaluate((sel) => {
      const box = document.querySelector(`${sel} .modal`)!.getBoundingClientRect();
      const one = (f: string) => {
        const el = document.querySelector<HTMLElement>(`${sel} [data-field="${f}"]`)!;
        const range = document.createRange(); range.selectNodeContents(el);
        const rects = [...range.getClientRects()];
        const tr = range.getBoundingClientRect();
        const lines = new Set(rects.map((q) => Math.round(q.top))).size;
        return { text: el.textContent ?? '', scale: el.dataset.fitScale ?? '?', ok: lines === 1 && tr.left >= box.left && tr.right <= box.right };
      };
      return { ttl: one('doneTitle'), lv: one('doneLevel') };
    }, modal);
    for (const [k, v] of Object.entries(r)) if (!v.ok) fail(`${where} — ${k} 「${v.text}」가 한 줄이 아니거나 판 밖이다 (배율 ${v.scale})`);
    return { ttl: r.ttl.text, lv: r.lv.text, ttlScale: r.ttl.scale, lvScale: r.lv.scale };
  };

  const rows: string[] = [];
  for (const lang of LANGS) {
    // 1. 도시 증축 완료
    await saveProfileTrusted(u.uid, seed());
    await page.evaluate((l) => localStorage.setItem('samchess.lang', l), lang);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.waitForTimeout(600);
    await page.click('.city-hot[data-place="palace"]', { force: true });
    await page.click('[data-action="city"]');
    // [도시 증축]은 건물 관리 바닥에 있다(2026-11-13)
    await page.click('[data-action="buildings"]');
    await page.click('[data-action="upgrade"]');
    await page.click('[data-action="upgradeConfirm"]');
    const city = await check('[data-modal="upgradeDone"]', `${lang} 도시`);
    await page.screenshot({ path: join(OUT, `${lang}-city.png`) });
    await page.click('[data-action="doneOk"]');
    // 2. 건물 일곱 — 기회를 넉넉히 넣고 하나씩(짓기 넷 · 증축 셋)
    await saveProfileTrusted(u.uid, { ...(await getProfile(u.uid))!, buildCredits: BUILDINGS.length });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.waitForTimeout(600);
    await page.click('.city-hot[data-place="palace"]', { force: true });
    await page.click('[data-action="city"]');
    await page.click('[data-action="buildings"]');
    const blds: string[] = [];
    for (const b of BUILDINGS) {
      await page.click(`.cty-bld[data-building="${b.id}"] [data-action="build"]`);
      await page.click('[data-action="buildConfirm"]');
      const r = await check('[data-modal="buildDone"]', `${lang} ${b.id}`);
      // 건설 완료(대장간, 새로 지음) · 증축 완료(장터, Lv1 → Lv2) 한 장씩
      if (b.id === 'forge') await page.screenshot({ path: join(OUT, `${lang}-forge.png`) });
      if (b.id === 'market') await page.screenshot({ path: join(OUT, `${lang}-market.png`) });
      blds.push(`${r.lv}(${r.lvScale})`);
      await page.click('[data-modal="buildDone"] [data-action="doneOk"]');
    }
    rows.push(`${lang.padEnd(8)} 제목 ${city.ttl}(${city.ttlScale}) · ${city.lv}(${city.lvScale}) | ${blds.join(' · ')}`);
    await page.click('[data-action="backBottom"]');
    await page.click('[data-action="back"]');
    await page.click('[data-action="back"]');
    await page.waitForSelector('.scr-main');
  }
  await browser.close();
  console.log(rows.join('\n'));
  console.log(`✓ 열 언어 — 도시 증축 완료 · 건물 일곱 완료 팝업의 제목 · 큰 글씨가 전부 한 줄 · 판 안 (${OUT})`);
} finally {
  await cleanupUsers();
  await pool.end().catch(() => {});
}
