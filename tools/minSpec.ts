/**
 * 최소사양 기기 — **iPhone 15** (2026-11-27 기획자). 세로 393 × 852 CSS px, 화질 3배.
 *
 * 글자 기준은 `useFrameFit`이 폭 ÷ 26으로 정하므로 이 폭에서 1rem ≈ 15.1px, 하한 0.8rem(`fontFloor.ts`) ≈ 12.1px다.
 * 「휴대폰에서 읽히는가 · 판이 화면에 드는가」를 보는 도구는 이 값으로 찍는다 — 도구마다 390 × 844 같은 숫자를
 * 따로 적으면 한쪽만 낡는다. 이보다 좁은 기기(360px급 안드로이드)도 화면은 그려지지만 가독성은 보장하지 않는다.
 */
export const MIN_SPEC = { name: 'iPhone 15', width: 393, height: 852, dpr: 3 } as const;

/** 세로 뷰포트 */
export const MIN_SPEC_PORTRAIT = { width: MIN_SPEC.width, height: MIN_SPEC.height } as const;
/** 가로로 눕혔을 때 */
export const MIN_SPEC_LANDSCAPE = { width: MIN_SPEC.height, height: MIN_SPEC.width } as const;
