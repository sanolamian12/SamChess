/**
 * 대기열 방 — **Colyseus 껍데기.** 판정은 `queue-logic.ts`가 다 하고, 여기는
 * 사건을 그리로 넘기고 결과를 진영이 아니라 **playerId**로 뿌린다.
 *
 * `BattleRoom.ts`와 같은 결이다 — 다른 것은 「누구에게 보내는가」의 키뿐이다
 * (대전 방은 진영 둘, 대기열은 playerId 여럿).
 *
 * ────────────────────────────────────────────────────────────────
 * `autoDispose = false` ★ — 거절 기억이 여기 산다
 * ────────────────────────────────────────────────────────────────
 *
 * 검색이 끝날 때마다 대기열 연결을 끊으므로(방에 붙어 있는 이유가 없어진다) 방이
 * 잠깐씩 비는데, 그때마다 새로 만들면 **거절 기억(`avoid`)이 날아간다** — 거절한
 * 상대와 다시 붙지 않는다는 약속(§5-63)이 그 순간 깨진다. 방을 계속 살려 둔다.
 *
 * ────────────────────────────────────────────────────────────────
 * 방이 열리는 자리 — `matchMaker`로 대전 방에 좌석을 예약한다
 * ────────────────────────────────────────────────────────────────
 *
 * 둘 다 `confirm`을 보내면 `matchMaker.createRoom('battle', …)`으로 **기존
 * `BattleRoom`을** 만들고(한 글자도 안 고쳤다) 둘에게 좌석을 하나씩 예약해
 * (`reserveSeatFor`) 그 예약을 돌려준다. 클라는 `consumeSeatReservation()`으로
 * 붙고, 그다음은 `enlist`부터 **개발용 고정 방(`?match=room`)과 완전히 같은 절차**다.
 */

import { Room, matchMaker } from '@colyseus/core';
import type { Client } from '@colyseus/core';
import { confirm, decline, emptyQueue, enqueue, gone } from './queue-logic.ts';
import type { PendingMatch, QueueEntry, QueueState } from './queue-logic.ts';
import { BATTLE_ROOM } from './protocol.ts';
import type { QueueClientMessage, QueueMatched, QueueSearch } from './protocol.ts';
import type { BattleRoomOptions } from './BattleRoom.ts';
import { now } from './clock.ts';
import { verifyAccessToken } from './auth.ts';
import type { AuthedUser } from './auth.ts';

const opponentOf = (e: QueueEntry): QueueMatched['opponent'] => ({
  id: e.enlist.playerId, squadName: e.enlist.squadName, entries: e.enlist.entries, power: e.power,
});

export class QueueRoom extends Room {
  override maxClients = 1_000;
  override autoDispose = false;

  private q: QueueState = emptyQueue();
  private readonly bySeat = new Map<string, Client>();

  override onCreate(): void {
    this.onMessage('*', (client, type, payload) => {
      const playerId = this.playerIdOf(client);
      if (!playerId) return;
      const msg = { t: type as string, ...(payload as object) } as QueueClientMessage;
      if (msg.t === 'search') this.search(playerId, msg.search);
      else if (msg.t === 'confirm') this.doConfirm(playerId, msg.matchId);
      else if (msg.t === 'decline') this.doDecline(playerId, msg.matchId);
    });
  }

  /**
   * 액세스 토큰을 검증한다 — **여기가 신원 확인의 실제 관문이다.** `client`가
   * 접속을 요청할 때 붙인 `_authToken`(`colyseus.js`의 `client.auth.token`)이
   * `context.token`으로 온다. 실패하면 `null`을 돌려주는데, Colyseus가 그걸
   * `AUTH_FAILED`로 바꿔 **접속 자체를 거절한다**(matchmaker의 `callOnAuth`).
   */
  static override async onAuth(token: string): Promise<AuthedUser | null> {
    return verifyAccessToken(token);
  }

  /** `options.playerId`는 안 믿는다 — 신원은 `onAuth`가 검증한 uid로만 정해진다 */
  override onJoin(client: Client, _options: unknown, auth: AuthedUser): void {
    client.userData = { playerId: auth.uid };
    this.bySeat.set(auth.uid, client);
  }

