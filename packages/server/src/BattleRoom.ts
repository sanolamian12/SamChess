/**
 * 대전 방 — **Colyseus 껍데기.** 판정은 한 줄도 안 한다.
 *
 * 하는 일은 넷뿐이다: 자리를 배정하고 · 사건을 `room-logic`의 `step()`으로 넘기고 ·
 * `out`을 진영별로 뿌리고 · 250ms마다 시계를 한 번 본다.
 *
 * ────────────────────────────────────────────────────────────────
 * `@colyseus/schema`를 쓰지 않는다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * Schema로 `BattleState`를 다시 적으면 **상태가 두 벌**이 되어 스택 선택의 1순위
 * 기준(「룰 엔진을 서버와 클라가 같은 코드로 돌린다」)이 깨진다. 덤으로 데코레이터가
 * 사라지는데, **Node 타입 스트리핑은 데코레이터를 못 넘긴다** — 이 저장소에서는
 * 설계 취향이 아니라 **물리적 제약**이다(§5-54).
 *
 * 그래서 방은 상태를 동기화하지 않고 **메시지만** 주고받는다. 실을 것은 이미
 * `@samchess/rules`의 `wire.ts`가 정해 뒀다(로그를 뺀 스냅샷 + 이벤트 + 남은 ms).
 *
 * ────────────────────────────────────────────────────────────────
 * 재접속은 Colyseus가 해 준다 — 우리는 「돌아왔다」만 받는다
 * ────────────────────────────────────────────────────────────────
 *
 * `allowReconnection`이 유예를 재고, 돌아오면 `joined`가, 안 돌아오면 `gone`이
 * `step()`으로 간다. **유예의 길이는 여기서 정하지 않는다** — `RECONNECT_GRACE_MS`
 * 하나가 정하고, 그 값은 넘기기 3번의 하한에 묶여 있다(§5-69).
 */

import { Room } from '@colyseus/core';
import type { Client } from '@colyseus/core';
import { RECONNECT_GRACE_MS, countKills } from '@samchess/rules';
import type { Side } from '@samchess/rules';
import { battlePower } from '@samchess/meta';
import { openRoom, step } from './room-logic.ts';
import type { RoomState, StepResult } from './room-logic.ts';
import type { ClientMessage, Enlist, Opened, Settled } from './protocol.ts';
import { now } from './clock.ts';
import { verifyAccessToken } from './auth.ts';
import type { AuthedUser } from './auth.ts';
import { chargeGrain, settleBattleResult } from './economy.ts';

/** 방을 만들 때 넘기는 것 — 지금은 대전 규모뿐이다(대기열은 H2b) */
export interface BattleRoomOptions {
  mode: '3v3' | '5v5';
  seed?: number;
}

/** 방이 시계를 보는 주기. 마감을 재는 것 말고는 하는 일이 없다 */
const TICK_MS = 250;

export class BattleRoom extends Room {
  override maxClients = 2;

  private room: RoomState | null = null;
  private mode: '3v3' | '5v5' = '3v3';
  private seed = 1;
  /** 자리에 앉은 사람 — `sessionId`가 아니라 **진영**이 키다 */
  private readonly seats = new Map<Side, Client>();
  private readonly enlists = new Map<Side, Enlist>();
  /** 승/패 보상을 이미 통보했는가 — `finished`는 그 뒤로도 계속 `dispatch`를
   * 지나가므로(재접속 등) **한 판에 한 번만** 부르려고 지킨다 */
  private settled = false;

  override onCreate(options: BattleRoomOptions): void {
    this.mode = options.mode ?? '3v3';
    // 시드는 **서버가 정한다** — 난수의 유일한 소비자가 서버라야 갈릴 수 없다(GDD §10)
    this.seed = options.seed ?? Math.floor(Math.random() * 1_000_000);

    this.onMessage('*', (client, type, payload) => {
      const side = this.sideOf(client);
      if (!side) return;
      const msg = { t: type as string, ...(payload as object) } as ClientMessage;
      // **`msg.enlist.playerId`는 안 믿는다** — `onAuth`가 검증한 uid로 덮는다
      if (msg.t === 'enlist') { this.enlist(side, { ...msg.enlist, playerId: this.uidOf(client) }); return; }
      if (msg.t === 'intent' && this.room) {
        this.dispatch(step(this.room, { t: 'intent', side, intent: msg.intent }, now()));
      }
    });

    this.setSimulationInterval(() => {
      if (!this.room || this.room.closed) return;
      this.dispatch(step(this.room, { t: 'tick' }, now()));
    }, TICK_MS);
  }

  /**
   * 액세스 토큰을 검증한다 — **개발용 고정 방(`?match=room`)으로 직접 붙는 경로만
   * 여기를 지난다.** 대기열이 예약한 좌석(H2b, 실제 경로)은 `QueueRoom`이 이미
   * 검증한 uid를 `reserveSeatFor`의 세 번째 인자로 실어 보내므로 `onAuth`를
   * 다시 안 거친다 — 둘 다 결국 `onJoin`의 세 번째 인자로 같은 모양이 온다.
   */
  static override async onAuth(token: string): Promise<AuthedUser | null> {
    return verifyAccessToken(token);
  }

