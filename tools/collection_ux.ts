/**
 * 컬렉션 UX 확인 — 목록 · 정렬 · 검색 · 두루마리 · 칸 등록 · 완성 (2026-10-13, `Design/컬렉션_기획.md` §7)
 *
 *   SHOTS=<dir> [API_PORT=8797] node --experimental-strip-types --env-file=.env tools/collection_ux.ts
 *
 * 필요한 것: `npm run dev`(5173) · 새 코드의 `server-api`. `API_PORT`를 주면 브라우저의 계정 API 요청
 * (8787)을 그 포트로 돌린다 — 이미 떠 있는 낡은 서버를 내리지 않고 새 경로(`/collection/register`)를
 * 시험할 때 쓴다.
 *
 * 시험 계정을 Admin API로 만들고 계정을 서버 쪽에서 심는다 — **도원결의를 지금 바로 채울 수 있게**
 * (유비 · 관우 · 장비 여분 1장씩), 여포 컬렉션은 병기 · 아이템만 있고 카드는 보관함에 한 장(=본체뿐)으로,
 * 그리고 두 개는 이미 완성 · 하나는 등록 중으로. 끝나면 계정을 지운다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { COLLECTIONS } from '@samchess/data';
import { forgeItemKey, newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const API_PORT = process.env['API_PORT'];
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';

const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);
const byTitle = (title: string) => COLLECTIONS.find((c) => c.title === title)!;

const email = `collection-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 700), height: Number(process.env['VH'] ?? 1100) },
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
if (API_PORT) {
  await page.route('http://localhost:8787/**', (route) =>
    route.continue({ url: route.request().url().replace('localhost:8787', `localhost:${API_PORT}`) }));
}
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const state = (sel: string) => page.getAttribute(sel, 'data-state');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', `수집실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  step('계정을 심는다 — 도원결의를 바로 채울 수 있게, 둘은 완성 · 하나는 등록 중');
  const stored = (await getProfile(uid))!;
  const DOWON = byTitle('도원결의');
  const LUBU = byTitle('인중여포 마중적토');
  const done1 = byTitle('황건적 토벌'); const done2 = byTitle('계교 전투');
  const part = byTitle('관도대전');
  // 칸이 가장 많은 컬렉션 — 셋은 등록됨 · 넷째는 낼 수 있음(여분 1장 = 보관함이면 본체라 2장) · 나머지는 막힘
  const MOST = [...COLLECTIONS].sort((a, b) => b.slots.length - a.slots.length)[0]!;
  const roster = { ...stored.roster };
  for (const id of ['yu-bi', 'gwan-u', 'jang-bi', 'jin-gung', 'go-sun'] as OfficerId[]) roster[id] = newInstance(id);
  await saveProfileTrusted(uid, {
    ...stored,
    roster,
    cards: { ...stored.cards, ['yu-bi' as OfficerId]: 1, ['gwan-u' as OfficerId]: 1, ['jang-bi' as OfficerId]: 1,
      ['yeo-po' as OfficerId]: 1, ['jin-gung' as OfficerId]: 2, [MOST.slots[3]!.id as OfficerId]: 2 },
    forgeOwned: { ...stored.forgeOwned, [forgeItemKey('bang-cheon-hwa-geuk', 1)]: null },
    marketOwned: { ...stored.marketOwned, 'jeok-to-ma': 1 },
    collection: {
      slots: {
        [done1.id]: done1.slots.map((_, i) => i), [done2.id]: done2.slots.map((_, i) => i),
        [part.id]: [0, 1, 2], [MOST.id]: [0, 1, 2],
      },
      completedAt: { [done1.id]: Date.now() - 3600_000, [done2.id]: Date.now() - 60_000 },
    },
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });

  step('메인 → 대자보 → 컬렉션');
  await page.click('[data-place="ranking"]', { force: true });
  await page.waitForSelector('[data-screen="board"]', { timeout: 15_000 });
  await page.waitForSelector('.rk-loading', { state: 'detached', timeout: 15_000 }).catch(() => {});
  await shot('clx-00-board');
  await page.click('[data-action="collection"]');
  await page.waitForSelector('[data-screen="collection"]');
  await shot('clx-01-list');
  if (await state(`[data-collection="${done1.id}"]`) !== 'done') fail('완성한 컬렉션이 「완료」로 안 그려진다');
  if (await state(`[data-collection="${DOWON.id}"]`) !== 'none') fail('도원결의가 「등록 전」이 아니다');
  ok('목록 — 상태 셋(none · done)이 속성으로 선다');

  step('목록 전 쪽 — 한글 제목이 줄에 드는가 · 한 쪽이 판에 드는가 (2026-10-14 세 줄 줄)');
  {
    const pages = Number(await page.getAttribute('[data-field="collection-pager"]', 'data-pages'));
    const cut: string[] = [];
    let seen = 0, worstOver = 0, fullPages = 0;
    for (let p = 1; p <= pages; p++) {
      if (p > 1) {
        await page.click('[data-field="collection-pager"] [data-dir="next"]');
        await page.waitForSelector(`[data-field="collection-pager"][data-page="${p}"]`);
      }
      const m = await page.evaluate(() => {
        const box = document.querySelector('.clx-rows') as HTMLElement;
        const rows = [...box.querySelectorAll('.clx-row')];
        return {
          n: rows.length,
          over: box.scrollHeight - box.clientHeight,
          cut: rows.map((r) => r.querySelector('.clx-title') as HTMLElement)
            .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent ?? ''),
        };
      });
      seen += m.n;
      cut.push(...m.cut);
      if (m.n === 5) { fullPages++; worstOver = Math.max(worstOver, m.over); }
    }
    if (seen !== COLLECTIONS.length) fail(`쪽을 다 넘겨 본 줄이 ${seen}개다 — ${COLLECTIONS.length}개여야 한다`);
    if (fullPages === 0) fail('다섯 줄이 찬 쪽이 하나도 없다 — 넘침을 잴 수 없다');
    if (worstOver > 0) fail(`다섯 줄이 판을 ${worstOver}px 넘친다 — 한 쪽 줄 수를 줄여야 한다`);
    if (cut.length) fail(`제목이 줄에서 잘린다 ${cut.length}건 — ${cut.join(' · ')}`);
    ok(`${pages}쪽 ${seen}줄 — 잘린 제목 0 · 다섯 줄 쪽 ${fullPages}개 넘침 0`);
    await page.click('[data-field="collection-pager"] [data-dir="first"]');
    await page.waitForSelector('[data-field="collection-pager"][data-page="1"]');
    await shot('clx-01a-list-lines');
  }

  step('[랭킹 보기] — 서버 1~10등 · 내 도시 줄');
  // 시험 계정은 둘을 완성해 두어 점수가 0이 아니다 — 반드시 줄에 선다(점수 0은 안 선다)
  await page.waitForFunction(() => !document.querySelector('[data-field="rank"]')?.textContent?.includes('…'), null, { timeout: 15_000 });
  const rankLabel = (await page.textContent('[data-field="rank"]'))?.trim();
  if (!/\d+위/.test(rankLabel ?? '')) fail(`상단 판 순위가 숫자가 아니다 — ${rankLabel}`);
  await page.click('[data-action="collectionRanking"]');
  await page.waitForSelector('[data-modal="collection-ranking"] .clx-rank-row[data-mine="1"]', { timeout: 15_000 });
  const topN = await page.$$eval('[data-modal="collection-ranking"] .clx-rank-row[data-rank]', (rs) => rs.length);
  await shot('clx-01b-ranking');
  ok(`순위 ${rankLabel} · 팝업 ${topN}줄(내 줄 포함)`);
  await page.click('[data-action="closeCollectionRanking"]');
  await page.waitForSelector('[data-modal="collection-ranking"]', { state: 'detached' });

  step('달성조건순 — 바로 채울 수 있는 도원결의가 맨 앞');
  await page.click('[data-action="sortMenu"]');
  await page.click('.rk-pop [data-value="reach"]');
  await page.waitForTimeout(300);
  const first = await page.getAttribute('.clx-list .clx-row >> nth=0', 'data-collection');
  if (first !== DOWON.id) fail(`달성조건순 첫 줄이 도원결의가 아니다 — ${first}`);
  ok('달성조건순 첫 줄 = 도원결의');
  await shot('clx-02-reach');

  step('검색 — 「여포」');
  await page.fill('[data-field="search"]', '여포');
  await page.waitForTimeout(200);
  const hits = await page.$$eval('.clx-row', (rs) => rs.length);
  if (hits < 3) fail(`여포로 찾은 줄이 ${hits}개뿐이다`);
  ok(`여포 검색 ${hits}줄 (한 쪽)`);
  await shot('clx-03-search');
  await page.fill('[data-field="search"]', '');

  step('두루마리 — 인중여포 마중적토 (카드는 보관함 본체뿐 → 막힘, 병기 · 아이템은 낼 수 있음)');
  await page.fill('[data-field="search"]', '인중여포');
  await page.click(`[data-collection="${LUBU.id}"]`);
  await page.waitForSelector('.clx-paper[data-show="1"]', { timeout: 5000 });
  await page.waitForTimeout(900);
  await shot('clx-04-lubu');
  const lubuStates = await page.$$eval('.clx-slot', (bs) => bs.map((b) => b.getAttribute('data-slot-state')));
  if (lubuStates[0] !== 'blocked') fail(`보관함 본체뿐인 여포 카드가 막히지 않았다 — ${lubuStates}`);
  if (!lubuStates.includes('ready')) fail('병기 · 아이템 칸이 「낼 수 있음」이 아니다');
  ok(`여포 칸 상태 ${lubuStates.join(' · ')}`);
  await page.click('[data-action="closeCollection"]');
  await page.waitForSelector('[data-modal="collection"]', { state: 'detached', timeout: 5000 });
  await page.fill('[data-field="search"]', '');

  step('도원결의 — 세 칸을 차례로 등록해 완성');
  await page.fill('[data-field="search"]', '도원');
  await page.click(`[data-collection="${DOWON.id}"]`);
  await page.waitForSelector('.clx-paper[data-show="1"]');
  await page.waitForTimeout(900);
  await shot('clx-05-dowon-before');
  for (let i = 0; i < 3; i++) {
    await page.click(`.clx-slot[data-slot="${i}"]`);
    await page.waitForSelector('[data-modal="collection-register"]');
    if (i === 0) await shot('clx-06-ask');
    await page.click('[data-action="confirmRegister"]');
    await page.waitForSelector('[data-modal="collection-register"]', { state: 'detached', timeout: 15_000 });
    const st = await page.getAttribute(`.clx-slot[data-slot="${i}"]`, 'data-slot-state');
    if (st !== 'done') fail(`${i}번 칸이 등록 뒤 done이 아니다 — ${st}`);
  }
  await page.waitForSelector('.clx-paper[data-state="done"] [data-field="complete"]');
  await page.waitForTimeout(500);
  await shot('clx-07-dowon-done');
  ok('세 칸 등록 → 등록 완료 · 낙관');

  const after = (await getProfile(uid))!;
  if (after.collection?.completedAt[DOWON.id] === undefined) fail('서버 계정에 완성 시각이 없다');
  if ((after.cards['yu-bi' as OfficerId] ?? 0) !== 0) fail('유비 여분 카드가 안 줄었다');
  if (!after.roster['yu-bi' as OfficerId]) fail('유비 본체가 사라졌다');
  ok('서버 계정 — 완성 시각 · 카드 소모 · 본체 그대로');

  await page.click('[data-action="closeCollection"]');
  await page.waitForSelector('[data-modal="collection"]', { state: 'detached', timeout: 5000 });
  await page.fill('[data-field="search"]', '');
  await shot('clx-08-list-after');

  step('가장 긴 상세 설명 · 가장 많은 칸 — 종이 안에 드는가');
  const LONGEST = [...COLLECTIONS].sort((a, b) => b.lore.length - a.lore.length)[0]!;
  for (const [tag, c] of [['longest', LONGEST], ['most-slots', MOST]] as const) {
    await page.fill('[data-field="search"]', c.title);
    await page.click(`[data-collection="${c.id}"]`);
    await page.waitForSelector('.clx-paper[data-show="1"]');
    await page.waitForTimeout(1200);
    await shot(`clx-09-${tag}`);
    // 넘치면 종이 안쪽만 굴린다(기획 §7.2) — 실패가 아니라 얼마나 넘치는지를 적는다
    const over = await page.$eval('.clx-paper-body', (el) => el.scrollHeight - el.clientHeight);
    ok(`${c.title} — 상세 설명 ${c.lore.length}자 · 칸 ${c.slots.length} · 넘침 ${over}px`);
    await page.click('[data-action="closeCollection"]');
    await page.waitForSelector('[data-modal="collection"]', { state: 'detached', timeout: 5000 });
  }
  await page.fill('[data-field="search"]', '');

  if (errors.length) fail(`콘솔 오류 ${errors.length}건:\n${errors.join('\n')}`);
  console.log('\n완주 — 문제 없음');
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  await shot('clx-99-fail').catch(() => {});
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  const { deleteProfile } = await import('../packages/server-api/src/profileStore.ts');
  await deleteProfile(uid).catch(() => {});
  process.exit();
}
