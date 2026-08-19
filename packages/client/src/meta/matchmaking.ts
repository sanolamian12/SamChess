/**
 * 온라인 상대를 찾는 자리 — **Colyseus가 갈아 끼울 이음매다** (F · 45쪽 · H2)
 *
 * `storage.ts`가 「온라인이 붙으면 이 파일만 서버 API가 된다」인 것과 같은 자리다.
 * 화면(`MatchScreen`)은 여전히 「찾았다 / 못 찾았다」 둘만 안다.
 *
 * ────────────────────────────────────────────────────────────────
 * 찾으면 **판정 주체까지 함께 온다** ★ (H2)
 * ────────────────────────────────────────────────────────────────
 *
 * 사람을 찾았다는 것은 **이미 방에 붙었다**는 뜻이다. 전투 화면이 나중에 다시
 * 붙으려 하면 그 사이에 상대가 사라질 수 있고, 무엇보다 `Playback`이 첫 프레임을
 * 그리려면 `initial`이 **동기로** 있어야 한다(계약이 그렇다). 그래서 상대와
 * 판정 주체를 **한 값으로** 들고 나온다 — 「상대는 값으로 넘긴다」(F)의 짝이다.
 *
 * ────────────────────────────────────────────────────────────────
 * 개발용 통로 — 대기열은 아직 없다 (H2b)
 * ────────────────────────────────────────────────────────────────
 *
 * | URL | 무엇 |
 * |---|---|
 * | `?match=fast` | 30초를 짧게 — 스모크가 AI 갈래를 30초 기다리지 않게 |
 * | `?match=online` | 온라인 상대를 **찾은 것으로** — 거절이 실제로 도는 유일한 길 |
 * | `?match=room` | **진짜 서버의 방**에 붙는다. 탭 둘이 만나면 그 자리에서 시작 |
 * | `?seat=2` | 계정을 가른다 (`storage.ts`) — 두 탭이 같은 계정이면 확인이 안 된다 |
 *
 * `?match=online`은 **가짜**다(편성만 AI 규칙으로 뽑고 라벨만 온라인). 대기열이
 * 붙는 H2b에서 「다시 찾기」가 진짜로 돌기 시작하면 **그때 지운다** — 지금 지우면
 * 45쪽 완료 조건 두 줄이 다시 도는 적 없는 검사가 된다(§5-52).
 */

import { ONLINE_SEARCH_MS, makeAiOpponent } from '@samchess/meta';
import type { MatchOpponent } from '@samchess/meta';
import type { BattleMode, OfficerId, RosterEntry, UnitId, Vec2 } from '@samchess/rules';
import { connectBattle } from '../battle/online.ts';
import type { BattleTransport } from '../battle/transport.ts';

/** 개발용 통로를 읽는 **유일한 자리**. `?demo=1`과 같은 결이다 */
const devMatch = (): string => new URLSearchParams(location.search).get('match') ?? '';

/** 흉내 낼 때 쓰는 짧은 대기 — 화면이 「찾는 중」을 지나가는 것은 보여야 한다 */
const FAST_MS = 400;

/** 이번 탐색이 실제로 기다릴 시간(ms). **화면이 30초를 다시 적지 않는다** */
export const searchMs = (): number => (devMatch() ? FAST_MS : ONLINE_SEARCH_MS);

/**
 * 찾은 결과. `transport`가 있으면 **이미 방에 붙어 있다.**
 *
 * `null`인 것은 흉내 통로(`?match=online`)뿐이고, 그때는 전투 화면이 예전처럼
 * `LocalTransport`를 만든다 — 상대만 온라인 라벨이 붙은 AI다.
 */
export interface OnlineMatch {
  opponent: MatchOpponent;
  transport: BattleTransport | null;
}

/** 상대를 찾을 때 서버에 내미는 것 — 내 편성과 저장된 배치 */
export interface SearchOptions {
  mode: BattleMode;
  myPower: number;
  seed: number;
  entries: RosterEntry[];
  squadName: string | null;
  /** 저장된 배치 프리셋. **어긋나면 서버가 조용히 안 깐다**(§5-45) */
  deploy: { unit: UnitId; pos: Vec2 }[] | null;
  /** 이미 내가 쓴 장수 — 흉내 상대가 같은 사람을 데려오지 않게 */
  exclude: readonly OfficerId[];
}

