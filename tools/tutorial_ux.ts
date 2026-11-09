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
import { S_TUTORIAL_OFFICERS, lineKey, sTutorialId, tutorialReady, tutorialStages } from '../packages/meta/src/index.ts';
import { apply, controllingSide, legalMovesFor, legalTargetsFor } from '../packages/rules/src/index.ts';
import { play } from '../packages/meta/test/tutorialPlay.ts';
import type { BattleState, UnitId } from '../packages/rules/src/index.ts';
import type { TutorialId } from '../packages/meta/src/index.ts';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = join(tmpdir(), 'samchess-tutorial-ux');
mkdirSync(OUT, { recursive: true });
// 판이 선 S급까지 — 끝맺음 열쇠(마지막 판의 마지막 안내)는 데이터가 안다
const ALL = ['basic-1', 'basic-2', 'basic-3', ...S_TUTORIAL_OFFICERS.map(sTutorialId).filter(tutorialReady)];
const which = process.argv.slice(2).filter((a) => ALL.includes(a));
const stageHasScene = (id: string): boolean => tutorialStages(id as TutorialId).some((st) => st.scene?.burn);
/** 엔진으로 대본대로 두었을 때 시간이 HP를 깎거나 채우는가 — 그러면 화면에도 아이콘 + 숫자가 떠야 한다(`tickPopup`, 2026-11-09) */
const TICK_REASONS = new Set(['dot', 'terrain:fire', 'terrain:holy']);
const stageTicks = (id: string): boolean => !id.startsWith('basic') && tutorialStages(id as TutorialId).some((st) => {
  try { return play(st).log.some((e) => e.e === 'hpChanged' && TICK_REASONS.has(e.reason) && (e.reason !== 'terrain:holy' || e.delta > 0)); } catch { return false; }
});
const lastLine = (id: string): string => lineKey(tutorialStages(id as TutorialId).at(-1)!.outro.at(-1)!);

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
  let finaleShots = 0;
  let moveShots = 0;
  let healShots = 0;
  const deadline = Date.now() + 900_000;   // 긴 판(곽가 · 가후 · 마초)은 연출을 다 보며 누르면 몇 분이 든다

  let burnShots = 0;
  let tickShots = 0;
  // 적 차례 앞의 자동 포커싱 (2026-11-09) — 처음 맞는 적 차례에 화면을 손으로 옮긴 척(OFF)하고, 적이 수를 두는 순간
  // 단추가 ON이고 카메라가 판 전체에 닿아 있는지 본다. 페이지 안의 rAF로 잰다 — 밖에서 들여다보면 그 순간을 놓친다
  let refocus: { manual: boolean; settled: boolean; label: string | null; waitedMs: number } | null | undefined;
  while (Date.now() < deadline) {
    // 판 도중의 장면(방통 판의 화계) — 불길이 붙는 순간부터 몇 장 찍는다
    if (burnShots === 0 && await page.evaluate(() => ((window as any).__battle?.scene?.debugBurns?.length ?? 0) > 0)) {
      for (; burnShots < 4; burnShots++) {
        await page.screenshot({ path: join(OUT, `${id}-burn-${burnShots}.png`) });
        await page.waitForTimeout(500);
      }
    }
    // 시간 HP(성채 회복 · 식소사번 · 화소연영) — 처음 뜬 몇 번을 찍는다
    if (tickShots < 3) {
      const n = await page.evaluate(() => ((window as any).__battle?.scene?.debugTickPopups?.length ?? 0));
      if (n > tickShots) { await page.waitForTimeout(250); await page.screenshot({ path: join(OUT, `${id}-tick-${tickShots}.png`) }); tickShots = n; }
    }
    const key = await guideKey();
    if (key) {
      if (!seenKeys.includes(key)) {
        seenKeys.push(key);
        if (shots < 40) await page.screenshot({ path: join(OUT, `${id}-${String(shots++).padStart(2, '0')}-${key}.png`) });
      }
      // 창이 떠 있는 동안 명령 칸은 전부 꺼져 있어야 한다
      if ((await enabledCmds()).length > 0) { lockedWhileGuide = false; if (process.env['UX_DEBUG']) console.log(`  열린 명령 [${(await enabledCmds()).join(' ')}] — 안내 ${key}`); }
      // 마지막 판의 끝맺음 — 누르면 데모가 같은 판을 처음부터 다시 띄운다. 여기서 끝낸다
      if (key === lastLine(id)) break;
      if (key === 'tut.lost') { check(false, `${id} — 안내대로 눌렀는데 졌다`); return; }
      await press('[data-modal="tutorialGuide"] button[data-action="tutorialNext"]');
      continue;
    }
    // 판이 끝났는데 안내가 아직 안 떴다 — 끝 장면(`playFinale`)이 도는 중이다. 프레임 사진으로 남긴다
    if (await page.evaluate(() => (window as any).__battle?.scene?.currentState?.phase === 'finished')) {
      if (finaleShots < 6) await page.screenshot({ path: join(OUT, `${id}-finale-${finaleShots++}.png`) });
      await page.waitForTimeout(450);
      continue;
    }
    if (refocus === undefined && await page.evaluate(() => {
      const pb = (window as any).__battle?.scene?.debugPlayback;
      return pb?.phase === 'aiThinking' && !pb.busy;
    })) {
      refocus = await page.evaluate(() => new Promise((done) => {
        const sc = (window as any).__battle.scene;
        const len0 = sc.currentState.log.length;
        const t0 = performance.now();
        let before = { manual: true, settled: false, label: null as string | null };
        sc.debugFreeCamera();
        sc.cameras.main.scrollX += 400;
        const tick = (): void => {
          if (sc.currentState.log.length > len0) {
            done({ ...before, waitedMs: Math.round(performance.now() - t0) });   // 적이 둔 그 프레임은 카메라가 이미 적에게 출발한다 — 바로 앞 프레임을 본다
          } else if (performance.now() - t0 > 8000) done(null);
          else { before = { manual: sc.debugManualCamera, settled: sc.rig.settled, label: document.querySelector<HTMLElement>('.focus-toggle')?.dataset.state ?? null }; requestAnimationFrame(tick); }
        };
        requestAnimationFrame(tick);
      }));
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
    // [대기]는 잠금의 비상구라 켠 명령 밖이어도 켜질 수 있다(할 것이 없을 때만 — `CommandFlow.commands`)
    if (limit) check(on.every((c) => allow.includes(c) || c === 'endTurn'), `${id} — 켜진 명령 [${on.join(' ')}]이 안내가 켠 [${allow.join(' ')}] 안이다`);
    actions++;
    // 대본 밖 차례에 「고유기술을 쓰시겠습니까?」가 떴다(아군의 다른 고유기술 — 마대 「신속」 등) — 대본이 시키지 않았으면 [미사용]
    const asking = await page.evaluate(() => document.querySelector<HTMLElement>('#ctx-flow')?.dataset.view === 'ask');
    if (asking && !allow.includes('unique')) { await press('#ctx-flow button[data-action="skipUnique"]'); continue; }
    // 긴 판(곽가 · 가후 — 대본 뒤 자유 차례가 스무 번 넘게 온다)도 끝까지 간다
    if (actions > 150) break;

    const scene = (fn: string) => page.evaluate((f) => (window as any).__battle.scene[f](), fn);
    if (allow.includes('move') && limit?.moveTo) {
      await press('#cmd button[data-action="move"]');
      // 갈 수 있는 칸 전부는 옅게, 정한 칸만 진하게(2026-10-24) — 판마다 첫 [이동]을 한 장 찍는다
      if (moveShots++ === 0) { await settle(); await page.screenshot({ path: join(OUT, `${id}-move-hint.png`) }); }
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
      const glints = await page.evaluate(() => (window as any).__battle.scene.debugHealGlints.length as number);
      await press('#ctx-flow button[data-action="commit"]');
      // 회복을 걸었으면 시전 자세 1초 뒤 대상 위로 반짝임이 돈다(2026-11-02) — 처음 한 번은 그 순간을 찍는다.
      // **대상의 HP가 실제로 오른 수만** 본다(2026-11-08) — 공포 · 증폭처럼 회복이 아닌 책략에도 반짝임을 요구해 가후 판 · 기본 2가 거짓으로 떨어졌다
      const healedByTactic = tactic && limit?.target ? await page.waitForFunction((u) => {
        const log = (window as any).__battle.scene.currentState.log as { e: string; unit?: string; delta?: number }[];
        const at = log.map((e) => e.e).lastIndexOf('tacticCast');
        return at >= 0 && log.slice(at + 1).some((e) => e.e === 'hpChanged' && e.unit === u && (e.delta ?? 0) > 0);
      }, limit.target, { timeout: 3000 }).then(() => true).catch(() => false) : false;
      if (healedByTactic && limit?.target) {
        const t0 = Date.now();
        if (healShots === 0) {
          for (let k = 0; k < 6; k++) {
            await page.waitForTimeout(k === 0 ? 900 : 400);
            await page.screenshot({ path: join(OUT, `${id}-heal-${k}.png`) });
          }
        }
        healShots++;
        const fired = await page.waitForFunction((n) => (window as any).__battle.scene.debugHealGlints.length > n, glints, { timeout: 8000 })
          .then(() => page.evaluate(() => (window as any).__battle.scene.debugHealGlints.at(-1))).catch(() => null);
        check(fired?.unit === limit.target, `${id} — 회복을 받은 ${limit.target}에게 반짝임이 돈다 (${fired ? `${fired.ms}ms · 누른 뒤 ${Date.now() - t0}ms 안` : '없음'})`);
      }
    } else if (allow.includes('unique')) {
      const skillGlints = await page.evaluate(() => (window as any).__battle.scene.debugHealGlints.length as number);
      await page.waitForSelector('#ctx-flow button[data-action="useUnique"]', { timeout: 5000 });
      await press('#ctx-flow button[data-action="useUnique"]');
      // 대상을 고르는 고유기술(영웅론) — 안내가 정한 그 장수를 누르면 확인창(누구에게 무엇을)이 선다 → [확인]
      if (limit?.target) {
        const pos = await page.evaluate((u) => (window as any).__battle.scene.currentState.units[u].pos, limit.target);
        await clickCell(pos);
        const panel = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('#ctx-flow');
          return `${el?.dataset.view ?? ''}/${el?.dataset.kind ?? ''}`;
        });
        check(panel === 'confirm/unique', `${id} — 고유기술 대상을 고르면 확인창이 선다 (${panel})`);
        await page.screenshot({ path: join(OUT, `${id}-unique-confirm.png`) });
        await press('#ctx-flow button[data-action="commit"]');
        // [확인]을 누른 뒤 발동 연출이 도는 동안 확인창([사용] · [취소])이 남아 있으면 「아직 누를 수 있다」로 읽힌다(2026-10-27 기획자)
        const left = await page.evaluate(() => new Promise<string[]>((done) => {
          const seen = new Set<string>();
          const t0 = performance.now();
          const tick = (): void => {
            const el = document.querySelector<HTMLElement>('#ctx-flow');
            if (el?.querySelector('button[data-action="commit"]')) seen.add(`${el.dataset.view}@${Math.round(performance.now() - t0)}`);
            if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else done([...seen].slice(0, 3));
          };
          tick();
        }));
        check(left.length === 0, `${id} — [확인]을 누른 뒤 연출 동안 확인창이 걷혀 있다${left.length ? ` (${left.join(', ')})` : ''}`);
      }
      // 고유기술로 HP가 올랐으면 두루마리 연출이 걷힌 뒤 초록 반짝임이 돈다(2026-11-03 기획자 — 지곤상증 · 한천감우)
      const healedBySkill = await page.waitForFunction(() => {
        const log = (window as any).__battle.scene.currentState.log as { e: string; delta?: number; reason?: string }[];
        const at = log.map((e) => e.e).lastIndexOf('uniqueSkillCast');
        return at >= 0 ? log.slice(at + 1).some((e) => e.e === 'hpChanged' && (e.delta ?? 0) > 0 && e.reason?.startsWith('skill:')) : false;
      }, null, { timeout: 3000 }).then(() => true).catch(() => false);
      if (healedBySkill) {
        const fired = await page.waitForFunction((n) => (window as any).__battle.scene.debugHealGlints.length > n, skillGlints, { timeout: 15000 })
          .then(() => page.evaluate(() => (window as any).__battle.scene.debugHealGlints.slice(-1)[0])).catch(() => null);
        check(fired?.kind === 'green', `${id} — 고유기술로 회복한 장수 위에 초록 반짝임이 돈다 (${fired ? `${fired.unit} · ${fired.ms}ms` : '없음'})`);
        await page.screenshot({ path: join(OUT, `${id}-unique-heal.png`) });
      }
    } else if (allow.includes('attack') && (on.includes('attack') || on.includes('move'))) {
      // **회귀의 손과 같은 판단** — 화면의 판을 그대로 가져와 엔진으로 「어디로 가서 누구를 칠지」를 고른다(가장 약한 적,
      // 대본이 정한 장수가 있으면 그 장수). 예전에는 판에서 처음 보이는 적에게 다가가다 정한 대상을 못 쳐 졌다
      const st = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__battle.scene.currentState))) as BattleState;
      const me = st.activeUnit!;
      const only = limit?.target ?? null;
      const hits = (x: BattleState): UnitId[] => legalTargetsFor(x, me).filter((u) => !only || u === only);
      const weakest = (x: BattleState, ts: UnitId[]): UnitId => [...ts].sort((a, b) => x.units[a]!.hp - x.units[b]!.hp)[0]!;
      let target: UnitId | null = hits(st).length ? weakest(st, hits(st)) : null;
      if (process.env['UX_DEBUG']) console.log(`  [${actions}] ${me} t${st.time} moved=${st.activeTurn?.moved} on=${on.join(',')} target=${target} pos=${JSON.stringify(st.units[me]!.pos)}`);
      if (!target && on.includes('move') && !st.activeTurn?.moved) {
        const tile = legalMovesFor(st, me).find((to) => hits(apply(st, controllingSide(st, st.units[me]!), { t: 'move', to }).state).length > 0);
        // 이번에 못 닿으면 가장 가까운 적(대본이 정한 장수가 있으면 그 장수)에게 다가간다 — 사람도 그렇게 한다
        const foes = Object.values(st.units).filter((u) => u.alive && controllingSide(st, u) !== 'P1' && (!only || u.id === only));
        const dist = (p: { x: number; y: number }): number => Math.min(...foes.map((f) => Math.abs(f.pos.x - p.x) + Math.abs(f.pos.y - p.y)));
        const step = tile ?? [...legalMovesFor(st, me)].sort((a, b) => dist(a) - dist(b))[0];
        if (step && (tile || dist(step) < dist(st.units[me]!.pos))) {
          await press('#cmd button[data-action="move"]');
          await clickCell(step);
          await press('#ctx-flow button[data-action="commit"]');
          continue;   // 다음 살핌에서 친다(못 닿으면 비상구 [대기])
        }
      }
      if (target) {
        // 이동한 뒤 칠 적이 닿으면 화면이 [공격]을 미리 누른다(2026-10-28) — 다시 누르면 명령 선택으로 물러난다
        if (!(await page.$('#cmd button[data-action="attack"].on'))) await press('#cmd button[data-action="attack"]');
        await clickCell(st.units[target]!.pos);
        await press('#ctx-flow button[data-action="commit"]');
      } else {
        // 칠 것이 없다 — [대기](잠금의 비상구가 켜 준다)
        if (!(await page.$('#ctx-flow button[data-action="commit"]'))) await press('#cmd button[data-action="endTurn"]');
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
  if (last !== lastLine(id)) {
    // 왜 멈췄는가 — 판의 단계 · 시각 · 차례 · 재생기 · 누른 수 · 남은 시간, 그리고 그 순간의 화면
    const why = await page.evaluate(() => {
      const sc = (window as any).__battle?.scene;
      const st = sc?.currentState;
      return { phase: st?.phase, time: st?.time, active: st?.activeUnit, winner: st?.winner, outcome: st?.outcome,
        playback: sc?.debugPlayback?.phase, busy: sc?.debugPlayback?.busy, limit: sc?.debugCommandLimit };
    });
    console.log(`  멈춘 자리: ${JSON.stringify(why)} · 누른 수 ${actions} · 남은 시간 ${Math.round((deadline - Date.now()) / 1000)}초`);
    await page.screenshot({ path: join(OUT, `${id}-stopped.png`) });
  }
  check(last === lastLine(id), `${id} — 끝맺음 창까지 갔다 (마지막 안내 ${last})`);
  if (stageHasScene(id)) check(burnShots > 0, `${id} — 장면의 불길이 붙었다`);
  if (refocus !== undefined) {
    check(!!refocus && !refocus.manual && refocus.settled && refocus.label === 'auto' && refocus.waitedMs >= 600,
      `${id} — 화면을 잡아 둔 채 적 차례가 오면 자동 포커싱을 켜고 카메라가 닿은 뒤에 적이 둔다 (${JSON.stringify(refocus)})`);
  }
  if (stageTicks(id)) {
    const kinds = await page.evaluate(() => [...new Set(((window as any).__battle?.scene?.debugTickPopups ?? []).map((p: { kind: string }) => p.kind))]);
    check(tickShots > 0, `${id} — 시간이 깎거나 채운 HP에 아이콘 + 숫자가 떴다 (${kinds.join(' · ') || '없음'})`);
  }
  check(lockedWhileGuide, `${id} — 안내 창이 떠 있는 동안 명령 칸이 전부 꺼져 있다`);
  console.log(`  안내 ${seenKeys.length}장: ${seenKeys.join(' → ')}`);
}

for (const id of which.length ? which : ALL) await run(id);
check(errors.length === 0, `콘솔 오류 없음${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(`\n그림: ${OUT}`);
await browser.close();
process.exit(failed ? 1 : 0);
