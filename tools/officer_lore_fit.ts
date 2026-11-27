/**
 * 장수 상세의 「장수 열전」이 칸에 다 드는가 — 260명 × 열 언어 (2026-11-27 기획자: 「열전이 3줄 넘게 필요한 장수가 있지 않나」)
 *
 *   node --experimental-strip-types --env-file=.env tools/officer_lore_fit.ts [--langs ko,mn]
 *
 * 화면(`#frame`)은 1:2로 박히고 글자 · 판이 다 rem(= 화면 폭 비례)이라, 장수 상세의 짜임은 기기와 상관없이 같다 — 420×840 하나로 잰다.
 * 열전 칸(`.ofcard-story`)은 남는 높이를 채우고 넘치면 자른다(`overflow: hidden`). **가장 좁은 꼴**로 잰다 — 고르기 · 보초병 상세처럼
 * 맨 아래 한 수([선택하기] · [해제하기])가 붙은 카드(단추 넷). 궁궐에서 연 카드(단추 셋)에 같은 단추 하나를 복제해 넣는다.
 * `--buttons 3`이면 복제하지 않는다(궁궐 · 농지 — 한 수가 [강화] 자리에 서는 카드).
 * 필요한 것: 5173(dev) · 8787(게임 API). 끝나면 시험 계정을 지운다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const argv = process.argv.slice(2);
/** 단추 수 — 넷(맨 아래 한 수가 따로 선 카드, 기본) · 셋(궁궐 · 농지 — 한 수가 [강화] 자리에 선다) */
const BUTTONS = argv.includes('--buttons') ? Number(argv[argv.indexOf('--buttons') + 1]) : 4;
const LANGS = (argv.includes('--langs') ? argv[argv.indexOf('--langs') + 1]! : 'ko,en,es_419,it,ja,mn,pt_BR,pt_PT,zh_Hans,zh_Hant').split(',');

const email = `lore-fit-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = ((await created.json()) as { id: string }).id;

type Got = { lines: number; room: number; clip: number };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 840 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new', { timeout: 30_000 });
  await page.fill('.scr-new .newgame-form input', `열전-${randomUUID().slice(0, 4)}`);
  await page.click('.scr-new .newgame-form .btn.primary');
  await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
  await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });

  const stored = (await getProfile(uid))!;
  const roster: Record<string, ReturnType<typeof newInstance>> = {};
  for (const o of OFFICERS) roster[o.id] = newInstance(o.id as OfficerId);
  await saveProfileTrusted(uid, { ...stored, roster } as Parameters<typeof saveProfileTrusted>[1]);

  const report: string[] = [];
  const hist: Record<string, number[]> = {};
  for (const lang of LANGS) {
    await page.evaluate((l) => localStorage.setItem('samchess.lang', l), lang);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });
    const over: { officer: string; g: Got }[] = [];
    let room = 0;
    let maxLines = 0;
    const lines: number[] = [];
    for (const o of OFFICERS) {
      await go(page, { name: 'officers', officer: o.id });
      await page.waitForSelector(`.ofcard-modal[data-officer="${o.id}"]`, { timeout: 8_000 });
      const got = await page.evaluate((buttons): Got | null => {
        const card = document.querySelector<HTMLElement>('.ofcard-modal .ofcard')!;
        const story = card.querySelector<HTMLElement>('.ofcard-story');
        if (!story) return null;
        // 맨 아래 한 수 자리 — 마지막 단추를 하나 복제해 단추 넷으로 만든다
        const btns = card.querySelectorAll<HTMLElement>(':scope > .btn');
        const last = btns[btns.length - 1]!;
        if (buttons > btns.length) last.after(last.cloneNode(true));
        const cs = getComputedStyle(story);
        const lh = parseFloat(cs.lineHeight);
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const have = story.clientHeight - pad;
        // 글의 제 높이 — 칸은 남는 높이를 채우므로(`flex: 1`) scrollHeight는 칸보다 작게 나오지 않는다. 글만 따로 재려고 안쪽을 감싼다
        const probe = document.createElement('div');
        probe.style.cssText = `width:${story.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px;font:${cs.font};line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing};word-break:${cs.wordBreak};overflow-wrap:${cs.overflowWrap};white-space:${cs.whiteSpace};position:absolute;visibility:hidden;`;
        probe.textContent = story.textContent;
        document.body.append(probe);
        const need = probe.getBoundingClientRect().height;
        probe.remove();
        return { lines: Math.round(need / lh), room: Math.floor(have / lh + 0.05), clip: Math.max(0, Math.round(need - have)) };
      }, BUTTONS);
      if (!got) continue;
      room = Math.max(room, got.room);
      maxLines = Math.max(maxLines, got.lines);
      lines.push(got.lines);
      if (got.clip > 1) over.push({ officer: o.id, g: got });
      await go(page, { name: 'main' });
    }
    hist[lang] = lines;
    const dist = [...new Set(lines)].sort((a, b) => a - b).map((n) => `${n}줄 ${lines.filter((x) => x === n).length}`).join(' · ');
    console.log(`  ${lang.padEnd(8)} 칸 ${room}줄 · 가장 긴 열전 ${maxLines}줄 · 넘침 ${over.length}명 — ${dist}`);
    for (const { officer, g } of over) report.push(`${lang} ${officer} — ${g.lines}줄 필요 / 칸 ${g.room}줄 (${g.clip}px 잘림)`);
  }
  console.log(report.length ? `\n넘치는 열전 ${report.length}건:\n  ${report.join('\n  ')}` : '\n넘치는 열전 없음');
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
