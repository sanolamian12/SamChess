/**
 * 온라인 판정 주체 — **`LocalTransport`와 같은 계약, 주소만 저쪽이다.**
 *
 * ```
 *   [Playback] ──의도──▶ [OnlineTransport] ──ws──▶ [BattleRoom] ──▶ room-logic
 *        ◀────── ServerMsg (큐에 쌓였다가 연출 속도로) ──────
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * `ready()`를 듣지 않는다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * `LocalTransport`는 「나는 밀리지 않았다」를 듣고 다음 것을 만들어 준다. 혼자 두는
 * 판이라 시뮬레이션이 연출을 앞질러 달릴 이유가 없기 때문이다. **서버는 기다려
 * 주지 않는다** — 상대가 두면 그 순간 통이 온다. 그래서 여기서 `ready()`는
 * 정말로 아무 일도 하지 않고, 밀려든 통은 재생기의 큐가 받는다.
 *
 * 이 모양은 H1의 회귀가 `ScriptedTransport`로 이미 흉내 내고 있었다 —
 * **묻지도 않고 미는 판정 주체.** 그 이중 구현이 여기서 진짜가 됐다.
 *
 * ────────────────────────────────────────────────────────────────
 * `initial`은 **동기**로 들고 있어야 한다
 * ────────────────────────────────────────────────────────────────
 *
 * 재생기가 첫 프레임을 그릴 때 필요한 값이라(계약이 `readonly initial: BattleState`),
 * 방에 붙는 일은 전투 화면보다 **먼저** 끝나 있어야 한다. 그래서 `connectBattle()`이
 * 「방이 열렸다」(`opened`)까지 기다렸다가 완성된 판정 주체를 돌려준다 —
 * 상대(`MatchOpponent`)도 그때 함께 온다. **전투 화면은 여전히 아무것도 안 만든다.**
 */

import { Client } from 'colyseus.js';
import type { Room, SeatReservation } from 'colyseus.js';
import { applyWire } from '@samchess/rules';
import type { BattleState, Intent, RosterEntry, ServerMsg, Side } from '@samchess/rules';
import type { BattleRewards, MatchOpponent } from '@samchess/meta';
import type { BattleTransport } from './transport.ts';
import { getAccessToken } from '../meta/auth.ts';

/** 대기열이 좌석을 예약해 준 값. 서버의 `matchMaker.SeatReservation`과 같은 모양이다 (H2b) */
export type Reservation = SeatReservation;

/**
 * 서버 주소. **배포는 코드가 아니라 설정이 바뀐다**(§5-59).
 *
 * `import.meta.env`를 **조심스럽게 읽는다** — 이 파일은 브라우저 밖(스모크)에서도
 * import되고, 거기서는 그 객체가 아예 없다. 없으면 기본 주소로 물러난다.
 */
export const serverUrl = (): string => {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.['VITE_SAMCHESS_SERVER'] ?? 'ws://localhost:2567';
};
const BATTLE_ROOM = 'battle';

/** 방에 들고 들어가는 것 — 서버의 `Enlist`와 같은 모양이다 */
export interface EnlistOptions {
  playerId: string;
  entries: RosterEntry[];
  squadName: string | null;
  power: number;
  deploy: { unit: string; pos: { x: number; y: number } }[] | null;
  mode: '3v3' | '5v5';
}

export class OnlineTransport implements BattleTransport {
  readonly initial: BattleState;
  readonly humanSide: Side;

