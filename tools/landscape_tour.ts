/**
 * 화면 순회 — 가로 모드 가안을 찍는다 (2026-11-14, `Design/가로모드/`)
 *
 *   OUT=Design/가로모드/가안 ORIENT=both node --experimental-strip-types --env-file=.env tools/landscape_tour.ts
 *
 * 계정 하나를 만들어 화면을 넉넉히 채운 뒤(장수 20 · 부대 여섯 · 건물 · 금화), 화면 마흔 개 남짓을
 * **세로 · 가로 두 벌**로 찍는다. 화면은 클릭으로 찾아가지 않고 개발 서버의 `window.__screen.go()`로
 * 곧장 넣는다(`App.tsx`) — 순회가 화면 흐름의 변경마다 깨지지 않게. 전투는 계정이 필요 없는
 * `?demo=1` · `?tutorial=` 통로로 찍는다.
 *
 * 필요한 것: 5173(dev) · 8787(게임 API). 끝나면 시험 계정을 지운다.
 *
 *   ORIENT=portrait|landscape|both   (기본 both)
 *   ONLY=main,palace                 이름에 이 글자가 든 장면만
 *   PHONE=1                          가로를 휴대폰 크기(844×390)로도 한 벌 더
 */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { defaultSquadCells, newInstance } from '@samchess/meta';
import type { RosterPick, Squad } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const OUT = process.env['OUT'] ?? 'Design/가로모드/가안';
const ORIENT = process.env['ORIENT'] ?? 'both';
const ONLY = (process.env['ONLY'] ?? '').split(',').filter(Boolean);

interface Size { dir: string; orient: 'portrait' | 'landscape'; w: number; h: number }
const SIZES: Size[] = [
  ...(ORIENT !== 'landscape' ? [{ dir: 'portrait', orient: 'portrait' as const, w: 700, h: 1400 }] : []),
  ...(ORIENT !== 'portrait' ? [{ dir: 'landscape', orient: 'landscape' as const, w: 1920, h: 1080 }] : []),
  ...(process.env['PHONE'] ? [{ dir: 'landscape-phone', orient: 'landscape' as const, w: 844, h: 390 }] : []),
];

const want = (name: string): boolean => ONLY.length === 0 || ONLY.some((o) => name.includes(o));
const log = (m: string): void => console.log(m);

// ── 계정 ──────────────────────────────────────────────────────────
const email = `land-tour-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = ((await created.json()) as { id: string }).id;

async function login(page: Page, orient: string, first: boolean): Promise<void> {
  await page.goto(`${BASE}/?orient=${orient}`, { waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 30_000 });
  if (first && await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `가로-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  }
  await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

async function seed(): Promise<void> {
  const stored = (await getProfile(uid))!;
  const roster = { ...stored.roster } as Record<string, ReturnType<typeof newInstance>>;
  for (const o of OFFICERS.slice(0, 24)) if (!roster[o.id]) roster[o.id] = newInstance(o.id as OfficerId);
  // 등급이 고루 보이게 — S · A도 몇 명
  for (const g of ['S', 'A', 'E']) {
    const o = OFFICERS.find((x) => x.grade === g && !roster[x.id]);
    if (o) roster[o.id] = newInstance(o.id as OfficerId);
  }
  const own = Object.keys(roster).filter((id) => OFFICERS.find((o) => o.id === id)?.grade !== 'E') as OfficerId[];
  const now = Date.now();
  roster[own[2]!] = { ...roster[own[2]!]!, injuredAt: now };
  const P3 = ['King', 'Rock', 'Queen'] as const;
  const P5 = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const;
  const squads: Squad[] = [];
  for (let i = 0; i < 6; i++) {
    const five = i % 3 === 2;
    const pieces = five ? P5 : P3;
    const picks: RosterPick[] = pieces.map((piece, k) => ({ piece, officer: own[(i * 2 + k) % own.length]! }));
    const mode = five ? '5v5' : '3v3';
    squads.push({
      id: `sq${i + 1}`, name: `시험${i + 1}`, mode, picks,
      deploy: { P1: defaultSquadCells(mode, 'P1', picks), P2: null },
      record: i === 0 ? { 'field/3v3': { plays: 9, wins: 5, draws: 1, losses: 3, kills: 14, points: 230 } } : {},
      createdAt: now - (6 - i) * 60_000,
    } as Squad);
  }
  await saveProfileTrusted(uid, {
    ...stored, cityLevel: 6, gold: 480, materials: 60, grain: 40,
    buildings: { ...stored.buildings, palace: 5, barracks: 5, market: 5, academy: 3, hospital: 2, forge: 3 },
    roster, squads, squadSeq: 7,
  } as Parameters<typeof saveProfileTrusted>[1]);
}

// ── 장면 ──────────────────────────────────────────────────────────
type Go = Record<string, unknown>;
const go = (page: Page, s: Go): Promise<unknown> =>
  page.evaluate((x) => (window as unknown as { __screen: { go: (v: unknown) => void } }).__screen.go(x), s);
