/**
 * 완료 팝업 한 줄 글 — 열 언어 눈 확인 (2026-11-13). 도시 증축 완료를 언어마다 실제로 띄워, 제목(「증 축 완 료」)과
 * 큰 글씨(「도시 Lv2」)가 한 줄에 들어 판 안에 있는지 본다(`FitLine.tsx`가 글마다 배율을 잰다). **2026-11-23부터 증축이 건물 셋을 함께 올린다** —
 * 건물 완료 팝업이 없어졌고, 증축 팝업의 고르기 일곱 줄 · 완료 팝업의 함께 오른 셋이 판 안에 드는지도 본다. 언어마다 고르기 · 완료를 찍는다.
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
import { OFFICERS } from '@samchess/data';
import { SORTIE_TUTORIALS, createProfile } from '@samchess/meta';
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
  const p = { ...createProfile(`완료글-${randomUUID().slice(0, 4)}`, 5), tutorial: { done: [...SORTIE_TUTORIALS] } } as PlayerProfile;
  const extra = OFFICERS.filter((o) => !p.roster[o.id as keyof typeof p.roster]).slice(0, 20);
  return {
    ...p, materials: 99, battleWins: 99, grainAt: Date.now(),   // 누적 승리도 증축 조건이다(2026-11-14)
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
    // 도시 증축 축하는 도입부가 길다(큰 급 약 7초 + 서버 왕복) — 판(.modal)이 그려질 때까지 넉넉히. data-modal만 보면 판이 아직 없을 수 있다(2026-11-23)
    await page.waitForSelector(`${modal} .modal`, { timeout: 20_000 });
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
      // 건물 완료는 이름 + 레벨 배지(2026-11-19) — 한 줄 검사는 이름 글자에, 배지는 판 안에 있는가만
      const bld = document.querySelector(`${sel} [data-field="doneBldName"]`);
      return { ttl: one('doneTitle'), lv: one(bld ? 'doneBldName' : 'doneLevel'), ...(bld ? { badge: (() => { const b = document.querySelector(`${sel} .cty-done-badge`)!.getBoundingClientRect(); return { text: 'badge', scale: '-', ok: b.left >= box.left && b.right <= box.right && b.height > 0 }; })() } : {}) };
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
    // [도시 증축]은 도시 관리 바닥에 있다(2026-11-23). 새로 짓는 셋을 골라 「건설」 표지까지 판 안에 드는지 본다
    await page.click('[data-action="upgrade"]');
    await page.waitForSelector('[data-modal="upgrade"]');
    for (const id of ['farm', 'hospital', 'forge']) await page.click(`[data-modal="upgrade"] [data-action="pickBuilding"][data-building="${id}"]`);
    await page.waitForTimeout(250);
    const pick = await page.evaluate(() => {
      const box = document.querySelector('[data-modal="upgrade"] .lvp-modal')!.getBoundingClientRect();
      const rows = [...document.querySelectorAll<HTMLElement>('[data-modal="upgrade"] .cty-up-row')];
      const out = rows.filter((e) => { const q = e.getBoundingClientRect(); return q.left < box.left || q.right > box.right; }).map((e) => e.dataset['building']);
      return { out, h: Math.round(box.height), hs: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))] };
    });
    if (pick.out.length) fail(`${lang} 증축 팝업 — 고르기 줄이 판 밖으로 나간다: ${pick.out.join(' ')}`);
    await page.screenshot({ path: join(OUT, `${lang}-pick.png`) });
    // [보기] — 오른 뒤의 건물 한 장(지금 형편 줄은 없다) · 가리개를 눌러도 고르기 판은 그대로 (2026-11-23 기획자)
    await page.click('[data-modal="upgrade"] [data-action="viewNext"][data-building="hospital"]');
    await page.waitForSelector('[data-modal="building"][class*="cty-peek-back"] .cty-peek[data-building="hospital"][data-level="1"]');
    if (await page.$('[data-modal="building"] [data-field="status"]')) fail(`${lang} 증축 고르기의 건물 한 장에 지금 형편 줄이 있다`);
    await page.screenshot({ path: join(OUT, `${lang}-pick-peek.png`) });
    await page.click('[data-modal="building"] [data-action="closeBuilding"]');
    // 장터 · 대장간의 [보기]는 그 레벨에서 새로 열리는 것만(「신규 아이템」 · 「신규 제작」)
    for (const b of ['market', 'forge']) {
      await page.click(`[data-modal="upgrade"] [data-action="viewNext"][data-building="${b}"]`);
      await page.waitForSelector(`[data-modal="building"] .cty-peek[data-building="${b}"]`);
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-modal="building"] img')].every((i) => i.complete), null, { timeout: 5_000 });
      await page.screenshot({ path: join(OUT, `${lang}-pick-peek-${b}.png`) });
      await page.click('[data-modal="building"] [data-action="closeBuilding"]');
    }
    // 판은 화면 높이의 80% 이상 · 판 안 스크롤 없음
    const fit = await page.evaluate(() => { const m = document.querySelector<HTMLElement>('[data-modal="upgrade"] .lvp-modal')!; const b = m.parentElement!.getBoundingClientRect(); return { ratio: m.getBoundingClientRect().height / b.height, scroll: m.scrollHeight - m.clientHeight }; });
    if (fit.ratio < 0.8 || fit.scroll > 1) fail(`${lang} 증축 판 — 높이 ${Math.round(fit.ratio * 100)}% · 스크롤 ${fit.scroll}px`);
    if (!await page.$('[data-modal="upgrade"]')) fail(`${lang} 건물 한 장을 닫았더니 고르기 판까지 닫혔다`);
    await page.click('[data-action="upgradeConfirm"]');
    const city = await check('[data-modal="upgradeDone"]', `${lang} 도시`);
    const built = await page.evaluate(() => {
      const box = document.querySelector('[data-modal="upgradeDone"] .modal')!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>('[data-modal="upgradeDone"] .cty-done-bldrow')].map((e) => {
        const q = e.getBoundingClientRect();
        return { id: e.dataset['building'], ok: q.left >= box.left && q.right <= box.right };
      });
    });
    if (built.length !== 3 || built.some((x) => !x.ok)) fail(`${lang} 완료 팝업 — 함께 오른 건물 줄이 판 밖이다: ${JSON.stringify(built)}`);
    await page.screenshot({ path: join(OUT, `${lang}-city.png`) });
    await page.click('[data-action="doneOk"]');
    await page.waitForSelector('.cel-back[data-leaving]', { state: 'detached', timeout: 5_000 });   // 축하 화면의 닫힘 연출(.36초)이 끝날 때까지
    rows.push(`${lang.padEnd(8)} 제목 ${city.ttl}(${city.ttlScale}) · ${city.lv}(${city.lvScale}) | 고르기 판 ${pick.h}px · 줄 높이 ${pick.hs.join('/')}px`);
    await page.click('[data-action="back"]');
    await page.click('[data-action="back"]');
    await page.waitForSelector('.scr-main');
  }
  await browser.close();
  console.log(rows.join('\n'));
  console.log(`✓ 열 언어 — 도시 증축 완료 · 증축 고르기 줄 · 완료 팝업의 제목 · 큰 글씨 · 함께 오른 건물이 판 안 (${OUT})`);
} finally {
  await cleanupUsers();
  await pool.end().catch(() => {});
}
