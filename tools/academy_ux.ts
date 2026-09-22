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
import { ACADEMY_RESEARCH_MS, ACADEMY_RESET_GOLD, applyResetAcademy, newInstance } from '@samchess/meta';
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
/**
 * 팝업의 [닫기] 판이 **화면 바닥의 명령 판과 같은 자리**인가 (2026-09-22 기획자 지정) — 아래·양옆
 * 모서리를 잰다. 「떠 있는가」와 「제자리에 있는가」는 다른 검사다(CLAUDE.md).
 */
async function closeAlignedWithHome(modal: string): Promise<void> {
  const rect = (sel: string) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom }; });
  const close = await rect(`[data-modal="${modal}"] .frg-back`);
  const home = await rect('.scr-building-academy .acd-home');
  const off = Math.max(Math.abs(close.l - home.l), Math.abs(close.r - home.r), Math.abs(close.b - home.b));
  if (off > 1.5) fail(`${modal}의 [닫기] 판이 바닥 판과 어긋났다 — ${JSON.stringify({ close, home })}`);
  ok(`${modal} — [닫기] 판이 바닥 판과 같은 자리(어긋남 ${off.toFixed(1)}px)`);
}

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
  if (!await page.$('[data-action="openDone"][disabled]')) fail('끝낸 연구가 없는데 [완료된 연구]가 켜져 있다');
  ok(`${lvText} · 연구된 책략 없음 · 연구 중 없음 · 단추 둘`);

  step('[연구하기] — 제목 「(Lv1)」 · 주제 셋 · 학파 표식 · MP 변화 · 바뀐 곳');
  await page.click('[data-action="openResearch"]');
  await page.waitForSelector('[data-modal="academyPick"] .acd-topic');
  await shot('acd-02-pick');
  if (await page.getAttribute('[data-modal="academyPick"]', 'data-level') !== '1') fail('Lv1이 아닌 레벨이 열렸다');
  const title = await page.textContent('[data-modal="academyPick"] .ofcpick-title');
  if (!title?.includes('1')) fail(`제목에 레벨이 없다 — ${title}`);
  const topics = await page.$$eval('[data-modal="academyPick"] .acd-topic', (els) => els.map((e) => (e as HTMLElement).dataset.tactic));
  if (topics.join(',') !== 'jeung-pok-plus,ban-gam-plus,gong-po-plus') fail(`Lv1 주제 셋이 아니다 — ${topics}`);
  const amp = '[data-modal="academyPick"] .acd-topic[data-tactic="jeung-pok-plus"]';
  const ampMp = await page.textContent(`${amp} .acd-mp`);
  if (!ampMp?.includes('1') || !ampMp.includes('→') || !ampMp.includes('2')) fail(`MP 변화가 안 보인다 — ${ampMp}`);
  if (await page.getAttribute(`${amp} .acd-school`, 'data-school') !== 'support') fail('증폭+에 지원책 표식이 없다');
  if (await page.getAttribute('[data-modal="academyPick"] .acd-topic[data-tactic="gong-po-plus"] .acd-school', 'data-school') !== 'illusion') fail('공포+에 환술 표식이 없다');
  const oldNew = [await page.textContent(`${amp} .acd-old`), await page.textContent(`${amp} .acd-new`)];
  if (oldNew.join('>') !== '1>2') fail(`바뀐 곳이 「1 → 2」가 아니다 — ${oldNew}`);
  if (!await page.$('[data-action="startResearch"][disabled]')) fail('아무것도 안 골랐는데 [연구 시작]이 켜져 있다');
  await closeAlignedWithHome('academyPick');
  ok(`${title} · 셋 · ${ampMp} · ~~1~~2 · 안 골라서 꺼짐`);
  {
    // 제목은 판 가운데 · 「택 1」은 왼쪽(두루마리 줄과 같은 왼쪽 선) · 모래시계 그림이 **실제로 읽혔다**
    const lay = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const panel = box('[data-modal="academyPick"] .acd-pick-panel');
      const t = box('[data-modal="academyPick"] .ofcpick-title');
      const hint = box('[data-modal="academyPick"] [data-field="hint"]');
      const row = box('[data-modal="academyPick"] .acd-topic');
      const img = document.querySelector('[data-action="startResearch"] .acd-timer') as HTMLImageElement | null;
      return {
        titleOff: Math.abs((t.left + t.right) / 2 - (panel.left + panel.right) / 2),
        hintText: document.querySelector('[data-modal="academyPick"] [data-field="hint"]')!.textContent,
        hintOff: Math.abs(hint.left - row.left),
        timerLoaded: !!img && img.complete && img.naturalWidth > 0,
      };
    });
    if (lay.titleOff > 2) fail(`제목이 가운데가 아니다 — ${lay.titleOff}px`);
    if (lay.hintOff > 2) fail(`「${lay.hintText}」가 왼쪽 선에 안 붙었다 — ${lay.hintOff}px`);
    if (!lay.timerLoaded) fail('모래시계 그림(blacksmith/timer.png)이 안 읽혔다');
    ok(`제목 가운데(${lay.titleOff.toFixed(1)}px) · 「${lay.hintText}」 왼쪽(${lay.hintOff.toFixed(1)}px) · 모래시계 그림 읽힘`);
  }

  step('증폭+ 체크 → [연구 시작 (1시간)] → 현황판에 「연구 중」');
  await page.click(amp);
  if (await page.getAttribute(amp, 'data-picked') !== '1') fail('체크가 안 됐다');
  await shot('acd-03-picked');
  const startLabel = await page.textContent('[data-action="startResearch"]');
  if (!await page.$('[data-action="startResearch"] .acd-timer')) fail('모래시계가 없다');
  await page.click('[data-action="startResearch"]');
  await page.waitForSelector('[data-modal="academyPick"]', { state: 'detached', timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-field="current"]')?.getAttribute('data-state') === 'researching');
  const cur = await page.textContent('[data-field="current"]');
  await shot('acd-04-researching');
  ok(`「${startLabel}」 → 연구 중 — "${cur}"`);
  if ((await getProfile(uid))!.academy?.research?.tactic !== 'jeung-pok-plus') fail('서버에 연구가 안 남았다');
  // 연구 중에는 [연구하기] 자리가 붉은 [연구 취소]다 · 현황판의 작은 [취소]와 안내문은 없다 (2026-09-22 지정)
  if (await page.$('[data-action="openResearch"]')) fail('연구 중인데 [연구하기]가 남아 있다');
  if (!await page.$('.acd-home [data-action="cancelResearch"].acd-cancel-research')) fail('바닥 판에 [연구 취소]가 없다');
  if (await page.$('.acd-status [data-action="cancelResearch"]')) fail('현황판에 작은 [취소]가 남아 있다');
  if (await page.$('[data-field="researchBlocked"]')) fail('연구 중 안내문이 남아 있다');
  const cancelArt = await page.$eval('.acd-home [data-action="cancelResearch"]', (e) => getComputedStyle(e).borderImageSource);
  if (!cancelArt.includes('btn-forcedcancel')) fail(`[연구 취소]가 붉은 목판이 아니다 — ${cancelArt}`);
  ok(`서버의 research가 증폭+ · 바닥 판은 붉은 [연구 취소](${await page.textContent('.acd-home [data-action="cancelResearch"]')}) · 현황판 [취소]·안내문 없음`);

  step('취소 → 「없음」으로 돌아간다');
  await page.click('[data-action="cancelResearch"]');
  await page.waitForSelector('[data-modal="academyCancel"]');
  await page.click('[data-action="confirmCancel"]');
  await page.waitForFunction(() => document.querySelector('[data-field="current"]')?.getAttribute('data-state') === 'idle');
  if ((await getProfile(uid))!.academy?.research) fail('취소했는데 서버에 연구가 남아 있다');
  ok('취소 — 화면·서버 둘 다 비었다');

  step('다시 증폭+ → 끝낸다 → 축하 팝업');
  await page.click('[data-action="openResearch"]');
  await page.click(amp);
  await page.click('[data-action="startResearch"]');
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
  await shot('acd-05-notice');
  const count = await page.getAttribute('[data-modal="academyNotice"] [data-field="apply"]', 'data-count');
  if (count !== '1') fail(`「일괄 적용」 인원이 1이 아니다 — ${count}`);
  ok(`축하 팝업 — ${await page.textContent('[data-modal="academyNotice"] [data-field="apply"]')}`);
  await page.click('[data-action="academyNoticeOk"]');
  await page.waitForSelector('[data-modal="academyNotice"]', { state: 'detached', timeout: 10_000 });
  const server2 = (await getProfile(uid))!;
  if (server2.academy?.notice?.length) fail('[확인]했는데 서버의 notice가 남았다');
  if (!server2.academy?.done.some((d) => d.tactic === 'jeung-pok-plus')) fail('서버의 done에 증폭+가 없다');
  if (!grants) await toAcademy();
  if (!await page.$('[data-field="researched"] .acd-chip[data-tactic="jeung-pok-plus"]')) fail('현황판에 증폭+ 칩이 없다');
  ok('확인 → 서버 notice 비움 · done에 증폭+ · 현황판 칩');

  step('[완료된 연구] — 같은 판 · 같은 글');
  await page.click('[data-action="openDone"]');
  await page.waitForSelector('[data-modal="academyDone"] .acd-topic[data-tactic="jeung-pok-plus"] .acd-new');
  await shot('acd-06-done');
  await closeAlignedWithHome('academyDone');
  await page.click('[data-action="closeDone"]');
  ok('증폭+ 한 줄 — 학파 · MP 변화 · 바뀐 곳');

  step('다음은 Lv2 — 제목이 따라온다');
  await page.click('[data-action="openResearch"]');
  await page.waitForSelector('[data-modal="academyPick"][data-level="2"]');
  const t2 = await page.$$eval('[data-modal="academyPick"] .acd-topic', (els) => els.map((e) => (e as HTMLElement).dataset.tactic));
  if (t2.join(',') !== 'hoe-bok-plus,gyeol-gye-plus,chim-muk-plus') fail(`Lv2 주제 셋이 아니다 — ${t2}`);
  await shot('acd-07-pick-lv2');
  ok(`「${await page.textContent('[data-modal="academyPick"] .ofcpick-title')}」 · 회복+ · 결계+ · 침묵+`);

  step('메인 화면에서 기다리면 팝업이 뜬다 — 새로고침 없이 (끝나기 5초 전으로 당긴다)');
  await page.click('[data-modal="academyPick"] .acd-topic[data-tactic="hoe-bok-plus"]');
  await page.click('[data-action="startResearch"]');
  await page.waitForFunction(() => document.querySelector('[data-field="current"]')?.getAttribute('data-state') === 'researching');
  {
    const p = (await getProfile(uid))!;
    await saveProfileTrusted(uid, { ...p, academy: { ...p.academy!, research: { ...p.academy!.research!, startedAt: Date.now() - ACADEMY_RESEARCH_MS + 5_000 } } });
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  if (await page.$('[data-modal="academyNotice"]')) fail('아직 안 끝났는데 팝업이 떴다');
  await page.waitForSelector('[data-modal="academyNotice"] [data-tactic="hoe-bok-plus"]', { timeout: 15_000 });
  await shot('acd-08-notice-main');
  ok('메인에서 회복+ 축하 팝업');
  await page.click('[data-action="academyNoticeOk"]');
  await page.waitForSelector('[data-modal="academyNotice"]', { state: 'detached', timeout: 10_000 });

  step('되돌리기(둔갑천서 같은 아이템) 뒤 — Lv1부터 · 끝냈던 레벨(둘)까지는 기다림 없이, 그 위는 1시간');
  {
    // 상점 칸이 아직 없어 서버의 같은 규칙(`applyResetAcademy`)을 직접 부른다 — `POST /academy/reset`이 부르는 그 함수
    const p = (await getProfile(uid))!;
    await saveProfileTrusted(uid, applyResetAcademy({ ...p, gold: Math.max(p.gold, ACADEMY_RESET_GOLD) }));
  }
  await page.reload({ waitUntil: 'networkidle' });
  await toAcademy();
  if (await page.$('[data-field="researched"] .acd-chip')) fail('되돌렸는데 칩이 남아 있다');
  await page.click('[data-action="openResearch"]');
  await page.waitForSelector('[data-modal="academyPick"][data-level="1"]');
  const instantLabel = await page.textContent('[data-action="startResearch"]');
  if (await page.$('[data-action="startResearch"] .acd-timer')) fail('즉시인데 모래시계가 있다');
  await shot('acd-09-pick-instant');
  await page.click('[data-modal="academyPick"] .acd-topic[data-tactic="ban-gam-plus"]');
  await page.click('[data-action="startResearch"]');
  await page.waitForSelector('[data-modal="academyNotice"] [data-tactic="ban-gam-plus"]', { timeout: 10_000 });
  if (await current() !== 'idle') fail('즉시 연구인데 「연구 중」이 됐다');
  ok(`「${instantLabel}」 → 곧바로 축하 팝업 · 연구 중 아님`);
  await page.click('[data-action="academyNoticeOk"]');
  await page.waitForSelector('[data-modal="academyNotice"]', { state: 'detached', timeout: 10_000 });
  if (!await page.$('[data-field="researched"] .acd-chip[data-tactic="ban-gam-plus"]')) fail('반감+ 칩이 없다');
  ok('반감+ 칩 — 다음은 Lv2부터 다시');
  // 되돌리기 전에 끝낸 것은 Lv1·Lv2 둘 — Lv2도 즉시, Lv3(태학 Lv3이지만 안 해 봤다)은 1시간
  await page.click('[data-action="openResearch"]');
  await page.waitForSelector('[data-modal="academyPick"][data-level="2"]');
  if (await page.$('[data-action="startResearch"] .acd-timer')) fail('끝냈던 Lv2인데 모래시계가 있다');
  await page.click('[data-modal="academyPick"] .acd-topic[data-tactic="chim-muk-plus"]');
  await page.click('[data-action="startResearch"]');
  await page.waitForSelector('[data-modal="academyNotice"] [data-tactic="chim-muk-plus"]', { timeout: 10_000 });
  await page.click('[data-action="academyNoticeOk"]');
  await page.waitForSelector('[data-modal="academyNotice"]', { state: 'detached', timeout: 10_000 });
  await page.click('[data-action="openResearch"]');
  await page.waitForSelector('[data-modal="academyPick"][data-level="3"]');
  if (!await page.$('[data-action="startResearch"] .acd-timer')) fail('안 해 본 Lv3인데 즉시다');
  await shot('acd-10-pick-lv3-wait');
  await page.click('[data-action="closePick"]');
  ok('Lv2 즉시 · 안 해 본 Lv3은 1시간(모래시계)');

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' | ')}`);
  console.log('\n✓ 태학 UX 한 바퀴 완주');
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
}
