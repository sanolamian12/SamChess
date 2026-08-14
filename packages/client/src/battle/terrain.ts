/**
 * 지형 그림 — 「이 칸에 무엇을 깔 것인가」 (2026-08-14).
 *
 * 화계·수계·성지는 지금까지 **말풍선 문장으로만** 알려졌다. 「E7에 수계가 생겼다」를
 * 읽고 판에서 그 칸을 짚어야 했는데, 수계는 아예 들어갈 수 없는 칸이라 모르고
 * 조준하면 「왜 저기로 못 가지」가 된다. 기획자가 그림 3종을 만들어 붙였다.
 *
 * ────────────────────────────────────────────────────────────────
 * 시각 효과(링)와 다른 층이다
 * ────────────────────────────────────────────────────────────────
 *
 * | | 무엇에 붙나 | 어디에 |
 * |---|---|---|
 * | 지형 그림 (이 파일) | **칸** | 판 위 고정. 유닛 아래(depth 3) |
 * | 지속형 링 (`visualEffect.ts`) | **유닛** | 유닛 컨테이너의 첫째 자식 — 같이 움직인다 |
 *
 * 둘이 함께 뜨는 자리가 있다 — 성지 칸에 유닛이 서면 **칸에는 성채 그림**이,
 * **그 유닛에는 링 `17`**이 붙는다(손권 「수성지주」). 같은 사실을 두 번 그리는 것이
 * 아니라 「이 칸이 성지다」와 「이 유닛이 그 효과를 받는 중이다」로 뜻이 다르다.
 *
 * 이 파일은 Phaser를 부르지 않는다 — `visualEffect.ts`·`camera.ts`와 같은 이유로
 * 헤드리스 검사가 가능해야 한다 (`test/terrain.test.ts`).
 */

import { TERRAIN_META } from '@samchess/rules';
import type { TerrainId } from '@samchess/rules';

/**
 * 지형 → 그림 파일 이름. `tools/build_terrain.py`가 굽는 것과 **같은 이름**이다.
 *
 * `Record<TerrainId, …>`라 지형이 늘면 컴파일이 먼저 막는다. 원본 파일명은
 * 한글(`지형_물.png`)이지만 웹으로는 지형 id를 그대로 쓴다 — URL에 한글을 넣으면
 * 서버·CDN마다 인코딩이 갈린다.
 */
export const TERRAIN_ART: Readonly<Record<TerrainId, string>> = {
  fire: 'fire',
  water: 'water',
  holy: 'holy',
};

/** 그림 경로. 링의 `ringUrl()`과 같은 규약이다. */
export const terrainUrl = (terrain: TerrainId): string => `terrain/${TERRAIN_ART[terrain]}.png`;

/**
 * 칸 안에서 그림이 차지하는 크기(px, 월드 좌표).
 *
 * 셀은 96×120이다. **칸을 꽉 채우지 않는다** — 격자선이 보여야 몇 칸짜리인지
 * 읽히고, 유닛이 그 위에 서면(화계·성지) 그림이 발밑으로 삐져나오지 않는다.
 * 원본이 정사각이라 좁은 쪽(가로 96)에 맞춘다.
 */
export const TERRAIN_SIZE = 88;

/**
 * 지형 그림의 불투명도.
 *
 * 유닛 **아래**에 깔리므로 진하면 그 칸에 선 캐릭터와 다투고, 옅으면 못 알아본다.
 * 화계·성지는 유닛이 올라서고 수계는 절대 올라서지 않는데, 그렇다고 갈래마다
 * 다르게 두지는 않았다 — 같은 층의 것이 칸마다 다른 진하기로 뜨면 그 차이가
 * 무슨 뜻인지 읽으려 들게 된다.
 */
export const TERRAIN_ALPHA = 0.85;

/**
 * 그림 표에 빠진 지형이 있는가. 테스트가 부르는 자기 점검이다.
 *
 * `TERRAIN_ART`가 `Record<TerrainId, …>`라 **키**는 컴파일이 지켜 준다. 여기서 보는
 * 것은 값 쪽이다 — 빈 문자열이나 오타는 컴파일을 통과하고 화면에서 그림만 조용히
 * 빠진다. `visualEffect.ts`의 `unmappedStatuses()`와 같은 자리다.
 */
export function unmappedTerrains(): string[] {
  return Object.keys(TERRAIN_META)
    .filter((t) => !TERRAIN_ART[t as TerrainId])
    .sort();
}
