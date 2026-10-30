/**
 * 수성전 — 공성전의 판 (GDD §8.8 「단계 6에서 정한 것」, 2026-10-30)
 *
 * ```
 *  y  0 ┬───────────────────────┐  북군 진영 — 수비군(AI)
 *     1 ┤         ┌───┐         │  성채 x 11–13 · y 1–3 (북군 군량고 자리)
 *     2 ┤         │ + │         │
 *     3 ┤         └───┘         │
 *       ┆                       ┆
 *    19 ┴───────────┬───────────┘  남군 진영 — 공격자(사람), 군량고 (12, 19)
 * ```
 *
 * **대전 판 그대로이고 갈리는 것은 셋뿐이다** — 북군 군량고 대신 성채가 서 있고(`siegeCastle`),
 * 북군 군량고가 없으며(`supplyDepotOf`), 60일(상한)을 버티면 수비 승이다(`checkTimeLimit`).
 * 엔진은 `state.scenario`를 보고 이 파일을 부를 뿐 좌표를 다시 적지 않는다(`raid.ts`와 같은 규약).
 *
 * 이 파일은 `battle.ts`·`state.ts`를 **값으로** import하지 않는다(순환 참조 방지).
 */

import type { Side, TerrainTile, Vec2 } from './types.ts';

/** 성을 지키는 쪽 — 공성전의 수비군은 북군이다(`meta`의 `GARRISON_SIDE`와 같다) */
export const SIEGE_DEFENDER: Side = 'P2';

/** 성채 3×3의 중심 — 북군 배치 구역(y 0–4)의 가운데. 3v3 · 5v5 둘 다 구역 가운데 열이 x 12다 */
export const SIEGE_CASTLE_CENTER: Readonly<Vec2> = { x: 12, y: 2 };
export const SIEGE_CASTLE_RADIUS = 1;

/** 이 칸이 성채 안인가 */
export const inSiegeCastle = (p: Vec2): boolean =>
  Math.abs(p.x - SIEGE_CASTLE_CENTER.x) <= SIEGE_CASTLE_RADIUS
  && Math.abs(p.y - SIEGE_CASTLE_CENTER.y) <= SIEGE_CASTLE_RADIUS;

/**
 * 처음부터 서 있는 성채 — 도적떼 판 · 손권 「수성지주」와 **같은 지형**(성지)이고 같은 조각 정보를 싣는다.
 * 그래서 새 그림도 새 판정도 없다. 성지는 진영을 가리지 않는다 — 들어온 공격자도 회복한다.
 */
export function siegeCastle(): TerrainTile[] {
  const out: TerrainTile[] = [];
  const c = SIEGE_CASTLE_CENTER;
  for (let dy = -SIEGE_CASTLE_RADIUS; dy <= SIEGE_CASTLE_RADIUS; dy++) {
    for (let dx = -SIEGE_CASTLE_RADIUS; dx <= SIEGE_CASTLE_RADIUS; dx++) {
      out.push({
        pos: { x: c.x + dx, y: c.y + dy },
        terrain: 'holy',
        lastTickedAt: 0,
        fort: { side: SIEGE_DEFENDER, dx, dy },
      });
    }
  }
  return out;
}