/**
 * 온라인 상대를 찾는다. **못 찾으면 `null`** — 부르는 쪽이 AI로 넘어간다.
 *
 * `signal`로 끊는다 — 사람이 [뒤로 가기]를 누르면 기다리던 것이 남아 있으면 안 된다.
 * 끊겼으면 `null`을 주고 조용히 끝낸다(화면은 이미 떠났다).
 */
export async function searchOnline(
  opts: SearchOptions, signal: AbortSignal,
): Promise<OnlineMatch | null> {
  if (devMatch() === 'room') return searchRoom(opts, signal);

  return new Promise((resolve) => {
    const done = (value: OnlineMatch | null): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => done(null);
    const timer = setTimeout(() => {
      // ── 대기열이 들어올 자리다 (H2b) ──
      // 지금은 짝지어 줄 사람이 없으므로 아무도 못 찾는다.
      done(devMatch() === 'online' ? { opponent: fakeOnline(opts), transport: null } : null);
    }, searchMs());
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * **진짜 서버의 방**에 붙어 상대가 올 때까지 기다린다 (개발용 · H2a).
 *
 * 대기열이 없으므로 방 이름 하나로 만난다 — 탭 둘이 같은 방에 들어가면 그 자리에서
 * 방이 열린다. **서버가 꺼져 있으면 조용히 `null`**을 주고 AI로 떨어진다:
 * 온라인이 안 되는 것 때문에 게임이 멈추면 안 된다(§5-61).
 */
async function searchRoom(opts: SearchOptions, signal: AbortSignal): Promise<OnlineMatch | null> {
  let landed: OnlineMatch | null = null;
  /*
   * **떠나면 방에서도 나간다.** 안 나가면 상대 쪽에서는 「들어왔다가 사라진 사람」이
   * 되어 재접속 유예 60초를 기다린다 — 사람이 [뒤로 가기]를 누른 것뿐인데.
   * 아직 안 붙었으면 붙는 대로 나간다(`landed`가 그때 채워진다).
   */
  const onAbort = (): void => { landed?.transport?.close(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    landed = await connectBattle('dev', {
      playerId: playerId(),
      entries: opts.entries,
      squadName: opts.squadName,
      power: opts.myPower,
      deploy: opts.deploy,
      mode: opts.mode,
    });
    if (signal.aborted) { landed.transport?.close(); return null; }
    return landed;
  } catch {
    return null;   // 서버가 없다 — AI로 간다
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 재접속용 안정된 키 (§5-58). 로그인이 붙는 날 **계정 id로 바뀔 뿐**이다 —
 * 전투 프로토콜은 「누구인가」에 안 걸리고 「같은 사람인가」에만 걸린다.
 */
function playerId(): string {
  // **자리마다 다른 키다** — 같은 브라우저 두 탭이 같은 id를 쓰면 서버가 둘을
  // 한 사람으로 보고 재접속으로 처리한다(`storage.ts`의 `?seat`와 같은 이유)
  const seat = new URLSearchParams(location.search).get('seat') ?? '1';
  const key = `samchess.deviceId.seat${seat}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = `dev-${seat}-${Date.now() % 1_000_000}`;
    localStorage.setItem(key, id);
  }
  return id;
}

/**
 * 온라인 상대를 흉내 낸다 (개발용 — 「다시 찾기」가 도는 유일한 길).
 *
 * 편성 자체는 AI와 같은 규칙으로 뽑는다. 다른 것은 `kind`·`id`·부대 이름 셋뿐이고,
 * 그 셋이 곧 이력의 빈 칸 둘(`opponentId`·`theirSquad`)을 채우는 값이다(§4-7②).
 */
function fakeOnline(opts: SearchOptions): MatchOpponent {
  const base = makeAiOpponent(opts.mode, opts.myPower, opts.seed, opts.exclude);
  return {
    ...base,
    kind: 'online',
    id: `guest-${opts.seed % 10_000}`,
    squadName: `연습상대 ${opts.seed % 100}`,
  };
}
