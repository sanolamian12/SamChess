/**
 * 화면 배경 — 시간대와 도시 자리 (pptx 33~36쪽)
 *
 * 그림은 `assets/Backgrounds/` 한 장에 여러 칸이 이어 그려져 있고,
 * `tools/build_backgrounds.py`(`npm run backgrounds`)가 칸마다 잘라
 * `public/backgrounds/{id}.jpg`로 굽는다. **칸 순서를 id로 바꾸는 표는 그 도구에 있고,
 * 여기는 「지금 어느 id를 쓸 것인가」만 정한다.**
 *
 * **확장자가 `.jpg`다** (2026-08-15). 고해상도 원본(`_big`)을 쓰면서 칸 하나가
 * 687×1536이 됐는데, PNG로 두면 열넉 장에 25MB가 넘는다. 여기와 도구의 출력
 * 확장자는 **함께 바뀌어야 한다** — 한쪽만 고치면 화면은 그대로 뜨는 것처럼 보이고
 * 그림만 404다(배경은 없어도 바탕색으로 물러나므로 눈에 잘 띄지 않는다).
 *
 * ────────────────────────────────────────────────────────────────
 * 여기는 순수 함수다 — 시계를 스스로 읽지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * `bandForHour()`가 규칙이고, 지금 시각을 넣는 것은 부르는 쪽(`currentBand()`)이다.
 * 룰 엔진의 `Date.now()` 금지와 같은 결이다 — 이쪽은 전투 재현성과 상관없지만,
 * **경계(7시·16시·20시)를 테스트로 고정하려면** 시계를 밖에서 넣을 수 있어야 한다.
 */

/** 시간대 — 그림 띠의 왼쪽부터 낮 · 황혼 · 밤 */
export type TimeBand = 'day' | 'dusk' | 'night';

/** 도시 안의 자리. 넷째 칸(`extra`)은 연결점이 정해지지 않아 화면에 아직 없다. */
export type PlaceId = 'palace' | 'barracks' | 'market';

export const PLACES: readonly PlaceId[] = ['palace', 'barracks', 'market'];

/**
 * 시각(0~23) → 시간대. **기획자 지정** (2026-08-15).
 *
 * | 그림 | 시간 |
 * |---|---|
 * | 맨 왼쪽 `day` | 07:00 ~ 15:59 |
 * | 두 번째 `dusk` | 16:00 ~ 19:59 |
 * | 세 번째 `night` | 20:00 ~ 다음날 06:59 |
 *
 * 밤이 자정을 넘어가므로 **범위가 하나로 이어지지 않는다** — 「20시 이상 또는 7시 미만」이다.
 * 이걸 `20 <= h < 7`로 적으면 언제나 거짓이 되어 밤 그림이 영영 안 나온다.
 */
export function bandForHour(hour: number): TimeBand {
  if (hour >= 7 && hour < 16) return 'day';
  if (hour >= 16 && hour < 20) return 'dusk';
  return 'night';
}

/** 지금 시각의 시간대. 접속한 기기의 시계를 따른다(서버 시각이 아니다). */
export const currentBand = (now: Date = new Date()): TimeBand => bandForHour(now.getHours());

/**
 * 도시 레벨 → 자리 그림의 단계. **기획자 지정** (2026-08-15) —
 * `1~4`는 `eachBackground.png`, `5` 이상은 `eachBackground2.png`.
 *
 * 나중에 레벨마다 더 잘게 나눌 예정이라, 화면은 「몇 번째 그림인가」만 알고
 * 그 경계는 이 함수 하나가 정한다.
 */
export const placeTier = (cityLevel: number): 1 | 2 => (cityLevel >= 5 ? 2 : 1);

/** 간판·로그인 화면의 배경 (33·34쪽) */
export const openBackdrop = (band: TimeBand): string => `backgrounds/open-${band}.jpg`;

/** 메인(도시) 화면의 배경 (35쪽) */
export const mainBackdrop = (band: TimeBand): string => `backgrounds/main-${band}.jpg`;

/**
 * 궁궐·병영·장터 화면의 배경 (35·36쪽).
 *
 * **시간대를 타지 않는다** — 원본이 자리별로만 그려져 있다.
 */
export const placeBackdrop = (place: PlaceId, cityLevel: number): string =>
  `backgrounds/place-${placeTier(cityLevel)}-${place}.jpg`;

/**
 * 「도시 전적 보기」(랭킹) 화면의 배경 — 원본 띠의 넷째 칸(게시판 그림).
 *
 * `PlaceId`에 안 넣은 이유 — 궁궐·병영·장터는 `PlaceScreen`(갈래 화면) 하나가
 * 공유하는 자리지만, 랭킹은 `CityRecordsScreen`으로 **곧장** 간다(메인의 랭킹
 * 자리, 또는 궁궐 → 도시 관리를 거쳐). `PLACES` 배열에 넣으면 메인 화면의
 * 궁궐·병영·장터 순회(`MainScreen.tsx`의 `cityHotspots`)에도 섞여 들어가
 * 존재하지 않는 `PlaceScreen`으로 이어야 하는 문제가 생긴다.
 */
export const rankingBackdrop = (cityLevel: number): string =>
  `backgrounds/place-${placeTier(cityLevel)}-ranking.jpg`;

/**
 * 배경을 CSS에 넘길 때 쓰는 인라인 스타일.
 *
 * 그림이 없어도(에셋을 안 받았을 때) 화면은 돌아야 한다 — `backgroundImage`만
 * 비고 바탕색은 스타일시트가 깔아 둔 것이 남는다. 지도·액자와 같은 규칙이다.
 */
export const backdropStyle = (url: string): React.CSSProperties => ({
  backgroundImage: `url(${url})`,
});
