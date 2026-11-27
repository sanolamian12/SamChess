/**
 * 레벨업 고르기 · 강화 완료(축하 화면)가 **열 언어에서 같은 크기 · 같은 자리인가**를 잰다 (2026-11-20 기획자 —
 * 「언어에 따라 배치나 크기가 달라지는 것을 가장 피해야 한다. 가장 긴 것 기준으로 일괄 맞추거나, 언어별로 표현을 조절하거나」).
 *
 *   node --experimental-strip-types --env-file=.env tools/levelup_lang_ux.ts
 *
 * 언어마다 새로 고쳐 같은 장수(Lv1)의 고르기 판을 열고 칸마다 높이 · 글을 줄인 배율(`--fit-scale`)을 잰 뒤, 실제로 올려 축하 화면도 잰다
 * (언어마다 다른 장수를 Lv1 → Lv2로 — 내용이 같아야 언어 차이만 남는다). 칸 하나라도 언어 사이에 1px 넘게 다르면 떨어진다.
 * 필요: Vite(5173) · 게임 API. 계정은 끝에 지운다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { MIN_SPEC_PORTRAIT } from './minSpec.ts';
import type { Page } from 'playwright';
import type { PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';
import { shotDir } from './shotDir.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('levelup_lang_ux');
const ALL_LANGS = ['ko', 'en', 'es_419', 'it', 'ja', 'mn', 'pt_BR', 'pt_PT', 'zh_Hans', 'zh_Hant'];
/** 판을 여는 언어 — `LANGS=ko,mn`으로 줄일 수 있다. 제목 재기는 언제나 열 언어 전부 */
const LANGS = process.env['LANGS']?.split(',') ?? ALL_LANGS;
const admin = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };

const email = `levelup-lang-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: MIN_SPEC_PORTRAIT });

/** 칸마다 높이(px) · 글을 줄인 배율 — 이름은 언어와 상관없는 열쇠 */
async function measure(p: Page, root: string, sels: Record<string, string>): Promise<Record<string, string>> {
  return p.evaluate(({ root, sels }) => {
    const out: Record<string, string> = {};
    const base = document.querySelector(root)!;
    for (const [k, sel] of Object.entries(sels)) {
      const els = [...base.querySelectorAll<HTMLElement>(sel)];
      els.forEach((el, i) => {
        const key = els.length > 1 ? `${k}#${i}` : k;
        out[`${key} 높이`] = String(Math.round(el.getBoundingClientRect().height));
        const fit = el.style.getPropertyValue('--fit-scale');
        if (fit) out[`${key} 글 배율`] = Number(fit).toFixed(2);
      });
    }
    return out;
  }, { root, sels });
}

/** 축하 화면의 제목 · 「화면을 터치해주세요」가 열 언어 모두 **줄이지 않고 한 줄**에 드는가 — 판을 하나만 열어 두고, 같은 틀(`.modal.cel` + 갈래 클래스)을
    판 옆에 세워 글만 바꿔 가며 잰다(`FitLine`과 같은 셈: 판 안쪽 폭 ÷ 한 줄 폭). 언어마다 `<html data-lang>`도 바꿔 글꼴을 맞춘다. */