  override onJoin(client: Client, _options: unknown, auth: AuthedUser): void {
    // 남는 자리에 앉힌다. **먼저 온 사람이 남군(P1)** — 대기열이 붙으면 매칭이 정한다
    const side: Side = this.seats.has('P1') ? 'P2' : 'P1';
    this.seats.set(side, client);
    client.userData = { side, uid: auth.uid };
    if (this.room) this.dispatch(step(this.room, { t: 'joined', side }, now()));
  }

  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const side = this.sideOf(client);
    const uid = this.uidOf(client);
    if (!side) return;
    /*
     * **끊긴 것과 나간 것을 구별하지 않는다.** 둘 다 「사라졌다」의 후보이고,
     * 판정은 유예가 한다 — 「사라졌다는 재접속 유예를 넘겨 안 돌아왔다는 뜻」(GDD §3.9).
     * 스스로 나간 사람(`consented`)은 돌아올 생각이 없으므로 기다리지 않는다.
     */
    if (this.room) this.dispatch(step(this.room, { t: 'gone', side }, now()));
    if (consented) return;
    try {
      await this.allowReconnection(client, RECONNECT_GRACE_MS / 1000);
      this.seats.set(side, client);
      client.userData = { side, uid };
      if (this.room) this.dispatch(step(this.room, { t: 'joined', side }, now()));
    } catch {
      // 안 돌아왔다. `step()`의 유예 판정이 이미 알고 있다 — 여기서 할 일이 없다
    }
  }

  /** 편성을 받아 두고, **둘이 다 모이면 방을 연다** */
  private enlist(side: Side, e: Enlist): void {
    this.enlists.set(side, e);
    if (this.room || this.enlists.size < 2) return;

    const p1 = this.enlists.get('P1')!;
    const p2 = this.enlists.get('P2')!;
    this.room = openRoom(this.roomId, this.seed, this.mode, { P1: p1, P2: p2 }, now());

    /*
     * **상대는 값으로 간다** — 화면이 「누구와 싸우는가」를 다시 만들지 않는다.
     * F가 오프라인에서 굳힌 계약(`MatchOpponent`)이 서버에서도 그대로 선다.
     */
    for (const [s, client] of this.seats) {
      const foe = s === 'P1' ? p2 : p1;
      const res = step(this.room, { t: 'joined', side: s }, now());
      const first = res.out.filter((o) => o.to === s).at(-1)!.msg;
      const opened: Opened = {
        side: s,
        opponent: { id: foe.playerId, squadName: foe.squadName, entries: foe.entries, power: foe.power },
        first,
      };
      client.send('opened', opened);
      this.room = res.room;
    }
  }

  private sideOf(client: Client): Side | undefined {
    return (client.userData as { side?: Side } | undefined)?.side;
  }

  private uidOf(client: Client | undefined): string {
    return (client?.userData as { uid?: string } | undefined)?.uid ?? '';
  }

  /**
   * `out`을 진영별로 뿌린다. **방이 접혔으면 그 통이 마지막이다.**
   *
   * `closed.refund`도 여기서 재계산시킨다(H3b) — `RoomClose`는 **성립하지 않은 판**
   * (배치 중 이탈 · 양쪽 이탈 · 양쪽 유휴)에만 실리고, 클라이언트는 이걸 그대로
   * 믿고 제 계정에 적용했었다(`wire.ts`의 경고 주석 참조). 서버가 직접 정산한다.
   */
  private dispatch(res: StepResult): void {
    this.room = res.room;
    for (const o of res.out) this.seats.get(o.to)?.send('sync', o.msg);
    if (res.closed) {
      for (const side of res.closed.refund) {
        const uid = this.uidOf(this.seats.get(side));
        if (uid) void chargeGrain(uid, this.mode, 'refund');
      }
      this.disconnect();
      return;
    }
    /*
     * **성립한 판이 끝났다** — 항복이든 자연 종료든 `room.battle.phase === 'finished'`가
     * 되는 순간은 여기 한 곳뿐이다(`RoomClose`가 실리는 「성립하지 않은 판」과는
     * 다른 갈래, §3.9). 진짜 무승부(`winner === null`, 실측 0.02%)는 사람이 택1을
     * 고른 뒤에만 반영되므로 여기서는 건드리지 않는다(`/battle/draw-result`, H3d).
     */
    if (!this.settled && this.room.battle.phase === 'finished' && this.room.battle.winner !== null) {
      this.settled = true;
      void this.settleFinished();
    }
  }

  /**
   * 양쪽 진영에 승/패 보상을 통보한다 (H3d) — `BattleRoom` 자신이 이미 판정을 끝낸
   * `room.battle`을 갖고 있으므로 재생 검증(`/battle/ai-result`)이 필요 없다. **판정은
   * 한 줄도 안 한다**(§5-79·80) — `state.winner`를 그대로 읽어 `server-api`에
   * 통보만 할 뿐이다.
   */
  private async settleFinished(): Promise<void> {
    const room = this.room!;
    const winner = room.battle.winner!;
    const SIDES: readonly Side[] = ['P1', 'P2'];
    await Promise.all(SIDES.map(async (side) => {
      const uid = this.uidOf(this.seats.get(side));
      if (!uid) return;
      const foe = side === 'P1' ? 'P2' : 'P1';
      const mine = room.seats[side].enlist;
      const theirs = room.seats[foe].enlist;
      const rewards = await settleBattleResult({
        uid, mode: this.mode, result: side === winner ? 'win' : 'lose', seed: this.seed,
        picks: mine.entries.map((e) => ({ officer: e.officer, piece: e.piece })),
        kills: countKills(room.battle, side),
        power: { mine: battlePower(this.mode, mine.entries), theirs: battlePower(this.mode, theirs.entries) },
        opponentId: theirs.playerId, mySquad: mine.squadName, theirSquad: theirs.squadName,
      });
      const settled: Settled = { rewards };
      this.seats.get(side)?.send('settled', settled);
    }));
  }
}