  private readonly room: Room;
  private inbox: ((msg: ServerMsg) => void) | null = null;
  /** 방에 붙은 뒤 첫 통보다 먼저 온 것들. `open()` 전에 도착할 수 있다 */
  private readonly early: ServerMsg[] = [];
  /**
   * 승/패 보상 통보 (H3d) — **리스너는 생성자에서 건다**, `waitForSettled()`가
   * 불릴 때 거는 게 아니라. "소켓 메시지는 리스너를 거는 시점이 늦으면 놓친다"가
   * 대기열(H2b)에서 실제로 한 번 터진 경주라, 여기서도 같은 실수를 반복하지 않는다.
   */
  private readonly settled: Promise<BattleRewards | null>;
  /** 우리가 닫았는가 — 아니면 끊긴 것이다(`onDrop`) */
  private closing = false;
  /** 마지막 통이 판의 끝을 실었다(결말 · 방이 접힘) — 그 뒤에 방을 떠나는 것은 끊김이 아니다 */
  private over = false;
  private dropCb: (() => void) | null = null;

  constructor(room: Room, side: Side, first: ServerMsg) {
    this.room = room;
    this.humanSide = side;
    // 첫 통이 곧 시작 상태다 — 로그는 비어 있고, 이후는 이벤트가 채운다
    this.initial = applyWire({ log: [] } as unknown as BattleState, first);
    /*
     * **첫 통을 다시 흘려 준다.** `LocalTransport`가 `open()`에서 첫 통을 내보내는
     * 것과 같은 자리다 — 재생기는 `initial`로 그리기 시작하지만 `onChange`가 한 번은
     * 와야 화면이 자기를 맞춘다(마감도 그 통에 실려 온다). 여기서는 그 통이 방에
     * 붙는 길목(`opened`)에 실려 이미 도착해 있어, 큐에 넣어 두었다가 흘린다.
     */
    this.early.push(first);
    this.room.onMessage('sync', (msg: ServerMsg) => {
      if (msg.close || msg.state.phase === 'finished') this.over = true;
      if (this.inbox) this.inbox(msg);
      else this.early.push(msg);
    });
    // 서버의 `Settled`와 같은 모양이다 — 패키지 경계를 넘기지 않고 값만 맞춘다
    this.settled = new Promise((resolve) => {
      this.room.onMessage('settled', (msg: { rewards: BattleRewards | null }) => resolve(msg.rewards));
    });
    /*
     * **우리가 닫지 않았는데 방을 떠났다 = 끊겼다** (2026-10-15). 망이 바뀌었거나 탭이 잠들었다.
     * 서버는 `RECONNECT_GRACE_MS` 동안 자리를 비워 두고 기다린다 — 화면이 열쇠로 다시 붙는다(`reconnectBattle`).
     * 판이 끝나 서버가 방을 접은 것도 여기로 오지만, 그때는 화면이 이미 결과로 넘어가 이 콜백을 안 듣는다.
     */
    this.room.onLeave(() => { if (!this.closing && !this.over) this.dropCb?.(); });
  }

  /**
   * 다시 붙는 열쇠 — Colyseus가 방에 붙을 때 준다. 브라우저를 껐다 켜도 이것으로 같은 자리에 앉는다.
   * 화면이 기기에 저장해 둔다(`onlineResume.ts`).
   */
  get reconnectionToken(): string { return this.room.reconnectionToken; }

  /** 우리가 닫지 않았는데 끊겼을 때 — 한 번만 건다 */
  onDrop(cb: () => void): void { this.dropCb = cb; }

