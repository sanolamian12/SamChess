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
import type { Side, TerrainId, TerrainTile } from '@samchess/rules';

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
export const terrainUrl = (art: string): string => `terrain/${art}.png`;

// ═══════════════════════════════════════════════════════════════
// 성채 — 성지 아홉 칸을 한 채로 그린다 (2026-09-10)
// ═══════════════════════════════════════════════════════════════

/**
 * 성채의 조각. 중심(`keep`)과 성벽 넷, 모서리 넷.
 *
 * 이름은 **방위**다 — `n`은 중심의 북쪽 칸, 즉 판에서 한 칸 위다(y가 아래로
 * 자란다). 굽는 도구(`tools/build_terrain.py`)가 같은 이름으로 회전본을 찍는다.
 */
export type FortPiece = 'keep' | 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * 중심에서의 상대 위치 → 조각.
 *
 * 반경이 1보다 커지는 날에도 **바깥 테두리는 같은 모양**이라 부호만 본다 —
 * 지금은 3×3뿐이라 `dx`·`dy`가 −1·0·1이다.
 */
export function fortPiece(dx: number, dy: number): FortPiece {
  const ns = Math.sign(dy) < 0 ? 'n' : Math.sign(dy) > 0 ? 's' : '';
  const ew = Math.sign(dx) < 0 ? 'w' : Math.sign(dx) > 0 ? 'e' : '';
  return ((ns + ew) || 'keep') as FortPiece;
}

/** 모서리 넷은 회색 돌뿐이라 **진영 색이 없다.** 성과 성벽만 남군·북군이 갈린다. */
const COLORLESS: ReadonlySet<FortPiece> = new Set<FortPiece>(['ne', 'nw', 'se', 'sw']);

/** 조각 그림 이름. `keep-p1` · `n-p2` · `sw`처럼 `fort/` 아래에 깔린다. */
export function fortArt(piece: FortPiece, side: Side): string {
  return COLORLESS.has(piece) ? `fort/${piece}` : `fort/${piece}-${side === 'P1' ? 'p1' : 'p2'}`;
}

/** 미리 받아야 할 성채 그림 전부. 굽는 도구가 내놓는 파일 목록과 같아야 한다. */
export const FORT_ART: readonly string[] = (() => {
  const pieces: FortPiece[] = ['keep', 'n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
  return [...new Set(pieces.flatMap((p) => [fortArt(p, 'P1'), fortArt(p, 'P2')]))];
})();

/**
 * 이 칸에 무엇을 그릴 것인가.
 *
 * 성채 조각 정보(`tile.fort`)가 없는 성지는 **옛 그림 한 장**으로 그린다 —
 * 개발용 통로(`?terrain=1`)가 놓는 홑칸과, 이 상향 이전에 저장된 판이 그렇다.
 */
export function terrainArt(tile: TerrainTile): string {
  if (tile.terrain === 'holy' && tile.fort) {
    return fortArt(fortPiece(tile.fort.dx, tile.fort.dy), tile.fort.side);
  }
  return TERRAIN_ART[tile.terrain];
}

/**
 * 칸 안에서 그림이 차지하는 크기(px, 월드 좌표).
 *
 * 셀은 96×120이다. **칸을 꽉 채우지 않는다** — 격자선이 보여야 몇 칸짜리인지
 * 읽히고, 유닛이 그 위에 서면(화계·성지) 그림이 발밑으로 삐져나오지 않는다.
 * 원본이 정사각이라 좁은 쪽(가로 96)에 맞춘다.
 */
export const TERRAIN_SIZE = 88;

/**
 * 성채 조각은 **칸을 꽉 채운다** — 화계·수계와 다른 유일한 자리다.
 *
 * 아홉 칸이 한 채로 읽혀야 해서 성벽이 이웃 칸의 성벽과 이어져야 하고, 88px로
 * 줄이면 칸마다 사방에 틈이 생겨 **아홉 조각으로 흩어져 보인다.** 칸이 96×120
 * (정사각이 아니다)이라 정사각 원본이 세로로 1.25배 늘어나는데, 성이 조금 높아
 * 보이는 쪽이 성벽이 끊겨 보이는 쪽보다 낫다고 봤다.
 */
export const isFortArt = (art: string): boolean => art.startsWith('fort/');

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
