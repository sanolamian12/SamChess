/**
 * **서버가 소유하는 필드** — `PUT /profile`이 클라이언트 값을 버리고 되쓰는 것들.
 * (H3d가 `grain`에 세운 경계, 2026-09-04에 도시·부상까지 넓혔다)
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 `packages/server-api`가 아니라 여기인가 ★
 * ────────────────────────────────────────────────────────────────
 *
 * **여기 있어야 `npm test`가 잡는다.** 되접기(`migrate.ts`)를 저장 층이 아니라 meta에
 * 둔 것과 똑같은 이유다 — 이 방어는 **깨져도 화면에 아무것도 안 뜬다.** 필드를
 * 하나 빠뜨리면 그 필드만 조용히 클라이언트 주장대로 저장되고, 서버 로그에도
 * 흔적이 없다. `server-api`에 두면 DB 없이는 부를 수도 없어 회귀가 아예 안 선다.
 *
 * 순수 함수다 — I/O도 시계도 없다.
 *
 * ────────────────────────────────────────────────────────────────
 * 필드를 더할 때 ★
 * ────────────────────────────────────────────────────────────────
 *
 * `PlayerProfile`에 새 필드를 넣을 때마다 **「이건 클라이언트가 정하나 서버가
 * 정하나」를 한 번 묻는다.** 서버가 정하는 것이면 여기 이름을 넣고, **동시에 그
 * 값을 바꾸는 전용 경로를 만든다** — 버리기만 하고 경로를 안 만들면 그 행위가
 * 아무 오류 없이 삼켜진다(무승부의 군량 택1이 `/battle/draw-result`를 새로
 * 만들어야 했던 자리).
 */

import type { OfficerId } from '@samchess/rules';
import type { PlayerProfile } from './types.ts';

/**
 * 통째로 서버 값을 지키는 최상단 필드들.
 *
 * | 필드 | 정본을 만드는 자리 |
 * |---|---|
 * | `grain` · `grainAt` | `getProfile()`의 서버 시계 정산 · 전투 보상 |
 * | `materials` | 전투 보상(승리 1) · `POST /city/upgrade` |
 * | `buildings` · `buildCredits` | `POST /city/upgrade` · `POST /city/build` |
 * | `hospitalBusy` | `POST /city/heal` |
 * | `forgeOrder` | `POST /forge/order` (취소는 없다 — 2026-09-25) |
 * | `forgeMadeAt` | `collectForgeOrder()` — 서버 시계로 찍는 제작일 |
 * | `gold` | `POST /market/gacha` · `/city/rename` · `/officer/respec` · `/market/materials` · `/forge/*` · `/academy/reset` · `/dev/grant` |
 * | `gachaPool` | `POST /market/gacha` — 유한 배열의 시드·소비 수 |
 * | `cityName` · `cityNameChangedAt` | 첫 저장(도시 생성) · `POST /city/rename` |
 * | `academy` | `POST /academy/research` · `/academy/cancel` · `/academy/ack` · `/academy/reset` · 거두기는 `syncCity()` |
 * | `cityLevel` | `POST /city/upgrade` |
 * | `record` · `matches` · `matchSeq` | 전투 정산(`settleOutcome` · AI 재생 · 공성전 · 온라인 · 방치 정산) |
 *
 * **`cityLevel` · `record` · `matches` · `matchSeq`는 2026-11-12에 옮겨 왔다** — 목록에 없어서 **아무 저장으로나** 도시 레벨을 11로,
 * 전적을 50전 50승 · 승점 99,999로 적을 수 있었다(개발 DB에서 재현). 도시 레벨은 장수 레벨 상한 · 건설 조건을, 전적의 승점은 랭킹을 정한다.
 * 정상 경로는 처음부터 전부 서버였다 — 증축은 `/city/upgrade`, 전적은 서버 정산. 서버에 못 닿을 때 화면이 로컬로 계산해 올리던 것
 * (증축 · 전투 결과)은 이제 다음 읽기에 서버 값으로 돌아간다 — 자재 · 카드와 같은 결이다(증축은 그전에 **레벨만 오르고 자재는 안 줄었다**).
 * 이상 징후 감시의 이야기는 `history/2026-11-12_이상징후_설계.md`, 이번 일은 `history/2026-11-12b_클라이언트신뢰_구멍.md`.
 *
 * **`cityName`은 2026-09-19에 옮겨 왔다** — 도시 이름이 계정 사이에 고유해졌다(DB의
 * `profiles_city_name_key`). `PUT`으로 이름을 바꿀 수 있으면 금화·쿨다운을 건너뛸 뿐
 * 아니라, 겹치는 이름을 올린 순간 **그 뒤의 저장이 전부 거절된다**(행 전체가 한 칸이라
 * 고유 인덱스에 걸린 저장은 다른 필드까지 못 쓴다). 이름을 정하는 길은 둘뿐이다.
 *
 * **`gold`·`gachaPool`은 2026-09-14(A1)에 옮겨 왔다.** 그전에는 가챠·도시 이름·재설계가
 * 로컬로 계산해 `PUT`으로 올렸고, 그래서 **API를 직접 부르면 금화를 마음대로 적을 수
 * 있었다**(현금 가챠라 치팅 유인이 가장 큰 자리). 금화가 들어오는 길은 아직 개발용
 * 지급뿐이다 — 금화팩 결제가 붙으면 그것도 서버 경로여야 한다.
 */
