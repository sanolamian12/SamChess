/**
 * 초심의 서 연출 확인 (2026-11-26 기획자, `Design/축하연출_초심의서_기획안.html`).
 *
 *   node --experimental-strip-types --env-file=.env tools/respec_ux.ts
 *
 * Lv5 장수 하나를 심은 계정으로 장터 → 도시 물자 → 초심의 서 → 그 장수 → [확정]을 누르고,
 * 명상하는 선비 도입부(5초)를 프레임으로 찍은 뒤 무대(레벨 배지가 1까지 내려가고 카드 ×N, 누르면 닫힘)를 보고, 확정 판의 꼬마를 장수 상세와 견준다.
 * 화면 사진은 OS 임시 폴더(`shotDir`). 5173 · 게임 API 필요.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { applyLevelUp, cardsSpentOn, cardsToLevelUp, newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { shotDir } from './shotDir.ts';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = shotDir('respec_ux');
const LEVEL = 5;
/** 열 언어의 「능력치를 초기화합니다.」 · 「실행하시겠습니까?」 */
const LANG_TEXTS = readdirSync('packages/client/src/i18n/strings').filter((f) => f.endsWith('.json')).map((f) => {
  const j = JSON.parse(readFileSync(`packages/client/src/i18n/strings/${f}`, 'utf8')) as Record<string, string>;
  return [f.replace('.json', ''), j['market.respec.lead']!, j['market.respec.ask']!, j['market.respec.done']!] as const;
});
const FRAMES_MS = [150, 500, 1000, 1500, 2200, 2800, 3400, 4000, 4500, 4850];

const ok = (m: string): void => console.log(`  ✓ ${m}`);
const step = (m: string): void => console.log(`\n▶ ${m}`);
const admin = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };

