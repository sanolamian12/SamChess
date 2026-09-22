/**
 * 태학 UX 확인 — 현황판 · 연구하기 · 취소 · 완료 축하 팝업 (GDD §5.12, 2026-09-22)
 *
 *   VW=760 VH=1200 SHOTS=<dir> node --experimental-strip-types --env-file=.env tools/academy_ux.ts
 *
 * 필요한 것: `npm run dev`(5173) · `npm run server-api`(8787). 개발용 지급(`SAMCHESS_DEV_GRANTS=1`)이
 * 켜져 있으면 「연구 즉시 완료」 단추로, 꺼져 있으면 서버 쪽에서 시작 시각을 당겨 끝낸다.
 *
 * 새 계정에는 태학도, 회복을 익힌 장수도 없어 「N명에게 일괄 적용」이 0명으로만 그려진다.
 * 그래서 **태학 Lv3 · 회복을 익힌 Lv4 장수 하나**를 서버 쪽에서 심고 돈다.
 *
 * 마지막 절은 **태학이 아닌 화면(메인)에서** 팝업이 뜨는가를 본다 — 끝나기 5초 전으로 당겨 두고
 * 새로고침 없이 기다린다. App의 「끝나는 순간에 한 번 더 정산」 시계가 안 돌면 여기서 걸린다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { OFFICERS, TACTICS } from '@samchess/data';
import { ACADEMY_RESEARCH_MS, newInstance } from '@samchess/meta';
import type { OfficerId, TacticId } from '@samchess/rules';
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
const T = (name: string): TacticId => TACTICS.find((t) => t.name === name)!.id as TacticId;

const email = `academy-ux-${randomUUID()}@samchess.test`;
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

async function toAcademy(): Promise<void> {
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  // 도시 그림 층은 흘러가듯 움직여(`.scr-art`의 드리프트) Playwright가 「안정되지 않았다」로
  // 끝없이 기다린다 — 성문도 핫스팟도 강제로 누른다
  await page.click('.city-gate rect', { force: true });
  await page.waitForSelector('[data-place="academy"]');
  await page.click('[data-place="academy"]', { force: true });
  await page.waitForSelector('.scr-building-academy [data-field="status"]');
}
const current = () => page.getAttribute('[data-field="current"]', 'data-state');

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
    await page.fill('.scr-new .newgame-form input', `태학실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }

  step('태학 Lv3 · 회복을 익힌 Lv4 장수 하나를 심는다');
  const stored = (await getProfile(uid))!;
  const who = OFFICERS.find((o) => o.grade === 'B')!.id as OfficerId;
  const inst = {
    ...newInstance(who), level: 4,
    growth: [
      { stat: 'hp' as const, tactics: [T('증폭')] },
      { stat: 'hp' as const, tactics: [T('반감')] },
      { stat: 'hp' as const, tactics: [T('회복')] },
    ],
  };
  await saveProfileTrusted(uid, {
    ...stored, cityLevel: 5, buildings: { ...stored.buildings, academy: 3 },
    roster: { ...stored.roster, [who]: inst },
  });
  await page.reload({ waitUntil: 'networkidle' });
  await toAcademy();
  await shot('acd-01-home');
  const lvText = await page.textContent('[data-field="level"]');
  if (!lvText?.includes('3')) fail(`태학 레벨이 안 보인다 — ${lvText}`);
  if (await current() !== 'idle') fail('연구 중이 아닌데 「없음」이 아니다');
  if (await page.$('[data-field="researched"] .acd-chip')) fail('연구한 적이 없는데 칩이 있다');
  if (!await page.$('[data-action="openResearch"].primary:not([disabled])')) fail('[연구하기]가 옥색 목판이 아니다');
  ok(`${lvText} · 연구된 책략 없음 · 연구 중 없음 · 단추 둘`);

  step('[연구하기] — 레벨마다 3중 택1, Lv4·5는 잠김');
  await page.click('[data-action="openResearch"]');
  await page.waitForSelector('[data-modal="academyPick"] .acd-level');
  await shot('acd-02-pick');
  const states = await page.$$eval('.acd-level', (els) => els.map((e) => (e as HTMLElement).dataset.state));
  if (states.join(',') !== 'open,open,open,locked,locked') fail(`칸 형편이 어긋났다 — ${states}`);
  const perLevel = await page.$$eval('.acd-level', (els) => els.map((e) => e.querySelectorAll('.acd-card').length));
  if (perLevel.some((n) => n !== 3)) fail(`레벨마다 카드 셋이 아니다 — ${perLevel}`);
  if (await page.$('.acd-level[data-state="locked"] [data-action="pickTopic"]')) fail('잠긴 레벨에 [연구] 단추가 있다');
  ok('open ×3 · locked ×2 · 카드 셋씩 · 잠긴 레벨엔 단추 없음');

  step('회복+ 연구 시작 → 현황판에 「연구 중」');
  await page.click('.acd-card[data-tactic="hoe-bok-plus"] [data-action="pickTopic"]');
  await page.waitForSelector('[data-modal="academyConfirm"]');
  await shot('acd-03-confirm');
  await page.click('[data-action="confirmResearch"]');
  await page.waitForSelector('[data-modal="academyConfirm"]', { state: 'detached', timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-field="current"]')?.getAttribute('data-state') === 'researching');
  const cur = await page.textContent('[data-field="current"]');
  await shot('acd-04-researching');
  ok(`연구 중 — "${cur}"`);
  const server1 = (await getProfile(uid))!;
  if (server1.academy?.research?.tactic !== 'hoe-bok-plus') fail('서버에 연구가 안 남았다');
  ok('서버의 academy.research가 회복+다');

  step('진행 중이면 다른 레벨의 [연구]가 꺼진다');
  await page.click('[data-action="openResearch"]');
  await page.waitForSelector('[data-modal="academyPick"] [data-field="busy"]');
  if (await page.$('[data-action="pickTopic"]:not([disabled])')) fail('진행 중인데 켜진 [연구]가 있다');
  const lv2 = await page.getAttribute('.acd-level[data-level="2"]', 'data-state');
  if (lv2 !== 'researching') fail(`Lv2가 연구 중으로 안 보인다 — ${lv2}`);
  await shot('acd-05-pick-busy');
  await page.click('[data-action="closePick"]');
  ok('켜진 [연구] 없음 · Lv2는 researching');

  step('취소 → 「없음」으로 돌아간다');
  await page.click('[data-action="cancelResearch"]');
  await page.waitForSelector('[data-modal="academyCancel"]');
  await page.click('[data-action="confirmCancel"]');
  await page.waitForFunction(() => document.querySelector('[data-field="current"]')?.getAttribute('data-state') === 'idle');
  if ((await getProfile(uid))!.academy?.research) fail('취소했는데 서버에 연구가 남아 있다');
  ok('취소 — 화면·서버 둘 다 비었다');

  step('다시 회복+ → 끝낸다 → 태학 화면에서 축하 팝업');
  await page.click('[data-action="openResearch"]');
  await page.click('.acd-card[data-tactic="hoe-bok-plus"] [data-action="pickTopic"]');
  await page.click('[data-action="confirmResearch"]');
  await page.waitForFunction(() => document.querySelector('[data-field="current"]')?.getAttribute('data-state') === 'researching');
  const grants = ((await (await fetch(`${API}/dev/status`)).json()) as { grants: boolean }).grants;
  await page.waitForTimeout(1_500); // 화면이 `/dev/status`를 물어 올 시간
  const devShown = !!await page.$('[data-dev="finishResearch"]');
  if (devShown !== grants) fail(`개발용 지급 ${grants ? '켜짐' : '꺼짐'}인데 개발용 줄이 ${devShown ? '보인다' : '안 보인다'}`);
  if (grants) {
    await page.click('[data-dev="finishResearch"]');
  } else {
    // 스위치가 꺼져 있다 — 서버 쪽에서 시작 시각을 당기고 새로고침한다. 새로고침은 **메인**에
    // 내려놓으므로 팝업도 메인에서 뜬다(전투가 아닌 모든 화면 — 그 자체가 확인할 거리다)
    const p = (await getProfile(uid))!;
    await saveProfileTrusted(uid, { ...p, academy: { ...p.academy!, research: { ...p.academy!.research!, startedAt: Date.now() - ACADEMY_RESEARCH_MS } } });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }
  await page.waitForSelector('[data-modal="academyNotice"]', { timeout: 15_000 });
  await shot('acd-06-notice');
  const count = await page.getAttribute('[data-modal="academyNotice"] [data-field="apply"]', 'data-count');
  if (count !== '1') fail(`「일괄 적용」 인원이 1이 아니다 — ${count}`);
  ok(`축하 팝업 — ${await page.textContent('[data-modal="academyNotice"] [data-field="apply"]')}`);
  await page.click('[data-action="academyNoticeOk"]');
  await page.waitForSelector('[data-modal="academyNotice"]', { state: 'detached', timeout: 10_000 });
  const server2 = (await getProfile(uid))!;
  if (server2.academy?.notice?.length) fail('[확인]했는데 서버의 notice가 남았다');
  if (!server2.academy?.done.some((d) => d.tactic === 'hoe-bok-plus')) fail('서버의 done에 회복+가 없다');
  if (!grants) await toAcademy();
  if (!await page.$('[data-field="researched"] .acd-chip[data-tactic="hoe-bok-plus"]')) fail('현황판에 회복+ 칩이 없다');
  ok('확인 → 서버 notice 비움 · done에 회복+ · 현황판 칩');

  step('[완료된 연구] 팝업');
  await page.click('[data-action="openDone"]');
  await page.waitForSelector('[data-modal="academyDone"] .acd-card[data-tactic="hoe-bok-plus"]');
  await shot('acd-07-done');
  await page.click('[data-action="closeDone"]');
  ok('회복+ 한 줄 — 원본 비교 포함');

  step('Lv2는 끝났다 — 다른 Lv2 주제는 못 고른다');
  await page.click('[data-action="openResearch"]');
  const lv2done = await page.getAttribute('.acd-level[data-level="2"]', 'data-state');
  if (lv2done !== 'done') fail(`Lv2가 done이 아니다 — ${lv2done}`);
  if (await page.$('.acd-level[data-level="2"] [data-action="pickTopic"]')) fail('끝낸 레벨에 [연구]가 남았다');
  await shot('acd-08-pick-after');
  await page.click('[data-action="closePick"]');
  ok('Lv2 done · 단추 없음');

  step('메인 화면에서 기다리면 팝업이 뜬다 — 새로고침 없이 (끝나기 5초 전으로 당긴다)');
  await page.click('[data-action="openResearch"]');
  await page.click('.acd-card[data-tactic="jeung-pok-plus"] [data-action="pickTopic"]');
  await page.click('[data-action="confirmResearch"]');
  await page.waitForFunction(() => document.querySelector('[data-field="current"]')?.getAttribute('data-state') === 'researching');
  {
    const p = (await getProfile(uid))!;
    await saveProfileTrusted(uid, { ...p, academy: { ...p.academy!, research: { ...p.academy!.research!, startedAt: Date.now() - ACADEMY_RESEARCH_MS + 5_000 } } });
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  if (await page.$('[data-modal="academyNotice"]')) fail('아직 안 끝났는데 팝업이 떴다');
  await page.waitForSelector('[data-modal="academyNotice"] [data-tactic="jeung-pok-plus"]', { timeout: 15_000 });
  await shot('acd-09-notice-main');
  ok('메인에서 증폭+ 축하 팝업');
  await page.click('[data-action="academyNoticeOk"]');
  await page.waitForSelector('[data-modal="academyNotice"]', { state: 'detached', timeout: 10_000 });

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 태학 UX 한 바퀴 완주');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