export const SERVER_OWNED_FIELDS = [
  'grain', 'grainAt', 'materials', 'buildings', 'buildCredits', 'hospitalBusy', 'forgeOrder',
  'forgeMadeAt', 'gold', 'gachaPool', 'roster', 'cards', 'cityName', 'cityNameChangedAt',
  // 도적떼 — 출몰·정산이 서버 시계로만 일어난다 (GDD §5.11). `farmGuards`는 클라이언트 것이다
  'raid',
  // 태학 연구 — 전투의 책략을 바꾼다 (GDD §5.12). `POST /academy/*`만 바꾼다
  'academy',
  // 시장 아이템 — 금화로 산다 (GDD §6.5). `marketCarry`(누가 들고 갈지)는
  // 총량을 안 바꾸므로 클라이언트 것이다 — `farmGuards`와 같은 결
  'marketOwned', 'marketTaken', 'marketInPlay', 'marketBoughtAt',
  // 컬렉션 — 채우는 길은 `POST /collection/register` 하나다 (2026-10-13)
  'collection',
  // AI 대전 — 상대 찾기 · 시작 · 덧붙이기 · 정산이 전부 `POST /battle/ai-*`다 (2026-10-15, `aiBattle.ts`).
  // 클라이언트가 지우거나 고쳐 올리면 같은 판을 두 번 정산하는 길이 다시 열린다
  'aiBattle',
  // 우편함 — 읽음 · 받음이 `POST /mail/:id/*`로만 바뀐다 (2026-10-21, `mail.ts`). 클라이언트가 지워 올리면 같은 보상을 다시 받는다
  'mailbox',
  // 튜토리얼 진행 — 기본 셋이 [출정하기]를 연다. `POST /tutorial/complete`만 바꾼다 (2026-10-22, `tutorial.ts`)
  'tutorial',
  // 도시 레벨 · 전적 — 증축과 전투 정산만 바꾼다(2026-11-12, 위 표)
  'cityLevel', 'record', 'matches', 'matchSeq',
] as const satisfies readonly (keyof PlayerProfile)[];

/**
 * 클라이언트가 올린 프로필에서 **서버 소유 필드만** 서버 값으로 되쓴다.
 *
 * 나머지(부대·배치·도시 이름 변경 전의 표시값…)는 그대로 통과시킨다 — 이 함수는 「무엇을 안
 * 믿는가」만 정하고, 「무엇이 맞는가」는 각 전용 경로가 정한다.
 *
 * ★ **`roster`·`cards`도 통째로 서버 값이다** (2026-09-14, A2). 예전에는 `roster`를 통째로
 * 지킬 수 없었다 — 같은 자리에 레벨업·성장 스택처럼 **클라이언트가 정당하게 바꾸는 것**이
 * 들어 있어서, 장수마다 부상 두 필드(`injuredAt`·`healingAt`)만 골라 지켰다. 그 틈으로
 * **API를 직접 불러 레벨·카드·명단을 적을 수 있었고**, 레벨 상한(도시 레벨)과 증축의 보유
 * 장수 조건이 무력했다. 레벨업(`POST /officer/levelup`)·재설계·카드 정리
 * (`/market/recycle`)가 서버 경로로 옮겨 오면서 **장수 한 명 안에 클라이언트가 바꾸는 값이
 * 하나도 남지 않았다** — 그래서 장수별로 고르는 분기를 지웠다.
 *
 * **기존 행이 없는 최초 1회(도시 만들기)에도 부른다** (2026-11-12) — 그때의 `current`는 서버가 이름으로 다시 지은 시작 꾸러미
 * (`starterProfile`)다. 예전에는 「지킬 정본이 아직 없다」며 클라이언트가 만든 계정을 그대로 받아, 금화를 얹은 도시로 시작할 수 있었다.
 */
export function guardServerOwned(incoming: PlayerProfile, current: PlayerProfile): PlayerProfile {
  const next: PlayerProfile = { ...incoming };
  // 키를 하나씩 옮긴다 — 뭉쳐서 스프레드하면 오타 난 키가 타입 검사를 그냥 지나간다
  for (const key of SERVER_OWNED_FIELDS) Object.assign(next, { [key]: current[key] });

  // `forgeOwned`는 통째로 지키면 지급/해제(§ 클라이언트가 정당하게 바꾸는 것)가
  // 저장되지 않는다 — `roster`의 부상 자국과 반대 방향: **키(보유 여부)만** 서버
  // 것을 지키고 **값(지급 대상)**은 클라이언트가 보낸 것을 받는다. 클라이언트가
  // 새 키를 얹어 보내도(총량을 스스로 늘리려는 시도) 여기서 사라진다.
  const forgeOwned: PlayerProfile['forgeOwned'] = {};
  for (const id of Object.keys(current.forgeOwned)) {
    forgeOwned[id] = id in incoming.forgeOwned ? incoming.forgeOwned[id]! : current.forgeOwned[id]!;
  }
  next.forgeOwned = forgeOwned;

  // `roster`·`cards`는 위 목록이 통째로 옮겼다 — 장수마다 부상만 골라 지키던 분기는
  // 2026-09-14(A2)에 지웠다(위 머리말 ★)
  return next;
}
