/**
 * 북군 화면 눈 확인 — 판을 돌려 그리는가 (2026-11-18 기획자, `battle/layout.ts`의 `boardFlipFor`)
 *
 *   node tools/flip_ux.ts [--url http://localhost:5173] [--shots 폴더] [--width 700]
 *
 * 데모 판(`?demo=1&side=P2` — 사람이 북군, 판정은 로컬 룰 엔진)이라 Vite만 있으면 된다. 남군 판(`side=P1`)과 나란히 본다.
 *
 * 1. 북군 판은 돌려 그린다(`board.flip`) · 남군 판은 아니다
 * 2. 눈금 — 화면 맨 왼쪽 열 글자가 `Y`, 맨 위 행 글자가 `20`(남군 판은 `A` · `1`)
 * 3. 내 장수(북군)가 화면 **아래**, 상대가 위에 선다
 * 4. 내 장수를 누르면(돌린 판의 화면 자리) 그 장수의 팝업이 뜬다 — 그리기와 누르기가 같은 뒤집기를 지난다
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const base = flag('url', 'http://localhost:5173');
const shots = flag('shots', '');
const width = Number(flag('width', '700'));
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const problems: string[] = [];
const ok = (cond: unknown, what: string): void => {
  if (!cond) { console.log(`  ✗ ${what}`); throw new Error(what); }
  console.log(`  ✓ ${what}`);
};

/** 판을 띄우고 배치 단계가 서기를 기다린다 */
async function open(side: 'P1' | 'P2'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: width * 2 } });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[console] ${m.text()}`); });
  await page.goto(`${base}/?demo=1&seed=2&side=${side}`);
  await page.waitForFunction(() => !!(window as any).__battle?.scene?.debugPlayback?.state, null, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  return page;
}

/** 판의 모습 — 돌렸나 · 눈금 첫 글자 · 장수의 화면(월드) 높이 */
const look = (page: Page) => page.evaluate(() => {
  const sc = (window as any).__battle.scene;
  const first = (axis: string) => sc.labels.find((t: any) => t.getData('axis') === axis && t.getData('i') === 0)?.text;
  const units = Object.values(sc.debugPlayback.state.units) as any[];
  const yOf = (side: string) => {
    const ys = units.filter((u) => u.side === side).map((u) => sc.views.get(u.id)?.container.y as number);
    return ys.reduce((a, b) => a + b, 0) / ys.length;
  };
  return { flip: sc.board.flip as boolean, col: first('col') as string, row: first('row') as string, p1: yOf('P1'), p2: yOf('P2'), mid: sc.board.h / 2 };
});

/** 장수를 누른다 — 화면에 그려진 자리(컨테이너)를 화면 좌표로 바꿔서. 판 좌표로 셈하지 않는다(그것이 시험 대상이다) */
async function clickUnit(page: Page, id: string): Promise<void> {
  // 카메라가 멎은 뒤에 잰다 — 움직이는 중에 재면 누르는 순간 장수가 그 자리에 없다(smoke_ui의 `settle`)
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate(() => (window as any).__battle.scene.debugCameraSettled === true)) break;
    await page.waitForTimeout(100);
  }
  const at = await page.evaluate((uid) => {
    const sc = (window as any).__battle.scene;
    const c = sc.views.get(uid).container;
    const cam = sc.cameras.main;
    const r = (sc.game.canvas as HTMLCanvasElement).getBoundingClientRect();
    const v = cam.worldView;
    return { x: r.left + ((c.x - v.x) / v.width) * r.width, y: r.top + ((c.y - v.y) / v.height) * r.height };
  }, id);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(400);
}

try {
  console.log('남군 판 (?side=P1)');
  const south = await open('P1');
  const s = await look(south);
  ok(!s.flip, '돌리지 않는다');
  ok(s.col === 'A' && s.row === '1', `눈금 첫 글자 A · 1 (${s.col} · ${s.row})`);
  ok(s.p1 > s.mid && s.p2 < s.mid, '내 장수(남군)가 아래');
  if (shots) await south.screenshot({ path: join(shots, '01-south.png') });
  // 기준선 — 남군 판에서도 같은 방법으로 누르면 뜬다(누르는 방법이 틀리면 북군 판의 실패가 뒤집기 탓이 아니다)
  await clickUnit(south, 'P1-King');
  const base0 = await south.evaluate(() => document.getElementById('unitpop')?.dataset.unit ?? '');
  ok(base0 === 'P1-King', `기준선 — 남군 판에서 P1-King을 누르면 팝업 (${base0 || '없음'})`);

  await south.close();   // 뒤로 밀린 탭은 Phaser가 멈춘다 — 다 본 뒤 닫는다

  console.log('북군 판 (?side=P2)');
  const north = await open('P2');
  const n = await look(north);
  ok(n.flip, '판을 돌려 그린다');
  ok(n.col === 'Y' && n.row === '20', `눈금 첫 글자 Y · 20 (${n.col} · ${n.row})`);
  ok(n.p2 > n.mid && n.p1 < n.mid, '내 장수(북군)가 아래, 상대가 위');
  if (shots) await north.screenshot({ path: join(shots, '02-north.png') });

  await north.close();

  // 장수마다 판을 새로 연다 — 하나를 고르면 카메라가 그 장수로 다가가 다른 장수가 화면 밖에 남는다(남군 판도 같다)
  for (const id of ['P2-King', 'P1-King']) {
    const page = await open('P2');
    await clickUnit(page, id);
    const shown = await page.evaluate(() => {
      const p = document.getElementById('unitpop')!;
      return p.classList.contains('hidden') ? '' : p.dataset.unit ?? '';
    });
    ok(shown === id, `${id}를 누르면 그 장수의 팝업 (${shown || '없음'})`);
    if (shots) await page.screenshot({ path: join(shots, `03-north-${id}.png`) });
    await page.close();
  }

  ok(problems.length === 0, `콘솔 오류 없음${problems.length ? `\n${problems.join('\n')}` : ''}`);
  console.log('✓ 완주');
} finally {
  await browser.close();
}
