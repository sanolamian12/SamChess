/**
 * 온라인 상대를 찾는 자리 — **대기열 이음매다** (F · 45쪽 · H2b).
 *
 * `storage.ts`가 「온라인이 붙으면 이 파일만 서버 API가 된다」인 것과 같은 자리다.
 *
 * ────────────────────────────────────────────────────────────────
 * 세 상태 — 찾는 중 → 찾음(확인 대기) → 방이 열린다
 * ────────────────────────────────────────────────────────────────
 *
 * ```
 * search()    대기열 방에 붙어 'search'를 보낸다
 * 'matched'   상대를 찾았다 — 아직 방은 안 열렸다. onFound(opponent)
 * confirmReady()  [전투준비] — 상대도 확인하면 'reservation'이 온다
 * decline()       [다시 찾기] — 서버가 나를 대기열 맨 앞으로, 상대도 패널티 없이
 *                 맨 앞으로 되돌린다(§5-63). onDeclinedByOpponent()도 같은 통로다
 * 'reservation'   좌석 예약 — `connectReservedBattle()`로 **기존 `BattleRoom`**에
 *                 붙는다. `enlist`부터는 개발용 고정 방과 완전히 같은 절차다
 * ```
 *
 * **매칭 폭은 안 넓힌다**(§5-62) — 서버가 `isAdjacentPower()`로 고르고,
 * AI 상대(`makeAiOpponent`)와 **같은 눈금**이다(§7.1).
 *
 * ────────────────────────────────────────────────────────────────
 * 개발용 통로 — `?match=fast`만 남는다
 * ────────────────────────────────────────────────────────────────
 *
 * `?match=room`·`?match=online`은 지웠다 — 대기열이 실제로 도는 지금은 흉내가
 * 필요 없다(§5-52가 걱정하던 「도는 적 없는 검사」는 스모크가 대기열을 직접 지나며
 * 막는다). `?match=fast`만 남는다 — 검색 자체는 그대로 두고 **못 찾았을 때 AI로
 * 넘어가는 시간만** 줄인다(스모크가 AI 갈래를 30초 기다리지 않기 위한 것).
 */

import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { ONLINE_SEARCH_MS, makeAiOpponent } from '@samchess/meta';
import type { MatchOpponent } from '@samchess/meta';
import type { BattleMode, OfficerId, RosterEntry, UnitId, Vec2 } from '@samchess/rules';
import { connectReservedBattle, serverUrl } from '../battle/online.ts';
import type { Reservation } from '../battle/online.ts';
import type { BattleTransport } from '../battle/transport.ts';

const QUEUE_ROOM = 'queue';

/** 개발용 통로를 읽는 **유일한 자리**. `?demo=1`과 같은 결이다 */
const devMatch = (): string => new URLSearchParams(location.search).get('match') ?? '';

/** `?match=fast`일 때 못 찾고 AI로 넘어가기까지의 시간 */
const FAST_MS = 400;

/** 이번 탐색이 실제로 기다릴 시간(ms). **화면이 30초를 다시 적지 않는다** */
export const searchMs = (): number => (devMatch() === 'fast' ? FAST_MS : ONLINE_SEARCH_MS);

/** 상대를 찾을 때 서버에 내미는 것 — 내 편성과 저장된 배치 */
export interface SearchOptions {
  mode: BattleMode;
  myPower: number;
  entries: RosterEntry[];
  squadName: string | null;
  /** 저장된 배치 프리셋. **어긋나면 서버가 조용히 안 깐다**(§5-45) */
  deploy: { unit: UnitId; pos: Vec2 }[] | null;
  /** 이미 내가 쓴 장수 — AI 대체 상대가 같은 사람을 데려오지 않게 */
  exclude: readonly OfficerId[];
  /** AI 대체 상대의 시드 */
  seed: number;
}

export interface OnlineSearchCallbacks {
  /** 상대를 찾았다 — [전투준비]/[다시 찾기]를 보여 준다 */
  onFound: (opponent: MatchOpponent) => void;
  /** 상대가 거절했다(또는 사라졌다) — 자동으로 다시 대기열에 섰다. 안내문만 띄운다 */
  onDeclinedByOpponent: () => void;
  /** 둘 다 확인해 방이 열렸다 — 전투 화면으로 넘길 준비가 됐다 */
  onReady: (opponent: MatchOpponent, transport: BattleTransport) => void;
  /** 서버가 없거나 시간 안에 못 찾았다 — 부르는 쪽이 AI로 넘어간다 */
  onTimeout: () => void;
}

