/**
 * 글자 크기 하한 — 0.8rem (2026-11-18 기획자). 휴대폰 폭 390px에서 1rem ≈ 15px이라 0.8rem ≈ 12px — 모바일 가독성의 흔한 하한(11~12px).
 *
 * 스타일시트의 `font-size`는 이 값 밑으로 적지 않는다. **글자를 재서 줄이는 코드**(`useFitText` · 배치 칩 · 컬렉션 연출)도
 * 여기서 멈춘다 — 그래도 안 들어가면 줄이지 않고 접는다(말줄임으로 정보를 숨기지 않는다).
 * 확인은 `tools/font_audit.ts`(화면을 돌며 보이는 글자의 실제 크기를 잰다).
 */
export const FONT_FLOOR_REM = 0.8;

/** 지금 프레임에서의 하한(px) — rem 기준값은 `useFrameFit`이 프레임 폭에 맞춰 정한다 */
export function fontFloorPx(): number {
  return FONT_FLOOR_REM * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
}
