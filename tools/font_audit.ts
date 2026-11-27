/**
 * 글자 크기 감사 — 하한 0.8rem(`screens/fontFloor.ts`)보다 작은 글자를 화면마다 찾는다 (2026-11-18)
 *
 *   OUT=<dir> [ORIENT=portrait|landscape|both] [ONLY=main,palace] [UI_LANG=mn] \
 *     node --experimental-strip-types --env-file=.env tools/font_audit.ts
 *
 * 크기는 전부 rem이고 html 글자 크기가 프레임에 따라 바뀌므로, **보이는 글자 요소의 실제 크기 ÷ html 글자 크기**로 잰다.
 * 조상의 `transform: scale`도 곱한다(눈에 보이는 크기). 그림 안의 글자 · Phaser 캔버스의 글자는 못 잰다.
 * 장면 · 계정 준비는 `landscape_tour.ts`와 같다. 필요한 것: 5173(dev) · 8787(게임 API). 끝나면 시험 계정을 지운다.
 * 결과: `${OUT}/font-audit.json`(장면별 전부) · 표준 출력에 선택자별 요약.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { MIN_SPEC_PORTRAIT } from './minSpec.ts';
import { FONT_FLOOR_REM } from '../packages/client/src/screens/fontFloor.ts';
import type { Browser, Page } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { defaultSquadCells, newInstance } from '@samchess/meta';
import type { RosterPick, Squad } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { shotDir } from './shotDir.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const OUT = process.env['OUT'] ?? shotDir('font_audit');   // 안 주면 OS 임시 폴더(저장소 맨 위에 쌓이지 않게)
const ORIENT = process.env['ORIENT'] ?? 'portrait';
// VIEW=635x1160 — 세로 화면 크기를 바꿔 찍는다(짧은 창에서 판이 넘치는지 볼 때). VIEW=phone은 최소사양(`minSpec.ts`, iPhone 15)
const VIEW_RAW = process.env['VIEW'] === 'phone' ? `${MIN_SPEC_PORTRAIT.width}x${MIN_SPEC_PORTRAIT.height}` : process.env['VIEW'];
const [VIEW_W, VIEW_H] = (VIEW_RAW ?? '').split('x').map(Number).filter((n) => n > 0) as [number?, number?];
const ONLY = (process.env['ONLY'] ?? '').split(',').filter(Boolean);
const LANG = process.env['UI_LANG'] ?? '';
/** 기준 — 글자 하한(rem). 2026-11-27부터 0.9(장수 상세의 능력치 숫자). 단추 글자는 같은 크기 이상 + 굵기 700 이상 */
const REF = FONT_FLOOR_REM;
const SHOTS = !!process.env['SHOTS'];
// DPR=3 — 사진을 기기 화질로(최소사양 iPhone 15는 3배). 재는 값(rem)은 안 바뀐다

interface Size { dir: string; orient: 'portrait' | 'landscape'; w: number; h: number }
const SIZES: Size[] = [
  ...(ORIENT !== 'landscape' ? [{ dir: 'portrait', orient: 'portrait' as const, w: VIEW_W ?? 700, h: VIEW_H ?? 1400 }] : []),
  ...(ORIENT !== 'portrait' ? [{ dir: 'landscape', orient: 'landscape' as const, w: 1920, h: 1080 }] : []),
];
const want = (name: string): boolean => ONLY.length === 0 || ONLY.some((o) => name.includes(o));
const log = (m: string): void => console.log(m);

export interface Hit { sel: string; rem: number; px: number; scale: number; text: string }
const results: Record<string, Hit[]> = {};
/** 잘림 — `px`는 넘친 폭 */
const clipResults: Record<string, Hit[]> = {};
/** 단추 글자 — 하한보다 작거나 굵지 않다(`px`는 굵기) */
const btnResults: Record<string, Hit[]> = {};
/** 머리 명패 아래 첫 판까지의 간격(rem) */
const gaps: Record<string, { rem: number; panel: string }> = {};
let refSeen: number | null = null;

