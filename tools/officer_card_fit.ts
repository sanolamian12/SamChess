/**
 * 장수 상세의 높이 재기 — 260명 × 열 언어 중 가장 긴 카드 (2026-11-19 기획자: 「내용에 따라 판 높이가 바뀌지 않게」)
 *
 *   node --experimental-strip-types --env-file=.env tools/officer_card_fit.ts [--langs ko,mn]
 *
 * 장수 상세(`OfficerDetailModal`)는 높이를 박는다(`style.css`의 `--ofcard-h`). 그 값은 여기서 잰다 — 판을 잠깐 「내용만큼」으로 풀고
 * 카드(`.ofcard`)의 자연 높이를 rem으로 읽는다(글자 · 판이 다 rem이라 화면 폭과 무관하다). **가장 무거운 꼴**로 잰다 —
 * 모든 장수를 들이고 다치게 하고(부상 줄) 병기를 하나씩 쥐여(병기 줄) 연다. 열린 [부상] 설명은 누를 때만이라 안 센다.
 * 필요한 것: 5173(dev) · 8787(게임 API). 끝나면 시험 계정을 지운다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { EQUIPMENT, OFFICERS } from '@samchess/data';
import { newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const argv = process.argv.slice(2);
const LANGS = (argv.includes('--langs') ? argv[argv.indexOf('--langs') + 1]! : 'ko,en,es_419,it,ja,mn,pt_BR,pt_PT,zh_Hans,zh_Hant').split(',');

const email = `card-fit-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = ((await created.json()) as { id: string }).id;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 700, height: 1400 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new', { timeout: 30_000 });
  await page.fill('.scr-new .newgame-form input', `재기-${randomUUID().slice(0, 4)}`);
  await page.click('.scr-new .newgame-form .btn.primary');
  await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
  await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });

  // 가장 무거운 꼴 — 260명 전부 · 모두 부상 · 모두 병기 한 자루
  const stored = (await getProfile(uid))!;
  const now = Date.now();
  const roster: Record<string, ReturnType<typeof newInstance>> = {};
  const forgeOwned: Record<string, string | null> = {};
  const weapon = EQUIPMENT[0]!.id;
  OFFICERS.forEach((o, i) => {
    roster[o.id] = { ...newInstance(o.id as OfficerId), injuredAt: now };
    forgeOwned[`${weapon}#${i + 1}`] = o.id;
  });
  await saveProfileTrusted(uid, { ...stored, roster, forgeOwned } as Parameters<typeof saveProfileTrusted>[1]);

  const worst: { lang: string; officer: string; rem: number }[] = [];
  const titles: number[] = [];
  for (const lang of LANGS) {
    await page.evaluate((l) => localStorage.setItem('samchess.lang', l), lang);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });
    let best = { officer: '', rem: 0, equip: false, injury: false, spill: 0, titleRem: 0, atSpill: 0 };
    let spill = 0; let title = { officer: '', rem: 0 }; let atSpill = 0;
    for (const o of OFFICERS) {
      await go(page, { name: 'officers', officer: o.id });
      await page.waitForSelector(`.ofcard-modal[data-officer="${o.id}"]`, { timeout: 8_000 });
      const got = await page.evaluate(() => {
        const modal = document.querySelector<HTMLElement>('.ofcard-modal')!;
        modal.style.height = 'auto'; modal.style.maxHeight = 'none'; modal.style.overflow = 'visible';
        const card = modal.querySelector<HTMLElement>('.ofcard')!;
        const story = card.querySelector<HTMLElement>('.ofcard-story');
        if (story) { story.style.flex = 'none'; story.style.overflow = 'visible'; }
        const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
        // 그림 · 능력치 판(비율이 박힌 상자) 안의 여섯 값 · [부상]이 판을 넘치지 않는가
        const bars = card.querySelector<HTMLElement>('.ofcard-layout .ofcard-bars');
        const panel = card.querySelector<HTMLElement>('.ofcard-layout');
        const spill = bars && panel ? Math.max(0, bars.scrollHeight - panel.clientHeight) : 0;
        // 이름 줄 — 획 폭을 풀어 [등급][레벨] 이름 자가 차지하는 폭(rem)
        const title = card.querySelector<HTMLElement>('.ofcard-title')!;
        const keepW = title.style.width;
        title.style.width = 'max-content'; title.style.maxWidth = 'none';
        const titleRem = title.getBoundingClientRect().width / rootPx;
        title.style.width = keepW; title.style.maxWidth = '';
        // 여섯 값이 커져도 칸이 서로 안 겹치는가 — 무 · 지 · 통 · HP · MP는 세 자리(「100」), AT는 「10-20」으로 잠깐 바꿔 잰다
        const keep: [HTMLElement, string | null][] = [];
        for (const f of ['might', 'intellect', 'leadership', 'hp', 'mp', 'at']) {
          const v = card.querySelector<HTMLElement>(`[data-field="${f}"] .v`);
          if (v) { keep.push([v, v.textContent]); v.textContent = f === 'at' ? '10-20' : '100'; }
        }
        let atSpill = 0;
        for (const row of card.querySelectorAll<HTMLElement>('.ofcard-layout .ofcard-bar-abl, .ofcard-layout .ofcard-bar-lv')) {
          const cells = [...row.querySelectorAll<HTMLElement>(':scope > .ofcard-stat')].map((c) => c.getBoundingClientRect());
          const end = row.getBoundingClientRect().right;
          cells.forEach((r, k) => {
            const next = k + 1 < cells.length ? cells[k + 1]!.left : end;
            atSpill = Math.max(atSpill, Math.round(r.right - next));
          });
        }
        for (const [v, t] of keep) v.textContent = t;
        return {
          titleRem, atSpill,
          spill,
          rem: card.getBoundingClientRect().height / rootPx,
          equip: !!card.querySelector('[data-field="equip"]'),
          injury: !!card.querySelector('[data-field="injury"]'),
        };
      });
      spill = Math.max(spill, got.spill); atSpill = Math.max(atSpill, got.atSpill);
      if (got.titleRem > title.rem) title = { officer: o.id, rem: got.titleRem };
      if (got.rem > best.rem) best = { officer: o.id, ...got };
      await go(page, { name: 'main' });
    }
    console.log(`  ${lang.padEnd(8)} ${best.rem.toFixed(2)}rem — ${best.officer}${best.equip ? '' : ' (병기 줄 없음!)'}${best.injury ? '' : ' (부상 줄 없음!)'}${spill ? ` · 그림 판을 ${spill}px 넘친다!` : ''} · 이름 줄 ${title.rem.toFixed(2)}rem(${title.officer})${atSpill ? ` · 능력치 칸이 ${atSpill}px 겹친다(세 자리 · 10-20)!` : ''}`);
    titles.push(title.rem);
    worst.push({ lang, officer: best.officer, rem: best.rem });
  }
  const top = worst.reduce((a, b) => (b.rem > a.rem ? b : a));
  console.log(`가장 긴 이름 줄 ${Math.max(...titles).toFixed(2)}rem — 금빛 획(--ofcard-title-w)은 이것보다 넓게`);
  console.log(`\n가장 긴 카드 ${top.rem.toFixed(2)}rem (${top.lang} · ${top.officer}) — 판(.ofcard-modal)은 이것보다 크게 잡는다`);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  console.log('시험 계정을 지웠다');
}

function go(page: Page, s: Record<string, unknown>): Promise<unknown> {
  return page.evaluate((x) => (window as unknown as { __screen: { go: (v: unknown) => void } }).__screen.go(x), s);
}
