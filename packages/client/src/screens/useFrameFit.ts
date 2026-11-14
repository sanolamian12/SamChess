/**
 * 게임 프레임의 크기를 재서 스타일 기준값을 준다.
 *
 * 스타일시트는 전부 `rem`이고 그 기준을 여기서 정한다 — 프레임이 320px(작은 폰)에서
 * 700px(세로 모니터)까지 변하는데 글자만 고정이면 좁은 화면에서 커맨드가 줄바꿈되고
 * 넓은 화면에서는 허전해진다.
 *
 * `--board`는 체스판 가로 폭이다. 하단 패널의 수묵화가 "판 가로의 절반"을 넘지 않게
 * 재는 기준인데, `rem`은 글자 기준이라 이 제한을 표현할 수 없어 따로 넘긴다.
 *
 * **가로 모드**(`orientation.ts`, 2026-11-14 가안)는 짧은 변이 높이다 — 판은 높이만큼의 정사각이고,
 * 글자는 높이를 `LANDSCAPE_REM_DIV`로 나눈다. 세로의 `폭 / 26`(= 높이 / 52)보다 크게 잡은 것은
 * 가로 프레임이 세로보다 **낮아서** 같은 비율이면 휴대폰 가로에서 글자가 반으로 줄기 때문이다.
 */

import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { currentOrientation } from './orientation.ts';

/** 가로 모드의 글자 기준 — 프레임 높이 ÷ 이 값. 1080p에서 27px(세로 최대 프레임 700px의 27px과 같은 결) */
export const LANDSCAPE_REM_DIV = 40;
/** 가로 모드의 가장 작은 글자 기준 — 휴대폰 가로(높이 ≈ 360~400px)에서 글자가 읽히게 */
export const LANDSCAPE_REM_MIN = 12;

export function useFrameFit(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const fit = (): void => {
      const { width, height } = frame.getBoundingClientRect();
      if (width === 0) return;
      const root = document.documentElement.style;
      if (currentOrientation() === 'landscape') {
        root.fontSize = `${Math.max(LANDSCAPE_REM_MIN, height / LANDSCAPE_REM_DIV)}px`;
        root.setProperty('--board', `${height}px`);
        return;
      }
      root.fontSize = `${Math.max(11, width / 26)}px`;
      root.setProperty('--board', `${width}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [ref]);
}
