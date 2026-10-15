/**
 * 끊긴 판을 되살리는 **의도 기록** — 도적떼(`raid.ts`)와 AI 대전(`aiBattle.ts`)이 함께 쓴다 (2026-10-15).
 *
 * 서버는 싸우는 동안 사람이 낸 의도를 **덧붙이기만** 받는다. 앞부분을 바꿔 끼우면 「몇 수 되돌려 다시 두기」가
 * 되기 때문이다. 정산도 **덧붙여 둔 수로 시작하는 기록만** 받는다. 규칙이 두 벌이면 한쪽만 낡는다.
 */
import type { Intent } from '@samchess/rules';

const sameIntent = (a: Intent, b: Intent): boolean => JSON.stringify(a) === JSON.stringify(b);

export type AppendResult =
  | { ok: true; next: Intent[] | null }
  | { ok: false; reason: string; kind: 'gap' | 'rejected'; have: number };

/**
 * `from`(클라이언트가 아는 「이미 저장된 수」)부터 `intents`를 덧붙인다. 같은 요청이 두 번 오면(응답을 못 받고 다시 보냄)
 * 겹치는 앞부분이 글자까지 같을 때만 남는 뒤쪽을 받는다. 덧붙인 뒤 **재생이 되는지**(`replays`) 본다 — 엔진이 거부할 수를
 * 쌓아 두면 재개도 정산도 그 자리에서 막힌다. `next: null`이면 새로 받은 것이 없다.
 */
export function appendIntentLog(
  have: readonly Intent[], from: number, intents: readonly Intent[],
  replays: (next: Intent[]) => { ok: true } | { ok: false; reason: string },
): AppendResult {
  if (!Number.isInteger(from) || from < 0 || from > have.length) {
    return { ok: false, reason: `저장된 수와 이어지지 않는다 — 저장 ${have.length}, 요청 ${from}`, kind: 'gap', have: have.length };
  }
  const overlap = Math.min(have.length - from, intents.length);
  for (let i = 0; i < overlap; i++) {
    if (!sameIntent(have[from + i]!, intents[i]!)) {
      return { ok: false, reason: `저장된 ${from + i}번째 수와 다르다`, kind: 'gap', have: have.length };
    }
  }
  const fresh = intents.slice(overlap);
  if (fresh.length === 0) return { ok: true, next: null };
  const next = [...have, ...fresh];
  const replay = replays(next);
  if (!replay.ok) return { ok: false, reason: replay.reason, kind: 'rejected', have: have.length };
  return { ok: true, next };
}

/** 정산에 올라온 의도가 **덧붙여 둔 수로 시작하는가** — 처음부터 다른 수로 다시 둔 판을 막는다 */
export function startsWithIntents(have: readonly Intent[], humanIntents: readonly Intent[]): boolean {
  return have.length <= humanIntents.length && have.every((h, i) => sameIntent(h, humanIntents[i]!));
}