  /**
   * **재접속 유예를 두지 않는다** — 대기열은 「나갔다」를 즉시 알아야 한다
   * (`gone()`의 머리 참조). 소켓이 죽었든 [뒤로 가기]를 눌렀든 여기서는 같다.
   */
  override onLeave(client: Client): void {
    const playerId = this.playerIdOf(client);
    if (!playerId) return;
    this.bySeat.delete(playerId);
    const r = gone(this.q, playerId, now());
    this.q = r.state;
    if (r.notifyPartner) this.tell(r.notifyPartner.playerId, 'declined', {});
    if (r.rematched) this.announce(r.rematched);
  }

  private search(playerId: string, s: QueueSearch): void {
    // 다시 찾는 것일 수 있다(거절 뒤 새 라운드) — 대기열 자리는 `decline()`이 이미
    // 옮겨 놨으므로, 여기서는 **처음 들어오는 사람만** 새로 넣는다
    if (this.q.waiting.some((e) => e.playerId === playerId)
        || this.q.pending.some((p) => p.a.playerId === playerId || p.b.playerId === playerId)) {
      return;
    }
    // **`s.enlist.playerId`는 클라이언트가 적어 보낸 값이라 안 믿는다** — 검증된 uid로 덮는다
    const entry: QueueEntry = {
      playerId, mode: s.mode, power: s.power, enlist: { ...s.enlist, playerId }, queuedAt: now(),
    };
    const r = enqueue(this.q, entry);
    this.q = r.state;
    if (r.matched) this.announce(r.matched);
  }

  private doConfirm(playerId: string, matchId: string): void {
    const r = confirm(this.q, matchId, playerId);
    this.q = r.state;
    if (r.opened) void this.openBattle(r.opened);
  }

  private doDecline(playerId: string, matchId: string): void {
    const r = decline(this.q, matchId, playerId, now());
    this.q = r.state;
    if (r.notifyDeclined) this.tell(r.notifyDeclined.playerId, 'declined', {});
    if (r.decliderMatch) this.announce(r.decliderMatch);
    if (r.partnerMatch) this.announce(r.partnerMatch);
  }

  private playerIdOf(client: Client): string | undefined {
    return (client.userData as { playerId?: string } | undefined)?.playerId;
  }

  private tell(playerId: string, type: string, payload: unknown): void {
    this.bySeat.get(playerId)?.send(type, payload);
  }

  private announce(m: PendingMatch): void {
    this.tell(m.a.playerId, 'matched', { matchId: m.id, opponent: opponentOf(m.b) } satisfies QueueMatched);
    this.tell(m.b.playerId, 'matched', { matchId: m.id, opponent: opponentOf(m.a) } satisfies QueueMatched);
  }

  /**
   * 둘 다 확인했다 — **기존 `BattleRoom`**을 만들고 좌석을 하나씩 예약해 보낸다.
   *
   * `reserveSeatFor`의 세 번째 인자로 **여기서 이미 검증된 uid**를 실어 보낸다 —
   * `BattleRoom`이 다시 토큰을 검증할 필요가 없다(이 경로는 `BattleRoom.onAuth`를
   * 안 거친다, `matchMaker.createRoom`+`reserveSeatFor`는 HTTP 매치메이크 요청이
   * 아니라서다). `BattleRoom.onJoin`은 이 값을 `auth.uid`로 그대로 받는다.
   */
  private async openBattle(m: PendingMatch): Promise<void> {
    const options: BattleRoomOptions = { mode: m.a.mode };
    const room = await matchMaker.createRoom(BATTLE_ROOM, options);
    const [resA, resB] = await Promise.all([
      matchMaker.reserveSeatFor(room, {}, { uid: m.a.playerId } satisfies AuthedUser),
      matchMaker.reserveSeatFor(room, {}, { uid: m.b.playerId } satisfies AuthedUser),
    ]);
    this.tell(m.a.playerId, 'reservation', { reservation: resA });
    this.tell(m.b.playerId, 'reservation', { reservation: resB });
  }
}
