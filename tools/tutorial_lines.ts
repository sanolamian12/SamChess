/**
 * 튜토리얼 안내 판 · 대사 판의 줄 수를 잰다 — 둘 다 크기가 고정이고 글자만 바뀐다(2026-10-30 기획자).
 *
 * - **안내 판**(`.tut-guide .tut-guide-q`, 3줄 칸) — 모든 튜토리얼의 안내(대사 제외) · 진 판 창을 **실제 판 폭에서** 접어 보고,
 *   3줄을 넘으면 실패한다. 넘으면 판이 다시 늘어난다 — 문구를 줄인다.
 * - **대사 판**(`.tut-say`, 높이 고정) — 대사(`say`)를 같은 모양의 판에 넣어 보고 글이 판 밖으로 넘치면(`scrollHeight > clientHeight`) 실패한다.
 *
 * 언어(2026-11-11, 튜토리얼 번역): `LANGS=en,ja` 또는 `LANGS=all`. 화면 언어(`localStorage['samchess.lang']`)를 심고 그 언어의 문구로 잰다 —
 * 글꼴이 언어마다 달라(키릴은 넓다) 한국어 길이로는 알 수 없다. 없는 키는 화면처럼 한국어로 물러난다.
 * 줄 수는 rem으로 잡힌 판이라 화면 폭과 무관하다(700px · 400px 같음).
 *
 *   node tools/tutorial_lines.ts                 (dev 서버 5173 필요 — 한국어)
 *   LANGS=all node tools/tutorial_lines.ts
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ALL_TUTORIALS, isSay, lineKey, stageLines, tutorialStages } from '../packages/meta/src/index.ts';

const ALL = ['ko', 'en', 'es_419', 'it', 'ja', 'mn', 'pt_BR', 'pt_PT', 'zh_Hans', 'zh_Hant'];
const want = (process.env.LANGS ?? 'ko').split(',').map((s) => s.trim());
const langs = want.includes('all') ? ALL : want;
const table = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(`packages/client/src/i18n/strings/${lang}.json`, 'utf-8').replace(/^﻿/, ''));
const ko = table('ko');

type Item = { id: string; key: string; say: boolean };
const items: Item[] = [];
for (const id of ALL_TUTORIALS) {
  let stages; try { stages = tutorialStages(id); } catch { continue; }
  for (const st of stages) for (const l of stageLines(st)) items.push({ id, key: lineKey(l), say: isSay(l) });
}
items.push({ id: '*', key: 'tut.lost', say: false });

const LIMIT = 3;
const vw = Number(process.env.VW ?? 700);
const browser = await chromium.launch();
let failed = 0;
for (const lang of langs) {
  const strings = table(lang);
  const rows = items.map((it) => ({ ...it, text: strings[it.key] ?? ko[it.key] ?? '' }));
  const page = await browser.newPage({ viewport: { width: vw, height: 1400 } });
  await page.addInitScript((l) => { try { localStorage.setItem('samchess.lang', l); } catch { /* */ } }, lang);
  await page.goto('http://localhost:5173/?tutorial=s-bang-deok');
  await page.waitForSelector('.tut-guide-q', { timeout: 30000 });
  const res = await page.evaluate((rows) => {
    const q = document.querySelector('.tut-guide-q') as HTMLElement;
    q.style.minHeight = '0'; q.style.display = 'block';   // 고정된 칸 — 재는 동안만 풀어 글의 제 높이를 본다
    const lh = parseFloat(getComputedStyle(q).lineHeight);
    // 대사 판 — 화면의 것과 같은 꼴을 가리개 옆에 하나 세운다(대사 장이 뜰 때까지 판을 몰지 않아도 되게)
    const back = document.createElement('div');
    back.className = 'modal-back gi-ask-back tut-back tut-say-back';
    back.style.visibility = 'hidden';
    back.innerHTML = '<div class="tut-say" style="animation:none"><div class="tut-say-face"></div><div class="tut-say-line">'
      + '<p class="tut-say-name">이름</p><p class="tut-say-text"></p></div></div>';
    (document.querySelector('.scr') ?? document.body).appendChild(back);
    const box = back.querySelector('.tut-say-line') as HTMLElement;
    const text = back.querySelector('.tut-say-text') as HTMLElement;
    const slh = parseFloat(getComputedStyle(text).lineHeight);
    const out = rows.map((it) => {
      if (!it.say) { q.textContent = it.text; return { ...it, lines: Math.round(q.getBoundingClientRect().height / lh), over: false }; }
      text.textContent = it.text;
      return { ...it, lines: Math.round(text.getBoundingClientRect().height / slh), over: box.scrollHeight > box.clientHeight + 1 };
    });
    back.remove();
    return out;
  }, rows);
  await page.close();

  const guide = res.filter((o) => !o.say);
  const says = res.filter((o) => o.say);
  const hist = (xs: typeof res) => xs.reduce<Record<number, number>>((h, o) => ((h[o.lines] = (h[o.lines] ?? 0) + 1), h), {});
  const gOver = guide.filter((o) => o.lines > LIMIT);
  const sOver = says.filter((o) => o.over);
  console.log(`\n[${lang}] 안내 ${guide.length}장 줄 수`, hist(guide), `· 대사 ${says.length}장 줄 수`, hist(says));
  for (const o of gOver) console.log(`  ✗ 안내 ${o.lines}줄 ${o.key} ${o.text}`);
  for (const o of sOver) console.log(`  ✗ 대사 넘침(${o.lines}줄) ${o.key} ${o.text}`);
  if (!gOver.length && !sOver.length) console.log(`  ✓ 안내 모두 ${LIMIT}줄 안 · 대사 모두 판 안`);
  failed += gOver.length + sOver.length;
}
await browser.close();
process.exit(failed ? 1 : 0);
