/**
 * 튜토리얼 안내 판의 줄 수를 잰다 — 안내 판은 크기가 고정이고(`style.css`의 `.tut-guide .tut-guide-q`, 3줄 칸) 글자만 바뀐다
 * (2026-10-30 기획자). 모든 튜토리얼의 안내(대사 제외) · 진 판 창을 **실제 판 폭에서** 접어 보고, 3줄을 넘는 것이 있으면 실패한다.
 * 넘으면 판이 다시 늘어난다 — 문구를 줄인다. 줄 수는 rem으로 잡힌 판이라 화면 폭과 무관하다(700px · 400px 같음).
 *
 *   node tools/tutorial_lines.ts      (dev 서버 5173 필요)
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ALL_TUTORIALS, lineKey, tutorialStages } from '../packages/meta/src/index.ts';
const ko = JSON.parse(readFileSync('packages/client/src/i18n/strings/ko.json', 'utf-8').replace(/^﻿/, ''));
const items: { id: string; key: string; text: string }[] = [];
for (const id of ALL_TUTORIALS) {
  let stages; try { stages = tutorialStages(id); } catch { continue; }
  for (const st of stages) {
    const ls = [...st.guide.flatMap((t) => t.phases.flatMap((p) => p.lines)), ...st.outro].filter((l) => typeof l === 'string');
    for (const l of ls) items.push({ id, key: lineKey(l), text: ko[lineKey(l)] ?? '' });
  }
}
items.push({ id: '*', key: 'tut.lost', text: ko['tut.lost'] });
const browser = await chromium.launch();
const vw = Number(process.env.VW ?? 700);
const page = await browser.newPage({ viewport: { width: vw, height: 1400 } });
await page.goto('http://localhost:5173/?tutorial=s-bang-deok');
await page.waitForSelector('.tut-guide-q', { timeout: 30000 });
const res = await page.evaluate((items) => {
  const q = document.querySelector('.tut-guide-q') as HTMLElement;
  const fixedH = q.getBoundingClientRect().height;   // 고정된 칸 — 재는 동안만 풀어 글의 제 높이를 본다
  q.style.minHeight = '0'; q.style.display = 'block';
  const lh = parseFloat(getComputedStyle(q).lineHeight);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const out = items.map((it) => { q.textContent = it.text; return { ...it, lines: Math.round(q.getBoundingClientRect().height / lh) }; });
  const modal = document.querySelector('.tut-guide') as HTMLElement;
  return { lh, rem, w: modal.getBoundingClientRect().width, fixed: Math.round(fixedH / lh), out };
}, items);
console.log(`vw ${vw} rem ${res.rem} line ${res.lh} panel w ${res.w} 고정 칸 ${res.fixed}줄 — 문구 ${res.out.length}개`);
const hist: Record<number, number> = {};
for (const o of res.out) hist[o.lines] = (hist[o.lines] ?? 0) + 1;
console.log('줄 수 분포', hist);
const max = Math.max(...res.out.map((o) => o.lines));
const LIMIT = 3;
for (const o of res.out.filter((o) => o.lines >= Math.max(max, LIMIT))) console.log(`${o.lines > LIMIT ? '✗' : ' '} ${o.lines}줄 ${o.id} ${o.key} ${o.text}`);
await browser.close();
const over = res.out.filter((o) => o.lines > LIMIT);
console.log(over.length ? `✗ ${over.length}장이 ${LIMIT}줄을 넘는다 — 판이 늘어난다` : `✓ 모두 ${LIMIT}줄 안 (가장 긴 것 ${max}줄)`);
process.exit(over.length ? 1 : 0);
