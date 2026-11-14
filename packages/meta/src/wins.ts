/**
 * 누적 승리 (2026-11-14) — 증축 조건이 읽는다. **다른 모듈을 import하지 않는다** — `city.ts`가 부르는데 `records.ts`를 거치면
 * `roster.ts` → `city.ts`로 되돌아오는 고리가 생겨 모듈이 초기화 전에 읽혔다.
 */
import type { RecordTally } from './types.ts';
/**
 * **누적 승리** — 증축 조건(2026-11-14). `PlayerProfile.battleWins`가 있으면 그것(AI 대전까지 센다), 없으면 이 값이 생기기 전의
 * 계정이라 **전적의 승리 합**으로 읽는다(AI 대전 승리는 그때 안 셌으니 그만큼은 없다). 정산이 이 값에서 하나씩 올린다.
 */
export function battleWinsOf(profile: { battleWins?: number; record: Record<string, RecordTally> }): number {
  return profile.battleWins ?? Object.values(profile.record).reduce((n, t) => n + t.wins, 0);
}