const TITLE_KEYS: [string, string][] = [
  ['levelup.done.title', 'lvd'], ['city.done.title', 'cty-done'], ['city.bld.done.built', 'cty-done'], ['city.bld.done.up', 'cty-done'],
  ['forge.done.title', 'frg-done'], ['academy.notice.title', 'acd-cel'], ['market.gold.done.title', 'gold-cel'],
];
let titleFit: string[] = [];
async function measureTitles(p: Page): Promise<string[]> {
  const { readFileSync } = await import('node:fs');
  const strings = Object.fromEntries(ALL_LANGS.map((l) => [l, JSON.parse(readFileSync(`packages/client/src/i18n/strings/${l}.json`, 'utf8')) as Record<string, string>]));
  return p.evaluate(({ LANGS, strings, keys }) => {
    const back = document.querySelector('[data-modal="levelUpDone"]')!;
    const real = back.querySelector('.modal.cel') as HTMLElement;
    const old = document.documentElement.dataset['lang'];
    const out: string[] = [];
    const room = (host: HTMLElement): number => { const hs = getComputedStyle(host); return host.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight); };
    const need = (el: HTMLElement, text: string): number => {
      const cs = getComputedStyle(el);
      const probe = document.createElement('span');
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', font: cs.font, letterSpacing: cs.letterSpacing });
      probe.textContent = text; el.appendChild(probe);
      const w = probe.offsetWidth; probe.remove(); return w;
    };
    for (const lang of LANGS) {
      document.documentElement.dataset['lang'] = lang;
      for (const [key, cls] of keys) {
        const box = document.createElement('div');
        box.className = `modal cel ${cls}`;
        box.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;width:${real.offsetWidth}px;animation:none`;
        const ttl = document.createElement('p'); ttl.className = 'modal-ttl cel-ttl'; ttl.style.setProperty('--fit-scale', '1');
        box.append(ttl); back.append(box);
        const text = strings[lang]![key] ?? '';
        const r = room(box) / need(ttl, text);
        if (r < 1) out.push(`${lang} ${key} 「${text}」 ${(r * 100).toFixed(0)}%`);
        box.remove();
      }
      const tap = back.querySelector('.cel-tap') as HTMLElement;
      const tr = room(real) / need(tap, strings[lang]!['celebrate.tap'] ?? '');
      if (tr < 1) out.push(`${lang} celebrate.tap 「${strings[lang]!['celebrate.tap']}」 ${(tr * 100).toFixed(0)}%`);
    }
    if (old) document.documentElement.dataset['lang'] = old;
    return out;
  }, { LANGS: ALL_LANGS, strings, keys: TITLE_KEYS });
}

let failed = false;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `언어-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  }

  // 장수를 언어 수만큼 Lv1로 — 처음 받은 다섯에 더해 같은 등급의 장수를 넣는다(카드 넉넉히)
  const stored = (await getProfile(uid))!;
  const own = Object.keys(stored.roster) as OfficerId[];
  const first = stored.roster[own[0]!]!;
  const { OFFICERS } = await import('@samchess/data');
  const extra = OFFICERS.map((o) => o.id as OfficerId).filter((id) => !own.includes(id)).slice(0, Math.max(0, LANGS.length - own.length));
  const ids = [...own, ...extra].slice(0, LANGS.length);
  const roster = { ...stored.roster } as PlayerProfile['roster'];
  for (const id of extra) roster[id] = { ...first, officer: id } as typeof first;
  const p: PlayerProfile = {
    ...stored, roster, cityLevel: 11, buildings: { ...stored.buildings, palace: 11 },
    cards: Object.fromEntries(ids.map((id) => [id, 300])) as PlayerProfile['cards'],
  };
  await saveProfileTrusted(uid, withGarrisons(p) as Parameters<typeof saveProfileTrusted>[1]);

  const pick: Record<string, Record<string, string>> = {};
  const done: Record<string, Record<string, string>> = {};
  for (const [i, lang] of LANGS.entries()) {
    const id = ids[i]!;
    await page.evaluate((l) => localStorage.setItem('samchess.lang', l), lang);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.click('.scr-main [data-place="palace"]', { force: true });
    await page.click('[data-action="officers"]');
    await page.waitForSelector('[data-screen="officer-list"]');
    // 검색은 한국어 이름도 받는다(`searchOfficers`) — 쪽 넘김을 건너뛴다
    await page.fill('input[data-field="search"]', OFFICERS.find((o) => o.id === id)!.name);
    await page.waitForTimeout(300);
    await page.click(`.ofc-rows [data-officer="${id}"]`);
    await page.click('.ofcard-modal [data-action="levels"]');
    await page.waitForSelector('[data-screen="levelup-panel"]');
    await page.waitForTimeout(500);
    pick[lang] = await measure(page, '[data-screen="levelup-panel"]', {
      '판': '.lvp-modal', '제목': '.lvp-title', '절 제목': '.lvu-head', '능력 줄': '.lv-stat-row',
      '책략 토글': '.lvu-tab', '설명 판': '.lvu-desc', '단추': '.lv-acts > .btn',
    });
    await page.screenshot({ path: `${SHOTS}/pick-${lang}.png` });
    await page.click('[data-action="confirm"]');
    await page.waitForSelector('[data-modal="levelUpDone"]', { timeout: 8_000 });
    await page.waitForTimeout(2_200);
    done[lang] = await measure(page, '[data-modal="levelUpDone"]', {
      '무대 상자': '.modal.cel', '제목': '.cel-ttl', '이름': '.cel-big', '줄': '.lvd-row', '터치 안내': '.cel-tap',
    });
    await page.screenshot({ path: `${SHOTS}/done-${lang}.png` });
    if (i === 0) titleFit = await measureTitles(page);
    await page.click('[data-modal="levelUpDone"] [data-action="doneOk"]');
    await page.waitForSelector('[data-modal="levelUpDone"]', { state: 'detached', timeout: 5_000 });
    console.log(`  · ${lang} 잼`);
  }

  for (const [name, table] of [['레벨업 고르기', pick], ['강화 완료', done]] as const) {
    console.log(`\n▶ ${name}`);
    const keys = [...new Set(Object.values(table).flatMap((r) => Object.keys(r)))];
    for (const k of keys) {
      const vals = LANGS.map((l) => table[l]?.[k] ?? '—');
      const nums = vals.map(Number).filter((x) => !Number.isNaN(x));
      const spread = Math.max(...nums) - Math.min(...nums);
      const bad = k.endsWith('배율') ? spread > 0.005 : spread > 1;
      if (bad) failed = true;
      console.log(`  ${bad ? '✗' : '✓'} ${k}: ${bad ? LANGS.map((l, j) => `${l} ${vals[j]}`).join(' · ') : vals[0]}`);
    }
  }
  console.log(`\n▶ 축하 화면 제목 · 터치 안내 — 열 언어 × ${TITLE_KEYS.length + 1}줄이 줄이지 않고 한 줄에 드는가`);
  if (titleFit.length) { failed = true; for (const x of titleFit) console.log(`  ✗ ${x}`); } else console.log('  ✓ 전부 한 줄 · 제 크기');
  console.log(`\n${failed ? '언어마다 달라지는 칸이 있다' : '열 언어가 모두 같다'} — 사진: ${SHOTS}`);
} catch (e) {
  failed = true;
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  await page.screenshot({ path: `${SHOTS}/zz-fail.png` }).catch(() => undefined);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: admin });
}
process.exit(failed ? 1 : 0);
