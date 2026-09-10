/**
 * 엔진이 들고 있는 이름표를 **화면이 id로 다시 고르는** 자리 (2026-09-11)
 *
 * `packages/rules/src/types.ts`의 `STATUS_META`(22종) · `TERRAIN_META`(3종)는
 * `label`·`desc`를 **한국어로** 갖고 있다. 룰 엔진은 UI 언어를 알면 안 되므로
 * (CLAUDE.md의 계층 규칙 — 서버도 같은 엔진을 돌린다) 엔진의 표는 그대로 두고,
 * 화면이 **id를 열쇠 삼아** 제 문구 표에서 다시 고른다. `story.ts`의
 * `pickTacticNameById`가 정확히 같은 사연으로 생긴 함수다 — 그게 없어서 장수
 * 카드의 책략 칩만 혼자 한국어로 떠 있었다(2026-09-03).
 *
 * **엔진의 표는 여전히 쓸모가 있다** — `kind`(버프/디버프)는 번역할 것이 없는
 * 판정값이고, `Record<StatusId, …>`라 상태가 늘면 **컴파일이 깨져** 빠뜨림을
 * 막는다. 여기서도 같은 보호가 선다: `status.${StatusId}.label` 꼴의 키를
 * 템플릿 리터럴 타입으로 부르므로, `ko.json`에 그 상태의 키가 없으면
 * **타입 검사가 먼저 막는다**(`t()`가 `StringKey`만 받는다).
 *
 * 진영 이름(북군·남군)도 여기 둔다 — HUD와 전투 로그 **둘이** 쓰는데, 각자
 * 적으면 한쪽만 번역되고도 화면은 아무 말도 안 한다.
 */

import { STATUS_META } from '@samchess/rules';
import type { Side, StatusId, TerrainId } from '@samchess/rules';
import { t } from './index.ts';

/** 상태이상의 표시 이름 */
export const statusLabel = (id: StatusId): string => t(`status.${id}.label`);

/** 상태이상의 설명문 — 배지를 누르면 뜬다 */
export const statusDesc = (id: StatusId): string => t(`status.${id}.desc`);

/** 버프인가 디버프인가. **번역할 것이 없는 판정값**이라 엔진의 표를 그대로 쓴다. */
export const statusKind = (id: StatusId): 'buff' | 'debuff' => STATUS_META[id].kind;

/** 지형의 표시 이름 */
export const terrainLabel = (id: TerrainId): string => t(`terrain.${id}.label`);

/** 지형의 설명문 */
export const terrainDesc = (id: TerrainId): string => t(`terrain.${id}.desc`);

/**
 * 진영 이름 (2026-08-12 확정). 판이 P2를 위쪽 5행에 두므로 **P2가 북군**이다 —
 * 이름과 판의 위아래가 어긋나면 「내가 어느 쪽이지」가 매 판 헷갈린다.
 */
export const armyName = (side: Side): string => t(`battle.army.${side}`);

/**
 * 결말의 까닭 — 「군주 격파」·「전멸」·「항복」·「판정승」·「무승부」.
 *
 * `BattleState['outcome']`은 판정값(id)이고, 그걸 사람 말로 옮기는 자리는
 * 전투 로그와 HUD **둘**이다. 한 자리에 모아 두지 않으면 한쪽만 번역된다.
 */
export const outcomeLabel = (outcome: 'kingDown' | 'wipeOut' | 'surrender' | 'timeLimit' | 'draw'): string =>
  t(`battle.outcome.${outcome}`);
