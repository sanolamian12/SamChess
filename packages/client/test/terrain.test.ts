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
import test from 'node:test';

import { TERRAIN_META } from '@samchess/rules';
import type { TerrainId } from '@samchess/rules';
import { TERRAIN_ART, TERRAIN_SIZE, terrainUrl, unmappedTerrains } from '../src/battle/terrain.ts';

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
