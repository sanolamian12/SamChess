/**
 * 장수 열전 펼친 판(`LoreModal`)에 열전이 다 드는가 — 260명 × 열 언어, 글자 크기 후보마다 (2026-11-27 기획자)
 *
 *   node --experimental-strip-types tools/lore_popup_fit.ts [--sizes 1.2,1.15,1.1,1.05,1] [--view 393x852]
 *
 * 펼친 판은 화면 가로 · 세로 80%(가죽 판, 제목 · 본문 · 체크 줄)이고 글자 · 판이 다 rem(= 화면 폭 비례)이라 짜임은 기기와 상관없다 — 최소사양(iPhone 15) 하나로 잰다.
 * 로그인 없이 첫 화면에 판(`.modal-back.lore-back > .lore-modal > .lore-text`)을 끼워 넣고 열전을 갈아 끼우며 `scrollHeight`를 잰다.
 * 결과: 크기마다 넘치는 열전 수 · 가장 긴 것. **모두 드는 가장 큰 크기**를 `style.css`의 `--lore-fs`에 적는다.
 * 필요한 것: 5173(dev).
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { OFFICERS } from '@samchess/data';
import { MIN_SPEC } from './minSpec.ts';
import { loreTeaser } from '../packages/client/src/screens/loreTeaser.ts';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const SIZES = (arg('--sizes') ?? '1.25,1.2,1.15,1.1,1.05,1,0.95,0.9').split(',').map(Number);
const [VW, VH] = (arg('--view') ?? `${MIN_SPEC.width}x${MIN_SPEC.height}`).split('x').map(Number) as [number, number];
const LANGS = ['ko', 'en', 'es_419', 'it', 'ja', 'mn', 'pt_BR', 'pt_PT', 'zh_Hans', 'zh_Hant'] as const;

const stories: { id: string; lang: string; text: string }[] = [];
for (const o of OFFICERS) for (const l of LANGS) { const t = o.story?.[l]; if (t?.trim()) stories.push({ id: o.id, lang: l, text: t }); }
/** (더보기) — 언어마다. 접힌 판에 「첫머리 + (더보기)」가 드는지도 잰다 */
const MORE: Record<string, string> = {};
for (const l of LANGS) MORE[l] = (JSON.parse(readFileSync(`packages/client/src/i18n/strings/${l}.json`, 'utf8')) as Record<string, string>)['ranking.card.story.more']!;
const teasers = stories.map((s) => ({ ...s, text: loreTeaser(s.text) }));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const res = await page.evaluate(({ stories, sizes, teasers, more }) => {
    const host = document.querySelector('#frame .scr') ?? document.querySelector('#frame')!;
    const back = document.createElement('div');
    back.className = 'modal-back lore-back';
    // 제목 · 체크 줄까지 넣고 판 전체가 넘치는지 본다(제목은 긴 이름 + 자로)
    back.innerHTML = '<div class="lore-modal" style="animation:none"><h3 class="lore-title"><span class="lore-name">Сыма И</span><span class="lore-courtesy">Чжунда</span></h3><p class="lore-text"></p><div class="lore-okrow"><button class="lore-ok"></button></div></div>';
    host.appendChild(back);
    const modal = back.querySelector<HTMLElement>('.lore-modal')!;
    const p = back.querySelector<HTMLElement>('.lore-text')!;
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const out: Record<string, { over: number; worst: string; worstBy: number }> = {};
    for (const fs of sizes) {
      modal.style.setProperty('--lore-fs', `${fs}rem`);
      let over = 0; let worst = ''; let worstBy = 0;
      for (const s of stories) {
        document.documentElement.setAttribute('data-lang', s.lang);
        p.textContent = s.text;
        const by = modal.scrollHeight - modal.clientHeight;
        if (by > 1) { over++; if (by > worstBy) { worstBy = by; worst = `${s.lang} ${s.id}`; } }
      }
      out[String(fs)] = { over, worst, worstBy: Math.round((worstBy / rootPx) * 100) / 100 };
    }
    // 접힌 판 — 장수 상세 카드의 안쪽 폭(화면에서 잰 판 폭: 화면 폭의 77.6%)
    const fold = document.createElement('button');
    fold.className = 'ofcard-lore';
    fold.style.width = `${host.getBoundingClientRect().width * 0.776}px`;
    fold.innerHTML = '<span class="ofcard-lore-t"><span class="ofcard-lore-in"><span class="ofcard-lore-first"></span> <span class="ofcard-lore-more"></span></span></span>';
    back.appendChild(fold);
    const ft = fold;
    let foldOver = 0; let foldWorst = ''; let foldBy = 0;
    for (const s of teasers) {
      document.documentElement.setAttribute('data-lang', s.lang);
      fold.querySelector('.ofcard-lore-first')!.textContent = s.text;
      fold.querySelector('.ofcard-lore-more')!.textContent = more[s.lang]!;
      const by = ft.scrollHeight - ft.clientHeight;
      if (by > 1) { foldOver++; if (by > foldBy) { foldBy = by; foldWorst = `${s.lang} ${s.id} 「${s.text}」`; } }
    }
    return { out, box: { w: p.clientWidth, h: modal.clientHeight, rootPx }, fold: { over: foldOver, worst: foldWorst, w: ft.clientWidth, h: ft.clientHeight } };
  }, { stories, sizes: SIZES, teasers, more: MORE });
  console.log(`열전 ${stories.length}개 · 글자 칸 ${res.box.w}×${res.box.h}px · 1rem = ${res.box.rootPx}px (${VW}×${VH})`);
  console.log(`접힌 판 — 첫머리 + (더보기) 넘침 ${res.fold.over}개 (글 칸 ${res.fold.w}×${res.fold.h}px)${res.fold.over ? ` · 가장 넘친 것 ${res.fold.worst}` : ' ✓'}`);
  for (const fs of SIZES) {
    const r = res.out[String(fs)]!;
    console.log(`${fs.toFixed(2)}rem  넘침 ${r.over}${r.over ? `  · 가장 긴 것 ${r.worst} (+${r.worstBy}rem)` : '  ✓'}`);
  }
} finally {
  await browser.close();
}
