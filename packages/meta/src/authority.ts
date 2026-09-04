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
 */
export const SERVER_OWNED_FIELDS = [
  'grain', 'grainAt', 'materials', 'buildings', 'buildCredits', 'hospitalBusy',
] as const satisfies readonly (keyof PlayerProfile)[];

/**
 * 장수 안에서 지키는 것들. **`roster`를 통째로 지킬 수는 없다** — 같은 자리에
 * 레벨업·성장 스택처럼 **클라이언트가 정당하게 바꾸는 것**이 들어 있어서,
 * 통째로 지키면 레벨업이 저장되지 않는다.
 */
export const SERVER_OWNED_OFFICER_FIELDS = ['injuredAt', 'healingAt'] as const;

/**
 * 클라이언트가 올린 프로필에서 **서버 소유 필드만** 서버 값으로 되쓴다.
 *
 * 나머지(레벨업·부대·전적·이름…)는 그대로 통과시킨다 — 이 함수는 「무엇을 안
 * 믿는가」만 정하고, 「무엇이 맞는가」는 각 전용 경로가 정한다.
 *
 * **지킬 기존 행이 없는 최초 1회에는 부르지 않는다** — 지킬 정본이 아직 없다.
 * 그 경계는 `loadProfile()`의 「1회 이전」과 같은 신뢰 수준이다.
 */
export function guardServerOwned(incoming: PlayerProfile, current: PlayerProfile): PlayerProfile {
  const next: PlayerProfile = { ...incoming };
  // 키를 하나씩 옮긴다 — 뭉쳐서 스프레드하면 오타 난 키가 타입 검사를 그냥 지나간다
  for (const key of SERVER_OWNED_FIELDS) Object.assign(next, { [key]: current[key] });

  const roster = { ...incoming.roster };
  for (const [id, inst] of Object.entries(roster)) {
    const mine = current.roster[id as OfficerId];
    // 서버에 없던 장수(방금 뽑은 카드 등)는 그대로 둔다 — 부상 자국이 붙어 있을
    // 수 없는 장수라 지킬 것도 없다
    if (!mine) continue;
    const { injuredAt: _a, healingAt: _b, ...rest } = inst;
    roster[id as OfficerId] = {
      ...rest,
      ...(mine.injuredAt !== undefined ? { injuredAt: mine.injuredAt } : {}),
      ...(mine.healingAt !== undefined ? { healingAt: mine.healingAt } : {}),
    };
  }
  next.roster = roster;
  return next;
}