const email = `respec-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const uid = (await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
})).json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 1200 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text().slice(0, 300)); });
page.on('response', (r) => { if (r.status() === 404 && /intro-respec|level\/lv-/.test(r.url())) errors.push(`404 ${r.url()}`); });
let failed = false;

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `초심-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 });
  }

  step(`Lv${LEVEL} 장수를 심는다`);
  const base = (await getProfile(uid))!;
  const X = OFFICERS.find((o) => o.grade === 'A' && !base.roster[o.id as OfficerId])!.id as OfficerId;
  let cards = 0;
  for (let lv = 1; lv < LEVEL; lv += 1) cards += cardsToLevelUp(lv) ?? 0;
  let seeded = { ...base, gold: 5000, cityLevel: 5, buildings: { ...base.buildings, market: 5 },
    roster: { ...base.roster, [X]: newInstance(X) }, cards: { ...base.cards, [X]: cards } };
  for (let lv = 1; lv < LEVEL; lv += 1) seeded = applyLevelUp(seeded, X, lv % 2 ? 'hp' : 'at', 'support');
  await saveProfileTrusted(uid, seeded);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  ok(`${X} Lv${LEVEL} — 돌려받을 카드 ${cardsSpentOn(LEVEL)}장`);

  step('장터 → 도시 물자 → 초심의 서');
  for (let i = 0; i < 6 && !(await page.$('[data-action="openGoods"]')); i += 1) {
    await page.click('[data-place="market"]', { force: true }).catch(() => {});
    await page.waitForTimeout(1_000);
  }
  await page.click('[data-action="openGoods"]');
  await page.click('[data-good="respec"]');
  await page.waitForSelector('[data-modal="officerPick"]', { timeout: 5_000 });
  if (!await page.$(`[data-modal="officerPick"] .ofc-row[data-officer="${X}"]`)) {
    await page.fill('[data-modal="officerPick"] [data-field="search"]', OFFICERS.find((o) => o.id === X)!.name);
  }
  await page.click(`[data-modal="officerPick"] .ofc-row[data-officer="${X}"]`);
  await page.waitForSelector('[data-modal="respecAsk"]', { timeout: 5_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/ask.png` });
  // 판은 화면(.scr)의 폭 80% × 높이 70% · 가운데, 꼬마는 장수 상세와 같은 크기(끝에 궁궐의 장수 상세를 열어 잰다)
  const ask = await page.evaluate(() => {
    const r = (sel: string): DOMRect => document.querySelector(sel)!.getBoundingClientRect();
    const scr = r('.scr'), m = r('[data-modal="respecAsk"] .modal');
    return { w: m.width / scr.width, h: m.height / scr.height, dx: (m.left + m.right) / 2 - (scr.left + scr.right) / 2,
      dy: (m.top + m.bottom) / 2 - (scr.top + scr.bottom) / 2, art: r('.rsp-ask-art').width };
  });
  if (Math.abs(ask.w - .8) > .02 || Math.abs(ask.h - .7) > .02 || Math.abs(ask.dx) > 2 || Math.abs(ask.dy) > 2) {
    throw new Error(`확정 판이 화면의 80% × 70% 가운데가 아니다 — ${JSON.stringify(ask)}`);
  }
  ok(`확정 판 ${(ask.w * 100).toFixed(0)}% × ${(ask.h * 100).toFixed(0)}% 가운데 · 꼬마 ${ask.art.toFixed(0)}px`);
  // 「능력치를 초기화합니다.」 · 「실행하시겠습니까?」는 열 언어 모두 한 줄 — 그 언어의 글꼴(`:root[data-lang]`)로 판 안에서 잰다
  const over = await page.evaluate((texts) => {
    const root = document.documentElement;
    const was = root.dataset['lang'];
    const out: string[] = [];
    for (const [lang, lead, q] of texts) {
      root.dataset['lang'] = lang;
      for (const [sel, text] of [['.rsp-ask-lead', lead], ['.rsp-ask-q', q]] as const) {
        const el = document.querySelector<HTMLElement>(`[data-modal="respecAsk"] ${sel}`)!;
        const keep = el.textContent;
        el.textContent = text;
        const body = el.parentElement!.getBoundingClientRect().width;
        if (el.scrollWidth > body + 1) out.push(`${lang} ${sel} ${el.scrollWidth}/${Math.round(body)}`);
        el.textContent = keep;
      }
    }
    if (was) root.dataset['lang'] = was;
    return out;
  }, LANG_TEXTS);
  if (over.length) throw new Error(`한 줄에 안 든다 — ${over.join(' · ')}`);
  ok(`안내 · 물음 — 열 언어 모두 한 줄`);
  await page.click('[data-modal="respecAsk"] [data-action="confirmOk"]');

  step('도입부 — 명상 · 클로즈업 · 송송 · 구슬로 · 원이 커져 흰빛');
  await page.waitForSelector('.cel-back[data-phase="charge"][data-intro="respec"]', { timeout: 10_000 });
  const t0 = Date.now();
  for (const ms of FRAMES_MS) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${SHOTS}/intro-${String(ms).padStart(4, '0')}.png` });
  }
  ok(`도입부 사진 ${FRAMES_MS.length}장`);

  step('무대 — 장수 모집 바탕 · 장수와 카드 묶음 · 붓 획 두 줄');
  // 도입부는 한 번만 돈다 — 무대가 열리는 순간 팝업 층이 다시 만들어지면 도입부가 처음부터 다시 돌았다(장터의 팝업 닻, 2026-11-26)
  await page.waitForSelector('[data-modal="respecDone"]', { timeout: 2_000 })
    .catch(() => { throw new Error('5초 도입부 뒤 2초 안에 무대가 안 열렸다 — 도입부가 다시 돌았나'); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/stage-0600.png` });
  await page.waitForTimeout(2_800);
  await page.screenshot({ path: `${SHOTS}/stage-3400.png` });
  // 「스탯 초기화 완료」 — 열 언어의 한 줄 폭(그 언어의 글꼴, 무대 제목 칸). 넘치는 언어는 `FitLine`이 그 글만 줄인다(두 줄은 없다) — 줄인 크기가 글자 하한(.8rem) 밑이면 실패
  const titles = await page.evaluate((texts) => {
    const root = document.documentElement;
    const was = root.dataset['lang'];
    const el = document.querySelector<HTMLElement>('[data-modal="respecDone"] .cel-ttl')!;
    const host = el.parentElement!;
    const out: string[] = [];
    for (const [lang, , , title] of texts) {
      root.dataset['lang'] = lang;
      el.style.setProperty('--fit-scale', '1');
      const cs = getComputedStyle(el);
      const probe = document.createElement('span');
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', font: cs.font, letterSpacing: cs.letterSpacing });
      probe.textContent = title;
      el.appendChild(probe);
      const need = probe.offsetWidth;
      probe.remove();
      const hs = getComputedStyle(host);
      const room = host.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight);
      const rem = parseFloat(getComputedStyle(root).fontSize);
      const size = parseFloat(cs.fontSize) * Math.min(1, room / need) / rem;
      out.push(`${lang} ${Math.round(need)}/${Math.round(room)} → ${size.toFixed(2)}rem${size < .8 ? ' ✗' : ''}`);
    }
    if (was) root.dataset['lang'] = was;
    el.style.removeProperty('--fit-scale');
    return out;
  }, LANG_TEXTS);
  console.log(`    제목 폭(필요/칸): ${titles.join(' · ')}`);
  if (titles.some((x) => x.endsWith('✗'))) throw new Error('「스탯 초기화 완료」가 글자 하한 밑으로 줄어드는 언어가 있다');
  ok('「스탯 초기화 완료」 — 열 언어 모두 한 줄(넘치는 언어는 줄여서, 하한 위)');
  // 제목 글꼴은 다른 축하 화면(강화 · 증축 · 대장간 · 태학)과 같다 — 캐릭터 보상의 명조(`brs-cel`)를 안 쓴다(2026-11-26 기획자)
  const ttlFont = await page.evaluate(() => {
    const f = (el: Element | null): string => (el ? getComputedStyle(el).fontFamily : '');
    const probe = document.createElement('div');
    probe.className = 'cel-back';
    probe.innerHTML = '<div class="modal cel"><p class="cel-ttl">x</p></div>';
    probe.style.display = 'none';
    document.querySelector('[data-modal="respecDone"]')!.parentElement!.append(probe);   // 같은 화면(.scr) 안에서 — 글꼴은 화면에서 물려받는다
    const common = f(probe.querySelector('.cel-ttl'));
    probe.remove();
    return { mine: f(document.querySelector('[data-modal="respecDone"] .cel-ttl')), common };
  });
  if (ttlFont.mine !== ttlFont.common) throw new Error(`제목 글꼴이 다른 축하와 다르다 — ${JSON.stringify(ttlFont)}`);
  ok(`제목 글꼴 — 다른 축하 화면과 같다 (${ttlFont.mine})`);
  const lv = await page.getAttribute('[data-field="respecLevel"]', 'data-level');
  const refund = await page.textContent('[data-field="refund"]');
  if (lv !== '1') throw new Error(`레벨 배지가 1까지 안 내려갔다 — ${lv}`);
  if (!refund?.includes(`×${cardsSpentOn(LEVEL)}`)) throw new Error(`카드 수가 「${refund}」 — ×${cardsSpentOn(LEVEL)}이어야`);
  if ((await getProfile(uid))!.roster[X]!.level !== 1) throw new Error('서버에서 Lv1이 안 됐다');
  ok(`배지 Lv1 · 카드 ${refund?.trim()} · 서버 Lv1`);

  // 단추 없이 「화면을 터치해주세요」 — 다른 축하 화면과 같다(2026-11-26 기획자)
  if (await page.$('[data-modal="respecDone"] [data-action="toPalace"]')) throw new Error('무대에 옛 단추가 남아 있다');
  if (!await page.$('[data-modal="respecDone"] .cel-tap')) throw new Error('무대에 「화면을 터치해주세요」가 없다');
  await page.click('[data-modal="respecDone"] .cel-hit');
  await page.waitForSelector('[data-modal="respecDone"]', { state: 'detached', timeout: 5_000 });
  ok('누르면 닫힌다 — 단추 없이 「화면을 터치해주세요」');
  // 장수 상세의 꼬마와 크기를 견준다 — 메인 → 궁궐 → 장수 일람 → 그 장수
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.click('[data-action="officers"]');
  await page.fill('input[data-field="search"]', OFFICERS.find((o) => o.id === X)!.name);
  await page.waitForTimeout(300);
  await page.click(`.ofc-rows [data-officer="${X}"]`);
  await page.waitForSelector(`.ofcard-modal[data-officer="${X}"]`, { timeout: 10_000 });
  const detailArt = await page.evaluate(() => document.querySelector('.ofcard-modal .ofcard-art')!.getBoundingClientRect().width);
  if (Math.abs(detailArt - ask.art) > 3) throw new Error(`확정 판의 꼬마(${ask.art.toFixed(0)}px)가 장수 상세(${detailArt.toFixed(0)}px)와 크기가 다르다`);
  ok(`장수 상세의 꼬마와 같은 크기 (${ask.art.toFixed(0)}px)`);
  if (errors.length) throw new Error(`오류 ${errors.length}건 — ${errors.slice(0, 3).join(' | ')}`);
  console.log(`\n사진: ${SHOTS}`);
} catch (e) {
  failed = true;
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  await page.screenshot({ path: `${SHOTS}/fail.png` }).catch(() => {});
  console.error(`  사진: ${SHOTS}/fail.png`);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: admin });
  console.log('✓ 시험 계정 정리');
  process.exit(failed ? 1 : 0);
}