const settle = (page: Page, ms = 1_400): Promise<void> => page.waitForTimeout(ms);

const DUMP = !!process.env['DUMP'];
const outline: Record<string, string> = {};
async function shoot(page: Page, dir: string, name: string): Promise<void> {
  // 대자보 · 랭킹처럼 서버를 읽는 화면은 「불러오는 중」이 걷힐 때까지
  await page.waitForFunction(() => !document.querySelector('.rk-loading, .busy-veil'), undefined, { timeout: 8_000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}/${dir}/${name}.jpg`, type: 'jpeg', quality: 86 });
  if (DUMP) {
    outline[name] = await page.evaluate(() => {
      const walk = (el: Element, d: number): string => {
        const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 4).join('.') : '';
        const r = el.getBoundingClientRect();
        let line = `${'  '.repeat(d)}${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}]`;
        if (d < 3) for (const c of el.children) if (!['svg', 'img', 'span', 'option'].includes(c.tagName.toLowerCase())) line += '\n' + walk(c, d + 1);
        return line;
      };
      const root = document.querySelector('#frame > .scr, #frame .scr') ?? document.querySelector('#frame');
      return root ? walk(root, 0) : '';
    });
  }
  log(`  📷 ${dir}/${name}`);
}

async function metaTour(browser: Browser, size: Size, first: boolean): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  ! pageerror ${e.message}`));

  // 간판 · 로그인 팝업 — 계정 없이
  await page.goto(`${BASE}/?orient=${size.orient}`, { waitUntil: 'networkidle' });
  await settle(page, 1_800);
  if (want('00-title')) await shoot(page, size.dir, '00-title');
  if (want('01-login')) {
    await page.click('[data-action="loginOpen"]');
    await page.waitForSelector('[data-modal="login"]');
    await settle(page, 500);
    await shoot(page, size.dir, '01-login');
  }

  if (first) {
    // 첫 순회만 새 계정 — 도시 이름 짓기 · 가입 오프닝을 지난다
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('[data-action="loginOpen"]');
    await page.fill('[data-field="email"]', email);
    await page.fill('[data-field="password"]', password);
    await page.click('[data-action="enter"]');
    await page.waitForSelector('.scr-new', { timeout: 30_000 });
    await settle(page, 2_500);
    if (want('02-newgame')) await shoot(page, size.dir, '02-newgame');
    await page.fill('.scr-new .newgame-form input', `가로-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await settle(page, 4_000);
    if (want('03-opening')) await shoot(page, size.dir, '03-opening-a');
    await page.waitForSelector('[data-action="openingEnter"]', { timeout: 40_000 });
    await settle(page, 800);
    if (want('03-opening')) await shoot(page, size.dir, '03-opening-b');
    await page.click('[data-action="openingEnter"]');
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await settle(page, 1_000);
    await seed();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 30_000 });
  } else {
    await login(page, size.orient, false);
  }
  await settle(page, 1_500);

  const prof = await page.evaluate(() => (window as unknown as { __profile: { current: { squads: Squad[]; roster: Record<string, unknown> } } }).__profile.current);
  const sq3 = prof.squads.find((s) => s.mode === '3v3')!;
  const firstOfficer = Object.keys(prof.roster)[0]!;

  const scenes: [string, Go, ((p: Page) => Promise<void>)?][] = [
    ['10-main', { name: 'main' }],
    ['11-main-ext', { name: 'main', view: 'ext' }],
    ['12-main-settings', { name: 'main' }, async (p) => { await p.click('.scr-main [data-action="settings"]'); }],
    ['20-palace', { name: 'place', place: 'palace' }],
    ['21-officers', { name: 'officers' }],
    ['22-officer-detail', { name: 'officers', officer: firstOfficer }],
    ['23-city', { name: 'city' }],
    ['24-buildings', { name: 'buildings' }],
    ['30-barracks', { name: 'place', place: 'barracks' }],
    ['31-tutorials', { name: 'tutorials' }],
    ['32-squads', { name: 'squads' }],
    ['33-squad-view', { name: 'squadView', id: sq3.id }],
    ['34-squad-new', { name: 'squadNew' }],
    ['35-squad-edit', { name: 'squadEdit', draft: sq3, base: sq3 }],
    ['36-garrison-policy', { name: 'garrisonPolicy', id: sq3.id }],
    ['37-sortie', { name: 'sortie' }],
    ['38-siege', { name: 'siege', mode: '3v3', squad: sq3 }],
    ['40-market', { name: 'market' }],
    ['50-board', { name: 'board' }],
    ['51-ranking', { name: 'ranking', from: 'main' }],
    ['52-ranking-city', { name: 'rankingCity', from: 'main' }],
    ['53-ranking-squad', { name: 'rankingSquad', from: 'main' }],
    ['54-ranking-officer', { name: 'rankingOfficer', from: 'main' }],
    ['55-collection', { name: 'collection' }],
    ['56-defense', { name: 'defense' }],
    ['60-academy', { name: 'building', building: 'academy' }],
    ['61-farm', { name: 'building', building: 'farm' }],
    ['62-hospital', { name: 'building', building: 'hospital' }],
    ['63-forge', { name: 'building', building: 'forge' }],
    ['70-result-win', {
      name: 'result', mode: '3v3', result: 'win', outcome: '', rewards: { grain: 3, materials: 1, cards: [{ officer: firstOfficer, grade: 'C' }] },
      record: { result: 'win', mode: '3v3', opponent: 'ai', picks: sq3.picks, kills: {} }, power: { mine: 812, theirs: 840 }, seed: 1, voided: null,
    }],
    ['71-result-lose', {
      name: 'result', mode: '3v3', result: 'lose', outcome: '', rewards: { grain: 1, materials: 0, cards: [{ officer: firstOfficer, grade: 'C' }] },
      record: { result: 'lose', mode: '3v3', opponent: 'ai', picks: sq3.picks, kills: {} }, power: { mine: 812, theirs: 840 }, seed: 1, voided: null,
    }],
  ];

  for (const [name, s, after] of scenes) {
    if (!want(name)) continue;
    try {
      await go(page, { name: 'main' });
      await settle(page, 200);
      await go(page, s);
      await page.waitForLoadState('networkidle');
      await settle(page);
      if (after) { await after(page); await settle(page, 700); }
      await shoot(page, size.dir, name);
    } catch (e) {
      log(`  ✗ ${name} — ${(e as Error).message.split('\n')[0]}`);
    }
  }

  // 장터 안쪽 — 홈의 단추를 따라간다
  if (want('41-market')) {
    try {
      await go(page, { name: 'main' }); await settle(page, 300); await go(page, { name: 'market' });
      await settle(page);
      const acts = await page.$$eval('.scr [data-action]', (els) => els.map((e) => (e as HTMLElement).dataset['action']));
      log(`  · 장터 단추 ${acts.join(' ')}`);
      for (const [i, a] of ['openShop', 'openGold'].entries()) {
        if (!acts.includes(a)) continue;
        await page.click(`.scr [data-action="${a}"]`);
        await settle(page);
        await shoot(page, size.dir, `41-market-${i}-${a}`);
        const sub = await page.$$eval('.scr [data-action]', (els) => els.map((e) => (e as HTMLElement).dataset['action']));
        log(`  · ${a} 안 단추 ${sub.join(' ')}`);
        for (const b of ['openMerc', 'openItems', 'openGoods']) {
          if (!sub.includes(b)) continue;
          await page.click(`.scr [data-action="${b}"]`);
          await settle(page);
          await shoot(page, size.dir, `42-market-${b}`);
          await go(page, { name: 'main' }); await settle(page, 300); await go(page, { name: 'market' });
          await settle(page, 400);
          await page.click(`.scr [data-action="${a}"]`);
          await settle(page, 600);
        }
        await go(page, { name: 'main' }); await settle(page, 300); await go(page, { name: 'market' });
        await settle(page, 600);
      }
    } catch (e) {
      log(`  ✗ 41-market — ${(e as Error).message.split('\n')[0]}`);
    }
  }
  await ctx.close();
}

async function battleTour(browser: Browser, size: Size): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  ! pageerror ${e.message}`));
  const shots: [string, string, number][] = [
    ['80-battle-deploy', 'demo=1&deploy=1', 3_500],
    ['81-battle-3v3', 'demo=1&sp=25', 6_000],
    ['82-battle-5v5', 'demo=1&mode=5v5&sp=25', 6_000],
    ['83-battle-siege', 'demo=1&siege=1&mode=3v3', 4_000],
    ['84-battle-duel', 'demo=1&duel=1', 6_000],
    ['85-tutorial', 'tutorial=basic-1', 6_000],
  ];
  for (const [name, q, wait] of shots) {
    if (!want(name)) continue;
    try {
      await page.goto(`${BASE}/?orient=${size.orient}&${q}`, { waitUntil: 'networkidle' });
      await settle(page, wait);
      await shoot(page, size.dir, name);
    } catch (e) {
      log(`  ✗ ${name} — ${(e as Error).message.split('\n')[0]}`);
    }
  }
  await ctx.close();
}

const browser = await chromium.launch();
try {
  let first = true;
  for (const size of SIZES) {
    mkdirSync(`${OUT}/${size.dir}`, { recursive: true });
    log(`\n▶ ${size.dir} ${size.w}×${size.h}`);
    await metaTour(browser, size, first);
    first = false;
    await battleTour(browser, size);
  }
  if (DUMP) (await import('node:fs')).writeFileSync(`${OUT}/outline.txt`, Object.entries(outline).map(([k, v]) => `## ${k}\n${v}`).join('\n\n'));
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  log('\n시험 계정을 지웠다');
  process.exit(0);
}
