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
 * 3. 설전 — 같은 틀에 설전 그림이 받아지는가
 * 4. `duel=1&slowAnswer=` 건 쪽의 기다림 — 단추 대신 「상대방이 결정중입니다」 · 양쪽 판 → AI가 답하면 걷힌다
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DUEL_COUNT_MS, DUEL_INTRO_MS } from '@samchess/rules';

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
    ok(await page.$('#duel .dl-side[data-holder="1"] .dl-name-row .dl-holder'), '합 화면에 공격권 북 표지(이름 줄 왼쪽)');
    // 안 고르면 나갈 패를 화면이 미리 내고 네온으로 보인다 — 보이는 패가 판에 실제로 들어간 패와 같아야 거짓말이 아니다 (2026-11-06)
    await page.waitForSelector('#duel .dl-pick[data-suggested="1"]', { timeout: 3_000 });
    const neon = await attr(page, '#duel .dl-pick[data-suggested="1"]', 'data-pick');
    const inState = await page.evaluate(() => {
      const s = (window as any).__battle.scene.debugPlayback.state;
      return String(s.duel?.picks?.P1 ?? '');
    });
    ok(neon !== null && neon === inState, `미리 낸 패가 네온 · 판에도 그 패 (${neon})`);
    // 연출 그림 — 열리면 첫 격돌(1), 내 그림 반 · 상대 그림 반이 실제로 받아진다 (2026-11-06, `ui/duelScene.ts`)
    ok(await attr(page, '#duel .dl-scene', 'data-scene') === '1', '합 화면 가운데에 연출 그림(첫 격돌)');
    const sceneUrls = await page.$$eval('#duel .dl-scene-l, #duel .dl-scene-r',
      (els) => els.map((e) => getComputedStyle(e).backgroundImage.replace(/^url\("?|"?\)$/g, '')));
    // 상태 코드로는 못 본다 — Vite는 없는 파일에도 200(index.html)을 준다. 내용 종류가 그림이어야 받아진 것이다
    const types = await page.evaluate((urls) => Promise.all(urls.map((u) => fetch(u).then((r) => r.headers.get('content-type') ?? ''))), sceneUrls);
    ok(sceneUrls.length === 2 && types.every((c) => c.startsWith('image/')), `〃 두 반쪽 그림이 받아진다 (${types.join(', ')} — 없으면 npm run duel)`);
    await shot('round');
    await page.click('#duel .dl-pick >> nth=1');
    await page.waitForSelector('#duel .dl-pick[data-picked="1"]', { timeout: 2_000 });
    ok(true, '패를 누르면 그 단추가 골린다');
    // 첫 합은 준비 뒤에 센다 — 그림이 떠오르고, 징과 함께 「일기토 시작!」, 그 뒤 3 · 2 · 1 (2026-11-06 기획자). 준비 동안 카운트 숫자는 비어 있다
    await page.waitForSelector('#duel[data-intro="start"] .dl-start', { timeout: DUEL_INTRO_MS + 1_000 });
    ok(await page.$eval('#duel .dl-count', (e) => e.textContent === ''), '준비 끝에 「일기토 시작!」 · 그동안 카운트는 비어 있다');
    await page.waitForSelector('#duel .dl-reveal, #duel .dl-end', { timeout: DUEL_INTRO_MS + DUEL_COUNT_MS + 3_000 });
    ok(true, '카운트가 끝나면 공개한다');
    if (await page.$('#duel .dl-reveal')) {
      ok(['1', '2', '3'].includes(await attr(page, '#duel .dl-scene', 'data-scene') ?? ''), '공개하면 그 합의 장면(1 · 2 · 3)');
    }
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
  // 끝 장면 (2026-11-06 기획자) — 판정은 보는 사람 기준(도망친 쪽은 패배) · 결과 한 줄 · 아래 칸은 걷지 않고 꺼서 흐리게(걷으면 그림이 내려앉는다)
  ok(await attr(page, '#duel .dl-end', 'data-tone') === 'lose', '〃 도망친 내 화면은 「패배」');
  ok(!!(await page.$eval('#duel .dl-end .dl-detail', (e) => e.textContent?.trim())), '〃 그 아래 결과 한 줄');
  // 진 쪽 초상에 「패배」 도장 — 내 판(왼쪽)에만 (2026-11-07 기획자)
  ok(await page.$$eval('#duel .dl-side', (cs) => cs.map((c) => !!c.querySelector('.dl-lost')).join()) === 'true,false', '〃 내 초상에만 「패배」 도장');
  ok(await page.$$eval('#duel .dl-stage[data-ended="1"] .dl-pick', (bs) => bs.length === 3 && bs.every((b) => (b as HTMLButtonElement).disabled)),
    '〃 패 셋은 그대로 서 있고 꺼졌다');
  await shot('fled');
  await page.waitForSelector('#duel[data-open="0"]', { timeout: 10_000, ...gone });
  ok(true, '끝 장면이 걷힌다');

  // ── 3. 설전 — 같은 틀에 설전 그림(`public/duel/scene/debate/`)이 실제로 받아지는가 (2026-11-06) ──
  console.log('설전 — 내가 건다 (?duel=1)');
  await page.goto(`${base}/?demo=1&duel=1&seed=2`);
  await page.waitForSelector('#ctx-flow[data-view="ask"]', { timeout: 20_000 });
  await page.click('#ctx-flow button[data-action="challenge-debate"]');
  await page.waitForSelector('#ctx-flow[data-view="confirm"][data-kind="challenge"]');
  await page.click('#ctx-flow button[data-action="commit"]');
  await page.waitForSelector('#duel[data-open="1"]', { timeout: 10_000 });
  if (await attr(page, '#duel', 'data-view') === 'round' && await page.$('#duel .dl-scene')) {
    const urls = await page.$$eval('#duel .dl-scene-l, #duel .dl-scene-r',
      (els) => els.map((e) => getComputedStyle(e).backgroundImage.replace(/^url\("?|"?\)$/g, '')));
    const types = await page.evaluate((us) => Promise.all(us.map((u) => fetch(u).then((r) => r.headers.get('content-type') ?? ''))), urls);
    ok(urls.length === 2 && urls.every((u) => u.includes('/duel/scene/debate/')) && types.every((c) => c.startsWith('image/')),
      `설전 합 화면에 설전 그림 두 반쪽 (${types.join(', ')} — 없으면 npm run duel)`);
    await page.waitForSelector('#duel .dl-reveal, #duel .dl-end', { timeout: DUEL_INTRO_MS + DUEL_COUNT_MS + 3_000 });
    // 말 둘 — 양쪽에 하나씩, 둘째는 0.5초 뒤에 튀어나온다(그 전엔 안 보인다) · 공개가 끝나도 카운트 앞머리까지 남는다 (2026-11-07)
    if (await page.$('#duel .dl-reveal')) {
      const says = await page.$$eval('#duel .dl-say', (bs) => bs.map((b) => ({ at: b.classList.contains('dl-say-l') ? 'l' : 'r', text: b.textContent ?? '', op: +getComputedStyle(b).opacity })));
      ok(says.length === 2 && new Set(says.map((s) => s.at)).size === 2 && says.every((s) => s.text.length > 0),
        `설전 공개에 양쪽 말풍선 둘 (${says.map((s) => `${s.at}:${s.text}`).join(' / ')})`);
      await page.waitForTimeout(900);
      ok(await page.$$eval('#duel .dl-say', (bs) => bs.length === 2 && bs.every((b) => +getComputedStyle(b).opacity > 0.9)), '〃 0.5초 뒤 둘째 말까지 떠 있다');
      await page.waitForSelector('#duel .dl-count', { timeout: 3_000 }).catch(() => null);
      if (await page.$('#duel .dl-count')) ok((await page.$$('#duel .dl-say')).length === 2, '〃 다음 합의 카운트 앞머리까지 남는다');
    }
    await shot('debate-reveal');
  } else {
    ok(true, 'AI가 설전을 거절했다 — 그림 검사는 건너뛴다');
  }
  await page.waitForSelector('#duel[data-open="0"]', { timeout: 60_000, ...gone });
  ok(true, '설전이 끝나면 층이 닫힌다');

  // ── 4. 건 쪽의 기다림 — AI가 늦게 답하는 흉내 통로(`?slowAnswer=`)로만 닿는다(AI는 같은 통에서 곧장 답한다) (2026-11-07) ──
  console.log('건 쪽의 기다림 (?duel=1&slowAnswer=2500)');
  await page.goto(`${base}/?demo=1&duel=1&seed=2&slowAnswer=2500`);
  await page.waitForSelector('#ctx-flow[data-view="ask"]', { timeout: 20_000 });
  await page.click('#ctx-flow button[data-action="challenge-duel"]');
  await page.waitForSelector('#ctx-flow[data-view="confirm"][data-kind="challenge"]');
  await page.click('#ctx-flow button[data-action="commit"]');
  await page.waitForSelector('#duel[data-view="wait"]', { timeout: 5_000 });
  ok(!!(await page.$('#duel .dl-wait .dl-deciding')) && !(await page.$('#duel .dl-wait button')),
    '기다림 창 — 단추 대신 「상대방이 결정중입니다」');
  ok((await page.$$('#duel .dl-wait .dl-side')).length === 2, '〃 양쪽 판');
  await shot('wait');
  await page.waitForFunction(() => document.querySelector('#duel')?.getAttribute('data-view') !== 'wait', null, { timeout: 8_000 });
  ok(true, '〃 AI가 답하면 기다림 창이 걷힌다');

  ok(problems.length === 0, `페이지 오류 없음${problems.length ? ` — ${problems.slice(0, 3).join(' / ')}` : ''}`);
  console.log('\n✓ 완주');
} finally {
  await browser.close();
}
