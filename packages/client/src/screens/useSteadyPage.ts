/**
 * 쪽을 넘겨도 판 높이가 그대로인 목록 (2026-11-13 기획자 — 「쪽을 넘길 때마다 패널 높이가 바뀌어 완성도가 떨어져 보인다」).
 *
 * 하는 일 — **언어가 바뀌면**(그리고 처음 그릴 때 · 쪽 수나 목록이 바뀔 때 · 화면 크기가 바뀔 때) 모든 쪽을 한 번씩 그려 보고,
 * 판이 가장 길어진 높이를 `min-height`로 박는다. 그 뒤로는 몇 쪽으로 넘어가든 그 높이다.
 *
 * - 쪽을 돌리는 것은 화면의 쪽 상태(`setPage`)가 아니라 **이 훅의 「살펴보는 쪽」**이다 — 화면의 쪽 넘김에는 고른 줄을 지우는 따위의
 *   곁일이 붙어 있을 수 있어서다. 그래서 화면은 목록을 자를 때 `page` 대신 이 훅이 돌려주는 쪽을 쓴다.
 * - 쪽마다 `flushSync`로 그리고 재고, 끝나면 원래 쪽으로 되돌린다 — 한 작업 안에서 다 끝나 사이에 그림이 안 찍힌다(깜빡임 없음).
 *   React가 커밋 중일 때는 `flushSync`가 안 돌아서 마이크로태스크로 미룬다.
 * - 잴 때는 박아 둔 높이를 먼저 걷는다 — 안 걷으면 더 짧아진 언어에서 옛 높이가 그대로 남는다.
 * - 쪽이 하나뿐이면 높이를 박지 않는다(넘길 쪽이 없다).
 *
 * `deps` — 목록의 내용이 바뀌는 것(갈래 · 거르기 · 정렬 · 불러온 자료). 쪽 수가 같아도 줄 내용이 바뀌면 높이가 다르다.
 *   ⚠ **원시값(글자 · 수)으로 넘긴다** — 렌더마다 새로 만드는 배열을 넣으면 잴 때 쪽을 돌리는 렌더가 또 재기를 불러 끝없이 돈다.
 *   목록이면 id를 이어 붙인 글자로.
 * 높이를 박는 자리는 `box`가 가리키는 요소 하나다 — 그 화면의 「판」(쪽 넘김 줄을 품은 상자면 줄 자리까지 함께 선다).
 * 박은 상자에는 `data-steady`가 붙고, 그 안의 쪽 줄은 판 바닥으로 내려간다(짧은 쪽에서도 쪽 줄 자리가 같다).
 * 상자가 조건부로 그려지면(대장간의 갈래처럼) 그 조건을 `deps`에 넣는다 — 상자가 새로 생긴 순간에도 다시 잰다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useLang } from '../i18n/useLang.ts';

export function useSteadyPage(
  box: RefObject<HTMLElement | null>,
  page: number,
  pageCount: number,
  deps: readonly unknown[] = [],
): number {
  const lang = useLang();
  const [probe, setProbe] = useState<number | null>(null);
  /** 마지막으로 잰 폭 — 크기 변화 가운데 폭이 바뀐 것만 다시 잰다(높이는 우리가 박은 값이 바꾼다) */
  const width = useRef(0);
  const [resized, setResized] = useState(0);

  useEffect(() => {
    let alive = true;
    const measure = (): void => {
      const el = box.current;
      if (!alive || !el) return;
      el.style.minHeight = '';
      if (pageCount <= 1) { delete el.dataset.steady; return; }
      let max = 0;
      try {
        for (let i = 0; i < pageCount; i++) {
          flushSync(() => setProbe(i));
          max = Math.max(max, el.getBoundingClientRect().height);
        }
      } finally {
        flushSync(() => setProbe(null));
      }
      width.current = el.getBoundingClientRect().width;
      if (max > 0) el.style.minHeight = `${Math.ceil(max)}px`;
      // 쪽 줄이 판 안에 있으면 판 바닥에 붙는다(`style.css`의 `[data-steady] > .pager`) — 짧은 쪽에서 줄이 위로 올라오지 않게
      el.dataset.steady = '1';
    };
    queueMicrotask(measure);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, pageCount, resized, ...deps]);

  // 화면 폭이 바뀌면(프레임 맞춤이 rem을 바꾼다) 다시 잰다
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (width.current && Math.abs(w - width.current) > 1) { width.current = w; setResized((n) => n + 1); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);

  return probe ?? page;
}