  /** 승/패 보상을 기다린다. 시간 안에 안 오면 `null` — 부르는 쪽이 로컬 반영으로 물러난다 */
  async waitForSettled(timeoutMs: number): Promise<BattleRewards | null> {
    return Promise.race([
      this.settled,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  open(inbox: (msg: ServerMsg) => void): void {
    this.inbox = inbox;
    for (const msg of this.early.splice(0)) inbox(msg);
  }

  /** 의도만 보낸다. **판정 결과는 절대 안 보낸다** (GDD §10) */
  send(intent: Intent): void {
    this.room.send('intent', { intent });
  }

  /** 서버는 기다려 주지 않는다 — 여기서 할 일이 없다 (파일 머리 참조) */
  ready(): void { /* 아무것도 하지 않는다 */ }

  close(): void {
    this.closing = true;
    this.inbox = null;
    void this.room.leave().catch(() => { /* 이미 끊긴 방이다 */ });
  }
}

/** `enlist`를 보내고 `opened`를 기다린다 — **두 접속 경로가 여기서 합쳐진다** */
async function enlistAndWait(
  room: Room, opts: EnlistOptions,
): Promise<{ transport: OnlineTransport; opponent: MatchOpponent }> {
  const opened = await new Promise<{
    side: Side;
    opponent: { id: string; squadName: string | null; entries: RosterEntry[]; power: number };
    first: ServerMsg;
  }>((resolve, reject) => {
    room.onMessage('opened', resolve);
    // 선전포고 방에 상대가 끝내 안 왔다 — 방이 안 열렸으니 참가비도 안 나갔다(`BattleRoom`의 `WAR_JOIN_MS`)
    room.onMessage('noShow', () => reject(new Error('war.noShow')));
    room.send('enlist', {
      enlist: {
        playerId: opts.playerId, entries: opts.entries, squadName: opts.squadName,
        power: opts.power, deploy: opts.deploy,
      },
    });
  });

  return {
    transport: new OnlineTransport(room, opened.side, opened.first),
    // **상대는 값으로 온다** — 전투 화면이 「누구와 싸우는가」를 다시 만들지 않는다
    opponent: {
      kind: 'online',
      id: opened.opponent.id,
      squadName: opened.opponent.squadName,
      entries: opened.opponent.entries,
      power: opened.opponent.power,
    },
  };
}

/**
 * 방에 붙어 상대를 만나고 **완성된 판정 주체**를 돌려준다 (개발용 고정 방).
 *
 * H2a의 통로다(`?match=room`) — 대기열이 붙는 H2b에서는 `connectReservedBattle`이
 * 실제 경로가 되고, 이 함수는 스모크(`smoke_online.ts`)가 그대로 쓴다.
 */
export async function connectBattle(
  roomName: string, opts: EnlistOptions, url = serverUrl(), token?: string,
): Promise<{ transport: OnlineTransport; opponent: MatchOpponent }> {
  const client = new Client(url);
  // 개발용 고정 방은 대기열을 안 거치므로 `BattleRoom.onAuth`가 직접 검증한다(§5-91).
  // `token`을 안 넘기면 브라우저 세션에서 읽는다 — **`tools/smoke_online.ts`가 이 자리로
  // 진짜 Supabase 토큰을 직접 실어 보낸다**(Node에는 `localStorage`가 없다)
  const auth = token ?? await getAccessToken();
  if (auth) client.auth.token = auth;
  const room = await client.joinOrCreate(BATTLE_ROOM, { mode: opts.mode, room: roomName });
  return enlistAndWait(room, opts);
}

/**
 * 수락된 선전포고의 방에 붙는다 (2026-10-28, GDD §8.8 단계 4). 두 사람이 **같은 id로** `joinOrCreate`하면 한 방에 선다
 * (`BattleRoom`이 `filterBy(['war'])`로 갈린다). 자리 · 명단 · 배치는 방을 만들 때 서버가 계정에서 낸다 — 여기서 보내는 `enlist`의
 * 편성은 그 방에서 안 쓴다(모양만 같은 통). 방이 거절하면(이미 끝났다 · 부대가 성립하지 않는다) 던진다.
 */
export async function connectWarBattle(
  warId: string, opts: EnlistOptions, url = serverUrl(),
): Promise<{ transport: OnlineTransport; opponent: MatchOpponent }> {
  const client = new Client(url);
  const auth = await getAccessToken();
  if (auth) client.auth.token = auth;
  /*
   * ★ **거절되면 잠시 뒤 다시 붙는다.** 두 사람이 거의 같이 오면 Colyseus는 늦은 쪽을 0.5초만 묶어 두는데
   * (`COLYSEUS_MAX_CONCURRENT_CREATE_ROOM_WAIT_TIME`), 선전포고 방은 만들며 게임 API를 불러 몇 초가 걸린다 — 늦은 쪽이
   * 제 방을 따로 만들고 그 방이 「이미 열렸다」로 거절된다(war_ux가 몇 번에 한 번 잡았다). 다시 물으면 먼저 만든 방이 보인다.
   */
  let room: Room | null = null;
  for (let attempt = 0; !room; attempt++) {
    try {
      room = await client.joinOrCreate(BATTLE_ROOM, { mode: opts.mode, war: warId });
    } catch (e) {
      if (attempt >= WAR_JOIN_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, WAR_JOIN_RETRY_MS));
    }
  }
  return enlistAndWait(room, opts);
}

/** 선전포고 방에 다시 붙는 횟수 · 간격 — 합이 방이 사람을 기다리는 `WAR_JOIN_MS`(30초) 안이다 */
const WAR_JOIN_RETRIES = 5;
const WAR_JOIN_RETRY_MS = 1_500;

/**
 * 대기열이 예약해 준 좌석으로 대전 방에 붙는다 (H2b — `meta/matchmaking.ts`가 부른다).
 *
 * `joinOrCreate` 대신 `consumeSeatReservation`을 쓰는 것 말고는 `connectBattle`과
 * 똑같다 — **`enlist`부터는 완전히 같은 절차**다(개발용 고정 방과 같은 `BattleRoom`이다).
 */
export async function connectReservedBattle(
  reservation: Reservation, opts: EnlistOptions, url = serverUrl(),
): Promise<{ transport: OnlineTransport; opponent: MatchOpponent }> {
  // 좌석 예약은 `QueueRoom`이 이미 검증한 uid를 실어 왔다(§5-91) — 여기서 토큰을
  // 다시 붙일 필요가 없다. `consumeSeatReservation`은 매치메이크 HTTP 요청이 아니라서
  // `BattleRoom.onAuth`도 다시 안 거친다
  const client = new Client(url);
  const room = await client.consumeSeatReservation(reservation);
  return enlistAndWait(room, opts);
}

/**
 * **끊긴 대전에 다시 붙는다** (2026-10-15) — 서버는 끊긴 쪽을 `RECONNECT_GRACE_MS` 동안 기다리고,
 * 돌아오면 판 스냅샷을 한 통 보낸다(`room-logic`의 `joined` — 로그를 뺀 스냅샷이라 재접속이 곧 한 통이다).
 *
 * ★ **리스너를 건 뒤 스냅샷을 다시 청한다**(`resync`) — 「소켓 메시지는 리스너를 거는 시점이 늦으면 놓친다」를
 * 여기서 또 밟았다. 서버가 재접속 순간 보내는 스냅샷은 `reconnect()`가 풀리기 **전에** 도착해 버려진다(smoke_online이
 * 「onMessage() not registered for type 'sync'」로 잡았다). 붙기 전에는 리스너를 걸 방이 없으니 걸고 나서 청한다.
 * 첫 통을 받은 뒤 만드는 `OnlineTransport`는 같은 마이크로태스크 안에서 자기 리스너를 건다.
 * 상대(`MatchOpponent`)는 다시 안 온다 — 화면이 저장해 둔 값을 쓴다.
 */
export async function reconnectBattle(
  token: string, side: Side, url = serverUrl(), timeoutMs = 8_000,
): Promise<OnlineTransport> {
  const client = new Client(url);
  const room = await client.reconnect(token);
  const first = await new Promise<ServerMsg>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('다시 붙었는데 판 스냅샷이 안 온다')), timeoutMs);
    const off = room.onMessage('sync', (msg: ServerMsg) => {
      clearTimeout(timer);
      if (typeof off === 'function') off();
      resolve(msg);
    });
    room.send('resync', {});
  });
  return new OnlineTransport(room, side, first);
}
