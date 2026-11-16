/**
 * 꼬마 애니메이션 판 위 눈 확인 — 데모 판(자동 대전)에서 그 장수가 평상 동작(1~3칸)을 할 때 칸마다 판을 멈추고 찍는다 (2026-11-16).
 *
 *   node tools/anim_look.ts 감녕 [가후 …] [--out 폴더] [--also 7,8,9]
 *
 * 18칸 시트는 `npm run anims`로 먼저 굽는다. `npm run dev`(5173)가 떠 있어야 한다.
 * 장수 하나마다 일기토 데모 판(`?demo=1&auto=1&duel=1&vs=그 장수,짝`)을 열어 양쪽을 AI에게 맡기고,
 * 그 장수의 칸이 바라는 번호가 되는 순간 게임 시계를 멈춰(`game.loop.sleep`) 장수 둘레를 찍는다 —
 * 평상 동작은 칸 하나가 220ms라 밖에서 시간을 재어 찍으면 놓친다. 0칸(평상 자세)은 평상 동작을 마치고 돌아온 모습이다.
 * `--also`로 다른 칸(공격 사이 7 · 8, 공격 9 …)도 찍는다. 찍은 파일 이름과 콘솔 오류를 출력한다.
 */

import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const names = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (names.length === 0) {
  console.error('장수 이름을 하나 이상 — node tools/anim_look.ts 감녕');
  process.exit(1);
}
const OUT = flag('out') ?? join(tmpdir(), 'samchess-anim');
const WANT = [0, 1, 2, 3, ...(flag('also')?.split(',').map(Number) ?? [])];
mkdirSync(OUT, { recursive: true });

const officers = JSON.parse(readFileSync('packages/data/generated/officers.json', 'utf8')) as { id: string; name: string }[];
const idOf = (name: string): string => {
  const o = officers.find((x) => x.name === name || x.id === name);
  if (!o) throw new Error(`없는 장수: ${name}`);
  return o.id;
};

const browser = await chromium.launch();
const problems: string[] = [];
try {
  for (const name of names) {
    const id = idOf(name);
    const partner = id === 'ga-hu' ? 'gam-nyeong' : 'ga-hu';
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
    await page.goto(`http://localhost:5173/?demo=1&auto=1&duel=1&vs=${id},${partner}&seed=2`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean((window as any).__battle?.scene?.views?.size), null, { timeout: 30_000 });
    // 그 장수의 칸이 아직 안 찍은 번호가 되면 시계를 멈추고 알린다 — 그림이 그려진 뒤(postrender)에 본다
    await page.evaluate(({ key, want }) => {
      const w = window as any;
      const scene = w.__battle.scene;
      w.__anim = { hit: null as null | { frame: number; x: number; y: number; w: number; h: number }, seen: new Set<number>(), want };
      scene.game.events.on('postrender', () => {
        if (w.__anim.hit) return;
        for (const [unitId, v] of scene.views) {
          if (v.portrait.texture.key !== key) continue;
          const f = Number(v.portrait.frame.name);
          if (!w.__anim.want.includes(f) || w.__anim.seen.has(f)) continue;
          // 0칸은 평상 동작을 한 번 지난 뒤, 그 장수의 차례가 아직 이어질 때만 — 처음 선 모습이나 차례가 끝난 뒤는
          // 카메라가 다른 곳을 본다
          if (f === 0 && (!w.__anim.seen.has(3) || scene.debugPlayback?.state?.activeUnit !== unitId)) continue;
          w.__anim.seen.add(f);
          // 장수 둘레(칸 셋 × 셋)를 화면 좌표로 — 위로 삐져나간 무기 · 윗칸까지 들어오게
          const cam = scene.cameras.main;
          const r = scene.game.canvas.getBoundingClientRect();
          const css = r.width / scene.scale.width;   // 게임 픽셀 → 화면 CSS 픽셀
          const sx = r.left + (cam.x + (v.container.x - cam.worldView.x) * cam.zoom) * css;
          const sy = r.top + (cam.y + (v.container.y - cam.worldView.y) * cam.zoom) * css;
          const size = v.portrait.displayWidth * cam.zoom * css * 3;
          w.__anim.hit = { frame: f, x: sx - size / 2, y: sy - size * 0.62, w: size, h: size };
          scene.game.loop.sleep();
          return;
        }
      });
    }, { key: `act:${id}`, want: WANT });
    const deadline = Date.now() + 90_000;
    let got = 0;
    while (got < WANT.length && Date.now() < deadline) {
      const hit = await page.evaluate(() => (window as any).__anim.hit) as null | { frame: number; x: number; y: number; w: number; h: number };
      if (!hit) { await page.waitForTimeout(30); continue; }
      const file = join(OUT, `${name}_칸${String(hit.frame).padStart(2, '0')}.png`);
      const vp = page.viewportSize()!;
      const x = Math.max(0, hit.x), y = Math.max(0, hit.y);
      await page.screenshot({ path: file, clip: { x, y, width: Math.min(hit.w, vp.width - x), height: Math.min(hit.h, vp.height - y) } });
      console.log(`찍음 ${file}`);
      got++;
      await page.evaluate(() => { const w = window as any; w.__anim.hit = null; w.__battle.scene.game.loop.wake(); });
    }
    if (got < WANT.length) console.log(`${name}: ${WANT.length}칸 중 ${got}칸만 찍었다 (90초 안에 그 칸이 안 왔다)`);
    await page.close();
  }
} finally {
  await browser.close();
}
if (problems.length) {
  console.log('콘솔 오류:');
  for (const p of problems) console.log(`  ${p}`);
}
