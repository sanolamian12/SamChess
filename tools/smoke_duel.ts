/**
 * 일기토 · 설전 스모크 — 데모 판(`?demo=1&duel=1|2`)을 브라우저로 끝까지 민다 (GDD §3.11, 설계서 §8 단계 3c).
 *
 *   npm run smoke:duel -- [--url http://localhost:5173] [--shots 폴더] [--width 700]
 *
 * 서버 · 계정이 필요 없다(데모 판의 판정 주체는 로컬 룰 엔진이다). Vite만 떠 있으면 된다.
 * 검사는 화면 글자가 아니라 `data-*`로 건다(CLAUDE.md). 첫 실패에서 멈춘다 — 끝까지 「✓ 완주」가 찍혀야 통과다.
 *
 * 1. `duel=1` 내가 건다 — 물음에 [일기토 신청] · [설전 신청] → 확인창(예보 · 승률) → 신청 → 합 화면(AI가 받으면) →
 *    패를 내면 그 단추가 골린다 → 공개 → … → 층이 닫히고 남군 일기토 신청권이 「씀」
 * 2. `duel=2` 적이 건다 — 받는 팝업(남은 초) → [수락] → 합 화면 · 내 쪽에 「AI 대리」가 없다 → [도망] → 끝 장면 → 닫힘
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const base = flag('url', 'http://localhost:5173');
const shots = flag('shots', '');
const width = Number(flag('width', '700'));
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: width * 2 } });
const problems: string[] = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[console] ${m.text()}`); });

let n = 0;
const shot = async (name: string): Promise<void> => {
  if (!shots) return;
  n++;
  await page.screenshot({ path: join(shots, `${String(n).padStart(2, '0')}-${name}.png`) });
};
const ok = (cond: unknown, what: string): void => {
  if (!cond) {
    console.log(`  ✗ ${what}`);
    throw new Error(what);
  }
  console.log(`  ✓ ${what}`);
};
const attr = (p: Page, sel: string, name: string): Promise<string | null> =>
  p.$eval(sel, (el, a) => el.getAttribute(a), name).catch(() => null);
const gone = { state: 'attached' as const };

try {
  // ── 1. 내가 건다 ──
  console.log('일기토 · 설전 — 내가 건다 (?duel=1)');
  await page.goto(`${base}/?demo=1&duel=1&seed=2`);
  await page.waitForSelector('#ctx-flow[data-view="ask"]', { timeout: 20_000 });
  ok(await page.$('#ctx-flow button[data-action="challenge-duel"]'), '차례 맨 앞의 물음에 [일기토 신청]');
  ok(await page.$('#ctx-flow button[data-action="challenge-debate"]'), '〃 [설전 신청]');
  await shot('ask');

  await page.click('#ctx-flow button[data-action="challenge-duel"]');
  await page.waitForSelector('#ctx-flow[data-view="confirm"][data-kind="challenge"]');
  ok((await page.$$('#ctx-flow .cx-duel-side')).length === 2, '확인창에 양쪽의 능력치 · 전의 두 줄');
  // 신청 전이면 공격권은 받는 쪽(상대) — 엔진의 예보가 정한다. 승률 · 몇 번 맞으면 0은 2026-11-06에 뺐다
  ok(await attr(page, '#ctx-flow .cx-duel-first', 'data-holder') === 'foe', '〃 선공은 받는 쪽');
  ok(!(await page.$('#ctx-flow .cx-rate[data-kind="odds"]')), '〃 승패 확률 칸은 없다');
  await shot('confirm');

  await page.click('#ctx-flow button[data-action="commit"]');
  await page.waitForSelector('#duel[data-open="1"]', { timeout: 10_000 });
  ok(true, '신청하면 대결 층이 열린다');
  const view = await attr(page, '#duel', 'data-view');
  if (view === 'round' && await page.$('#duel .dl-pick:not([disabled])')) {
    ok(await page.$('#duel .dl-side[data-holder="1"] .dl-holder'), '합 화면에 공격권 북 표지');
    await shot('round');
    await page.click('#duel .dl-pick >> nth=1');
    await page.waitForSelector('#duel .dl-pick[data-picked="1"]', { timeout: 2_000 });
    ok(true, '패를 누르면 그 단추가 골린다');
    await page.waitForSelector('#duel .dl-reveal, #duel .dl-end', { timeout: 6_000 });
    ok(true, '카운트가 끝나면 공개한다');
    await shot('reveal');
  } else {
    ok(view === 'round', `AI가 거절해 곧장 끝 장면 (view=${view})`);
  }
  await page.waitForSelector('#duel[data-open="0"]', { timeout: 60_000, ...gone });
  ok(true, '대결이 끝나면 층이 닫힌다');
  ok(await attr(page, '.gi-side[data-side="P1"] .gi-right[data-kind="duel"]', 'data-used') === '1', '남군 일기토 신청권이 「씀」');
  ok(await attr(page, '.gi-side[data-side="P1"] .gi-right[data-kind="debate"]', 'data-used') === '0', '〃 설전은 남았다');
  await shot('after');

  // ── 2. 적이 건다 ──
  console.log('일기토 · 설전 — 적이 건다 (?duel=2)');
  await page.goto(`${base}/?demo=1&duel=2&seed=2`);
  await page.waitForSelector('#duel[data-view="offer"]', { timeout: 20_000 });
  ok(/\d/.test(await page.$eval('#duel .dl-timer', (el) => el.textContent ?? '')), '받는 팝업에 남은 초');
  await shot('offer');
  await page.click('#duel button[data-action="accept"]');
  await page.waitForSelector('#duel[data-view="round"]', { timeout: 5_000 });
  ok(true, '[수락]하면 합 화면');
  ok(!(await page.$('#duel .dl-side.me .dl-auto')), '내가 받았으니 내 쪽에 「AI 대리」가 없다');
  await page.waitForSelector('#duel button[data-action="flee"]:not([disabled])', { timeout: 6_000 });
  await page.click('#duel button[data-action="flee"]');
  await page.waitForSelector('#duel .dl-end', { timeout: 5_000 });
  ok(true, '[도망]하면 끝 장면');
  await shot('fled');
  await page.waitForSelector('#duel[data-open="0"]', { timeout: 10_000, ...gone });
  ok(true, '끝 장면이 걷힌다');

  ok(problems.length === 0, `페이지 오류 없음${problems.length ? ` — ${problems.slice(0, 3).join(' / ')}` : ''}`);
  console.log('\n✓ 완주');
} finally {
  await browser.close();
}
