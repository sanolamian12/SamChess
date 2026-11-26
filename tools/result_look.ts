/**
 * 결과 두루마리 눈 확인 — `?result=…`(로그인 없이, `screens/ResultDemo.tsx`)를 시각마다 찍는다 (2026-11-26).
 *
 *   node tools/result_look.ts [win|siege|lose|draw|raid|raidLost|tutorial] [lang]   (Vite 5173만 필요)
 *
 * 찍은 그림은 OS 임시 폴더의 `result_look/`에. 줄이 서는 순간(「쿵」)을 놓치지 않게 첫 장은 촘촘히,
 * 그다음은 누르며 걸음마다 찍는다 — 「보상」 → 어두워짐 → 캐릭터 보상 → 밝아지며 받은 장수 줄 → 전과.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const kind = process.argv[2] ?? 'win';
const lang = process.argv[3] ?? 'ko';
const OUT = join(process.env.RESULT_LOOK_OUT ?? join(tmpdir(), 'result_look'));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:5173/?result=${kind}&lang=${lang}${process.argv[4] ? `&why=${process.argv[4]}` : ''}`);
await page.waitForSelector('.brs-frame');
// 두루마리 자리를 프레임마다 잰다 — 줄이 서는 동안 위아래로 밀리면 안 된다(2026-11-27 기획자). 서기 연출(scale)은 레이아웃이 아니라 잰 값에 안 든다
await page.evaluate(() => {
  const w = window as unknown as { __brsY: Set<string> };
  w.__brsY = new Set();
  const tick = (): void => {
    const el = document.querySelector('.brs-scroll');
    if (el) { const r = (el as HTMLElement).offsetTop; w.__brsY.add(`${r}/${(el as HTMLElement).offsetHeight}`); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const t0 = Date.now();
const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: join(OUT, `${kind}-${lang}-${name}.png`) });
  console.log(`  ${String(Date.now() - t0).padStart(5)}ms ${name}`);
};
for (const at of [150, 450, 1750, 2000, 2500, 3200, 3900, 4600]) {
  await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
  await shot(`a${at}`);
}
const settled = await page.waitForSelector('.brs-frame[data-settled="1"]', { timeout: 6000 }).then(() => true, () => false);
console.log('첫 장 다 섬:', settled, await page.$$eval('.brs-beat:not([data-wait])', (els) => els.map((e) => e.textContent?.trim())));
await shot('b-settled');
for (let step = 0; step < 6; step++) {
  const st = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>('.brs-frame')!;
    return { page: f.dataset.page, last: f.dataset.last, veil: f.dataset.veil ?? null, modal: !!document.querySelector('[data-modal="rewardCards"]') };
  });
  console.log('상태', JSON.stringify(st));
  if (st.modal) {
    await page.waitForTimeout(1200);
    await shot(`c${step}-cards`);
    await page.click('[data-action="rewardCardsOk"]');
    await page.waitForTimeout(200);
    await shot(`c${step}-lift`);
    await page.waitForTimeout(900);
    await shot(`c${step}-tail`);
    continue;
  }
  if (st.veil) { await page.waitForTimeout(600); continue; }
  if (st.last === '1') { await page.waitForTimeout(900); await shot(`d${step}-last`); break; }
  await page.click('.brs-stage');
  await page.waitForTimeout(400);
  await shot(`c${step}-fade`);
  await page.waitForTimeout(800);
  await shot(`c${step}-next`);
  await page.waitForTimeout(1300);
}
const ys = await page.evaluate(() => [...(window as unknown as { __brsY: Set<string> }).__brsY]);
console.log(ys.length === 1 ? `두루마리 자리 고정 — 위/높이 ${ys[0]}` : `✗ 두루마리 자리가 움직였다 — ${ys.join(' · ')}`);
console.log(errors.length ? `콘솔 오류 ${errors.join(' | ')}` : '콘솔 오류 없음', '→', OUT);
await browser.close();