// ── 재기 (페이지 안) ───────────────────────────────────────────────
async function audit(page: Page, key: string): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('.rk-loading, .busy-veil'), undefined, { timeout: 8_000 }).catch(() => {});
  const got = await page.evaluate((ref) => {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const hits: { sel: string; rem: number; px: number; scale: number; text: string }[] = [];
    const clips: typeof hits = [];
    const btns: typeof hits = [];
    let story: number | null = null;
    const hiddenChain = (el: Element): boolean => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return true;
      }
      return false;
    };
    const name = (el: Element): string => {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
      return el.tagName.toLowerCase() + cls.map((c) => '.' + c).join('');
    };
    const selOf = (el: Element): string => {
      const parts = [name(el)];
      let e = el.parentElement; let n = 0;
      while (e && n < 3 && e.id !== 'frame' && e !== document.body) {
        if (typeof e.className === 'string' && e.className.trim()) { parts.unshift(name(e)); n++; }
        e = e.parentElement;
      }
      return parts.join(' > ');
    };
    for (const el of document.querySelectorAll('body *')) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'canvas', 'img', 'video', 'option'].includes(tag)) continue;
      let text = '';
      if (tag === 'input' || tag === 'textarea') text = (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder || '';
      else for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent ?? '';
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      if (hiddenChain(el)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      let scale = 1;
      if (el instanceof SVGGraphicsElement) scale = el.getScreenCTM()?.a ?? 1;
      else if (el instanceof HTMLElement && el.offsetWidth > 0 && getComputedStyle(el).display !== 'inline') scale = r.width / el.offsetWidth;
      else if (el instanceof HTMLElement && el.offsetHeight > 0) scale = r.height / el.offsetHeight;
      const rem = (px * scale) / rootPx;
      if (el.classList.contains('ofcard-story')) story = rem;
      // 조상의 살짝 줄인 변형(0.95배 이상 — 판 등장 연출의 끝자락 등)은 CSS 크기로 판정한다
      const cssRem = px / rootPx;
      const shown = scale >= 0.95 ? cssRem : rem;
      if (el.closest('button, .btn, [role="button"]')) {
        const w = parseInt(getComputedStyle(el).fontWeight, 10) || 400;
        if (shown < ref - 0.005 || w < 700) btns.push({ sel: selOf(el), rem: Math.round(rem * 1000) / 1000, px: w, scale: Math.round(scale * 100) / 100, text: text.slice(0, 40) });
      }
      if (shown < ref - 0.005) hits.push({ sel: selOf(el), rem: Math.round(rem * 1000) / 1000, px: Math.round(px * 10) / 10, scale: Math.round(scale * 100) / 100, text: text.slice(0, 40) });
      // 잘림 — 넘침을 숨기는 상자(자신 또는 두 겹 위까지)에서 글자가 칸보다 넓다(말줄임 포함)
      if (el instanceof HTMLElement) {
        // 자기 자신과 바로 위 한 겹만 본다 — 더 올라가면 화면 틀(`.scr`)까지 닿아, 배경 그림이 넓은 만큼을 모든 글자의 잘림으로 셌다(+77px 오탐)
        for (let e: HTMLElement | null = el, k = 0; e && k < 2; e = e.parentElement, k++) {
          if (e.id === 'frame' || e.classList.contains('scr') || e === document.body) break;
          const cs = getComputedStyle(e);
          if (cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis') {
            if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) {
              clips.push({ sel: selOf(el), rem: Math.round(rem * 1000) / 1000, px: e.scrollWidth - e.clientWidth, scale: 1, text: text.slice(0, 40) });
            }
            // 세로 — 스크롤이 없는 화면(2026-11-25)이라 넘친 줄은 잘려 안 보인다. 줄 높이 자투리(2px)는 뺀다. `px`가 음수면 세로
            if (e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 0) {
              clips.push({ sel: selOf(el), rem: Math.round(rem * 1000) / 1000, px: -(e.scrollHeight - e.clientHeight), scale: 1, text: text.slice(0, 40) });
            }
            break;
          }
        }
      }
    }
    return { hits, clips, btns, story, rootPx };
  }, REF);
  // PROBE=sel1|sel2 — 그 선택자의 보이는 글자 크기(rem) · 굵기를 찍는다(기준값을 잴 때)
  if (process.env['PROBE']) {
    const probes = await page.evaluate((sels) => {
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return sels.map((s) => {
        const e = [...document.querySelectorAll<HTMLElement>(s)].find((x) => x.getBoundingClientRect().height > 0);
        if (!e) return `${s}: 없음`;
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return `${s}: ${(parseFloat(cs.fontSize) / rootPx).toFixed(3)}rem · ${cs.fontWeight} · x ${Math.round(r.left)}~${Math.round(r.right)} · h ${(r.height / rootPx).toFixed(2)}rem · 「${(e.textContent ?? '').trim().slice(0, 12)}」`;
      });
    }, process.env['PROBE'].split('|'));
    log(`  [${key}] ${probes.join('\n    ')}`);
  }
  if (got.story !== null) refSeen = got.story;
  results[key] = got.hits;
  clipResults[key] = got.clips;
  btnResults[key] = got.btns;
  // 머리 명패 ↔ 바로 아래 판의 간격 (2026-11-25 기획자 — 모든 화면이 용병 시장과 같은 간격). 명패는 `.place-nm`,
  // 판은 명패 밑에서 가장 위에 있는 폭 넓은 판(`.place-panel` 또는 이름에 panel이 든 것)
  const gap = await page.evaluate(() => {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const nm = [...document.querySelectorAll<HTMLElement>('.place-nm')].find((e) => e.getBoundingClientRect().height > 0);
    if (!nm) return null;
    const hb = nm.getBoundingClientRect().bottom;
    const frameW = document.querySelector('#frame')!.getBoundingClientRect().width;
    const cands = [...document.querySelectorAll<HTMLElement>('.place-panel, [class*="panel"]')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.width > frameW * 0.5 && r.top >= hb - 2 && !e.closest('.modal-back, .modal');
    }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const p = cands[0];
    if (!p) return null;
    return { rem: Math.round(((p.getBoundingClientRect().top - hb) / rootPx) * 100) / 100, panel: `${p.tagName.toLowerCase()}.${[...p.classList].join('.')}` };
  });
  if (gap) gaps[key] = gap;
  if (SHOTS) await page.screenshot({ path: `${OUT}/${key.replace(/\//g, '_')}.jpg`, type: 'jpeg', quality: 70 });
}

