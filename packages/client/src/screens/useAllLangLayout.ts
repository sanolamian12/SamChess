/**
 * 열 언어 어느 것으로 봐도 같은 크기 — 줄 높이 · 판 높이를 **열 언어 가운데 가장 큰 것**에 맞춘다
 * (2026-11-13 기획자 — 「몽골어 · 포르투갈어 · 에스파냐어에서 두 줄이 되며 판이 늘어난다. 언어를 바꿔도 판 크기가 일관되게」).
 *
 * 하는 일 — 화면에 들어올 때(그리고 판 폭이 바뀔 때 · 글꼴을 다 받았을 때 · `sig`가 바뀔 때) **화면 언어를 열 언어로 차례로
 * 바꿔 그려 보고**(`previewLang`), 판마다
 *  - 줄(`rows`)이 있으면 가장 높은 줄의 높이를 `--row-h`로 판에 건다 — CSS가 줄의 `min-height`로 읽는다,
 *  - 판의 높이를 「모든 줄이 그 높이일 때」로 셈해 가장 큰 언어의 값을 `min-height`로 박는다.
 * 끝나면 원래 언어로 되돌린다. 한 작업 안에서 다 끝나(마이크로태스크 → `flushSync`) 사이에 그림이 안 찍힌다.
 *
 * 왜 숨은 사본이 아니라 언어를 바꿔 그리나 — 건물 줄처럼 **컴포넌트 안에서 `t()`를 부르는** 줄은 다른 언어로 미리 만들어 둘 수가 없다
 * (튜토리얼 목록은 줄 글을 미리 만드는 꼴이라 숨은 사본으로 잰다, `TutorialListScreen`). 언어를 바꾸면 그 언어의 글꼴
 * (`:root[data-lang]` — 몽골어 PT Serif)과 이름 맞춤(`useFitNames`)까지 그 언어대로 돌아 실제 화면과 같은 값을 잰다.
 *
 * - `previewLang`은 저장 · 더빙을 안 건드린다 — 화면에 남는 것은 원래 언어뿐이다.
 * - 줄이 판 안에서 세로로 쌓인다고 본다(판 높이 = 줄 아닌 몫 + 줄 수 × 줄 높이). 판이 바깥 칸에 눌려 줄어드는 자리에는 쓰지 않는다.
 * - `sig`에는 **언어와 무관한 원시값**만 — 언어마다 바뀌는 값을 넣으면 재는 도중 다시 재기를 부른다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';
import { LANGS, currentLang, previewLang } from '../i18n/index.ts';

export interface LangBox {
  box: RefObject<HTMLElement | null>;
  /** 높이를 하나로 맞출 줄 — 판 안에서 고르는 선택자(예: `:scope > .cty-bld`) */
  rows?: string;
}

export function useAllLangLayout(boxes: readonly LangBox[], sig: string): void {
  const latest = useRef(boxes);
  latest.current = boxes;
  const busy = useRef(false);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    let alive = true;
    // 커밋 중에는 `flushSync`가 안 돈다 — 마이크로태스크는 이 커밋이 끝난 뒤, 그림이 찍히기 전에 돈다
    queueMicrotask(() => { if (alive) measure(latest.current, busy); });
    return () => { alive = false; };
  }, [sig, tick]);

  // 판 폭이 바뀌면(프레임 맞춤이 rem을 바꾼다) 다시 잰다 — 높이는 우리가 박은 값이 바꾸므로 폭만 본다
  useLayoutEffect(() => {
    const el = latest.current[0]?.box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = Math.round(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(() => {
      const now = Math.round(el.getBoundingClientRect().width);
      if (now !== w) { w = now; setTick((n) => n + 1); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 브라우저는 쓰이기 전까지 글꼴을 안 받는다 — 몽골어 글꼴은 재는 동안에야 받기 시작하므로 다 받으면 다시 잰다
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) return;
    let live = true;
    const bump = (): void => { if (live && !busy.current) setTick((n) => n + 1); };
    fonts.addEventListener('loadingdone', bump);
    return () => { live = false; fonts.removeEventListener('loadingdone', bump); };
  }, []);
}

function measure(boxes: readonly LangBox[], busy: { current: boolean }): void {
  if (busy.current) return;
  const targets = boxes.map((b) => ({ el: b.box.current, rows: b.rows })).filter((x): x is { el: HTMLElement; rows: string | undefined } => !!x.el);
  if (targets.length === 0) return;
  busy.current = true;
  for (const { el } of targets) { el.style.minHeight = ''; el.style.removeProperty('--row-h'); }
  const stats = targets.map(() => ({ maxRow: 0, panels: [] as { rest: number; n: number }[] }));
  const orig = currentLang();
  try {
    for (const { id } of LANGS) {
      flushSync(() => previewLang(id));
      targets.forEach(({ el, rows }, i) => {
        const height = el.getBoundingClientRect().height;
        let sum = 0;
        let n = 0;
        if (rows) {
          for (const row of el.querySelectorAll<HTMLElement>(rows)) {
            const h = row.getBoundingClientRect().height;
            sum += h; n++;
            stats[i]!.maxRow = Math.max(stats[i]!.maxRow, h);
          }
        }
        stats[i]!.panels.push({ rest: height - sum, n });
      });
    }
  } finally {
    flushSync(() => previewLang(orig));
    busy.current = false;
  }
  targets.forEach(({ el, rows }, i) => {
    const s = stats[i]!;
    const row = Math.ceil(s.maxRow);
    if (rows && row > 0) el.style.setProperty('--row-h', `${row}px`);
    const panel = Math.max(...s.panels.map((p) => p.rest + p.n * row));
    if (panel > 0) el.style.minHeight = `${Math.ceil(panel)}px`;
    el.dataset['allLang'] = '1';
  });
}
