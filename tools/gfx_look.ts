/**
 * 그래픽 마감용 눈 확인 — 판 700px(뷰포트 1000×1400)로 전투 화면의 대표 장면을 찍는다.
 *
 *   node --experimental-strip-types tools/gfx_look.ts [--out 폴더] [--only deploy,turn,tactic,popup,enemy] [--q "&mode=5v5"] [--lang en]
 *
 * `npm run dev`가 떠 있어야 한다. 찍은 파일 이름과 콘솔 오류(시전 오라 그림 없음은 거른다)를 출력한다.
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const BASE = flag('url', 'http://localhost:5173');
const OUT = flag('out', join(tmpdir(), 'samchess-gfx'));
const ONLY = new Set(flag('only', 'deploy,turn,tactic,popup,enemy').split(','));
const EXTRA = flag('q', '');
/** 화면 언어 — `--lang en` (스모크의 일본어 판과 같은 통로: localStorage) */
const LANG = flag('lang', '');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems: string[] = [];
const open = async (query: string): Promise<Page> => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/vfx:cast-/.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  if (LANG) await page.addInitScript((l) => localStorage.setItem('samchess.lang', l), LANG);
  // 뒤에 오는 값이 이긴다 — `--q '&mode=5v5'`가 기본값을 덮는다 (같은 이름을 두 번 붙이면 앞의 것이 읽힌다)
  const params = new URLSearchParams('demo=1&seed=3&mode=3v3&side=P1');
  for (const [k, v] of new URLSearchParams(query + EXTRA)) params.set(k, v);
  await page.goto(`${BASE}/?${params}`, { waitUntil: 'networkidle' });
  return page;
};
const phase = (page: Page) => page.evaluate(() => (window as any).__battle?.scene?.debugPlayback?.phase);
const myTurn = (page: Page) => page.waitForFunction(() => {
  const p = (window as any).__battle?.scene?.debugPlayback;
  return p?.phase === 'awaitingInput' && !p.busy;
}, null, { timeout: 60_000 });
const shot = async (page: Page, name: string) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`찍음 ${file}`);
};

if (ONLY.has('deploy')) {
  const page = await open('&deploy=1');
  await page.waitForTimeout(2500);
  await shot(page, 'deploy');
  // 고유기술 패널 — 꼬마 그림 → 장수 팝업(판 한가운데) · 라벨 → 고유기술 팝업
  await page.click('#cmd .sk-row[data-side="mine"] .sk-art');
  await page.waitForTimeout(500);
  await shot(page, 'deploy-officer');
  await page.click('#cmd .sk-banner:not(:disabled)');
  await page.waitForTimeout(700);
  await shot(page, 'deploy-skill');
  await page.close();
}

if (ONLY.has('turn') || ONLY.has('tactic') || ONLY.has('popup')) {
  const page = await open('');
  await myTurn(page);
  await page.waitForTimeout(1800);
  if (ONLY.has('turn')) await shot(page, 'turn');
  if (ONLY.has('tactic')) {
    const btn = page.locator('#cmd [data-action="castTactic"]');
    if (await btn.isEnabled()) {
      await btn.click();
      await page.waitForTimeout(800);
      await shot(page, 'tactic');
      await btn.click().catch(() => {});
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else console.log('책략 단추가 꺼져 있다 — tactic 건너뜀');
  }
  if (ONLY.has('popup')) {
    await page.evaluate(() => { const sc = (window as any).__battle.scene; sc.resetView(); sc.debugFreeCamera(); });
    await page.waitForTimeout(200);
    const at = await page.evaluate(() => {
      const scene = (window as any).__battle.scene;
      const u = Object.values(scene.debugPlayback.state.units as Record<string, any>)
        .find((x: any) => x.alive && x.side === 'P2') as any;
      const rect = (scene.game.canvas as HTMLCanvasElement).getBoundingClientRect();
      const v = scene.cameras.main.worldView;
      return { x: rect.left + ((u.pos.x * 96 + 48 - v.x) / v.width) * rect.width,
               y: rect.top + ((u.pos.y * 120 + 60 - v.y) / v.height) * rect.height };
    });
    await page.mouse.click(at.x, at.y);
    await page.waitForSelector('#unitpop:not(.hidden)', { timeout: 5000 }).catch(() => console.log('팝업이 안 떴다'));
    await page.waitForTimeout(1200);
    await shot(page, 'popup');
  }
  await page.close();
}

if (ONLY.has('enemy')) {
  const page = await open('');
  await myTurn(page);
  await page.locator('#cmd [data-action="endTurn"]').click();
  await page.waitForTimeout(300);
  // 확인창이 있으면 확정
  const ok = page.locator('#ctx [data-action="confirm"]');
  if (await ok.count()) await ok.first().click().catch(() => {});
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'aiThinking', null, { timeout: 20_000 })
    .catch(async () => console.log(`상대 차례가 안 왔다 (${await phase(page)})`));
  await page.waitForTimeout(250);
  await shot(page, 'enemy');
  await page.close();
}

await browser.close();
console.log(problems.length ? `콘솔 오류 ${problems.length}건:\n  ${problems.slice(0, 10).join('\n  ')}` : '콘솔 오류 없음');