export interface OnlineSearch {
  /** [전투준비] — 지금 매칭된 상대를 받아들인다. 상대가 안 찾아졌으면 아무 일도 없다 */
  confirmReady(): void;
  /** [다시 찾기] — 지금 매칭된 상대를 거절한다(§5-63) */
  decline(): void;
  /** 나간다 — 대기열/확인 대기에서 빠진다. 이후로는 어떤 콜백도 안 온다 */
  close(): void;
}

/**
 * 대기열 방에 붙어 온라인 상대를 찾는다. **콜백이 전부다** — MatchScreen이 세
 * 상태(찾는 중 · 찾음 · 방 열림)를 이 콜백으로 그린다.
 *
 * 서버가 꺼져 있으면 접속이 실패하고 `searchMs()` 안에 `onTimeout()`이 온다 —
 * 온라인이 안 되는 것 때문에 게임이 멈추면 안 된다(§5-61).
 */
export function searchOnline(opts: SearchOptions, cb: OnlineSearchCallbacks): OnlineSearch {
  let closed = false;
  let left = false;   // **대기열 방을 이미 나갔는가** — 두 번 나가면 소켓이 「이미 닫히는 중」이라고 불평한다
  let matchId: string | null = null;
  let room: Room | null = null;

  const leaveQueue = (): void => {
    if (left) return;
    left = true;
    void room?.leave();
  };

  /*
   * **찾는 동안에만** 시간 제한을 둔다 — 한 번이라도 매칭되면(그 뒤 거절이
   * 오가더라도) 더는 「못 찾아서 AI로」가 아니다. 안 그러면 「금방 찾았는데 상대가
   * 거절해서 다시 도는 사이 원래 타이머가 끝나 AI로 떨어지는」 이상한 경험이 된다.
   */
  const timer = setTimeout(() => {
    if (closed || matchId) return;
    closed = true;
    leaveQueue();
    cb.onTimeout();
  }, searchMs());

  const finish = (): void => { closed = true; clearTimeout(timer); };

  void (async () => {
    try {
      const client = new Client(serverUrl());
      const r = await client.joinOrCreate(QUEUE_ROOM, { playerId: playerId() });
      if (closed) { void r.leave(); return; }
      room = r;

      r.onMessage('matched', (msg: { matchId: string; opponent: OpponentWire }) => {
        if (closed) return;
        clearTimeout(timer);
        matchId = msg.matchId;
        cb.onFound(fromWire(msg.opponent));
      });

      r.onMessage('declined', () => {
        if (closed) return;
        matchId = null;
        cb.onDeclinedByOpponent();
      });

      r.onMessage('reservation', (msg: { reservation: Reservation }) => {
        if (closed) return;
        void (async () => {
          const landed = await connectReservedBattle(msg.reservation, { ...enlistOf(opts), mode: opts.mode });
          if (closed) { landed.transport.close(); return; }
          finish();
          leaveQueue();   // 대전 방으로 넘어갔다 — 대기열 접속은 이제 볼일이 없다
          cb.onReady(landed.opponent, landed.transport);
        })();
      });

      r.send('search', { search: { mode: opts.mode, power: opts.myPower, enlist: enlistOf(opts) } });
    } catch {
      if (!closed) { finish(); cb.onTimeout(); }
    }
  })();

  return {
    confirmReady: () => { if (matchId) room?.send('confirm', { matchId }); },
    decline: () => { if (matchId) { room?.send('decline', { matchId }); matchId = null; } },
    close: () => { finish(); leaveQueue(); },
  };
}

interface OpponentWire { id: string; squadName: string | null; entries: RosterEntry[]; power: number }

const fromWire = (o: OpponentWire): MatchOpponent => ({
  kind: 'online', id: o.id, squadName: o.squadName, entries: o.entries, power: o.power,
});

const enlistOf = (opts: SearchOptions): {
  playerId: string; entries: RosterEntry[]; squadName: string | null; power: number;
  deploy: { unit: UnitId; pos: Vec2 }[] | null;
} => ({
  playerId: playerId(), entries: opts.entries, squadName: opts.squadName,
  power: opts.myPower, deploy: opts.deploy,
});

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
 * 못 찾았을 때(또는 서버가 없을 때) AI 상대를 **내 전투력에 맞춰** 만든다 —
 * `searchOnline`의 `onTimeout`에서 부르는 쪽 몫이다.
 */
export function fallbackAiOpponent(opts: SearchOptions): MatchOpponent {
  return makeAiOpponent(opts.mode, opts.myPower, opts.seed, opts.exclude);
}
