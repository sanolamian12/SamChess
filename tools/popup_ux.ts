/**
 * 그림이 늦게 입혀진 팝업 · 단추 눈 확인 (2026-10-16)
 *
 * 메인 바닥 [로그아웃](참나무 목판) · 궁궐 [이름 변경] 팝업(먹빛 나무판 + 두루마리 입력칸, 막힌 이유 한 줄) ·
 * 장수 랭킹 카드의 책략 설명 팝업(두루마리). 증축 확인 · 최소 군량은 `smoke:meta`가 `SHOTS`로,
 * 컬렉션 등록 · 인장 팝업은 `collection_ux.ts` · `city_bonus_ux.ts`가 찍는다.
 *
 *   SHOTS=<dir> [LANG_UI=es] node --experimental-strip-types --env-file=.env tools/popup_ux.ts
 *
 * 그림이 걸렸는지는 사진만이 아니라 `border-image-source`로도 본다 — `border:` 단축이 덮으면 그림이 통째로 사라진다.
 */
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? '.';
const LANG = process.env['LANG_UI'] ?? '';

const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

const admin = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
const email = `popup-ux-${randomUUID()}@samchess.test`;
const password = randomUUID();
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
});
const uid = (await created.json() as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 1200 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
// 브라우저 대화상자는 받아 넘기지 않고 오류로 센다 — 받아 넘기면 팝업이 죽어도 통과한다(`forge_play.ts`가 밟은 자리)
page.on('dialog', (d) => { errors.push(`브라우저 대화상자가 떴다 — ${d.message()}`); void d.dismiss(); });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const art = (sel: string) => page.$eval(sel, (e) => getComputedStyle(e).borderImageSource);

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
    await page.fill('.scr-new .newgame-form input', `팝업실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    // 가입 오프닝(대사 · 장수 W 대형, 약 14초)을 지나야 메인이다 — 끝의 [성 안으로 들어가기]
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 }); // 메인이 자리 잡는 1초 연출이 끝난 뒤
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }
  await page.waitForTimeout(500);

  // ① 메인 바닥 — [로그아웃]은 참나무 목판, [[테스트] 도시 삭제]는 개발 모드에서만(이 dev 서버에서는 보인다)
  // 글자색까지 본다 — 그림만 걸리고 `.scr-bg .foot .btn`의 밝은 글자 · 검은 바탕이 이겨 흐리게 뜬 적이 있다(같은 날)
  const foot = await page.$$eval('.scr-main .foot .btn', (bs) => bs.map((b) => {
    const cs = getComputedStyle(b);
    return { art: cs.borderImageSource, color: cs.color, bg: cs.backgroundColor };
  }));
  const bad = foot.filter((f) => !f.art.includes('btn-secondary') || f.color !== 'rgb(44, 32, 19)' || f.bg !== 'rgba(0, 0, 0, 0)');
  if (!foot.length || bad.length) fail(`메인 바닥 단추가 참나무 목판이 아니다 — ${JSON.stringify(bad)}`);
  await shot('popup-01-main');
  ok(`메인 바닥 단추 ${foot.length}개 — 참나무 목판`);

  // ①-2 [로그아웃] 확인 — 브라우저 `confirm()`이 아니라 나무판 팝업이 **화면 가운데**에 뜨고, [그만둔다]는 메인에 남는다
  await page.click('[data-action="logout"]');
  await page.waitForSelector('[data-modal="logout"] .modal', { timeout: 3_000 })
    .catch(() => fail('[로그아웃]을 눌렀는데 확인 팝업이 안 뜬다'));
  const lo = await page.evaluate(() => {
    const m = document.querySelector('[data-modal="logout"] .modal')!;
    const r = m.getBoundingClientRect();
    const f = document.getElementById('frame')!.getBoundingClientRect();
    return {
      plank: getComputedStyle(m).borderImageSource,
      dy: Math.round(Math.abs((r.top + r.bottom) / 2 - (f.top + f.bottom) / 2)),
    };
  });
  if (!lo.plank.includes('panel-settings')) fail(`로그아웃 확인이 나무판이 아니다 — ${lo.plank}`);
  if (lo.dy > 4) fail(`로그아웃 확인이 화면 가운데가 아니다 — ${lo.dy}px 어긋남`);
  await shot('popup-01b-logout');
  await page.click('[data-action="logoutCancel"]');
  await page.waitForSelector('[data-modal="logout"]', { state: 'detached' });
  if (!await page.$('.scr-main')) fail('[그만둔다] 뒤에 메인이 아니다');
  ok('로그아웃 확인 — 나무판 · 가운데 · [그만둔다]는 메인에 남는다');

  // ② 궁궐 [이름 변경] — 판 · 명패 · 입력칸 셋이 그림이고, 막힌 이유 한 줄이 판 위에서 읽히는 색인가
  await page.click('.scr-main [data-place="palace"]', { force: true });
  await page.waitForSelector('[data-field="palaceStatus"] [data-action="rename"]');
  await page.click('[data-field="palaceStatus"] [data-action="rename"]');
  await page.waitForSelector('[data-modal="rename"] .modal');
  const rn = {
    plank: await art('[data-modal="rename"] .modal'),
    plate: await art('[data-modal="rename"] .modal-ttl'),
    field: await art('[data-modal="rename"] .field'),
    ok: await art('[data-action="renameConfirm"]'),
    no: await art('[data-action="renameCancel"]'),
  };
  if (!rn.plank.includes('panel-settings')) fail(`이름 변경 판이 나무판이 아니다 — ${rn.plank}`);
  if (!rn.plate.includes('plate-settings')) fail(`이름 변경 제목이 명패가 아니다 — ${rn.plate}`);
  if (!rn.field.includes('field-frame')) fail(`이름 칸이 두루마리가 아니다 — ${rn.field}`);
  if (!rn.ok.includes('btn-primary') || !rn.no.includes('btn-secondary')) fail(`단추 그림이 다르다 — ${rn.ok} / ${rn.no}`);
  await shot('popup-02-rename');
  await page.fill('[data-modal="rename"] .field', '');
  await page.waitForSelector('[data-modal="rename"] [data-field="why"]');
  await shot('popup-02b-rename-why');
  ok('이름 변경 — 나무판 · 명패 · 두루마리 칸 · 옥색/참나무 단추 · 막힌 이유');
  await page.click('[data-action="renameCancel"]');

  // ③ 장수 랭킹 → 카드 → 책략 칩 — 어두운 화면에서도 궁궐과 같은 두루마리인가
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('.scr-main [data-place="ranking"]', { force: true });
  await page.waitForSelector('[data-screen="board"]');
  await page.click('.scr-board [data-action="ranking"]');
  await page.waitForSelector('[data-screen="ranking"]');
  await page.click('[data-action="rankingOfficer"]');
  await page.waitForSelector('[data-screen="rankingOfficer"]');
  await page.waitForSelector('.rk-row.rk-clickable', { timeout: 15_000 });
  const rows = await page.$$('.rk-row.rk-clickable');
  let found = false;
  for (const r of rows.slice(0, 12)) {
    await r.click();
    await page.waitForSelector('.ofcard-modal', { timeout: 5_000 });
    const chip = await page.$('.ofcard-modal .ofcard-bar-tactics button.chip');
    if (chip) {
      // 책략은 글자가 아니라 엠블럼이다(2026-10-23) — 단추 안에 그림이 있는가, 글자는 없는가
      if (!await chip.$('.tac-icon img')) fail('장수 카드의 책략 단추에 엠블럼이 없다');
      if ((await chip.innerText()).replace('+', '').trim()) fail('장수 카드의 책략 단추에 글자가 남아 있다');
      await shot('popup-03a-card');
      await chip.click();
      await page.waitForSelector('[data-modal="tactic"] .tac-modal');
      const src = await art('[data-modal="tactic"] .tac-modal');
      if (!src.includes('field-frame')) fail(`랭킹의 책략 팝업이 두루마리가 아니다 — ${src}`);
      await shot('popup-03-tactic');
      found = true;
      break;
    }
    await page.click('.ofcard-modal [data-action="closeCard"]');
    await page.waitForTimeout(150);
  }
  if (found) ok('랭킹의 책략 팝업 — 두루마리');
  else console.log('  · 랭킹 위 12명 중 책략을 가진 장수가 없어 책략 팝업은 못 찍었다');

  // ④ [로그아웃] → 확인 — 실제로 간판으로 돌아가는가 (맨 끝에 둔다 — 세션이 끊긴다)
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
  await page.click('[data-action="logout"]');
  await page.click('[data-action="logoutConfirm"]');
  await page.waitForSelector('.scr-title', { timeout: 10_000 })
    .catch(() => fail('로그아웃을 확인했는데 간판으로 안 돌아간다'));
  ok('로그아웃 확인 → 간판');

  if (errors.length) fail(`콘솔 오류 — ${errors.join(' / ')}`);
  console.log(`\n사진: ${SHOTS}`);
} finally {
  await browser.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: admin });
}
