/**
 * 병원 UX 확인 — 운영 현황판 · 입원 팝업 · 개발용 강제 부상 (트랙 11h, 2026-09-18)
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/hospital_ux.ts
 *
 * server-api의 개발용 지급(`SAMCHESS_DEV_GRANTS=1`)이 **켜져 있으면** 「장수 3명 부상시키기」 단추로,
 * **꺼져 있으면** 서버 쪽에서 직접 부상을 심는다 — 어느 쪽이든 **개발용 줄이 스위치와 똑같이
 * 보이거나 숨는가**를 먼저 본다(꺼진 서버에서 단추가 남아 있던 것을 기획자가 짚었다, 2026-09-18).
 *
 * 새 계정에는 병원도 부상도 없어 현황판의 세 갈래(치료 중 · 쿨타임 · 비었음)가 **하나도 안
 * 그려진다.** 그래서 병원 Lv3 · 부상 둘 · **환자 없는 쿨타임 방 하나**를 서버 쪽에서 심고 돈다.
 * 쿨타임 방을 따로 심는 까닭은 치료 1분이 지나야 저절로 생기는 상태라서다(기다리면 느리다).
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { ROOM_CYCLE_MS, applyInjuries, newInstance } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:8787';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const LANG = process.env['LANG_UI'] ?? '';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

const email = `hospital-ux-${randomUUID()}@samchess.test`;
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
page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname !== '/profile') errors.push(`404 ${new URL(r.url()).pathname}`); });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const wardStates = () => page.$$eval('.hsp-ward', (rows) => rows.map((r) => `${(r as HTMLElement).dataset.state}:${r.textContent}`));

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
    await page.fill('.scr-new .newgame-form input', `병원실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  step('병원 Lv3 · 장수 10명 · 부상 둘(50분 전 · 방금) · 환자 없는 쿨타임 방 하나를 심는다');
  const stored = await getProfile(uid);
  const roster = { ...stored!.roster } as Record<string, ReturnType<typeof newInstance>>;
  for (const o of OFFICERS.filter((o) => o.grade !== 'E').slice(0, 10)) {
    if (!roster[o.id]) roster[o.id] = newInstance(o.id as OfficerId);
  }
  const own = Object.keys(roster);
  const now = Date.now();
  roster[own[0]!] = { ...roster[own[0]!]!, injuredAt: now - 50 * 60_000 };
  roster[own[1]!] = { ...roster[own[1]!]!, injuredAt: now };
  await saveProfileTrusted(uid, {
    ...stored!,
    cityLevel: 5,
    buildings: { ...stored!.buildings, hospital: 3 },
    roster,
    // 3분 전에 누군가 치료를 시작해 이미 나간 방 — 남은 쿨타임 약 3분
    hospitalBusy: [now - 3 * 60_000 + ROOM_CYCLE_MS],
  } as Parameters<typeof saveProfileTrusted>[1]);
  ok(`장수 ${own.length}명`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.city-gate rect');
  await page.waitForSelector('[data-place="hospital"]');
  await page.click('[data-place="hospital"]');
  await page.waitForSelector('.scr-building-hospital .hsp-ward');
  await shot('hsp-01-home');
  let wards = await wardStates();
  console.log('   ', wards.join(' | '));
  if (wards.length !== 3) fail(`병원 Lv3인데 치료실 줄이 ${wards.length}개다`);
  if (!wards[0]!.startsWith('cooldown')) fail('심어 둔 쿨타임 방이 맨 위가 아니다');
  if (wards.filter((w) => w.startsWith('empty')).length !== 2) fail('빈 방이 둘이 아니다');
  ok('치료실 셋 — 쿨타임 하나 · 비었음 둘');
  if (!await page.$('[data-action="admit"].primary:not([disabled])')) fail('입원할 수 있는데 [입원시키기]가 옥색 목판이 아니다');
  if (await page.$('[data-action="backBottom"]')) fail('판 아래 [뒤로 가기]가 아직 있다');
  ok('[입원시키기]는 옥색 · 판 아래 [뒤로 가기] 없음');

  const grants = ((await (await fetch(`${API}/dev/status`)).json()) as { grants: boolean }).grants;
  await page.waitForTimeout(1_500); // 화면이 `/dev/status`를 물어 올 시간
  const devShown = !!await page.$('[data-dev="injure"]');
  if (devShown !== grants) fail(`개발용 지급 ${grants ? '켜짐' : '꺼짐'}인데 개발용 줄이 ${devShown ? '보인다' : '안 보인다'}`);
  ok(`개발용 줄이 스위치(${grants ? '켜짐' : '꺼짐'})와 같이 ${devShown ? '보인다' : '숨는다'}`);

  step(grants ? '개발용 — 장수 3명 부상시키기' : '스위치가 꺼져 있다 — 서버 쪽에서 셋을 더 다치게 한다');
  const injuredBefore = await page.textContent('[data-field="injured"]');
  if (grants) {
    await page.click('[data-dev="injure"]');
  } else {
    const cur = (await getProfile(uid))!;
    await saveProfileTrusted(uid, applyInjuries(cur, own.slice(2, 5) as OfficerId[], Date.now()));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
    await page.click('.city-gate rect');
    await page.waitForSelector('[data-place="hospital"]');
    await page.click('[data-place="hospital"]');
    await page.waitForSelector('.scr-building-hospital .hsp-ward');
  }
  await page.waitForFunction((b) => document.querySelector('[data-field="injured"]')?.textContent !== b, injuredBefore, { timeout: 10_000 });
  const injuredAfter = await page.textContent('[data-field="injured"]');
  ok(`${injuredBefore} → ${injuredAfter}`);

  step('입원 팝업 — 자연 회복 남은 시간(분 단위)');
  await page.click('[data-action="admit"]');
  await page.waitForSelector('[data-modal="hospitalPick"] .hsp-row');
  await shot('hsp-02-pick');
  const lefts = await page.$$eval('.hsp-row [data-field="left"]', (els) => els.map((e) => e.textContent ?? ''));
  console.log('   ', lefts.join(' | '));
  if (lefts.length !== 5) fail(`부상 다섯이어야 하는데 ${lefts.length}줄이다`);
  if (lefts.some((l) => /초|(^|\D)0분/.test(l))) fail('초 단위나 「0분」이 보인다');
  ok('다섯 줄 — 분 단위');

  // `CHECK_TICK=1`이면 강제 부상 뒤 1분 남짓 기다려 **숫자가 실제로 줄어드는가**를 본다(느려서 기본은 끈다).
  // 60분에서 올림이라 방금 다친 장수는 꼬박 1분이 지나야 59분이 된다
  if (process.env['CHECK_TICK'] === '1') {
    step('시간이 흐르면 줄어드는가 — 65초 기다린다');
    const mins = (ls: string[]) => ls.map((l) => Number(/(\d+)/.exec(l)?.[1] ?? NaN));
    const before = mins(lefts);
    await page.click('[data-action="closePick"]');
    await page.waitForTimeout(65_000);
    await page.click('[data-action="admit"]');
    await page.waitForSelector('[data-modal="hospitalPick"] .hsp-row');
    const after = mins(await page.$$eval('.hsp-row [data-field="left"]', (els) => els.map((e) => e.textContent ?? '')));
    console.log(`    전 ${before.join(',')} → 후 ${after.join(',')}`);
    if (after.some((m, i) => !(m < before[i]!))) fail('1분이 지났는데 줄지 않은 줄이 있다');
    ok('다섯 줄 전부 1분씩 줄었다');
  }

  step('둘을 입원시킨다 — 빈 방이 떨어지면 팝업이 닫히고 단추가 이유를 말한다');
  await page.click('.hsp-row [data-action="admitOfficer"]');
  await page.waitForFunction(() => document.querySelectorAll('.hsp-row[data-healing="true"]').length === 1, null, { timeout: 10_000 });
  await shot('hsp-03-pick-one-healing');
  await page.click('.hsp-row[data-healing="false"] [data-action="admitOfficer"]');
  await page.waitForSelector('[data-modal="hospitalPick"]', { state: 'detached', timeout: 10_000 });
  wards = await wardStates();
  console.log('   ', wards.join(' | '));
  if (wards.filter((w) => w.startsWith('healing')).length !== 2) fail('치료 중인 방이 둘이 아니다');
  if (!await page.$('[data-action="admit"][disabled]')) fail('빈 방이 없는데 [입원시키기]가 켜져 있다');
  if (await page.$('[data-action="admit"].primary')) fail('꺼진 [입원시키기]가 옥색 목판이다');
  // 몽골어만 남은 시간이 다음 줄이다(기획자 지정) — 나머지 언어는 한 줄
  const brs = await page.$$eval('.hsp-ward[data-state="healing"] .hsp-ward-st br', (els) => els.length);
  if ((LANG === 'mn') !== (brs > 0)) fail(`치료 중 줄의 줄바꿈이 어긋났다 — 언어 ${LANG || 'ko'}, <br> ${brs}개`);
  const why = await page.textContent('[data-field="admitBlocked"]');
  ok(`치료 중 둘 · 단추 꺼짐 — "${why}"`);
  await shot('hsp-04-full');

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 병원 UX 한 바퀴 완주');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
