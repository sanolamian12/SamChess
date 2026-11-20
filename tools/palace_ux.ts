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
import { shotDir } from './shotDir.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('palace_ux');   // 안 주면 OS 임시 폴더(저장소 맨 위에 쌓이지 않게)
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
    await page.fill('.scr-new .newgame-form input', `궁궐실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    // 가입 오프닝(대사 · 장수 W 대형, 약 14초)을 지나야 메인이다 — 끝의 [성 안으로 들어가기]
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 }); // 메인이 자리 잡는 1초 연출이 끝난 뒤
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  const stored = (await getProfile(uid))!;
  const emperor = OFFICERS.find((o) => o.grade === 'E')!.id as OfficerId;
  const seeded = {
    ...stored,
    cityLevel: 4,
    materials: 75,
    battleWins: 99,   // 누적 승리도 증축 조건이다(2026-11-14)
    buildings: { ...stored.buildings, palace: 2 },
    roster: { ...stored.roster, [emperor]: newInstance(emperor) },
  } as Parameters<typeof saveProfileTrusted>[1];
  await saveProfileTrusted(uid, seeded);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  // [이름 변경]은 메인 머리의 도시 이름 바로 오른쪽 — 글자 없는 둥근 배지 (2026-11-19 기획자, 궁궐 현황판에서 옮겼다)
  const mainRename = await page.evaluate(() => {
    const nm = document.querySelector('.scr-main .city-head [data-field="cityName"]')?.getBoundingClientRect();
    const b = document.querySelector<HTMLElement>('.scr-main .city-head [data-action="rename"]');
    const r = b?.getBoundingClientRect();
    return nm && b && r ? { gap: Math.round(r.left - nm.right), round: getComputedStyle(b).borderRadius, square: Math.round(r.width) === Math.round(r.height), text: b.innerText.trim() } : null;
  });
  if (!mainRename) fail('메인 머리에 도시 이름 · [이름 변경]이 없다');
  if (mainRename!.gap < 0 || mainRename!.gap > 20) fail(`[이름 변경]이 도시 이름 바로 오른쪽이 아니다 — 틈 ${mainRename!.gap}px`);
  if (mainRename!.round !== '50%' || !mainRename!.square || mainRename!.text) fail(`[이름 변경]이 글자 없는 둥근 배지가 아니다 — ${JSON.stringify(mainRename)}`);
  // [이름 변경] 팝업이 **화면 가운데**에 뜨는가 — 판 안에 두면 판에 갇힌다(「있는가」와 「제자리인가」는 다른 검사)
  await page.click('.scr-main [data-action="rename"]');
  await page.waitForSelector('[data-modal="rename"] .modal');
  const pos = await page.evaluate(() => {
    const r = document.querySelector('[data-modal="rename"] .modal')!.getBoundingClientRect();
    return { mid: Math.round(r.top + r.height / 2), vh: window.innerHeight };
  });
  await page.screenshot({ path: `${SHOTS}/palace-02-rename.png` });
  if (Math.abs(pos.mid - pos.vh / 2) > pos.vh * 0.15) fail(`이름 변경 팝업이 화면 가운데가 아니다 — 중심 ${pos.mid} / 높이 ${pos.vh}`);
  await page.click('[data-action="renameCancel"]');
  ok(`메인 [이름 변경] — 도시 이름 바로 오른쪽(틈 ${mainRename!.gap}px) 둥근 배지 · 팝업은 화면 가운데`);
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.waitForSelector('.scr-place-palace [data-field="palaceStatus"]');
  await page.screenshot({ path: `${SHOTS}/palace-01.png` });

  const got = await page.evaluate(() => {
    const txt = (f: string) => document.querySelector(`[data-field="palaceStatus"] [data-field="${f}"]`)?.textContent ?? '';
    const cells = [...document.querySelectorAll('.plc-grid .plc-cell')].map((e) => (e as HTMLElement).dataset.field);
    return {
      cells, city: (document.querySelector('[data-field="palaceStatus"] [data-field="cityLevel"]') as HTMLElement | null)?.dataset.level ?? '',
      // 도시 · 궁궐 두 줄의 배지가 세로로 줄을 맞추는가(2026-11-19 기획자) — 왼쪽 끝 차이
      badgeAlign: (() => { const a = document.querySelector('[data-field="cityLevel"] .city-badge')?.getBoundingClientRect(); const b = document.querySelector('[data-field="palaceLevel"] .bld-badge')?.getBoundingClientRect(); const ia = document.querySelector('[data-field="cityLevel"] .gic')?.getBoundingClientRect(); const ib = document.querySelector('[data-field="palaceLevel"] .gic')?.getBoundingClientRect(); if (ia && ib && Math.abs((ia.left + ia.right) - (ib.left + ib.right)) > 2) return 998; return a && b ? Math.round(Math.abs((a.left + a.right) - (b.left + b.right)) / 2) : 999; })(),   // 가운데끼리
      palace: (document.querySelector('[data-field="palaceStatus"] [data-field="palaceLevel"] .bld-lv') as HTMLElement | null)?.dataset.level ?? '', pool: txt('pool'),
      emperor: (document.querySelector('[data-field="palaceStatus"] [data-field="emperor"]') as HTMLElement | null)?.dataset.emperor,
      // 왼쪽 정렬 — 같은 단의 두 칸이 왼쪽 끝을 맞추는가
      leftEdges: [...document.querySelectorAll('.plc-grid .plc-cell')].map((e) => Math.round(e.getBoundingClientRect().left)),
    };
  });
  console.log('   ', JSON.stringify(got));
  if (got.cells.join(',') !== 'cityLevel,pool,palaceLevel,emperor') fail(`네 칸 차례가 다르다 — ${got.cells.join(',')}`);
  if (!/4/.test(got.city) || /2/.test(got.city)) fail(`첫 칸이 도시 Lv4가 아니다 — "${got.city}"`);
  if (got.badgeAlign > 1) fail(`도시 · 궁궐 레벨 배지가 세로로 안 맞는다 — ${got.badgeAlign}px`);
  if (!/2/.test(got.palace)) fail(`아랫줄 첫 칸이 궁궐 Lv2가 아니다 — "${got.palace}"`);
  const [l0, l1, l2, l3] = got.leftEdges;
  if (l0 !== l2 || l1 !== l3) fail(`두 단이 왼쪽 끝을 맞추지 않는다 — ${got.leftEdges.join(',')}`);
  if (!got.pool.includes(`${poolUsed(seeded)} / ${poolCap(seeded)}`)) fail(`등용 장수 칸이 다르다 — "${got.pool}"`);
  if (got.emperor !== '1') fail('헌제를 심었는데 황제가 부재다');
  if (await page.$('[data-field="palaceStatus"] [data-field="cityName"], [data-field="palaceStatus"] [data-action="rename"]')) fail('궁궐 현황판에 도시 이름 · [이름 변경]이 남아 있다(2026-11-19 메인으로 옮겼다)');
  ok('궁궐 현황판 — 도시 Lv4 · 궁궐 Lv2 · 장수 · 황제 옹립(이름 줄 없음)');


  // 도시 관리 — 이름·황제 줄이 없고, 레벨 줄 오른쪽에 다음 레벨 자재. [도시 증축]은 건물 관리로 옮겼다(2026-11-13 — 아래에서 본다)
  await page.click('[data-action="city"]');
  await page.waitForSelector('[data-screen="city"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/palace-03-city.png` });
  const city = await page.evaluate(() => {
    const acts = document.querySelector('.scr-city .place-panel.cty-acts')?.getBoundingClientRect();
    const body = document.querySelector('.scr-city .place-body')?.getBoundingClientRect();
    return {
      name: !!document.querySelector('.scr-city [data-field="cityName"]'),
      rename: !!document.querySelector('.scr-city [data-action="rename"]'),
      emperor: !!document.querySelector('.scr-city [data-field="emperor"]'),
      level: document.querySelector('.scr-city [data-field="level"] .v')?.textContent ?? '',
      materials: document.querySelector('.scr-city [data-field="materials"] .v')?.textContent ?? '',
      ready: !!document.querySelector('.scr-city [data-cond="materials"][data-ok="1"]'),
      upgradeHere: !!document.querySelector('.scr-city [data-action="upgrade"]'),
      // 명령 판이 본문 바닥에 붙었는가 — 본문 안쪽 여백(1rem ≈ 16px) 안이면 붙은 것이다
      actsGap: acts && body ? Math.round(body.bottom - acts.bottom) : 999,
    };
  });
  console.log('   ', JSON.stringify(city));
  if (city.name || city.rename || city.emperor) fail('도시 관리에 이름·[이름 변경]·황제 줄이 남아 있다');
  if (city.level.trim() !== 'Lv4') fail(`레벨 줄이 「Lv4」만이 아니다 — "${city.level}"`);
  if (city.materials.replace(/\s/g, '') !== `75/${upgradeCost(4)}`) fail(`자재 줄이 「75 / 25」가 아니다 — "${city.materials}"`);
  if (!city.ready) fail('자재가 다 모였는데 자재 조건 칸이 채움(초록)이 아니다');
  if (city.upgradeHere) fail('도시 관리에 아직 [도시 증축]이 있다 — 건물 관리로 옮겼다');
  if (city.actsGap > 24) fail(`명령 판이 바닥에 안 붙었다 — 본문 끝에서 ${city.actsGap}px 위`);
  ok(`도시 관리 — Lv4 · 자재 「${city.materials}」 + 충족 · [도시 증축] 없음 · 명령 판 바닥(${city.actsGap}px)`);

  // 자재가 모자라면 「(증축 조건 충족)」이 **없어야** 한다 — 있을 때만 보면 늘 띄워도 통과한다
  // 건설 기회 1 — 아래 건물 관리에서 확인 팝업을 열고 실제로 한 번 짓는다(그 뒤 0이 되어 잠김 안내가 뜬다)
  await saveProfileTrusted(uid, { ...seeded, materials: 5, buildCredits: 1 } as Parameters<typeof saveProfileTrusted>[1]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.waitForSelector('[data-action="city"]');
  await page.click('[data-action="city"]');
  await page.waitForSelector('[data-screen="city"]');
  await page.waitForTimeout(300);
  if (await page.$('.scr-city [data-cond="materials"][data-ok="1"]')) fail('자재가 5인데 자재 조건 칸이 채움으로 뜬다');
  ok('자재가 모자라면 자재 조건 칸이 채움(초록)이 아니다');

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
  // 줄은 「Lv1 → Lv2」 · 「없음 → Lv1」만 — 효과 문장은 확인 팝업이 말한다 (2026-11-12)
  const steps = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cty-bld')].map((el) =>
    [(el as HTMLElement).dataset.building, [...el.querySelectorAll('[data-field="step"] .bld-step > *')]
      .map((c) => (c.classList.contains('bld-badge') ? `Lv${(c as HTMLElement).dataset.level}` : c.textContent)).join(' ')])));   // 레벨은 배지 그림(2026-11-19)
  if (!/2/.test(steps.palace ?? '') || !(steps.palace ?? '').includes('→')) fail(`궁궐 줄이 「Lv2 → Lv3」이 아니다 — "${steps.palace}"`);
  if (!(steps.academy ?? '').includes('→ Lv1')) fail(`태학 줄이 「없음 → Lv1」이 아니다 — "${steps.academy}"`);
  if (await page.$('.cty-bld .fx')) fail('건물 관리 줄에 아직 효과 문장 칸이 있다');
  await page.click('.cty-bld[data-building="academy"] [data-action="build"]');
  await page.waitForSelector('[data-modal="buildAsk"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/palace-05-buildAsk.png` });
  const ask = await page.evaluate(() => ({
    step: [...document.querySelectorAll('[data-field="askStep"] .bld-step > *')]
      .map((c) => (c.classList.contains('bld-badge') ? `Lv${(c as HTMLElement).dataset.level}` : c.textContent)).join(' '),
    what: document.querySelector('[data-field="askWhat"]')?.textContent ?? '',
    cost: document.querySelector('[data-field="askCost"]')?.textContent ?? '',
  }));
  if (!ask.step.includes('→ Lv1') || !ask.what || !ask.cost.includes('-1')) fail(`짓기 확인 팝업이 비었다 — ${JSON.stringify(ask)}`);
  await page.click('[data-action="buildCancel"]');
  if (await page.$('[data-modal="buildAsk"]')) fail('[취소]를 눌렀는데 확인 팝업이 안 닫힌다');
  await page.click('.cty-bld[data-building="academy"] [data-action="build"]');
  await page.click('[data-action="buildConfirm"]');
  await page.waitForSelector('[data-modal="buildDone"]', { timeout: 10_000 });
  await page.click('[data-action="doneOk"]');
  await page.waitForSelector('.cel-back[data-leaving]', { state: 'detached', timeout: 5_000 });   // 축하 화면의 닫힘 연출(.36초)이 끝날 때까지
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const note = document.querySelector('[data-field="whyBuild"]');
    const first = document.querySelector('.cty-bld');
    return {
      lv: (document.querySelector('.cty-bld[data-building="academy"]') as HTMLElement | null)?.dataset.level,
      note: note?.textContent ?? '',
      // 잠김 안내는 머리줄 밑 — 첫 건물 줄보다 위
      above: !!(note && first && note.getBoundingClientRect().bottom <= first.getBoundingClientRect().top + 1),
    };
  });
  await page.screenshot({ path: `${SHOTS}/palace-06-buildings-after.png` });
  if (after.lv !== '1') fail(`[짓기]를 확인했는데 태학이 Lv1이 아니다 — ${after.lv}`);
  if (!after.note) fail('건설 기회를 다 썼는데 잠김 안내가 없다');
  // [도시 증축]은 이 화면 바닥 판에 — [뒤로 가기] 위 (2026-11-13). 자재 5라 막혀 있다. 막힌 이유는 내관이 말한다(2026-11-19).
  // 「건설 기회가 남았다」는 이유로 안 띄운다 — 머리의 「남은 건설 기회」(남았으면 붉은 글)가 말한다
  const upg = await page.evaluate(() => {
    const acts = document.querySelector('.scr-city .place-panel.cty-acts')!;
    const up = acts.querySelector('[data-action="upgrade"]');
    const back = acts.querySelector('[data-action="backBottom"]');
    return {
      up: !!up, before: !!(up && back && (up.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING)),
      disabled: (up as HTMLButtonElement | null)?.disabled ?? null,
      why: document.querySelector('.stw[data-say="why"] [data-field="guideText"]')?.textContent ?? '',
      whyCode: (document.querySelector('.stw[data-say="why"]') as HTMLElement | null)?.dataset.sayCode ?? '',
      // 판 안에 숨었다 나타나는 줄이 남지 않았다
      oldLine: !!acts.querySelector('.cty-whys, [data-field="why"]'),
    };
  });
  if (!upg.up || !upg.before) fail(`건물 관리 바닥에 [도시 증축]이 [뒤로 가기] 위에 없다 — ${JSON.stringify(upg)}`);
  if (upg.disabled !== true) fail('자재가 5인데 [도시 증축]이 눌린다');
  if (upg.oldLine) fail('막힌 이유가 아직 판 안의 줄로 뜬다');
  if (upg.whyCode === 'city.credits') fail('「건설 기회가 남았다」 이유가 아직 뜬다');
  if (upg.why && !upg.whyCode) fail('막힌 이유에 번역 코드가 없다');
  // 한국어가 아닌 화면에서 한국어 원문이 새지 않는가
  if (LANG && LANG !== 'ko' && /[가-힣]/.test(upg.why)) fail(`${LANG} 화면에 한국어 이유가 뜬다 — "${upg.why}"`);
  if (!after.above) fail('잠김 안내가 머리줄 밑(첫 건물 줄 위)이 아니다');
  ok(`건물 관리 — 줄 「${steps.palace}」 「${steps.academy}」 · 확인 팝업 「${ask.what}」 → 지음 · 안내 「${after.note}」`);

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
