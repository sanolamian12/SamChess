/**
 * 고유기술 팝업이 판 안에 드는가 — 고유기술 40종 × 열 언어 × 세로 · 가로 (2026-11-19 기획자: 유래 · 효과를 제목 다음 줄로 내린 뒤)
 *
 *   node --env-file=.env tools/skill_popup_fit.ts [--langs ko,mn]
 *
 * 장수 상세에서 고유기술 배너를 눌러 팝업(`SkillModal`)을 열고, 글이 든 칸(`.ofc-skill-body`)이 판 안에서 넘치는지
 * (`scrollHeight − clientHeight`, px)를 잰다. 넘치면 스크롤이 생긴다. 판 그림은 비율을 지켜 화면에 드는 최대 크기라
 * 세로(700×1400)와 가로(1920×1080)에서 크기가 다르다. 필요한 것: 5173(dev) · 8787(게임 API). 끝나면 시험 계정을 지운다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { OFFICERS, UNIQUE_SKILLS } from '@samchess/data';
import { newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const argv = process.argv.slice(2);
const LANGS = (argv.includes('--langs') ? argv[argv.indexOf('--langs') + 1]! : 'ko,en,es_419,it,ja,mn,pt_BR,pt_PT,zh_Hans,zh_Hant').split(',');
const SIZES = [{ orient: '세로', w: 700, h: 1400 }, { orient: '가로', w: 1920, h: 1080 }];

// 기술마다 그 기술을 가진 장수 하나
const holders = UNIQUE_SKILLS.map((s) => ({ skill: s, officer: OFFICERS.find((o) => o.uniqueSkill === s.id) }))
  .filter((x): x is { skill: typeof x.skill; officer: NonNullable<typeof x.officer> } => !!x.officer);

const email = `skill-fit-${randomUUID()}@samchess.test`;
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
  await page.fill('.scr-new .newgame-form input', `기술-${randomUUID().slice(0, 4)}`);
  await page.click('.scr-new .newgame-form .btn.primary');
  await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
  await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 20_000 });

  const stored = (await getProfile(uid))!;
  const roster: Record<string, ReturnType<typeof newInstance>> = { ...(stored.roster as Record<string, ReturnType<typeof newInstance>>) };   // 처음 받은 다섯은 남긴다
  for (const h of holders) roster[h.officer.id] ??= newInstance(h.officer.id as OfficerId);
  await saveProfileTrusted(uid, { ...stored, roster } as Parameters<typeof saveProfileTrusted>[1]);

  const over: string[] = [];
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.w, height: size.h });
    for (const lang of LANGS) {
      await page.evaluate((l) => localStorage.setItem('samchess.lang', l), lang);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#frame:not([data-sky]) .scr-main', { timeout: 30_000 });
      let worst = { skill: '', spill: -Infinity, room: 0 };
      let n = 0;
      for (const h of holders) {
        await go(page, { name: 'officers', officer: h.officer.id });
        try {
          await page.waitForSelector(`.ofcard-modal[data-officer="${h.officer.id}"]`, { timeout: 8_000 });
        } catch {
          console.log(`  ! ${h.officer.id} 장수 상세가 안 열림 — 화면 ${await page.evaluate(() => document.querySelector('#frame .scr')?.className)}`);
          await page.screenshot({ path: `${process.env['TEMP'] ?? '.'}/skill_fit_fail.png` });
          throw new Error('stop');
        }
        await page.click('[data-action="skill"]');
        await page.waitForSelector('.ofc-skill-body', { timeout: 5_000 });
        await page.waitForFunction(() => {
          const img = document.querySelector<HTMLImageElement>('.ofc-skill-body .ofc-banner');
          return !img || img.complete;
        });
        const got = await page.evaluate(() => {
          const body = document.querySelector<HTMLElement>('.ofc-skill-body')!;
          // 넘침은 scrollHeight로, 여유(음수 넘침)는 글의 실제 높이로 — scrollHeight는 칸보다 작아지지 않는다
          const kids = [...body.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
          const used = kids.length ? Math.max(...kids.map((r) => r.bottom)) - body.getBoundingClientRect().top : 0;
          const spill = body.scrollHeight > body.clientHeight ? body.scrollHeight - body.clientHeight : Math.round(used - body.clientHeight);
          return { spill, client: body.clientHeight };
        });
        if (got.spill > 0) { n++; over.push(`${size.orient} ${lang} ${h.skill.id}(${h.officer.id}) +${got.spill}px`); }
        if (got.spill > worst.spill) worst = { skill: `${h.skill.id}(${h.skill.tier})`, spill: got.spill, room: got.client };
        await page.click('[data-modal="skill"] [data-action="close"]');
        await page.waitForSelector('[data-modal="skill"]', { state: 'detached', timeout: 5_000 });
        await go(page, { name: 'main' });
        await page.waitForSelector('#frame .scr-main', { timeout: 8_000 });
      }
      const verdict = worst.spill > 0 ? `넘침 ${n}종 · 가장 큰 넘침 +${worst.spill}px` : `모두 듦 · 가장 빠듯한 여유 ${-worst.spill}px`;
      console.log(`  ${size.orient} ${lang.padEnd(8)} ${verdict} — ${worst.skill} (글 칸 높이 ${worst.room}px)`);
    }
  }
  console.log(over.length ? `\n넘치는 경우 ${over.length}건:\n${over.join('\n')}` : '\n넘치는 경우 없음');
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
