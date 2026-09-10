/**
 * 지형 그림 회귀 — 「어떤 지형이 어떤 파일로 뜨는가」를 못 박는다 (2026-08-14).
 *
 * 작지만 조용히 새기 쉬운 자리다. 지형이 하나 늘면 `TERRAIN_ART`가
 * `Record<TerrainId, …>`라 **키**는 컴파일이 막아 주는데, 값은 문자열이라
 * 오타·빈칸이 그대로 통과하고 화면에서는 그 지형만 그림 없이 지나간다 —
 * 판이 그 상황(「화계」·「수계」·「수성지주」 시전)이 되어야 보이는 것이라
 * 눈으로 잡기가 특히 어렵다. `visualEffect.test.ts`의 `unmappedStatuses()`와 같은 자리다.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { TERRAIN_META } from '@samchess/rules';
import type { TerrainId, TerrainTile } from '@samchess/rules';
import {
  FORT_ART, TERRAIN_ART, TERRAIN_SIZE, fortArt, fortPiece, isFortArt, terrainArt, terrainUrl,
  unmappedTerrains,
} from '../src/battle/terrain.ts';

test('지형 3종이 전부 그림 표에 있다', () => {
  assert.deepEqual(unmappedTerrains(), []);
  assert.deepEqual(Object.keys(TERRAIN_ART).sort(), Object.keys(TERRAIN_META).sort());
});

test('그림 경로는 지형 id 하나로 만들어진다 — 한글 파일명은 굽는 단계에서 끝난다', () => {
  for (const terrain of Object.keys(TERRAIN_META) as TerrainId[]) {
    const url = terrainUrl(terrain);
    assert.equal(url, `terrain/${terrain}.png`);
    // URL에 한글이 남으면 서버·CDN마다 인코딩이 갈린다. 이름을 잇는 자리는
    // `tools/build_terrain.py`의 표 하나뿐이다.
    assert.match(url, /^[\x21-\x7e]+$/);
  }
});

test('지형 그림은 칸(96×120)보다 작다 — 격자선이 보여야 몇 칸짜리인지 읽힌다', () => {
  assert.ok(TERRAIN_SIZE < 96, `TERRAIN_SIZE=${TERRAIN_SIZE} 가 셀 가로폭을 넘는다`);
});

test('지형 이름의 단일 출처는 엔진이다', () => {
  // 화면이 「화계」·「수계」·「성지」를 따로 적어 두면 엔진과 조용히 어긋난다.
  // 말풍선(`ui/eventText.ts`)도 이 표를 읽는다.
  assert.equal(TERRAIN_META.fire.label, '화계');
  assert.equal(TERRAIN_META.water.label, '수계');
  assert.equal(TERRAIN_META.holy.label, '성지');
});

// ── 성채 (2026-09-10) ──────────────────────────────────────────

test('조각 이름은 중심에서의 방위다 — y는 아래로 자란다', () => {
  assert.equal(fortPiece(0, 0), 'keep');
  assert.equal(fortPiece(0, -1), 'n');
  assert.equal(fortPiece(0, 1), 's');
  assert.equal(fortPiece(1, 0), 'e');
  assert.equal(fortPiece(-1, 0), 'w');
  assert.equal(fortPiece(-1, -1), 'nw');
  assert.equal(fortPiece(1, -1), 'ne');
  assert.equal(fortPiece(-1, 1), 'sw');
  assert.equal(fortPiece(1, 1), 'se');
});

test('모서리 넷만 진영 색이 없다 — 그림도 한 벌뿐이다', () => {
  for (const piece of ['ne', 'nw', 'se', 'sw'] as const) {
    assert.equal(fortArt(piece, 'P1'), fortArt(piece, 'P2'));
  }
  for (const piece of ['keep', 'n', 'e', 's', 'w'] as const) {
    assert.notEqual(fortArt(piece, 'P1'), fortArt(piece, 'P2'));
  }
  // 성·성벽 2진영 × 5 + 모서리 4 = 14장
  assert.equal(FORT_ART.length, 14);
  assert.equal(new Set(FORT_ART).size, 14);
});

test('성채 그림 경로에도 한글이 남지 않는다', () => {
  for (const art of FORT_ART) {
    assert.ok(isFortArt(art), `${art} 가 fort/ 아래가 아니다`);
    assert.match(terrainUrl(art), /^[!-~]+$/);
  }
});

test('조각 정보가 없는 성지는 옛 그림 한 장으로 뜬다', () => {
  // 개발용 통로(`?terrain=1`)의 홑칸과, 이 상향 이전에 저장된 판이 여기로 온다.
  const lone: TerrainTile = { pos: { x: 1, y: 1 }, terrain: 'holy', lastTickedAt: 0 };
  assert.equal(terrainArt(lone), 'holy');
  assert.equal(isFortArt(terrainArt(lone)), false);
  const piece: TerrainTile = { ...lone, fort: { side: 'P2', dx: 1, dy: -1 } };
  assert.equal(terrainArt(piece), 'fort/ne');
  assert.equal(terrainArt({ ...piece, fort: { side: 'P2', dx: 0, dy: -1 } }), 'fort/n-p2');
});

test('구워 둔 성채 그림과 화면이 부르는 이름이 같다', () => {
  // 에셋은 리포에 없다 — `npm run terrain`을 돌린 자리에서만 실제로 대조한다.
  // 이름을 잇는 자리가 둘(도구의 `FORT_BASE`·`FORT_TURNS`와 여기 `FORT_ART`)이라
  // 한쪽만 고치면 화면에서 그 조각만 조용히 빠진다.
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/terrain/fort');
  if (!existsSync(dir)) return;
  const baked = readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => `fort/${f.slice(0, -4)}`);
  assert.deepEqual(baked.sort(), [...FORT_ART].sort());
});
