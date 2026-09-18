/**
 * 궁궐 현황 판 · 도시 관리 상단 확인 (2026-09-18)
 *
 * 궁궐 — 도시 이름(가운데) + [이름 변경](오른쪽 벽, 붉은 목판) · 2×2 왼쪽 정렬
 *        (도시 Lv · 황제 / 궁궐 Lv · 등용 장수).
 * 도시 관리 — 이름·황제 줄이 없고, 자재 줄 「75 / 25 (증축 조건 충족)」, 막힌 이유는
 *        [도시 증축] 바로 밑이며 **화면 언어로** 뜬다, 명령 판은 화면 바닥.
 *
 *   VW=760 VH=1200 SHOTS=<dir> [LANG_UI=mn] node --experimental-strip-types --env-file=.env tools/palace_ux.ts
 *
 * 새 계정은 도시 Lv1 · 궁궐 Lv1 · 자재 0 · 황제 부재라 **두 레벨이 같은 숫자**다 — 왼쪽과
 * 오른쪽을 바꿔 그려도 안 보인다. 그래서 도시 Lv4 · 궁궐 Lv2 · 자재 75 · 헌제 보유로 심는다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { newInstance, poolCap, poolUsed, upgradeCost } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const LANG = process.env['LANG_UI'] ?? '';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

const email = `palace-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env['VW'] ?? 760), height: Number(process.env['VH'] ?? 1200) },
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  if (LANG) await page.evaluate((l) => localStorage.setItem('samchess.lang', l), LANG);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    await page.fill('.scr-new .newgame-form input', '궁궐실험');
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  const stored = (await getProfile(uid))!;
  const emperor = OFFICERS.find((o) => o.grade === 'E')!.id as OfficerId;
  const seeded = {
    ...stored,
    cityLevel: 4,
    materials: 75,
    buildings: { ...stored.buildings, palace: 2 },
    roster: { ...stored.roster, [emperor]: newInstance(emperor) },
  } as Parameters<typeof saveProfileTrusted>[1];
  await saveProfileTrusted(uid, seeded);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.waitForSelector('.scr-place-palace [data-field="palaceStatus"]');
  await page.screenshot({ path: `${SHOTS}/palace-01.png` });

  const got = await page.evaluate(() => {
    const txt = (f: string) => document.querySelector(`[data-field="palaceStatus"] [data-field="${f}"]`)?.textContent ?? '';
    const cells = [...document.querySelectorAll('.plc-grid .plc-cell')].map((e) => (e as HTMLElement).dataset.field);
    const nm = document.querySelector('.plc-name-row [data-field="cityName"]')?.getBoundingClientRect();
    const panel = document.querySelector('[data-field="palaceStatus"]')?.getBoundingClientRect();
    return {
      cells, city: txt('cityLevel'), palace: txt('palaceLevel'), pool: txt('pool'),
      emperor: (document.querySelector('[data-field="palaceStatus"] [data-field="emperor"]') as HTMLElement | null)?.dataset.emperor,
      renameInRow: !!document.querySelector('.plc-name-row [data-action="rename"]'),
      // [이름 변경]이 판 오른쪽 벽에 붙었는가 — 판 안쪽 오른쪽 끝과 단추 오른쪽 끝의 차이
      renameGap: (() => {
        const b = document.querySelector('.plc-name-row [data-action="rename"]')?.getBoundingClientRect();
        const row = document.querySelector('.plc-name-row')?.getBoundingClientRect();
        return b && row ? Math.round(row.right - b.right) : 999;
      })(),
      renameArt: getComputedStyle(document.querySelector('.plc-name-row [data-action="rename"]')!).borderImageSource,
      // 왼쪽 정렬 — 같은 단의 두 칸이 왼쪽 끝을 맞추는가
      leftEdges: [...document.querySelectorAll('.plc-grid .plc-cell')].map((e) => Math.round(e.getBoundingClientRect().left)),
      // 이름이 **판의 한가운데**인가 — 단추가 옆에 있어도 이름을 밀면 안 된다
      nameOffset: nm && panel ? Math.round((nm.left + nm.width / 2) - (panel.left + panel.width / 2)) : 999,
    };
  });
  console.log('   ', JSON.stringify(got));
  if (got.cells.join(',') !== 'cityLevel,emperor,palaceLevel,pool') fail(`네 칸 차례가 다르다 — ${got.cells.join(',')}`);
  if (!/4/.test(got.city) || /2/.test(got.city)) fail(`첫 칸이 도시 Lv4가 아니다 — "${got.city}"`);
  if (!/2/.test(got.palace)) fail(`아랫줄 첫 칸이 궁궐 Lv2가 아니다 — "${got.palace}"`);
  const [l0, l1, l2, l3] = got.leftEdges;
  if (l0 !== l2 || l1 !== l3) fail(`두 단이 왼쪽 끝을 맞추지 않는다 — ${got.leftEdges.join(',')}`);
  if (got.renameGap > 2) fail(`[이름 변경]이 오른쪽 벽에서 ${got.renameGap}px 떨어져 있다`);
  if (!got.renameArt.includes('btn-forcedcancel')) fail(`[이름 변경]이 붉은 목판이 아니다 — ${got.renameArt}`);
  if (!got.pool.includes(`${poolUsed(seeded)} / ${poolCap(seeded)}`)) fail(`등용 장수 칸이 다르다 — "${got.pool}"`);
  if (got.emperor !== '1') fail('헌제를 심었는데 황제가 부재다');
  if (!got.renameInRow) fail('[이름 변경]이 도시 이름 줄에 없다');
  if (Math.abs(got.nameOffset) > 4) fail(`도시 이름이 가운데가 아니다 — ${got.nameOffset}px 어긋남`);
  ok('이름(가운데)+[이름 변경] · 도시 Lv4 · 궁궐 Lv2 · 등용 장수 · 황제 옹립');

  // [이름 변경] 팝업이 **화면 가운데**에 뜨는가 — 판 안에 두면 판에 갇힌다(「있는가」와 「제자리인가」는 다른 검사)
  await page.click('[data-field="palaceStatus"] [data-action="rename"]');
  await page.waitForSelector('[data-modal="rename"] .modal');
  const pos = await page.evaluate(() => {
    const r = document.querySelector('[data-modal="rename"] .modal')!.getBoundingClientRect();
    return { mid: Math.round(r.top + r.height / 2), vh: window.innerHeight };
  });
  await page.screenshot({ path: `${SHOTS}/palace-02-rename.png` });
  if (Math.abs(pos.mid - pos.vh / 2) > pos.vh * 0.15) fail(`이름 변경 팝업이 화면 가운데가 아니다 — 중심 ${pos.mid} / 높이 ${pos.vh}`);
  await page.click('[data-action="renameCancel"]');
  ok('이름 변경 팝업이 화면 가운데에 뜬다');

  // 도시 관리 — 이름·황제 줄이 없고, 레벨 줄 오른쪽에 다음 레벨 자재, 이유는 [도시 증축] 밑
  await page.click('[data-action="city"]');
  await page.waitForSelector('[data-screen="city"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/palace-03-city.png` });
  const city = await page.evaluate(() => {
    const acts = document.querySelector('.scr-city .place-panel.cty-acts')?.getBoundingClientRect();
    const body = document.querySelector('.scr-city .place-body')?.getBoundingClientRect();
    const up = document.querySelector('[data-action="upgrade"]');
    const why = document.querySelector('.cty-whys');
    return {
      name: !!document.querySelector('.scr-city [data-field="cityName"]'),
      rename: !!document.querySelector('.scr-city [data-action="rename"]'),
      emperor: !!document.querySelector('.scr-city [data-field="emperor"]'),
      level: document.querySelector('.scr-city [data-field="level"] .v')?.textContent ?? '',
      materials: document.querySelector('.scr-city [data-field="materials"] .v')?.textContent ?? '',
      ready: !!document.querySelector('.scr-city [data-field="ready"]'),
      whyAfterUpgrade: !!up && !!why && up.nextElementSibling === why,
      why: document.querySelector('[data-field="why"]')?.textContent ?? '',
      whyCode: (document.querySelector('[data-field="why"]') as HTMLElement | null)?.dataset.code ?? '',
      // 명령 판이 본문 바닥에 붙었는가 — 본문 안쪽 여백(1rem ≈ 16px) 안이면 붙은 것이다
      actsGap: acts && body ? Math.round(body.bottom - acts.bottom) : 999,
    };
  });
  console.log('   ', JSON.stringify(city));
  if (city.name || city.rename || city.emperor) fail('도시 관리에 이름·[이름 변경]·황제 줄이 남아 있다');
  if (city.level.trim() !== 'Lv4') fail(`레벨 줄이 「Lv4」만이 아니다 — "${city.level}"`);
  if (city.materials.replace(/\s/g, '') !== `75/${upgradeCost(4)}`) fail(`자재 줄이 「75 / 25」가 아니다 — "${city.materials}"`);
  if (!city.ready) fail('자재가 다 모였는데 「(증축 조건 충족)」이 없다');
  if (city.why && !city.whyAfterUpgrade) fail('막힌 이유가 [도시 증축] 바로 밑이 아니다');
  if (city.why && !city.whyCode) fail('막힌 이유에 번역 코드가 없다');
  // 한국어가 아닌 화면에서 한국어 원문이 새지 않는가 — 이 검사를 넣은 까닭이다
  if (LANG && LANG !== 'ko' && /[가-힣]/.test(city.why)) fail(`${LANG} 화면에 한국어 이유가 뜬다 — "${city.why}"`);
  if (city.actsGap > 24) fail(`명령 판이 바닥에 안 붙었다 — 본문 끝에서 ${city.actsGap}px 위`);
  ok(`도시 관리 — Lv4 · 자재 「${city.materials}」 + 충족 · 이유 「${city.why}」 · 명령 판 바닥(${city.actsGap}px)`);

  // 자재가 모자라면 「(증축 조건 충족)」이 **없어야** 한다 — 있을 때만 보면 늘 띄워도 통과한다
  await saveProfileTrusted(uid, { ...seeded, materials: 5 } as Parameters<typeof saveProfileTrusted>[1]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.waitForSelector('[data-action="city"]');
  await page.click('[data-action="city"]');
  await page.waitForSelector('[data-screen="city"]');
  await page.waitForTimeout(300);
  if (await page.$('.scr-city [data-field="ready"]')) fail('자재가 5인데 「(증축 조건 충족)」이 뜬다');
  ok('자재가 모자라면 「(증축 조건 충족)」이 없다');

  // 건물 관리 — 바닥 명령 판의 [뒤로 가기]가 도시 관리로 돌아가는가 (2026-09-18)
  await page.click('[data-action="buildings"]');
  await page.waitForSelector('[data-screen="buildings"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/palace-04-buildings.png` });
  const bld = await page.evaluate(() => {
    const acts = document.querySelector('.scr-city .place-panel.cty-acts')?.getBoundingClientRect();
    const body = document.querySelector('.scr-city .place-body')?.getBoundingClientRect();
    return {
      back: document.querySelector('.cty-acts [data-action="backBottom"]')?.textContent ?? '',
      gap: acts && body ? Math.round(body.bottom - acts.bottom) : 999,
    };
  });
  if (!bld.back) fail('건물 관리 바닥에 [뒤로 가기]가 없다');
  if (bld.gap > 24) fail(`건물 관리 명령 판이 바닥에 안 붙었다 — ${bld.gap}px 위`);
  await page.click('.cty-acts [data-action="backBottom"]');
  await page.waitForSelector('[data-screen="city"]', { timeout: 5_000 });
  ok(`건물 관리 — 바닥 「${bld.back}」(${bld.gap}px) → 도시 관리로 돌아온다`);

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 궁궐 현황 판 완주');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
