/**
 * 화면 확인용 스크린샷 — 헤드리스 브라우저로 클라이언트를 띄워 찍는다.
 *
 *   node --experimental-strip-types tools/shot.ts [--seed 1] [--mode 3v3] [--wait 2000] [--out shot.png] [--auto]
 *
 * 렌더링 결과를 눈으로 확인하는 유일한 수단이다. 배치가 어긋났는지, 하이라이트가
 * 엉뚱한 칸에 그려졌는지는 테스트로 잡히지 않는다.
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
const url = `${base}/?seed=${seed}&mode=${mode}${auto}`;
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(waitMs);
await page.screenshot({ path: out });
await browser.close();

console.log(`${url} → ${out} (${waitMs}ms 대기)`);
if (problems.length) {
  console.log(`\n문제 ${problems.length}건:`);
  for (const p of problems.slice(0, 20)) console.log('  ' + p);
} else {
  console.log('콘솔 오류 없음');
}
