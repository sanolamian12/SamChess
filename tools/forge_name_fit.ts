/**
 * 대장간 제작 목록 **카드 이름표가 언어별로 견디는가**를 실측한다 (2026-09-10).
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/forge_name_fit.ts
 *
 * 이름표는 한 줄(`.frg-tile-name` — `nowrap` + `text-overflow: ellipsis`)이라
 * **길면 넘치지 않고 잘린다.** 넘쳤으면 레이아웃이 깨져서라도 눈에 띄는데, 잘리면
 * 화면은 아무 말도 안 하고 「…」만 남는다 — 그래서 **글자 폭(`scrollWidth`)과
 * 보이는 폭(`clientWidth`)을 재서** 잘림을 잡는다(「있는가」가 아니라 「제자리에
 * 있는가」의 사촌이다).
 *
 * 대장간 Lv5를 심어 15종을 전부 띄우고, 언어를 돌아가며 한 쪽씩 잰다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const LANGS = (process.env['LANGS'] ?? 'ko,en,ja,zh_Hant,pt_BR,it,es_419,mn').split(',');

const email = `forge-fit-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
});
page.on('dialog', (d) => void d.accept());

type Row = { lang: string; page: number; name: string; text: number; box: number; clipped: boolean;
  plateH?: number; dy?: number };

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  // 입력칸은 이제 [입장] 팝업 안이다(2026-09-11, `LoginModal`) — 먼저 팝업을 연다
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', '이름측정');
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  // 대장간 Lv5 — **`?forgeLevel=`이 아니라 진짜 계정 상태로** 심는다. 15종이
  // 전부 목록에 떠야 가장 긴 이름(수면탄두연환개 계열)이 실제로 그려진다.
  const stored = await getProfile(uid);
  await saveProfileTrusted(uid, {
    ...stored!, gold: 500, cityLevel: 11,
    buildings: { ...stored!.buildings, forge: 5 },
  } as Parameters<typeof saveProfileTrusted>[1]);

  const rows: Row[] = [];
  for (const lang of LANGS) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    if (lang !== 'ko') {
      await page.click('[data-action="settings"]');
      await page.waitForSelector(`[data-modal="settings"] [data-lang="${lang}"]`, { timeout: 5_000 });
      await page.click(`[data-modal="settings"] [data-lang="${lang}"]`);
      await page.waitForTimeout(250);
      // **팝업을 닫고 나가야 한다** — 열린 채로는 `.modal-back`이 성 밖 화살표
      // 클릭을 가로챈다(고르기만 하면 안 닫힌다)
      await page.click('[data-action="settingsClose"]');
      await page.waitForTimeout(200);
    }
    await page.click('.city-gate rect');
    await page.waitForSelector('[data-place="forge"]');
    await page.click('[data-place="forge"]');
    await page.waitForSelector('[data-action="craft"]');
    if (await page.$('[data-action="ackDone"]')) await page.click('[data-action="ackDone"]');
    await page.click('[data-action="craft"]');
    await page.waitForSelector('.frg-tile');

    for (let pg = 1; ; pg += 1) {
      await page.waitForTimeout(250);
      const got = await page.evaluate(() => [...document.querySelectorAll('.frg-tile-name')].map((el) => {
        const e = el as HTMLElement;
        /*
         * **가운데에 있는가도 함께 잰다** (2026-09-10) — 높이를 글자 쪽에 걸었더니
         * 한 줄짜리 이름이 상자 위쪽에 붙어 나무 판과 글자의 중심이 어긋났는데,
         * 잘림 검사(`scrollHeight > clientHeight`)는 그때도 전부 통과했다.
         * 「들어가는가」와 「가운데 있는가」는 다른 검사다.
         */
        const plate = e.closest('.frg-tile-nameplate') as HTMLElement;
        const er = e.getBoundingClientRect();
        const pr = plate.getBoundingClientRect();
        return {
          plateH: +pr.height.toFixed(1),
          // 글자 상자의 중심 − 명패의 중심. 0이면 정확히 가운데다
          dy: +((er.top + er.height / 2) - (pr.top + pr.height / 2)).toFixed(1),
          name: (e.textContent ?? '').trim(),
          // 두 줄 접기(`line-clamp`)로 바뀐 뒤로는 **세로가 잘림의 척도다** —
          // 가로는 이제 절대 안 넘치고(`white-space: normal`), 셋째 줄이 생겨야 잘린다
          text: e.scrollHeight,
          box: e.clientHeight,
        };
      }));
      for (const g of got) rows.push({ lang, page: pg, ...g, clipped: g.text > g.box + 1 });
      await page.screenshot({ path: `${SHOTS}/fit-${lang}-p${pg}.png` });
      // 상세 패널 명패도 같은 위험이 있다 — 쪽마다 첫 칸을 열어 재고 닫는다.
      // **쪽마다** 여는 이유는 효과 줄이 등급마다 다르기 때문이다 — 가장 긴
      // 문장(무기 Lv5 「결정타 +30%p, 평타 피해 +1 (결정타는 +2)」)은 2쪽에 있다.
      // **그 쪽의 첫 칸과 마지막 칸을 다 연다** — 한 쪽에 등급이 둘 섞여 있어
      // (2쪽 = Lv4 + Lv5) 첫 칸만 보면 더 긴 Lv5 문장을 영영 못 본다
      for (const nth of [0, -1]) {
        const tiles = await page.$$('.frg-tile');
        const tile = nth === 0 ? tiles[0]! : tiles[tiles.length - 1]!;
        await tile.click();
        await page.waitForSelector('[data-action="startOrder"]');
        await page.waitForTimeout(250);
        const d = await page.evaluate(() => {
          const e = document.querySelector('.frg-item-title') as HTMLElement | null;
          const eff = document.querySelector('.frg-item-effect') as HTMLElement | null;
          if (!e) return null;
          return {
            name: (e.textContent ?? '').trim(),
            text: e.scrollHeight, box: e.clientHeight,
            // 효과 줄도 같은 잣대로 — 넘치면 가로 스크롤이나 잘림이 난다
            effText: (eff?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            effW: eff?.scrollWidth ?? 0, effBox: eff?.clientWidth ?? 0,
            effH: eff?.scrollHeight ?? 0, effBoxH: eff?.clientHeight ?? 0,
          };
        });
        if (d) {
          rows.push({ lang, page: 0, name: d.name, text: d.text, box: d.box, clipped: d.text > d.box + 1 });
          const bad = d.effW > d.effBox + 1 || d.effH > d.effBoxH + 1;
          // 효과 줄은 자유 줄바꿈이라 **잘리지 않는다** — 보는 것은 「몇 줄인가」다
          const lines = Math.round(d.effH / 25);
          console.log(`      ${lines > 1 ? '✗' : '✓'} 효과 줄(${pg}쪽) ${lines}줄 「${d.effText}」 폭 ${d.effW}px / 칸 ${d.effBox}px`);
        }
        await page.screenshot({ path: `${SHOTS}/fit-${lang}-detail-p${pg}-${nth === 0 ? 'first' : 'last'}.png` });
        await page.click('[data-action="closeDetail"]');
        await page.waitForTimeout(200);
      }
      const next = await page.$('[data-action="nextPage"]');
      if (!next || !(await next.isEnabled())) break;
      const before = await page.$eval('.frg-tile-name', (e) => e.textContent);
      await next.click();
      await page.waitForTimeout(300);
      const after = await page.$eval('.frg-tile-name', (e) => e.textContent);
      if (before === after) break;
    }
  }

  console.log('\n언어별 — 잘린 칸 / 전체, 가장 빠듯한 이름');
  for (const lang of LANGS) {
    const mine = rows.filter((r) => r.lang === lang);
    const clipped = mine.filter((r) => r.clipped);
    // **가장 넘치는 칸이 아니라 가장 높은 칸**을 고른다 — 잘림이 0이면 차이가
    // 전부 0이라 예전 식은 그냥 첫 칸을 집었다(「최악 「대감도」」가 그것이다).
    // 글자 높이는 곧 줄 수라, 이 값이 「두 줄짜리가 남았는가」에 답한다.
    const worst = mine.reduce((a, b) => (b.text > a.text ? b : a), mine[0]!);
    const flag = clipped.length ? '✗' : '✓';
    console.log(
      `  ${flag} ${lang.padEnd(8)} 잘림 ${String(clipped.length).padStart(2)}/${mine.length}` +
      `  · 최악 「${worst.name}」 글자 높이 ${worst.text}px / 칸 ${worst.box}px` +
      (clipped.length ? `\n      잘린 것 — ${clipped.map((c) => c.name).join(', ')}` : ''),
    );
    const tiles = mine.filter((r) => r.plateH !== undefined);
    const offs = tiles.filter((r) => Math.abs(r.dy!) > 1);
    const heights = [...new Set(tiles.map((r) => r.plateH!))].sort((a, b) => a - b);
    // 한 줄 높이 = 가장 낮은 글자 상자. 그보다 큰 칸이 두 줄 이상이다
    const oneLine = Math.min(...tiles.map((r) => r.text));
    const twoLine = tiles.filter((r) => r.text > oneLine + 1);
    console.log(
      `      명패 높이 ${heights.join(' / ')}px · 가운데 아닌 칸 ${offs.length}/${tiles.length}`
      + `
      두 줄 이상인 칸 ${tiles.filter((r) => r.text > oneLine + 1).length}/${tiles.length}`
      + (twoLine.length ? ` — ${twoLine.map((r) => r.name).join(', ')}` : '')
      + (offs.length ? ` (최대 ${Math.max(...offs.map((o) => Math.abs(o.dy!))).toFixed(1)}px 치우침)` : ''),
    );
  }
} catch (e) {
  console.error('✗', e);
  await page.screenshot({ path: `${SHOTS}/fit-fail.png` });
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  process.exit(0);
}
