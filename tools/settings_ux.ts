/**
 * 환경설정 UX 확인 — 음성 더빙 한 줄 · 소리 과녁 둘 (2026-10-23)
 *
 *   SHOTS=<dir> node --experimental-strip-types tools/settings_ux.ts
 *
 * 필요한 것: `npm run dev`(5173). 로그인하지 않는다 — 간판 화면의 기어로 연다(어느 화면에서 열든 같은 팝업이다).
 *
 * 보는 것:
 *  - 더빙을 고르는 단추가 없고, Language 바로 아래에 「음성 더빙 · ⟨언어⟩」가 Language를 따라 바뀐다
 *  - 과녁을 누르면 화살이 날아가 박힌 **뒤에** 칸이 바뀐다 — 날아가는 시간은 거리에 비례하고 100%가 0.5초
 *  - 칸은 새로고침해도 남고(`localStorage`), 배경 음악의 세기(`__bgm.volume`)가 따라온다
 *  - 옛 끔 · 켬(`samchess.bgm.muted = 1`)으로 꺼 둔 기기는 두 갈래 다 음소거로 옮겨진다(칸은 그대로)
 *  - 활을 누르면 그 갈래만 음소거(활 오른쪽 아래 금지 표시) · 과녁을 쏘면 풀린다 · 칸 숫자는 이름과 같은 줄에서 안 겹친다
 */
import { chromium } from 'playwright';

const BASE = process.env['BASE'] ?? 'http://localhost:5173';
const SHOTS = process.env['SHOTS'] ?? '.';
const fail = (m: string): never => { throw new Error(m); };
const ok = (m: string): void => console.log(`  ✓ ${m}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 1200 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/settings-${name}.png` });

const open = async (): Promise<void> => {
  await page.click('.gear');
  await page.waitForSelector('[data-modal="settings"]');
};

