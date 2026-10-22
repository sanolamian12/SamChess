/**
 * 튜토리얼 눈 확인 — `?tutorial=basic-1|2|3`을 **대본대로 눌러** 끝까지 가며 장면을 찍는다 (G3, 2026-10-22).
 *
 * 로그인 · 서버가 필요 없다(`TutorialDemo` — 완료는 서버에 안 적는다). 개발 서버(5173)만 떠 있으면 된다.
 *
 *   node --experimental-strip-types tools/tutorial_ux.ts            # 셋 다
 *   node --experimental-strip-types tools/tutorial_ux.ts basic-2    # 하나만
 *
 * 누를 것은 화면이 건 잠금(`scene.debugCommandLimit`)이 정한다 — 안내가 켠 명령 · 칸 · 대상 그대로다. 그래서 이 도구가
 * 끝까지 가면 「안내대로 누르면 끝난다」가 화면에서도 선다(회귀 `tutorialBattles.test.ts`는 엔진에서 같은 것을 본다).
 * 확인하는 것: 안내 창이 뜬다 · 창이 떠 있는 동안 명령 칸이 전부 꺼진다 · 닫으면 켠 명령만 켜진다 · 이동 칸이 하나뿐이다 ·
 * 마지막 판의 끝맺음 창이 뜬다. 찍은 그림은 OS 임시 폴더에 남는다. 검사는 화면 글자가 아니라 `data-*`로 건다.
 */

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Page } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = join(tmpdir(), 'samchess-tutorial-ux');
mkdirSync(OUT, { recursive: true });
const ALL = ['basic-1', 'basic-2', 'basic-3'];
const which = process.argv.slice(2).filter((a) => ALL.includes(a));

let failed = 0;
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failed++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 1400 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const settle = async (ms = 3000): Promise<void> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(() => (window as any).__battle?.scene?.debugCameraSettled === true)) return;
    await page.waitForTimeout(60);
  }
};

/** 격자 → 페이지 픽셀 (`smoke_ui.ts`의 `toScreen`과 같은 식) */
const clickCell = async (c: { x: number; y: number }): Promise<void> => {
  await settle();
  await page.waitForTimeout(80);
  const at = await page.evaluate(([px, py]) => {
    const scene = (window as any).__battle.scene;
    const cam = scene.cameras.main;
    const rect = (scene.game.canvas as HTMLCanvasElement).getBoundingClientRect();
    const v = cam.worldView;
    return { x: rect.left + ((px! * 96 + 48 - v.x) / v.width) * rect.width, y: rect.top + ((py! * 120 + 60 - v.y) / v.height) * rect.height };
  }, [c.x, c.y]);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(150);
};

const press = async (sel: string): Promise<void> => {
  try {
    await page.click(sel, { timeout: 8000 });
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'stuck.png') });
    const view = await page.evaluate(() => ({
      ctx: document.querySelector<HTMLElement>('#ctx-flow')?.dataset.view ?? null,
      cells: (window as any).__battle?.scene?.debugChoosableCells?.() ?? null,
      phase: (window as any).__battle?.scene?.debugPlayback?.phase ?? null,
    }));
    throw new Error(`${sel}를 못 눌렀다 — ${JSON.stringify(view)} (그림 ${join(OUT, 'stuck.png')})`, { cause: e });
  }
  await page.waitForTimeout(150);
};

/** 사람의 입력을 기다리는가 — 연출이 멎고 내 차례 */
const awaiting = (p: Page) => p.evaluate(() => {
  const pb = (window as any).__battle?.scene?.debugPlayback;
  return !!pb && pb.phase === 'awaitingInput' && !pb.busy;
});

const guideKey = (): Promise<string | null> =>
  page.evaluate(() => document.querySelector<HTMLElement>('[data-modal="tutorialGuide"]')?.dataset.key ?? null);

const enabledCmds = (): Promise<string[]> => page.evaluate(() =>
  [...document.querySelectorAll<HTMLButtonElement>('#cmd button[data-action]')].filter((b) => !b.disabled).map((b) => b.dataset.action!));

