/**
 * 게임 프레임의 크기를 재서 스타일 기준값을 준다.
 *
 * 스타일시트는 전부 `rem`이고 그 기준을 여기서 정한다 — 프레임이 320px(작은 폰)에서
 * 700px(세로 모니터)까지 변하는데 글자만 고정이면 좁은 화면에서 커맨드가 줄바꿈되고
 * 넓은 화면에서는 허전해진다.
 *
 * `--board`는 체스판 가로 폭이다. 하단 패널의 수묵화가 "판 가로의 절반"을 넘지 않게
 * 재는 기준인데, `rem`은 글자 기준이라 이 제한을 표현할 수 없어 따로 넘긴다.
 */

import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

export function useFrameFit(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const fit = (): void => {
      const width = frame.getBoundingClientRect().width;
      if (width === 0) return;
      document.documentElement.style.fontSize = `${Math.max(11, width / 26)}px`;
      document.documentElement.style.setProperty('--board', `${width}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [ref]);
}
