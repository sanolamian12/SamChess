/**
 * 화면 방향 — 세로(기본) · 가로 (2026-11-14, 가로 모드 가안).
 *
 * 세로는 지금까지의 1:2 프레임 그대로다. 가로는 프레임을 화면에 꽉 채우고(16:9 ~ 2.2:1),
 * 글자 기준(`rem`)을 **프레임 높이**에서 잰다 — 세로가 폭에서 재는 것과 짝이다(`useFrameFit`).
 * 모양은 전부 `landscape.css`의 `:root[data-orient="landscape"]` 아래에 있고 `style.css`는 안 건드린다 —
 * 세로 화면이 가로 작업 때문에 조용히 바뀌지 않게.
 *
 * **아직 환경설정에 단추가 없다** — 가안을 확정하는 동안은 주소로만 켠다:
 *
 *   ?orient=landscape   가로로 켜고 기억한다(이 브라우저의 localStorage)
 *   ?orient=portrait    세로로 되돌린다
 *
 * 환경설정에 붙일 때는 `setOrientation()`을 부르면 된다 — 프레임은 `ResizeObserver`가 다시 잰다.
 */

export type Orientation = 'portrait' | 'landscape';

const KEY = 'samchess.orient';

const parse = (v: string | null): Orientation | null =>
  v === 'landscape' || v === 'portrait' ? v : null;

/** 주소 → 저장된 값 → 세로. 주소로 온 값은 저장해 둔다(새로고침해도 그대로) */
export function readOrientation(): Orientation {
  const fromUrl = parse(new URLSearchParams(location.search).get('orient'));
  try {
    if (fromUrl) localStorage.setItem(KEY, fromUrl);
    return fromUrl ?? parse(localStorage.getItem(KEY)) ?? 'portrait';
  } catch {
    return fromUrl ?? 'portrait';
  }
}

export const currentOrientation = (): Orientation =>
  document.documentElement.dataset['orient'] === 'landscape' ? 'landscape' : 'portrait';

/** 문서 뿌리에 방향을 단다 — CSS(`landscape.css`)와 `useFrameFit`이 이것을 읽는다 */
export function applyOrientation(o: Orientation): void {
  document.documentElement.dataset['orient'] = o;
}

/** 환경설정용 — 바꾸고 기억한다 */
export function setOrientation(o: Orientation): void {
  try { localStorage.setItem(KEY, o); } catch { /* 저장 못 해도 이번 접속은 바뀐다 */ }
  applyOrientation(o);
}