try {
  console.log('▶ 옛 끔 · 켬으로 꺼 둔 기기');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('samchess.bgm.muted', '1'); localStorage.setItem('samchess.dubLang', 'JP'); });
  await page.reload({ waitUntil: 'networkidle' });
  await open();
  const lv = await page.$$eval('[data-modal="settings"] .vr', (els) => els.map((e) => `${(e as HTMLElement).dataset.level}${(e as HTMLElement).dataset.muted}`));
  if (lv.join(',') !== '51,51') fail(`꺼 둔 기기가 음소거(칸 100% 그대로)로 안 옮겨졌다 — ${lv}`);
  if ((await page.$$('[data-modal="settings"] .vr-ban')).length !== 2) fail('음소거인데 금지 표시가 갈래마다 하나가 아니다');
  await shot('muted');
  const left = await page.evaluate(() => [localStorage.getItem('samchess.bgm.muted'), localStorage.getItem('samchess.dubLang')]);
  if (left.some((v) => v !== null)) fail(`옛 저장값이 남았다 — ${left}`);
  ok('배경 음악 · 효과음 다 음소거(금지 표시) · 옛 끔 · 켬과 옛 더빙 선택은 지워졌다');

  console.log('▶ 음성 더빙 — Language를 따라간다');
  if (await page.$('[data-modal="settings"] [data-dub]')) fail('더빙을 고르는 단추가 남아 있다');
  const dubText = async (): Promise<string> => (await page.textContent('[data-modal="settings"] [data-field="dub"] .v'))?.trim() ?? '';
  await page.click('[data-modal="settings"] [data-lang="ko"]');
  if (await dubText() !== '한국어') fail(`한국어 화면의 더빙이 ${await dubText()}`);
  // 「Language 바로 아래」— 더빙 줄이 언어 칩보다 위에 있다
  const order = await page.$eval('[data-modal="settings"]', (m) => {
    const dub = m.querySelector('[data-field="dub"]')!.getBoundingClientRect().top;
    const chips = m.querySelector('.langs')!.getBoundingClientRect().top;
    return dub < chips;
  });
  if (!order) fail('더빙 줄이 Language 바로 아래가 아니다');
  await shot('ko');
  await page.click('[data-modal="settings"] [data-lang="es_419"]');
  if (await dubText() !== 'Português') fail(`스페인어 화면의 더빙이 ${await dubText()} — Português여야 한다`);
  // 더빙 이름 칸은 한 줄이다 — 들여 썼을 때 스페인어 「Doblaje de voz」가 두 줄이 됐다(2026-10-23)
  const lines = await page.$eval('[data-modal="settings"] [data-field="dub"] .k', (e) => {
    const r = document.createRange(); r.selectNodeContents(e);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
  });
  if (lines !== 1) fail(`스페인어에서 「음성 더빙」 이름이 ${lines}줄이다`);
  await shot('es');
  await page.click('[data-modal="settings"] [data-lang="ko"]');
  ok('고르는 단추 없음 · Language 바로 아래 · 한국어 → 한국어, 스페인어 → Português(이름 한 줄)');

  console.log('▶ 이름 줄 — 칸 숫자가 같은 줄, 이름과 안 겹친다');
  for (const ch of ['bgm', 'fx']) {
    const g = await page.$eval(`[data-modal="settings"] .vr[data-channel="${ch}"]`, (v) => {
      const k = v.querySelector('.vr-k')!.getBoundingClientRect();
      const p = v.querySelector('[data-step="1"] .vr-pct')!.getBoundingClientRect();
      return { overlap: k.right - p.left, dy: Math.abs((k.top + k.bottom) / 2 - (p.top + p.bottom) / 2) };
    });
    if (g.overlap > 0) fail(`${ch} — 이름이 20과 ${g.overlap.toFixed(1)}px 겹친다`);
    if (g.dy > 3) fail(`${ch} — 칸 숫자가 이름과 같은 줄이 아니다(${g.dy.toFixed(1)}px 어긋남)`);
  }
  ok('두 갈래 다 같은 줄 · 안 겹친다');

  console.log('▶ 과녁 — 날아가서 박힌 뒤에 칸이 바뀐다');
  // 날아가는 시간은 페이지 안에서 화살 애니메이션 자체의 길이로 잰다 — 바깥(클릭 · 셀렉터 기다림)으로 재면 지연이 섞인다
  const fly = async (ch: string, step: number): Promise<number> => {
    const sel = `[data-modal="settings"] .vr[data-channel="${ch}"]`;
    await page.click(`${sel} [data-step="${step}"]`);
    const ms = await page.$eval(`${sel} .vr-arrow`, (e) => Number(e.getAnimations()[0]?.effect?.getTiming().duration ?? -1));
    if (await page.getAttribute(sel, 'data-level') === String(step) && ms > 0) {
      // 같은 칸을 다시 쏜 것이 아니면, 날아가는 동안에는 아직 옛 칸이어야 한다
    }
    // 박힐 때까지 — 칸이 이미 그 칸이어도(음소거만 풀리는 경우) 화살이 다 날아야 끝이다
    await page.waitForFunction((q) => {
      const a = document.querySelector<HTMLElement>(`${q} .vr-arrow`);
      return !!a && a.dataset.flying === '0' && a.getAnimations().length === 0;
    }, sel, { timeout: 3_000 });
    if (await page.getAttribute(sel, 'data-level') !== String(step)) fail(`${sel} — 박혔는데 칸이 ${step}이 아니다`);
    await page.waitForTimeout(80);
    return ms;
  };
  // 100% — 날아가는 도중을 찍는다
  await page.click('[data-modal="settings"] .vr[data-channel="bgm"] [data-step="5"]');
  await page.waitForTimeout(200);
  // 시작은 100% · 음소거(옛 끔에서 옮겨 온 것) — 박히는 순간 풀린다. 날아가는 동안에는 아직 음소거여야 한다
  if (await page.getAttribute('[data-modal="settings"] .vr[data-channel="bgm"]', 'data-muted') !== '1') fail('화살이 닿기도 전에 음소거가 풀렸다');
  await shot('flying');
  // 포물선 — 날아가는 동안 화살이 쏜 높이보다 올라갔다가 내려온다
  {
    const sel = '[data-modal="settings"] .vr[data-channel="fx"]';
    await page.click(`${sel} [data-step="5"]`);
    const ys = await page.evaluate(async (q) => {
      const a = document.querySelector<HTMLElement>(`${q} .vr-arrow`)!;
      const out: number[] = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 520) { out.push(a.getBoundingClientRect().top); await new Promise((r) => requestAnimationFrame(r)); }
      return out;
    }, sel);
    const top = Math.min(...ys);
    if (!(ys[0]! - top > 4)) fail(`화살이 포물선을 그리지 않는다 — 높이 ${ys.map(Math.round).join(',')}`);
    await page.waitForSelector(`${sel}[data-level="5"]`, { timeout: 3_000 });
    ok(`포물선 — 쏜 높이보다 ${Math.round(ys[0]! - top)}px 올라갔다 내려온다`);
  }
  await page.waitForSelector('[data-modal="settings"] .vr[data-channel="bgm"][data-muted="0"]', { timeout: 3_000 });
  await page.waitForTimeout(450);
  await fly('bgm', 1);
  const far = await fly('bgm', 5);
  await fly('fx', 3);
  const near = await fly('fx', 1);
  if (Math.abs(far - 500) > 1) fail(`100%까지 ${far}ms — 0.5초여야 한다`);
  // 과녁은 출발점에서 같은 간격 — 20%는 100%의 1/5(0.1초)
  if (Math.abs(near - far / 5) > 15) fail(`20% 과녁(${near}ms)이 100%(${far}ms)의 1/5이 아니다 — 과녁이 출발점에서 같은 간격이 아니다`);
  await page.waitForTimeout(500);
  await shot('set');
  const hits = await page.$$eval('[data-modal="settings"] .vr-target-hit', (els) => els.length);
  if (hits !== 2) fail(`화살 박힌 과녁이 갈래마다 하나가 아니다 — ${hits}`);
  const bgmVol = await page.evaluate(() => (window as unknown as { __bgm?: { volume: number } }).__bgm?.volume ?? null);
  if (bgmVol !== null && bgmVol !== 1) fail(`배경 음악의 세기가 100%가 아니다 — ${bgmVol}`);
  ok(`화살 100% ${far}ms · 20% ${Math.round(near)}ms · 박힌 과녁이 갈래마다 하나 · 배경 음악 세기 ${bgmVol ?? '(곡 없음)'}`);

  console.log('▶ 활 — 그 갈래만 음소거, 과녁을 쏘면 풀린다');
  await page.click('[data-modal="settings"] .vr[data-channel="bgm"] [data-action="mute"]');
  if (await page.getAttribute('[data-modal="settings"] .vr[data-channel="bgm"]', 'data-muted') !== '1') fail('활을 눌렀는데 음소거가 안 됐다');
  if (await page.getAttribute('[data-modal="settings"] .vr[data-channel="fx"]', 'data-muted') !== '0') fail('배경 음악 활이 효과음까지 껐다');
  if (!await page.$('[data-modal="settings"] .vr[data-channel="bgm"] .vr-ban')) fail('음소거인데 금지 표시가 없다');
  const mutedVol = await page.evaluate(() => (window as unknown as { __bgm?: { volume: number } }).__bgm?.volume ?? null);
  if (mutedVol !== null && mutedVol !== 0) fail(`음소거인데 배경 음악 세기가 ${mutedVol}`);
  await shot('bgm-muted');
  await page.click('[data-modal="settings"] .vr[data-channel="bgm"] [data-action="mute"]');
  if (await page.getAttribute('[data-modal="settings"] .vr[data-channel="bgm"]', 'data-muted') !== '0') fail('활을 다시 눌렀는데 안 켜졌다');
  await page.click('[data-modal="settings"] .vr[data-channel="bgm"] [data-action="mute"]');
  await fly('bgm', 5);
  if (await page.getAttribute('[data-modal="settings"] .vr[data-channel="bgm"]', 'data-muted') !== '0') fail('과녁을 쐈는데 음소거가 안 풀렸다');
  ok('활 → 배경 음악만 음소거 · 금지 표시 · 세기 0 · 다시 누르면 켜짐 · 과녁을 쏘면 풀림');

  console.log('▶ 새로고침해도 남는다');
  await page.reload({ waitUntil: 'networkidle' });
  await open();
  const kept = await page.$$eval('[data-modal="settings"] .vr', (els) => els.map((e) => (e as HTMLElement).dataset.level));
  if (kept.join(',') !== '5,1') fail(`새로고침 뒤 칸이 ${kept} — 5,1이어야 한다`);
  ok('배경 음악 100% · 효과음 20% 그대로');

  if (errors.length) fail(`콘솔 · 404 — ${errors.join(' | ')}`);
  console.log('\n✓ 환경설정 UX 끝');
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