async function run(id: string): Promise<void> {
  console.log(`\n── ${id} ──`);
  await page.goto(`${BASE}/?tutorial=${id}`);
  const seenKeys: string[] = [];
  let shots = 0;
  let lockedWhileGuide = true;
  let actions = 0;
  const deadline = Date.now() + 240_000;

  while (Date.now() < deadline) {
    const key = await guideKey();
    if (key) {
      if (!seenKeys.includes(key)) {
        seenKeys.push(key);
        if (shots < 40) await page.screenshot({ path: join(OUT, `${id}-${String(shots++).padStart(2, '0')}-${key}.png`) });
      }
      // 창이 떠 있는 동안 명령 칸은 전부 꺼져 있어야 한다
      if ((await enabledCmds()).length > 0) lockedWhileGuide = false;
      // 마지막 판의 끝맺음 — 누르면 데모가 같은 판을 처음부터 다시 띄운다. 여기서 끝낸다
      const outro = /\.done$|\.next$/.test(key) && (key === 'tut.b1.done' || key.startsWith('tut.b2.done') || key.startsWith('tut.b3.'));
      if (outro && (key === 'tut.b1.done' || key === 'tut.b2.done' || key === 'tut.b3.next')) break;
      if (key === 'tut.lost') { check(false, `${id} — 안내대로 눌렀는데 졌다`); return; }
      await press('[data-modal="tutorialGuide"] button[data-action="tutorialNext"]');
      continue;
    }
    if (!(await awaiting(page))) { await page.waitForTimeout(120); continue; }
    // 안내 층은 120ms마다 살핀다 — 차례가 막 바뀐 순간에는 옛 잠금이 남아 있다. 판 · 잠금이 잠시 멎은 것을 보고 누른다
    const snap = () => page.evaluate(() => {
      const sc = (window as any).__battle.scene;
      return JSON.stringify([sc.currentState.activeUnit, sc.currentState.time, sc.currentState.activeTurn, sc.debugCommandLimit]);
    });
    const before = await snap();
    await page.waitForTimeout(400);
    if ((await guideKey()) || !(await awaiting(page)) || (await snap()) !== before) continue;
    const limit = await page.evaluate(() => (window as any).__battle.scene.debugCommandLimit as
      { allow: string[]; moveTo: { x: number; y: number } | null; target: string | null } | null);
    // 안내 층이 아직 단계를 안 열었다 — 다음 살핌을 기다린다
    if (limit && limit.allow.length === 0) { await page.waitForTimeout(150); continue; }
    const allow = limit?.allow ?? ['move', 'attack', 'endTurn'];
    const on = await enabledCmds();
    if (limit) check(on.every((c) => allow.includes(c)), `${id} — 켜진 명령 [${on.join(' ')}]이 안내가 켠 [${allow.join(' ')}] 안이다`);
    actions++;
    if (actions > 40) break;

    const scene = (fn: string) => page.evaluate((f) => (window as any).__battle.scene[f](), fn);
    if (allow.includes('move') && limit?.moveTo) {
      await press('#cmd button[data-action="move"]');
      const cells = await scene('debugChoosableCells') as { x: number; y: number }[];
      check(cells.length === 1 && cells[0]!.x === limit.moveTo.x && cells[0]!.y === limit.moveTo.y, `${id} — 이동 칸은 정해 둔 한 칸 (${limit.moveTo.x},${limit.moveTo.y})`);
      await clickCell(limit.moveTo);
      await press('#ctx-flow button[data-action="commit"]');
    } else if (allow.includes('castTactic') || allow.includes('useItem')) {
      const tactic = allow.includes('castTactic');
      await press(`#cmd button[data-action="${tactic ? 'castTactic' : 'useItem'}"]`);
      await press(tactic ? '#ctx-flow .cx-row[data-tactic]' : '#ctx-flow .cx-row[data-item]');
      if (limit?.target) {
        const pos = await page.evaluate((u) => (window as any).__battle.scene.currentState.units[u].pos, limit.target);
        await clickCell(pos);
      }
      await press('#ctx-flow button[data-action="commit"]');
    } else if (allow.includes('unique')) {
      await page.waitForSelector('#ctx-flow button[data-action="useUnique"]', { timeout: 5000 });
      await press('#ctx-flow button[data-action="useUnique"]');
    } else if (allow.includes('attack') && on.includes('attack')) {
      await press('#cmd button[data-action="attack"]');
      let cells = await scene('debugChoosableCells') as { x: number; y: number }[];
      if (cells.length === 0 && on.includes('move')) {
        // 칸을 정하지 않은 차례(기본 3) — 칠 수 있는 칸으로 다가간다
        await press('#cmd button[data-action="move"]');
        const moves = await scene('debugChoosableCells') as { x: number; y: number }[];
        const foe = await page.evaluate(() => {
          const s = (window as any).__battle.scene.currentState;
          return Object.values(s.units).find((u: any) => u.side === 'P2' && u.alive) as { pos: { x: number; y: number } };
        });
        const near = moves.sort((a, b) => Math.abs(a.x - foe.pos.x) + Math.abs(a.y - foe.pos.y) - (Math.abs(b.x - foe.pos.x) + Math.abs(b.y - foe.pos.y)))[0];
        if (near) { await clickCell(near); await press('#ctx-flow button[data-action="commit"]'); }
        continue;
      }
      if (cells.length) {
        await clickCell(cells[0]!);
        await press('#ctx-flow button[data-action="commit"]');
      } else {
        await press('#cmd button[data-action="attack"]');
        await press('#cmd button[data-action="endTurn"]');
        await press('#ctx-flow button[data-action="commit"]');
      }
    } else if (on.includes('endTurn')) {
      // 이동한 뒤 할 것이 없으면 화면이 [대기]를 미리 띄운다 — 확인창이 이미 서 있을 수 있다
      if (!(await page.$('#ctx-flow button[data-action="commit"]'))) await press('#cmd button[data-action="endTurn"]');
      await press('#ctx-flow button[data-action="commit"]');
    } else {
      await page.waitForTimeout(200);
    }
  }
  const last = seenKeys[seenKeys.length - 1] ?? '';
  check(['tut.b1.done', 'tut.b2.done', 'tut.b3.next'].includes(last), `${id} — 끝맺음 창까지 갔다 (마지막 안내 ${last})`);
  check(lockedWhileGuide, `${id} — 안내 창이 떠 있는 동안 명령 칸이 전부 꺼져 있다`);
  console.log(`  안내 ${seenKeys.length}장: ${seenKeys.join(' → ')}`);
}

for (const id of which.length ? which : ALL) await run(id);
check(errors.length === 0, `콘솔 오류 없음${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(`\n그림: ${OUT}`);
await browser.close();
process.exit(failed ? 1 : 0);
