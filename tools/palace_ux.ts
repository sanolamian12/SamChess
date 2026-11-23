/**
 * 궁궐 현황 판 · 도시 관리 상단 확인 (2026-09-18)
 *
 * 궁궐 — 도시 이름(가운데) + [이름 변경](오른쪽 벽, 붉은 목판) · 2×2 왼쪽 정렬
 *        (도시 Lv · 황제 / 궁궐 Lv · 등용 장수).
 * 도시 관리 — 이름·황제 줄이 없고, 자재 줄 「75 / 25」 + 조건 칸, [도시 증축]은 바닥 명령 판(2026-11-23),
 *        막힌 이유는 내관이 **화면 언어로** 말한다.
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


  // 도시 관리 — 이름·황제 줄이 없고, 레벨 줄 오른쪽에 다음 레벨 자재. [도시 증축]은 바닥 명령 판에(2026-11-23 — 건물 관리가 없어지며 돌아왔다)
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
      level: (document.querySelector('.scr-city [data-field="level"]') as HTMLElement | null)?.dataset['level'] ?? '',
      materials: document.querySelector('.scr-city [data-field="materials"]')?.textContent ?? '',
      // 건물 줄은 「그림 · 배지 · 이름」 셋만 — 현황 칸이 남았으면 실패 (2026-11-23 기획자)
      statusLeft: document.querySelectorAll('.scr-city .cty-bld .fx').length,
      backBottom: !!document.querySelector('.scr-city .cty-acts [data-action="backBottom"]'),
      ready: !!document.querySelector('.scr-city [data-cond="materials"][data-ok="1"]'),
      upgradeHere: !!document.querySelector('.scr-city .cty-acts [data-action="upgrade"]'),
      oldDoor: !!document.querySelector('[data-action="buildings"]'),
      // 명령 판이 본문 바닥에 붙었는가 — 본문 안쪽 여백(1rem ≈ 16px) 안이면 붙은 것이다
      actsGap: acts && body ? Math.round(body.bottom - acts.bottom) : 999,
    };
  });
  console.log('   ', JSON.stringify(city));
  if (city.name || city.rename || city.emperor) fail('도시 관리에 이름·[이름 변경]·황제 줄이 남아 있다');
  if (city.level !== '4') fail(`레벨 배지가 Lv4가 아니다 — "${city.level}"`);
  if (city.statusLeft) fail(`건물 줄에 현황 칸이 ${city.statusLeft}개 남았다`);
  if (!city.backBottom) fail('도시 관리 바닥에 [뒤로 가기]가 없다');
  if (city.materials.replace(/\s/g, '') !== `75/${upgradeCost(4)}`) fail(`자재 요건 칸이 「75/25」가 아니다 — "${city.materials}"`);
  if (!city.ready) fail('자재가 다 모였는데 자재 조건 칸이 채움(초록)이 아니다');
  if (!city.upgradeHere) fail('도시 관리 바닥에 [도시 증축]이 없다');
  if (city.oldDoor) fail('도시 관리에 옛 [건물 관리]가 남았다');
  if (city.actsGap > 24) fail(`명령 판이 바닥에 안 붙었다 — 본문 끝에서 ${city.actsGap}px 위`);
  ok(`도시 관리 — Lv4 배지 · 자재 요건 「${city.materials}」 + 충족 · 건물 줄 그림 · 배지 · 이름뿐 · [증축] · [뒤로 가기]가 바닥 판에(${city.actsGap}px)`);

  // 자재가 모자라면 자재 칸이 채움이 **아니어야** 한다 — 있을 때만 보면 늘 띄워도 통과한다. [도시 증축]은 막히고 이유는 내관이 말한다
  await saveProfileTrusted(uid, { ...seeded, materials: 5 } as Parameters<typeof saveProfileTrusted>[1]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.waitForSelector('[data-action="city"]');
  await page.click('[data-action="city"]');
  await page.waitForSelector('[data-screen="city"]');
  await page.waitForTimeout(300);
  if (await page.$('.scr-city [data-cond="materials"][data-ok="1"]')) fail('자재가 5인데 자재 조건 칸이 채움으로 뜬다');
  const upg = await page.evaluate(() => {
    const acts = document.querySelector('.scr-city .place-panel.cty-acts')!;
    const up = acts.querySelector('[data-action="upgrade"]') as HTMLButtonElement | null;
    return {
      disabled: up?.disabled ?? null,
      why: document.querySelector('.stw[data-say="why"] [data-field="guideText"]')?.textContent ?? '',
      whyCode: (document.querySelector('.stw[data-say="why"]') as HTMLElement | null)?.dataset.sayCode ?? '',
      // 판 안에 숨었다 나타나는 줄이 남지 않았다
      oldLine: !!acts.querySelector('.cty-whys, [data-field="why"]'),
    };
  });
  await page.screenshot({ path: `${SHOTS}/palace-04-city-short.png` });
  if (upg.disabled !== true) fail('자재가 5인데 [도시 증축]이 눌린다');
  if (upg.oldLine) fail('막힌 이유가 아직 판 안의 줄로 뜬다');
  if (upg.why && !upg.whyCode) fail('막힌 이유에 번역 코드가 없다');
  // 한국어가 아닌 화면에서 한국어 원문이 새지 않는가
  if (LANG && LANG !== 'ko' && /[가-힣]/.test(upg.why)) fail(`${LANG} 화면에 한국어 이유가 뜬다 — "${upg.why}"`);
  ok(`자재가 모자라면 — 자재 칸 채움 아님 · [도시 증축] 막힘 · 이유 「${upg.why || '(자재 — 조건 칸이 말한다)'}」`);

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 궁궐 현황 판 완주');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