// ── 계정 ──────────────────────────────────────────────────────────
const email = `font-audit-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = ((await created.json()) as { id: string }).id;

async function seed(): Promise<void> {
  const stored = (await getProfile(uid))!;
  const roster = { ...stored.roster } as Record<string, ReturnType<typeof newInstance>>;
  for (const o of OFFICERS.slice(0, 24)) if (!roster[o.id]) roster[o.id] = newInstance(o.id as OfficerId);
  // OFFICER=<id> — 장수 상세를 그 장수로 연다(계정에 들인다)
  if (process.env['OFFICER'] && !roster[process.env['OFFICER']]) roster[process.env['OFFICER']] = newInstance(process.env['OFFICER'] as OfficerId);
  // 고유기술이 없는 장수 하나(장면 22e)
  if (!roster['gyeong-mu']) roster['gyeong-mu'] = newInstance('gyeong-mu' as OfficerId);
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
  for (let i = 0; i < 4; i++) {
    const five = i >= 2;
    const role = i % 2 === 0 ? 'attack' : 'defense';
    const pieces = five ? P5 : P3;
    const picks: RosterPick[] = pieces.map((piece, k) => ({ piece, officer: own[(i * 2 + k) % own.length]! }));
    const mode = five ? '5v5' : '3v3';
    squads.push({
      id: `${role === 'attack' ? 'atk' : 'def'}-${mode}`, role, mode, picks,
      deploy: { P1: defaultSquadCells(mode, 'P1', picks), P2: null },
      record: i === 0 ? { 'field/3v3': { plays: 9, wins: 5, draws: 1, losses: 3, kills: 14, points: 230 } } : {},
      createdAt: now - (4 - i) * 60_000,
    } as Squad);
  }
  await saveProfileTrusted(uid, {
    ...stored, cityLevel: 6, gold: 480, materials: 60, grain: 40,
    buildings: { ...stored.buildings, palace: 5, barracks: 5, market: 5, academy: 3, hospital: 2, forge: 3 },
    roster, squads,
    // CARDS=1 — 장수 전부에게 카드를 쥐여 레벨업 대상으로(장수 일람의 초록 네온 이름 · 카드 수 · 겹 갈매기를 볼 때)
    ...(process.env['CARDS'] ? { cards: { ...stored.cards, ...Object.fromEntries(own.map((id) => [id, 10])) } } : {}),
    // ACADEMY_DONE=1 — 태학 Lv3 주제를 끝낸 계정(도시 관리 건물 한 장의 「연구: [엠블럼]」 · 흑백 둘을 보려고)
    ...(process.env['ACADEMY_DONE'] ? { academy: { done: [{ level: 3, tactic: 'ham-jeong-plus', doneAt: now - 3_600_000 }] } } : {}),
  } as Parameters<typeof saveProfileTrusted>[1]);
}

type Go = Record<string, unknown>;
const go = (page: Page, s: Go): Promise<unknown> =>
  page.evaluate((x) => (window as unknown as { __screen: { go: (v: unknown) => void } }).__screen.go(x), s);
const settle = (page: Page, ms = 1_400): Promise<void> => page.waitForTimeout(ms);
const click = async (p: Page, sel: string): Promise<void> => { await p.click(sel, { timeout: 5_000 }); };
/** 덮개(머리 도구 층 · 배경)에 가려 Playwright가 「누를 수 없다」고 보는 단추 — DOM에서 바로 누른다. 없으면 던진다 */
const jsClick = async (p: Page, sel: string): Promise<void> => {
  const ok = await p.evaluate((q) => { const e = document.querySelector<HTMLElement>(q); e?.click(); return !!e; }, sel);
  if (!ok) throw new Error(`${sel} 없음`);
};

async function setLang(page: Page): Promise<void> {
  if (LANG) await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
}

async function metaTour(browser: Browser, size: Size, first: boolean): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: Number(process.env['DPR'] ?? 1) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  ! pageerror ${e.message}`));
  const d = size.dir;

  await page.goto(`${BASE}/?orient=${size.orient}`, { waitUntil: 'networkidle' });
  await setLang(page);
  await page.reload({ waitUntil: 'networkidle' });
  await settle(page, 1_800);
  if (want('00-title')) await audit(page, `${d}/00-title`);
  await click(page, '[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]');
  await settle(page, 500);
  if (want('01-login')) await audit(page, `${d}/01-login`);
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await click(page, '[data-action="enter"]');
  if (first) {
    await page.waitForSelector('.scr-new', { timeout: 30_000 });
    await settle(page, 2_500);
    if (want('02-newgame')) await audit(page, `${d}/02-newgame`);
    await page.fill('.scr-new .newgame-form input', `글자-${randomUUID().slice(0, 4)}`);
    await click(page, '.scr-new .newgame-form .btn.primary');
    await settle(page, 4_000);
    if (want('03-opening')) await audit(page, `${d}/03-opening-a`);
    await page.waitForSelector('[data-action="openingEnter"]', { timeout: 40_000 });
    await settle(page, 800);
    if (want('03-opening')) await audit(page, `${d}/03-opening-b`);
    await click(page, '[data-action="openingEnter"]');
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await settle(page, 1_000);
    await seed();
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });
  await settle(page, 1_500);

  const prof = await page.evaluate(() => (window as unknown as { __profile: { current: { squads: Squad[]; roster: Record<string, unknown> } } }).__profile.current);
  const sq3 = prof.squads.find((s) => s.id === 'def-3v3')!;
  const atk3 = prof.squads.find((s) => s.id === 'atk-3v3')!;
  const firstOfficer = process.env['OFFICER'] ?? Object.keys(prof.roster)[0]!;

  const scenes: [string, Go, ((p: Page) => Promise<void>)?][] = [
    ['10-main', { name: 'main' }],
    ['11-main-ext', { name: 'main', view: 'ext' }],
    ['12-main-settings', { name: 'main' }, async (p) => { await click(p, '.scr-main [data-action="settings"]'); }],
    ['13-main-mail', { name: 'main' }, async (p) => { await jsClick(p, '[data-action="mail"]'); }],
    ['14-main-info', { name: 'main' }, async (p) => { await jsClick(p, '[data-action="info"]'); }],
    ['15-main-logout', { name: 'main' }, async (p) => { await click(p, '.scr-main [data-action="settings"]'); await settle(p, 600); await jsClick(p, '[data-modal="settings"] [data-action="logout"]'); }],
    ['20-palace', { name: 'place', place: 'palace' }],
    ['20b-palace-rename', { name: 'main' }, async (p) => { await click(p, '.scr-main [data-action="rename"]'); }],   // 2026-11-19 메인 머리로 옮겼다
    ['21-officers', { name: 'officers' }],
    ['22-officer-detail', { name: 'officers', officer: firstOfficer }],
    ['22b-officer-levels', { name: 'officers', officer: firstOfficer }, async (p) => { await click(p, '[data-action="levels"]'); }],
    ['22c-officer-skill', { name: 'officers', officer: firstOfficer }, async (p) => { await click(p, '[data-action="skill"]'); }],
    ['22e-officer-noskill', { name: 'officers', officer: 'gyeong-mu' }],
    ['22f-officer-lore', { name: 'officers', officer: firstOfficer }, async (p) => { await click(p, '[data-action="openLore"]'); }],
    ['22d-officer-items', { name: 'officers', officer: firstOfficer }, async (p) => { await click(p, '[data-action="heldOpen"]'); }],
    ['23-city', { name: 'city' }],
    // 건물 한 장 — 줄 오른쪽 [보기] (2026-11-23 기획자)
    // 아이콘 말풍선 — 요건 칸 그림을 누르면 이름이 2초(2026-11-23 기획자). 누른 뒤 곧장 찍는다
    ['23i-city-tip', { name: 'city' }, async (p) => { await p.click('.cty-cond[data-cond="topOfficers"] .gic', { force: true }); }],
    ['23b-city-peek', { name: 'city' }, async (p) => { await jsClick(p, '.cty-bld[data-building="palace"] [data-action="viewBuilding"]'); }],
    ['23c-city-peek-farm', { name: 'city' }, async (p) => { await jsClick(p, '.cty-bld[data-building="farm"] [data-action="viewBuilding"]'); }],
    ['23d-city-peek-barracks', { name: 'city' }, async (p) => { await jsClick(p, '.cty-bld[data-building="barracks"] [data-action="viewBuilding"]'); }],
    ['23e-city-peek-market', { name: 'city' }, async (p) => { await jsClick(p, '.cty-bld[data-building="market"] [data-action="viewBuilding"]'); }],
    ['23f-city-peek-academy', { name: 'city' }, async (p) => { await jsClick(p, '.cty-bld[data-building="academy"] [data-action="viewBuilding"]'); }],
    ['23g-city-peek-hospital', { name: 'city' }, async (p) => { await jsClick(p, '.cty-bld[data-building="hospital"] [data-action="viewBuilding"]'); }],
    ['23h-city-peek-forge', { name: 'city' }, async (p) => { await jsClick(p, '.cty-bld[data-building="forge"] [data-action="viewBuilding"]'); }],
    ['30-barracks', { name: 'place', place: 'barracks' }],
    ['31-tutorials', { name: 'tutorials' }],
    ['32-squads', { name: 'squads' }],
    ['35-squad-edit', { name: 'squadEdit', draft: sq3, base: sq3 }],
    ['35b-squad-edit-atk', { name: 'squadEdit', draft: atk3, base: atk3 }],
    ['35c-squad-deploy', { name: 'squadEdit', draft: atk3, base: atk3 }, async (p) => { await click(p, '[data-action="toDeploy"]'); }],
    ['35d-squad-swap', { name: 'squadEdit', draft: atk3, base: atk3 }, async (p) => { await click(p, '[data-action="swapPiece"]'); }],
    ['35e-squad-pick', { name: 'squadEdit', draft: { ...atk3, picks: atk3.picks.slice(0, 2) }, base: atk3 }, async (p) => { await jsClick(p, '[data-action="pickOfficer"]'); }],
    ['36-garrison-policy', { name: 'garrisonPolicy', id: sq3.id }],
    ['37-sortie', { name: 'sortie' }],
    ['37b-sortie-peek', { name: 'sortie' }, async (p) => { await click(p, '[data-action="peekSquad"]'); }],
    ['38-siege', { name: 'siege', mode: '3v3', squad: atk3 }],
    ['39-match', { name: 'match', mode: '3v3', squad: atk3, seed: 7 }],
    ['40-market', { name: 'market' }],
    ['50-board', { name: 'board' }],
    ['51-ranking', { name: 'ranking', from: 'main' }],
    ['52-ranking-battle', { name: 'rankingBoard', board: 'battle', from: 'main' }],
    ['53-ranking-city', { name: 'rankingBoard', board: 'city', from: 'main' }],
    ['54-ranking-collection', { name: 'rankingBoard', board: 'collection', from: 'main' }],
    ['55-collection', { name: 'collection' }],
    ['55b-collection-ranking', { name: 'collection' }, async (p) => { await click(p, '[data-action="collectionRanking"]'); }],
    ['56-defense', { name: 'defense' }],
    ['60-academy', { name: 'building', building: 'academy' }],
    ['61-farm', { name: 'building', building: 'farm' }],
    ['62-hospital', { name: 'building', building: 'hospital' }],
    ['63-forge', { name: 'building', building: 'forge' }],
    ['60b-academy-pick', { name: 'building', building: 'academy' }, async (p) => { await click(p, '[data-action="openResearch"]'); }],
    ['62b-hospital-admit', { name: 'building', building: 'hospital' }, async (p) => { await click(p, '[data-action="admit"]'); }],
    ['63b-forge-craft', { name: 'building', building: 'forge' }, async (p) => { await click(p, '[data-action="craft"]'); }],
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
      if (after) { await after(page); await settle(page, 900); }
      await audit(page, `${d}/${name}`);
    } catch (e) {
      log(`  ✗ ${name} — ${(e as Error).message.split(String.fromCharCode(10))[0]}`);
    }
    // 팝업을 연 장면 뒤에는 새로 읽는다 — 우편 · 안내 · 로그아웃 확인은 화면 밖 층(머리 도구)에 떠서 화면을 옮겨도 안 닫히고,
    // 그 위에 덮인 채로 뒤 장면의 클릭을 전부 막았다(열 언어 순회에서 장면 여덟이 함께 떨어졌다)
    if (after) {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 }).catch(() => {});
      await settle(page, 600);
    }
  }

  // 장터 안쪽 — 홈의 단추를 따라간다
  if (want('41-market')) {
    try {
      const home = async (): Promise<void> => { await go(page, { name: 'main' }); await settle(page, 300); await go(page, { name: 'market' }); await settle(page, 700); };
      await home();
      // 'home' = 장터 홈 그대로(배너 셋이 홈에 있다 — 2026-11-24)
      for (const a of ['home', 'openGold']) {
        const acts = await page.$$eval('.scr [data-action]', (els) => els.map((e) => (e as HTMLElement).dataset['action']));
        if (a !== 'home') {
          if (!acts.includes(a)) continue;
          await click(page, `.scr [data-action="${a}"]`);
          await settle(page);
        }
        await audit(page, `${d}/41-market-${a}`);
        const sub = await page.$$eval('.scr [data-action]', (els) => els.map((e) => (e as HTMLElement).dataset['action']));
        for (const b of ['openMerc', 'openItems', 'openGoods']) {
          if (!sub.includes(b)) continue;
          await click(page, `.scr [data-action="${b}"]`);
          await settle(page);
          await audit(page, `${d}/42-market-${b}`);
          await home();
          if (a !== 'home') { await click(page, `.scr [data-action="${a}"]`); await settle(page, 600); }
        }
        await home();
      }
    } catch (e) {
      log(`  ✗ 41-market — ${(e as Error).message.split('\n')[0]}`);
    }
  }
  await ctx.close();
}

