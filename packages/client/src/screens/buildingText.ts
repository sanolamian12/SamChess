/**
 * 건물에 관해 **화면이 적는 문장** — 도시 관리와 산 너머가 여기서 가져다 쓴다 (2026-09-04).
 *
 * 두 가족이다. **현황**(`buildingStatusText`, 값이 들어간다)과 **소개**
 * (`buildingDescText`, 값이 없다). 어느 화면이 무엇을 쓰는지는 각 함수의 주석에 있다.
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 화면이 아니라 여기인가
 * ────────────────────────────────────────────────────────────────
 *
 * 처음엔 `CityScreen` 안의 작은 함수였는데, 산 너머(`MainScreen`의 확장 도시)도
 * 같은 말을 적게 되면서 **두 화면이 같은 문장을 각자 조립하는** 모양이 됐다.
 * 「같은 뜻이면 같은 자리」 — 한쪽만 고치면 성 안과 성 밖이 같은 건물을 다르게
 * 말하는데, 그건 화면을 두 번 오가야만 보인다.
 *
 * ────────────────────────────────────────────────────────────────
 * 값은 규칙이, 문장은 i18n이 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 숫자는 전부 `@samchess/meta`의 함수(`poolUsed`·`grainCap`·`grainPerHour`·
 * `hospitalRooms`)와 규칙이 낸 `row.status`에서 온다 — 여기서 계산하지 않는다.
 *
 * 문장을 `strings/{lang}.json`에 두는 것은 **엑셀에서 오는 `purpose`·`blurb`가
 * 한국어 한 벌뿐이라 열 언어로 번역될 수가 없기** 때문이다. 그래서 규칙이 낸
 * 줄(`row.status`)을 기본으로 쓰되, 번역이 필요한 자리만 여기서 갈아 끼운다.
 *
 * | 건물 | 무엇을 적나 | 왜 갈아 끼우나 |
 * |---|---|---|
 * | 궁궐 | 현원 5 / 최대 60 명 | 한도가 아니라 **지금 얼마나 쓰는가**가 궁금하다 |
 * | 병영 | 현재 20 / 최대 20 | 〃 |
 * | 농지 | 시간당 군량 생산량 1 | 안 지어도 1은 찬다 — 그 값이 여기서 나온다 |
 * | 병원 | 치료실 2 | 엑셀 라벨이 「치료 room」이라 화면에 그대로 못 쓴다 |
 * | 시장·대장간 | 하는 일 | 값이 아예 없어(품목 표 미정) 규칙이 낼 줄이 없다 |
 * | 태학 | 장수 훈련 · 보정 2 | 엑셀 라벨(「훈련 보정」)만으로는 **뭘 하는 건물인지** 안 보인다 |
 */

import { grainCap, grainPerHour, hospitalRooms, poolCap, poolUsed, trainingBonus } from '@samchess/meta';
import type { BuildingId } from '@samchess/data';
import type { BuildingRow, PlayerProfile } from '@samchess/meta';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';

/**
 * 그 건물이 **무엇을 하는 곳인가** — 한 줄 소개 (2026-09-04 기획자 지정).
 *
 * ★ **현황(`buildingStatusText`)과 뜻이 다르다.** 소개는 값이 없고 안 바뀐다.
 *
 * | 화면 | 무엇을 적나 | 왜 |
 * |---|---|---|
 * | 도시 관리(현황판) | 「시간당 군량 생산량 4」 | 지금 형편을 재러 온 자리다 |
 * | 산 너머(지도) | 「군량 생산량을 늘린다.」 | 건물 그림 밑에 붙는 이름표다 — 성 안 자리 넷(궁궐 「장수와 정사를 살핀다」)과 **같은 결**이라야 한 화면으로 읽힌다 |
 *
 * 그래서 열쇠도 성 안 자리와 **같은 규약**(`place.{id}.sub`)을 쓴다 — 산 너머라고
 * 다른 이름을 지으면 같은 자리의 같은 줄이 두 규약을 갖게 된다.
 */
export const buildingDescText = (id: BuildingId): string => t(`place.${id}.sub` as StringKey);

export function buildingStatusText(profile: PlayerProfile, row: BuildingRow): string {
  switch (row.id) {
    case 'palace':
      return t('city.pool.n', { have: poolUsed(profile), max: poolCap(profile) });
    case 'barracks':
      return t('city.bld.grain', { have: profile.grain, max: grainCap(profile) });
    case 'farm':
      return t('city.bld.farm', { n: grainPerHour(profile) });
    case 'hospital':
      return t('city.bld.hospital', { n: hospitalRooms(profile) });
    case 'market':
      return t('city.bld.market');
    case 'academy':
      return t('city.bld.academy', { n: trainingBonus(profile) });
    case 'forge':
      return t('city.bld.forge.what');
    default:
      // 규칙이 낸 줄 그대로. 값이 없는 건물이면 쓰임을 적는다
      return row.status ?? t('city.bld.pending', { what: row.purpose });
  }
}
