/**
 * 레벨업 고르기 눈 확인 (2026-11-20 기획자 개편 — 금테 두 절 · 캡슐 줄 · 책략 토글 + 설명 판 하나 · [확정] 아래 [뒤로 가기]).
 *
 *   [UI_LANG=mn] [VW=390 VH=844] node --experimental-strip-types --env-file=.env tools/levelup_ux.ts
 *
 * 시험 계정에 장수 셋을 Lv1 · Lv2 · Lv5로 심고(다음 레벨 2 · 3 · 6 — Lv6 지원은 「화계 + 진화」 한 쌍) 각각 판을 연다.
 * 판마다 기본 · 환술 토글 · MP 줄을 찍고, 설명 판 높이가 토글로 안 출렁이는지 · 판이 넘치는지 · 글자가 .8rem 밑인지를 잰다.
 * 필요: Vite(5173) · 게임 API. 계정은 끝에 지운다.
 *
 * `MEASURE=1`이면 **설명 판의 고정 높이를 잰다** — 열 언어 × Lv2~10 × 두 학파의 설명(이름 + MP · 효과문 · 발동 조건)을 실제 판에
 * 하나씩 넣고(언어마다 `<html data-lang>`도 바꿔 글꼴까지 맞춘다) 판이 글에 맞춰 늘어난 높이의 최댓값을 rem으로 낸다 —
 * 그 값을 `style.css`의 `.lvu-desc` `height`에 옮겨 적는다. 그냥 돌리면 같은 후보 전부가 **고정 높이 안에 드는지**를 본다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { OFFICERS as _O, tacticById } from '@samchess/data';
import { applyLevelUp, tacticChoices } from '@samchess/meta';
import { isTerrainTactic } from '@samchess/rules';
import type { PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { withGarrisons } from '../packages/meta/test/fixtures.ts';
import { shotDir } from './shotDir.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('levelup_ux');
const UI_LANG = process.env['UI_LANG'];

const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);
const admin = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };

const email = `levelup-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 390), height: Number(process.env['VH'] ?? 844) },
});
if (UI_LANG) await page.addInitScript((l) => { try { localStorage.setItem('samchess.lang', l); } catch { /* 없다 */ } }, UI_LANG);
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname !== '/profile') errors.push(`404 ${new URL(r.url()).pathname}`); });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}${UI_LANG ? `-${UI_LANG}` : ''}.png` });

let failed = false;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `레벨업-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);

  step('장수 셋을 Lv1 · Lv2 · Lv5로 심는다(카드 넉넉히 · 도시 Lv11)');
  const stored = (await getProfile(uid))!;
  const own = Object.keys(stored.roster) as OfficerId[];
  const [a, b, c] = own as [OfficerId, OfficerId, OfficerId];
  let p: PlayerProfile = { ...stored, cityLevel: 11, buildings: { ...stored.buildings, palace: 11 } };
  p = { ...p, cards: { ...p.cards, [a]: 300, [b]: 300, [c]: 300 } };
  p = applyLevelUp(p, b, 'hp', 'support');
  for (let i = 0; i < 4; i++) p = applyLevelUp(p, c, 'mp', i % 2 ? 'illusion' : 'support');
  p = { ...p, cards: { ...p.cards, [a]: 300, [b]: 300, [c]: 300 } };
  await saveProfileTrusted(uid, withGarrisons(p) as Parameters<typeof saveProfileTrusted>[1]);
  ok(`${a} Lv1 · ${b} Lv${p.roster[b]!.level} · ${c} Lv${p.roster[c]!.level}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.click('[data-action="officers"]');
  await page.waitForSelector('[data-screen="officer-list"]');

  // ── 설명 판 — 열 언어 × 모든 레벨의 두 학파가 고정 높이 안에 드는가 (MEASURE=1이면 그 최댓값을 잰다) ──
  {
    step(process.env['MEASURE'] ? '설명 판 높이 재기 — 열 언어 × Lv2~10 × 두 학파' : '설명 판 — 열 언어 × Lv2~10 × 두 학파가 고정 높이 안에 드는가');
    const LANGS = ['ko', 'en', 'es_419', 'it', 'ja', 'mn', 'pt_BR', 'pt_PT', 'zh_Hans', 'zh_Hant'] as const;
    const strings = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(`packages/client/src/i18n/strings/${l}.json`, 'utf8')) as Record<string, string>]));
    const cases: { lang: string; level: number; school: string; items: { name: string; text: string }[]; cond: string }[] = [];
    for (const lang of LANGS) {
      for (let level = 2; level <= 10; level++) {
        const ch = tacticChoices(level);
        for (const school of ['support', 'illusion'] as const) {
          const list = ch[school].map((t) => tacticById.get(t)!).filter(Boolean);
          if (list.length === 0) continue;
          const key = list.every((x) => isTerrainTactic(x)) ? 'levelup.trigger.terrain' : `levelup.trigger.${school}`;
          cases.push({
            lang, level, school, cond: strings[lang]![key] ?? strings['ko']![key]!,
            items: list.map((x) => ({
              name: `${(lang === 'ko' ? x.name : x.nameI18n?.[lang]) ?? x.name} (MP: ${x.mpCost})`,
              text: (lang === 'ko' ? x.text : x.textI18n?.[lang]) ?? x.text,
            })),
          });
        }
      }
    }
    await page.click(`.ofc-rows [data-officer="${a}"]`);
    await page.click('.ofcard-modal [data-action="levels"]');
    await page.waitForSelector('[data-screen="levelup-panel"]');
    await page.waitForTimeout(300);
    const res = await page.evaluate(({ cases, measure }) => {
      const desc = document.querySelector('[data-field="tacticDesc"]') as HTMLElement;
      const item = desc.querySelector('.lvu-desc-item[data-on="1"]') as HTMLElement;
      const keep = item.innerHTML;
      const fixedPx = desc.offsetHeight;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const oldLang = document.documentElement.dataset['lang'];
      if (measure) desc.style.height = 'auto';
      let best = { px: 0, at: '' };
      const over: string[] = [];
      for (const c of cases) {
        document.documentElement.dataset['lang'] = c.lang;
        item.innerHTML = '';
        for (const it of c.items) {
          const one = document.createElement('div'); one.className = 'lvu-desc-one';
          const l = document.createElement('span'); l.className = 'lv-tactic-label'; l.textContent = it.name;
          const tx = document.createElement('span'); tx.className = 'lv-tactic-text'; tx.textContent = it.text;
          one.append(l, tx); item.append(one);
        }
        const cond = document.createElement('span'); cond.className = 'lv-tactic-cond'; cond.textContent = c.cond; item.append(cond);
        const at = `${c.lang} Lv${c.level} ${c.school}`;
        if (measure) { if (desc.offsetHeight > best.px) best = { px: desc.offsetHeight, at }; }
        else if (item.offsetHeight > desc.clientHeight - parseFloat(getComputedStyle(desc).paddingTop) - parseFloat(getComputedStyle(desc).paddingBottom) + 0.5) over.push(at);
      }
      item.innerHTML = keep; desc.style.height = '';
      if (oldLang) document.documentElement.dataset['lang'] = oldLang;
      return { best: { rem: best.px / rem, at: best.at }, fixedRem: fixedPx / rem, over, n: cases.length };
    }, { cases, measure: !!process.env['MEASURE'] });
    if (process.env['MEASURE']) console.log(`  · 후보 ${res.n}개 — 가장 긴 것 ${res.best.at}: ${res.best.rem.toFixed(3)}rem (지금 판 ${res.fixedRem.toFixed(3)}rem)`);
    else if (res.over.length) fail(`설명 판 넘침 ${res.over.length}건: ${res.over.slice(0, 6).join(' · ')}`);
    else ok(`후보 ${res.n}개 전부 고정 높이(${res.fixedRem.toFixed(2)}rem) 안`);
    await page.click('[data-action="stepBack"]');
    await page.click('[data-action="cardBack"]');
    await page.waitForTimeout(300);
  }

  for (const id of [a, b, c]) {
    const lvNext = p.roster[id]!.level + 1;
    step(`${id} → Lv${lvNext}`);
    const name = _O.find((o) => o.id === id)!.name;
    await page.fill('input[data-field="search"]', UI_LANG ? '' : name);
    await page.waitForTimeout(300);
    await page.click(`.ofc-rows [data-officer="${id}"]`);
    await page.waitForSelector('.ofcard-modal [data-action="levels"]:not([disabled])', { timeout: 8_000 });
    await page.click('.ofcard-modal [data-action="levels"]');
    await page.waitForSelector('[data-screen="levelup-panel"]');
    await page.waitForTimeout(400);
    await shot(`lv${lvNext}-1-default`);

    // 능력 줄 — 고른 줄이 하나, 체크 판은 없다
    const rows = await page.$$eval('.lv-stat-row', (els) => els.map((e) => e.classList.contains('on')));
    if (rows.length !== 3 || rows.filter(Boolean).length !== 1) fail(`능력 줄 ${rows.length}개 · 고른 줄 ${rows.filter(Boolean).length}`);
    if (await page.$('[data-screen="levelup-panel"] .lv-check')) fail('나무 체크 판이 아직 있다');

    // 토글 — 설명 판은 고른 쪽만 보이고, 높이는 안 바뀐다
    const descH = () => page.$eval('[data-field="tacticDesc"]', (e) => (e as HTMLElement).offsetHeight);
    const shown = () => page.$$eval('[data-field="tacticDesc"] > .lvu-desc-item', (els) =>
      els.filter((e) => getComputedStyle(e).visibility === 'visible').map((e) => (e as HTMLElement).dataset.school));
    const h1 = await descH();
    if ((await shown()).join() !== 'support') fail(`처음에 보이는 설명: ${(await shown()).join()}`);
    await page.click('.lvu-tab[data-school="illusion"]');
    await page.waitForTimeout(300);
    if ((await shown()).join() !== 'illusion') fail(`환술을 눌렀는데 보이는 설명: ${(await shown()).join()}`);
    const h2 = await descH();
    if (h1 !== h2) fail(`토글로 설명 판 높이가 바뀐다 ${h1} → ${h2}`);
    await page.click('.lv-stat-row[data-stat="mp"]');
    await page.waitForTimeout(250);
    await shot(`lv${lvNext}-2-illusion-mp`);
    ok(`토글 · 설명 판 높이 ${h1}px 그대로`);

    // 움직임은 사진에 안 잡힌다 — 걸려 있는지 계산된 스타일로 본다(네온 · 금빛 후광 · 광택 · 화살촉)
    const anim = await page.evaluate(() => {
      const a = (sel: string, pseudo?: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el, pseudo ?? null).animationName : 'none(없음)';
      };
      return {
        row: a('.lv-stat-row.on .lv-stat'), medal: a('.lv-stat-row.on .lvu-stat-medal'), rowShine: a('.lv-stat-row.on .lvu-stat-shine', '::after'),
        offShine: a('.lv-stat-row:not(.on) .lvu-stat-shine', '::after'), head: a('.lvu-head-shine', '::after'),
        tab: a('.lvu-tab.on'), tabIcon: a('.lvu-tab.on .lvu-tab-icon > img'), tabShine: a('.lvu-tab.on .lvu-tab-icon', '::after'),
        arrow: a('.lv-stat-row.on .c-arrow img'), offArrow: a('.lv-stat-row:not(.on) .c-arrow img'),
      };
    });
    const want = { row: 'lvu-pulse', medal: 'lvu-gold', rowShine: 'gr-glint', head: 'gr-glint', tab: 'lvu-pulse', tabIcon: 'lvu-gold', tabShine: 'gr-glint', arrow: 'lvu-nudge' } as const;
    for (const [k, v] of Object.entries(want)) if (anim[k as keyof typeof anim] !== v) fail(`움직임 ${k}: ${anim[k as keyof typeof anim]} (기대 ${v})`);
    if (anim.offShine !== 'none') fail(`안 고른 줄의 메달에도 광택이 돈다: ${anim.offShine}`);
    if (anim.offArrow !== 'none') fail(`안 고른 줄의 화살촉도 움직인다: ${anim.offArrow}`);

    // 판 넘침 · 글자 하한
    const m = await page.$eval('[data-screen="levelup-panel"]', (el) => {
      const small: string[] = [];
      for (const n of el.querySelectorAll<HTMLElement>('*')) {
        if (!n.childNodes.length || ![...n.childNodes].some((x) => x.nodeType === 3 && x.textContent!.trim())) continue;
        if (getComputedStyle(n).visibility !== 'visible') continue;
        const px = parseFloat(getComputedStyle(n).fontSize);
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        if (px < rem * 0.8 - 0.1) small.push(`${n.className}:${px.toFixed(1)}px`);
      }
      const clipped = [...el.querySelectorAll<HTMLElement>('.lvu-tab-name, .lv-stat > span, .lbl')]
        .filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent);
      return { over: el.scrollHeight - el.clientHeight, small, clipped };
    });
    console.log(`  · 판 넘침 ${m.over}px · 작은 글자 ${m.small.length} · 잘림 ${m.clipped.length}`);
    if (m.small.length) console.log(`    ${m.small.join(' | ')}`);
    if (m.clipped.length) console.log(`    잘림: ${m.clipped.join(' | ')}`);

    // [뒤로 가기]는 [확정] 아래에 있고 누르면 카드로
    const order = await page.$$eval('.lv-acts > .btn', (els) => els.map((e) => (e as HTMLElement).dataset.action));
    if (order.join() !== 'confirm,stepBack') fail(`단추 차례: ${order.join()}`);
    await page.click('[data-action="stepBack"]');
    await page.waitForSelector('[data-screen="levelup-panel"]', { state: 'detached', timeout: 5_000 });
    ok('[뒤로 가기] → 카드');
    await page.click('[data-action="cardBack"]');
    await page.waitForTimeout(300);
  }
  // ── 실제로 올려 축하 판(`Celebrate`)을 본다 — 첫 장수(Lv1 → Lv2) ──
  {
    step(`${a} 실제로 올린다 → 축하 판`);
    await page.fill('input[data-field="search"]', UI_LANG ? '' : _O.find((o) => o.id === a)!.name);
    await page.waitForTimeout(300);
    await page.click(`.ofc-rows [data-officer="${a}"]`);
    await page.click('.ofcard-modal [data-action="levels"]');
    await page.waitForSelector('[data-screen="levelup-panel"]');
    await page.click('[data-action="confirm"]');
    // 모음(5초) — 섬광이 도는 동안은 눌러도 안 닫히고, 배경 음악은 멈춘다(`holdBgm`). 무대가 열려야 `data-modal`이 붙는다
    await page.waitForSelector('.cel-back[data-phase="charge"]', { timeout: 8_000 });
    if (await page.$('[data-modal="levelUpDone"]')) fail('모으는 중인데 무대가 벌써 떴다');
    await page.mouse.click(195, 420);
    await page.waitForTimeout(300);
    if (!await page.$('.cel-back[data-phase="charge"]')) fail('모으는 중에 눌렀더니 닫혔다');
    ok('모음 — 섬광이 도는 동안은 눌러도 안 닫힌다');
    await page.waitForSelector('[data-modal="levelUpDone"]', { timeout: 8_000 });
    await page.waitForTimeout(250);
    await shot('done-0-opening');
    await page.waitForTimeout(500);
    await shot('done-0b-slam');
    await page.waitForTimeout(1_200);
    await shot('done-1');
    const cel = await page.evaluate(() => {
      const m = document.querySelector('[data-modal="levelUpDone"] .modal') as HTMLElement;
      const r = m.getBoundingClientRect();
      return {
        level: m.querySelector('[data-field="doneLevel"] [data-level]')?.getAttribute('data-level'),
        stat: m.querySelector('[data-field="doneStat"]')?.getAttribute('data-stat'),
        tactic: !!m.querySelector('[data-field="doneTactic"] .lvd-tac'),
        badge: m.querySelector('.cel-badge [data-level]')?.getAttribute('data-level') ?? m.querySelector('.cel-badge img')?.getAttribute('src'),
        over: 0, inView: r.top >= 0 && r.bottom <= innerHeight + 1,
        flakes: document.querySelectorAll('[data-modal="levelUpDone"] .cel-flakes > i').length,
        anim: getComputedStyle(document.querySelector('[data-modal="levelUpDone"] .cel-flakes > i')!).animationName,
      };
    });
    if (cel.level !== '2' || cel.stat !== 'hp' || !cel.tactic) fail(`축하 판 내용: ${JSON.stringify(cel)}`);
    if (!cel.inView) fail(`축하 화면의 무대가 화면 밖이다: ${JSON.stringify(cel)}`);
    if (String(cel.badge) !== '2') fail(`축하 화면의 배지가 Lv2가 아니다: ${cel.badge}`);
    if (cel.flakes !== 16 || cel.anim !== 'cel-flake') fail(`금가루: ${cel.flakes} · ${cel.anim}`);
    await page.click('[data-modal="levelUpDone"] [data-action="doneOk"]');
    await page.waitForSelector('[data-modal="levelUpDone"]', { state: 'detached', timeout: 5_000 });
    if (await page.$('[data-screen="levelup-panel"]')) fail('축하 판을 닫았는데 고르기 판이 남았다');
    await page.waitForSelector('.ofcard-modal', { timeout: 5_000 });
    ok('Lv2 배지 · HP · 새 책략 · 금가루 16 · 화면 안 → 화면을 눌러 카드로');
  }

  if (errors.length) fail(`콘솔 오류: ${errors.join(' | ')}`);
  console.log(`\n완주 — 사진: ${SHOTS}`);
} catch (e) {
  failed = true;
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  await shot('zz-fail').catch(() => undefined);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: admin });
}
process.exit(failed ? 1 : 0);