async function battleTour(browser: Browser, size: Size): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: Number(process.env['DPR'] ?? 1) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  ! pageerror ${e.message}`));
  await page.goto(`${BASE}/?orient=${size.orient}`, { waitUntil: 'networkidle' });
  await setLang(page);
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
      await audit(page, `${size.dir}/${name}`);
    } catch (e) {
      log(`  ✗ ${name} — ${(e as Error).message.split('\n')[0]}`);
    }
  }
  await ctx.close();
}

const browser = await chromium.launch();
try {
  mkdirSync(OUT, { recursive: true });
  let first = true;
  for (const size of SIZES) {
    log(`\n▶ ${size.dir} ${size.w}×${size.h}`);
    await metaTour(browser, size, first);
    first = false;
    await battleTour(browser, size);
  }
  writeFileSync(`${OUT}/font-audit.json`, JSON.stringify({ ref: REF, refSeen, results, clips: clipResults, buttons: btnResults }, null, 1));
  const clipBy = new Map<string, { px: number; scenes: Set<string>; text: string }>();
  for (const [scene, hits] of Object.entries(clipResults)) {
    for (const h of hits) {
      const leaf = h.sel.split(' > ').slice(-2).join(' > ');
      const cur = clipBy.get(leaf) ?? { px: 0, scenes: new Set<string>(), text: h.text };
      cur.px = Math.abs(h.px) > Math.abs(cur.px) ? h.px : cur.px; cur.scenes.add(scene.split('/').pop()!);
      clipBy.set(leaf, cur);
    }
  }
  log(`\n머리 명패 ↔ 첫 판 간격 ${Object.keys(gaps).length}곳`);
  for (const [k, v] of Object.entries(gaps)) log(`${v.rem.toFixed(2)}rem  ${k}  ${v.panel}`);
  log(`\n잘림 묶음 ${clipBy.size}개`);
  for (const [leaf, v] of [...clipBy.entries()].sort((a, b) => b[1].px - a[1].px)) {
    log(`${v.px < 0 ? `세로 ${-v.px}` : `+${v.px}`}px  ${leaf}  「${v.text}」  [${[...v.scenes].join(', ')}]`);
  }
  // 선택자별 요약 — 마지막 요소(글자를 든 요소)의 이름으로 묶는다
  const by = new Map<string, { min: number; scenes: Set<string>; text: string; sel: string }>();
  for (const [scene, hits] of Object.entries(results)) {
    for (const h of hits) {
      const leaf = h.sel.split(' > ').slice(-2).join(' > ');
      const cur = by.get(leaf) ?? { min: 9, scenes: new Set<string>(), text: h.text, sel: h.sel };
      cur.min = Math.min(cur.min, h.rem); cur.scenes.add(scene.split('/').pop()!);
      by.set(leaf, cur);
    }
  }
  const bb = new Map<string, { min: number; w: number; scenes: Set<string>; text: string }>();
  for (const [scene, hits] of Object.entries(btnResults)) {
    for (const h of hits) {
      const leaf = h.sel.split(' > ').slice(-2).join(' > ');
      const cur = bb.get(leaf) ?? { min: 9, w: 999, scenes: new Set<string>(), text: h.text };
      cur.min = Math.min(cur.min, h.rem); cur.w = Math.min(cur.w, h.px); cur.scenes.add(scene.split('/').pop()!);
      bb.set(leaf, cur);
    }
  }
  log(`\n단추 글자 묶음 ${bb.size}개 (하한 ${REF}rem · 굵기 700)`);
  for (const [leaf, v] of [...bb.entries()].sort((a, b) => a[1].min - b[1].min)) {
    log(`${v.min.toFixed(3)}rem · ${v.w}  ${leaf}  「${v.text}」  [${[...v.scenes].join(', ')}]`);
  }
  log(`\n기준 .ofcard-story 실측 =${refSeen ?? '(못 봄)'} rem · 작은 글자 묶음 ${by.size}개`);
  for (const [leaf, v] of [...by.entries()].sort((a, b) => a[1].min - b[1].min)) {
    log(`${v.min.toFixed(3)}rem  ${leaf}  「${v.text}」  [${[...v.scenes].join(', ')}]`);
  }
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  log('\n시험 계정을 지웠다');
  process.exit(0);
}
