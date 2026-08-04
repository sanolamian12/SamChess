/**
 * 화면 확인용 스크린샷 — 헤드리스 브라우저로 클라이언트를 띄워 찍는다.
 *
 *   node --experimental-strip-types tools/shot.ts [--seed 1] [--mode 3v3] [--wait 2000] [--out shot.png] [--auto] [--zoom 2]
 *
 * 렌더링 결과를 눈으로 확인하는 유일한 수단이다. 배치가 어긋났는지, 하이라이트가
 * 엉뚱한 칸에 그려졌는지는 테스트로 잡히지 않는다.
 *
 * `--zoom`을 주면 살아있는 유닛들의 무게중심으로 카메라를 붙인다. 기본 줌은 20×25 보드를
 * 화면에 다 넣느라 셀이 30px대로 줄어서, **타일 위의 바·배지가 읽히는지는 확대해야 보인다.**
 *
 * 개발 서버(`npm run dev -w @samchess/client`)가 떠 있어야 한다.
 * 콘솔 오류도 함께 출력하므로 조용히 깨진 경우를 놓치지 않는다.
 */

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};

const base = flag('url', 'http://localhost:5173');
const seed = flag('seed', '1');
const mode = flag('mode', '3v3');
const waitMs = Number(flag('wait', '2500'));
const out = flag('out', 'shot.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => problems.push(`[request] ${r.url()} — ${r.failure()?.errorText}`));

const auto = argv.includes('--auto') ? '&auto=1' : '';
const url = `${base}/?demo=1&seed=${seed}&mode=${mode}${auto}`;
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(waitMs);

const zoom = Number(flag('zoom', '0'));
if (zoom > 0) {
  await page.evaluate((z) => {
    const scene = (window as unknown as Record<string, any>).__battle.scene;
    const state = scene.debugPlayback.state;
    const alive = Object.values(state.units as Record<string, any>)
      .filter((u: any) => u.alive) as any[];
    // 제어권을 쥔 유닛이 있으면 그쪽으로 붙는다. 유닛 전체의 무게중심은 초반에
    // 아무도 없는 중립 지대라, 확대하면 빈 칸만 찍힌다.
    const focus = state.activeUnit ? state.units[state.activeUnit] : null;
    const cx = focus ? focus.pos.x : alive.reduce((n, u) => n + u.pos.x, 0) / alive.length;
    const cy = focus ? focus.pos.y : alive.reduce((n, u) => n + u.pos.y, 0) / alive.length;
    scene.cameras.main.setZoom(z);
    scene.cameras.main.centerOn(cx * 96 + 48, cy * 120 + 60);
  }, zoom);
  await page.waitForTimeout(300);
}

await page.screenshot({ path: out });
await browser.close();

console.log(`${url} → ${out} (${waitMs}ms 대기)`);
if (problems.length) {
  console.log(`\n문제 ${problems.length}건:`);
  for (const p of problems.slice(0, 20)) console.log('  ' + p);
} else {
  console.log('콘솔 오류 없음');
}
