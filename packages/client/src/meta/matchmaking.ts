/**
 * 온라인 상대를 찾는 자리 — **Colyseus가 갈아 끼울 이음매다** (F · 45쪽)
 *
 * `storage.ts`가 「온라인이 붙으면 이 파일만 서버 API가 된다」인 것과 같은 자리다.
 * 지금은 아무도 못 찾고 `null`을 주며, 그래서 매칭 화면이 언제나 AI로 넘어간다.
 * 서버가 붙으면 **이 함수 하나**가 방에 들어가 상대를 기다리는 것으로 바뀌고,
 * 화면(`MatchScreen`)은 한 글자도 안 바뀐다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「늘 못 찾는다」면 거절 프로세스를 **한 번도 확인할 수 없다** ★
 * ────────────────────────────────────────────────────────────────
 *
 * 「다시 찾기」(군량 −1)는 **온라인에만 있다**(§5-15). 온라인이 언제나 빈손이면
 * 화면은 늘 AI로 떨어지고, 그러면 45쪽의 완료 조건 두 줄 — 「딱 최소면 [다시 찾기]가
 * 아예 안 나오는가」·「거절을 반복해 바닥에 닿으면 사라지는가」 — 이 **실행되지
 * 않는다.** E가 밟은 「검사가 기본값과 같은 값을 보고 있었다」와 같은 함정이라,
 * 온라인을 흉내 내는 개발용 통로를 함께 둔다.
 *
 * | URL | 무엇 |
 * |---|---|
 * | `?match=fast` | 30초를 짧게 — 스모크가 AI 갈래를 30초 기다리지 않게 |
 * | `?match=online` | 온라인 상대를 **찾은 것으로** — 거절이 실제로 도는 유일한 길 |
 *
 * **개발용 통로 넷째다.** 「카드 +5」·「금화 +10」·「재료 +10」과 함께, 상점과
 * 온라인이 붙을 때 같이 지운다.
 */

import { ONLINE_SEARCH_MS, makeAiOpponent } from '@samchess/meta';
import type { MatchOpponent } from '@samchess/meta';
import type { BattleMode, OfficerId } from '@samchess/rules';

/** 개발용 통로를 읽는 **유일한 자리**. `?demo=1`과 같은 결이다 */
const devMatch = (): string => new URLSearchParams(location.search).get('match') ?? '';

/** 흉내 낼 때 쓰는 짧은 대기 — 화면이 「찾는 중」을 지나가는 것은 보여야 한다 */
const FAST_MS = 400;

/** 이번 탐색이 실제로 기다릴 시간(ms). **화면이 30초를 다시 적지 않는다** */
export const searchMs = (): number => (devMatch() ? FAST_MS : ONLINE_SEARCH_MS);

/**
 * 온라인 상대를 찾는다. **못 찾으면 `null`** — 부르는 쪽이 AI로 넘어간다.
 *
 * `signal`로 끊는다 — 사람이 [뒤로 가기]를 누르면 기다리던 것이 남아 있으면 안 된다.
 * 끊겼으면 `null`을 주고 조용히 끝낸다(화면은 이미 떠났다).
 */
export function searchOnline(
  mode: BattleMode,
  myPower: number,
  seed: number,
  exclude: readonly OfficerId[],
  signal: AbortSignal,
): Promise<MatchOpponent | null> {
  return new Promise((resolve) => {
    const done = (value: MatchOpponent | null): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => done(null);
    const timer = setTimeout(() => {
      // ── 여기가 Colyseus가 들어올 자리다 ──
      // 지금은 방이 없으므로 아무도 못 찾는다. 흉내 통로만 상대를 만들어 준다.
      done(devMatch() === 'online' ? fakeOnline(mode, myPower, seed, exclude) : null);
    }, searchMs());
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 온라인 상대를 흉내 낸다 (개발용).
 *
 * 편성 자체는 AI와 같은 규칙으로 뽑는다 — **서버가 붙으면 진짜 사람의 부대**가
 * 그 자리에 온다. 다른 것은 `kind`·`id`·부대 이름 셋뿐이고, 그 셋이 곧 이력의
 * 빈 칸 둘(`opponentId`·`theirSquad`)을 채우는 값이다(§4-7②).
 */
function fakeOnline(
  mode: BattleMode, myPower: number, seed: number, exclude: readonly OfficerId[],
): MatchOpponent {
  const base = makeAiOpponent(mode, myPower, seed, exclude);
  return {
    ...base,
    kind: 'online',
    id: `guest-${seed % 10_000}`,
    squadName: `연습상대 ${seed % 100}`,
  };
}
