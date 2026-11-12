/**
 * 건물 판의 이름 맞추기 — 도시 관리와 건물 관리가 함께 쓴다 (2026-11-12)
 */

import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * 건물 이름을 **두 줄 안에** 넣는다 — 못 넣으면 이름 글씨를 한 단계씩 줄인다 (2026-11-12 지정).
 * 현황 칸이 오른쪽 벽에 붙고 이름 칸이 남는 폭을 다 먹는데, 그 폭은 언어 · 판 폭마다 달라
 * CSS 값 하나로는 못 정한다. 단어 가운데서는 끊지 않는다(`overflow-wrap: normal`) — 그래서
 * 「단어 하나가 칸보다 넓다」(`scrollWidth > clientWidth`)도 넘친 것으로 본다.
 * 줄인 배율은 이름 **전부**에 같이 건다 — 줄마다 글씨 크기가 다르면 표가 흔들려 보인다.
 */
export function useFitNames(lang: string): RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const fit = (): void => {
      let scale = 1;
      box.style.setProperty('--nm-scale', '1');
      const over = (): boolean => [...box.querySelectorAll<HTMLElement>('.cty-bld .nm .gic-t')].some((el) => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height;
        return el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > lh * 2 + 1;
      });
      while (over() && scale > 0.6) {
        scale = Math.round((scale - 0.05) * 100) / 100;
        box.style.setProperty('--nm-scale', String(scale));
      }
      box.dataset.nmScale = String(scale);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [lang]);
  return ref;
}
