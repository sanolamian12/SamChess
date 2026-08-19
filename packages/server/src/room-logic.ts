/**
 * 대전 방의 **판정 층** — Colyseus를 모르고, 지금 몇 시인지도 모른다.
 *
 * ```
 *   [BattleRoom]  ──RoomEvent + nowMs──▶  step()  ──▶  { room, out[], closed }
 *      (껍데기)                            (순수)         진영별 ServerMsg
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 순수 층으로 가르나 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 여기서 굳는 규칙들 — **배치 30초 · 정찰 30초 · 제어 20초 · `[차례 넘기기]` 3번 ·
 * 재접속 유예 1분 · 방 유휴 2분 · 이탈 표 네 줄** — 은 전부 **브라우저 둘을 띄우고
 * 한쪽을 닫아야만** 보이는 종류다. 그런 것을 껍데기에 적으면 검사가 아예 도는 적이
 * 없다(§5-52). 시각을 인자로 받으면 가짜 시계로 한 판을 통째로 밀 수 있고,
 * `npm test`가 전부 잡는다 — 되접기를 `@samchess/meta`에 둔 것과 같은 이유다.
 *
 * ────────────────────────────────────────────────────────────────
 * 서버는 **묻지도 않고 민다** — `ready()`를 듣지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * `LocalTransport`는 재생기의 연출을 기다려 주지만(혼자 두는 판이라 앞질러 달릴
 * 이유가 없다) 서버는 그러지 않는다. 한 걸음에 여러 통이 나가고, 받는 쪽이 큐에
 * 쌓았다가 연출 속도로 소화한다 — 회귀의 `ScriptedTransport`가 흉내 내던 그 모양이
 * 여기서 진짜가 된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 서버가 하는 일은 넷뿐이다
 * ────────────────────────────────────────────────────────────────
 *
 * 1. **의도를 검증하고 적용한다** — 클라이언트는 판정 결과를 보내지 않는다(GDD §10)
 * 2. **마감을 잰다** — 배치·정찰이 지나면 대신 넘기고, 제어 20초는 **재기만 한다**
 *    (넘기는 것은 상대의 선택이다)
 * 3. **시간을 진행시킨다** — `running`이면 곧바로 `advanceTime`
 * 4. **방을 접는다** — 이탈 · 유휴 (GDD §3.9의 표)
 *
 * ⚠ **참가비·거절 군량을 다시 검증하지 않는다** (H3). 계정이 아직 브라우저에 있어
 * 전투만 서버로 보내도 결과를 지어내면 그만이다 — **둘은 같은 세션에서만 뜻이
 * 있다**(§5-61). 아는 채로 두고 여기 적어 둔다.
 */

import {
  CONTROL_MS, DEPLOY_MS, RECONNECT_GRACE_MS, ROOM_IDLE_MS, SCOUT_MS, WAITING_MS,
  advanceTime, apply, createBattle, toWire, validate,
} from '@samchess/rules';
import type {
  BattleEvent, BattleMode, BattlePhase, BattleState, Intent, RoomClose, ServerMsg, Side,
} from '@samchess/rules';
import type { Enlist } from './protocol.ts';

const SIDES: readonly Side[] = ['P1', 'P2'];
const other = (side: Side): Side => (side === 'P1' ? 'P2' : 'P1');

/** 한 사람의 자리. **끊긴 것과 나간 것을 구별하지 않는다** — 둘 다 유예가 판정한다 */
export interface Seat {
  readonly enlist: Enlist;
  connected: boolean;
  /** 끊긴 시각. 붙어 있으면 `null` */
  goneAt: number | null;
}

export interface RoomState {
  battle: BattleState;
  seats: Record<Side, Seat>;
  /**
   * 지금 단계가 시작된 실시간. **단계가 바뀔 때만 다시 잰다** —
   * 통마다 새로 재면 배치 중에 기물을 옮길 때마다 30초가 되살아난다(§5-56).
   */
  phaseAt: number;
  /** 마지막으로 본 단계. 위 값을 언제 다시 잴지 정한다 */
  phaseNow: BattlePhase;
  /** 진영별 「내가 준비를 마친 시각」 — `waiting` 마감의 기준점 */
  readyAt: Record<Side, number | null>;
  /**
   * 마지막으로 **어느 쪽에서든 의도가 온** 시각 — 유휴 상한의 기준 (§5-68).
   *
   * **서버가 스스로 민 것은 세지 않는다.** 「어느 쪽에서도 의도가 안 오면」이
   * 규칙이라, 자동 준비·자동 정찰 종료를 세면 아무도 안 두는 판이 영원히 안 접힌다.
   */
  aliveAt: number;
  closed: RoomClose | null;
}

export interface Outbound {
  to: Side;
  msg: ServerMsg;
}

export type RoomEvent =
  | { t: 'joined'; side: Side }
  | { t: 'gone'; side: Side }
  | { t: 'intent'; side: Side; intent: Intent }
  /** 아무 일도 없었다 — 마감만 본다 */
  | { t: 'tick' };

export interface StepResult {
  room: RoomState;
  out: Outbound[];
  /** 이번 걸음에 방이 접혔으면 그 정산. 이미 접혀 있었으면 `null` */
  closed: RoomClose | null;
}

// ═══════════════════════════════════════════════════════════════
// 1. 방을 연다
// ═══════════════════════════════════════════════════════════════

/**
 * 두 사람이 다 모였다 — 판을 만들고 **배치 프리셋을 깐다.**
 *
 * **프리셋은 서버가 깐다** — 예전에는 `BattleScreen`이 깔았는데, 그러면 북군(P2)의
 * 프리셋이 「내가 언제나 남군」인 오프라인에서 한 번도 안 돈다. 판정이 서버로
 * 오면서 자리도 함께 왔다.
 *
 * **어긋난 프리셋은 아무 말 없이 안 깐다**(§5-45) — 구성을 고쳤거나 남군 좌표를
 * 북군에 쓴 경우다. 여기서 막으면 「부대를 고쳤더니 전투에 못 들어간다」가 된다.
 */
export function openRoom(
  matchId: string, seed: number, mode: BattleMode,
  seats: Record<Side, Enlist>, nowMs: number,
): RoomState {
  let battle = createBattle({
    matchId, seed, mode,
    rosters: { P1: seats.P1.entries, P2: seats.P2.entries },
  });

  for (const side of SIDES) {
    const placements = seats[side].deploy;
    if (!placements) continue;
    if (!validate(battle, side, { t: 'deploy', placements }).ok) continue;
    battle = apply(battle, side, { t: 'deploy', placements }).state;
  }

  return {
    battle,
    seats: {
      P1: { enlist: seats.P1, connected: true, goneAt: null },
      P2: { enlist: seats.P2, connected: true, goneAt: null },
    },
    phaseAt: nowMs,
    phaseNow: battle.phase,
    readyAt: { P1: null, P2: null },
    aliveAt: nowMs,
    closed: null,
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. 한 걸음
// ═══════════════════════════════════════════════════════════════

/**
 * 사건 하나를 받아 방을 한 걸음 민다. **이 함수 하나가 방의 규칙 전부다.**
 *
 * 순서에 이유가 있다 — ① 사건을 반영하고 ② 서버가 할 일(마감·시간 진행)을 하고
 * ③ 이탈·유휴를 판정한다. ②를 ③보다 먼저 하는 것은 **마감이 지나 자동으로 넘어간
 * 판을 이탈로 접지 않기 위해서**다.
 */
export function step(room: RoomState, ev: RoomEvent, nowMs: number): StepResult {
  if (room.closed) return { room, out: [], closed: null };

  const out: Outbound[] = [];
  const run = (advance: () => { state: BattleState; events: BattleEvent[] }): void => {
    const r = advance();
    room.battle = r.state;
    markPhase(room, nowMs);
    for (const side of SIDES) out.push({ to: side, msg: sync(room, side, r.events, nowMs) });
  };

  // ── ① 사건 ──
  switch (ev.t) {
    case 'joined': {
      const seat = room.seats[ev.side];
      seat.connected = true;
      seat.goneAt = null;
      /*
       * **재접속은 스냅샷 한 통이다** — 「로그를 뺀 스냅샷을 보낸다」는 결정에
       * 딸려 이미 풀려 있다(§5-55). 이벤트만 보내는 설계였다면 로그 전체를
       * 되보내야 했다. 돌아온 사람의 로그는 비어 있고, 그래서 대화창은 지금부터다.
       */
      out.push({ to: ev.side, msg: sync(room, ev.side, [], nowMs) });
      break;
    }
    case 'gone': {
      const seat = room.seats[ev.side];
      if (seat.connected) { seat.connected = false; seat.goneAt = nowMs; }
      break;
    }
    case 'intent': {
      if (!accepts(room, ev.side, ev.intent, nowMs)) break;
      room.aliveAt = nowMs;
      if (ev.intent.t === 'ready' && room.readyAt[ev.side] === null) room.readyAt[ev.side] = nowMs;
      run(() => apply(room.battle, ev.side, ev.intent));
      break;
    }
    case 'tick':
      break;
  }

  // ── ② 서버가 할 일 — 마감과 시간 진행 ──
  drive(room, nowMs, run);

  // ── ③ 사라진 쪽이 있다 — 항복시킬 것인가, 방을 접을 것인가 ──
  const gone = goneSides(room, nowMs);
  if (gone.length === 1 && room.seats[other(gone[0]!)].connected
      && room.battle.phase !== 'deploy' && room.battle.phase !== 'finished') {
    /*
     * **정찰 이후 갈래에는 새 규칙이 없다** (§5-64) — 사라진 쪽 대신
     * `{t:'surrender'}`를 적용하면 `outcome: 'surrender'`가 그대로 나오고
     * 보상표(GDD §6.4)가 그대로 걸린다. **성립한 판이라 `close`를 안 만든다.**
     */
    const g = gone[0]!;
    run(() => apply(room.battle, g, { t: 'surrender' }));
  }

  const closed = resolveClose(room, nowMs);
  if (closed) {
    room.closed = closed;
    for (const side of SIDES) {
      out.push({ to: side, msg: { ...sync(room, side, [], nowMs), close: closed } });
    }
  }
  return { room, out, closed };
}

/**
 * 이 의도를 받아들이나 — **서버가 클라이언트를 믿지 않는 유일한 자리.**
 *
 * 거부는 **조용히 버린다**. 로컬(`LocalTransport`)이 던지는 것과 반대인데 뜻이
 * 다르기 때문이다: 로컬의 거부는 **우리 UI의 버그**라 시끄러워야 하고, 여기서는
 * 저편이 우리 UI라는 보장이 없다 — 믿을 수 없는 클라이언트에게 설명할 이유가 없다.
 */
function accepts(room: RoomState, side: Side, intent: Intent, nowMs: number): boolean {
  if (!validate(room.battle, side, intent).ok) return false;
  /*
   * **제어 20초는 서버가 잰다** (GDD §3.3). 엔진은 실시간을 모르므로
   * `validate`가 통과시켜 준 뒤 여기서 한 번 더 막는다 — 이 한 줄이 없으면
   * `[차례 넘기기]`가 즉시 먹혀 3번 규칙이 「빨리 세 번 누르기」가 된다.
   */
  if (intent.t === 'forceSkipTurn') {
    const at = room.battle.controlStartedAtMs;
    if (at === null || nowMs - at < CONTROL_MS) return false;
  }
  return true;
}

/**
 * 서버가 스스로 미는 것 — **마감이 지났거나 시간이 흘러야 할 때.**
 *
 * `for`로 도는 이유: 한 걸음이 다음 걸음을 곧바로 부른다. 배치 마감으로 둘 다
 * 준비를 마치면 그 자리에서 `scout`이 되고, 정찰 마감이 지나 있으면 이어서
 * `running`이 되며, `running`은 곧바로 제어권까지 간다. 상한은 안전장치다 —
 * 이 갈래는 언제나 몇 걸음 안에 `control`이나 `finished`에서 멈춘다.
 */
function drive(
  room: RoomState, nowMs: number,
  run: (f: () => { state: BattleState; events: BattleEvent[] }) => void,
): void {
  for (let guard = 0; guard < 8; guard++) {
    const b = room.battle;
    if (b.phase === 'finished') return;

    if (b.phase === 'deploy') {
      if (nowMs - room.phaseAt < DEPLOY_MS) return;
      /*
       * **끊긴 사람에게는 자동 `[준비완료]`를 걸지 않는다** ★ (§5-69)
       *
       * 배치 마감의 자동 준비는 **자리에 있는데 시간이 다 된** 사람을 위한 편의다.
       * 끊긴 사람에게까지 걸면 `+30초`에 `ready`가 서고 `+60초`에 유예가 끝날 때는
       * 이미 정찰 이후라, **배치 중 이탈이 언제나 항복으로 판정되어 이탈 표의 첫
       * 줄이 영원히 안 돈다** — 「도달할 수 없는 갈래」가 규칙 쪽에 생기는 자리다.
       */
      const auto = SIDES.filter((s) => room.seats[s].connected && !b.ready[s]);
      if (auto.length === 0) return;   // 끊긴 쪽만 남았다 — 유예가 판정한다
      for (const s of auto) {
        if (room.readyAt[s] === null) room.readyAt[s] = nowMs;
        run(() => apply(room.battle, s, { t: 'ready' }));
      }
      continue;
    }

    if (b.phase === 'scout') {
      if (nowMs - room.phaseAt < SCOUT_MS) return;
      run(() => advanceTime(room.battle));
      continue;
    }

    if (b.phase === 'running') {
      run(() => advanceTime(room.battle));
      continue;
    }

    // `control` — **서버는 재되 먼저 움직이지 않는다.** 넘기는 것은 상대의 선택이다
    return;
  }
}

/** 재접속 유예를 넘겨 안 돌아온 쪽 — **「사라졌다」의 정의는 여기 하나뿐이다** */
function goneSides(room: RoomState, nowMs: number): Side[] {
  return SIDES.filter((s) => {
    const at = room.seats[s].goneAt;
    return at !== null && nowMs - at >= RECONNECT_GRACE_MS;
  });
}

/**
 * 방을 접을 때인가 — **GDD §3.9의 표 그대로.**
 *
 * | | 사라진 쪽 | 남은 쪽 |
 * |---|---|---|
 * | 한쪽만 · 배치 중 | 참가비를 **잃는다** | **환불** · 전적도 보상도 없다 |
 * | 한쪽만 · 정찰 이후 | **항복과 같다** | 승리 보상·전적 |
 * | 양쪽 다 | 양쪽 **환불** · 전적도 보상도 없다 | |
 *
 * 가운데 줄은 여기 안 온다 — `step()`이 이미 `surrender`를 적용했고, 그건
 * **성립한 판**이라 정산 지시가 필요 없다.
 */
function resolveClose(room: RoomState, nowMs: number): RoomClose | null {
  if (room.battle.phase === 'finished') return null;

  const gone = goneSides(room, nowMs);

  if (gone.length === 2) {
    // **양쪽 다 사라졌으면 지킬 사람이 없다** — 대개 시스템 장애이고, 아니라면
    // 싸우지 않기로 합의한 것이다. 기다리느라 불편을 겪은 사람이 없다 (§5-66)
    return { reason: 'left', refund: ['P1', 'P2'] };
  }

  if (gone.length === 1) {
    const g = gone[0]!;
    const rest = other(g);
    /*
     * **판정 시점은 「기다린 사람이 있었는가」로 갈린다** (§5-66) — 상대가 붙어
     * 있으면 곧바로 끝내고(기다리는 사람을 더 기다리게 하지 않는다), 그때 상대도
     * 끊겨 있으면 **재촉할 사람이 없으므로** 둘의 유예가 모두 끝날 때까지 둔다.
     */
    if (!room.seats[rest].connected) return null;
    /*
     * 여기 오는 것은 **배치 중**뿐이다(정찰 이후는 `step()`이 항복시켰다).
     * **배치 중 이탈에 승리는 주지 않는다** — 주면 「상대를 끊게 만드는 것」이
     * 이득이 되고, 성립한 적 없는 전투의 전적이 남는다. 환불까지가 지킬 몫이다.
     *
     * **사라진 쪽은 `refund`에 없다** — 돌려주면 참가비를 낸 뒤 끊어서 회피할 수
     * 있어 「다시 찾기」(−1)가 통째로 무력해진다(§5-65).
     */
    return { reason: 'left', refund: [rest] };
  }

  /*
   * **양쪽 다 손을 놓았다** (§5-68) — 어느 쪽에서도 의도가 안 온다.
   * §5-67(넘기기 3번)과 **겹치지 않는다**: 누르는 사람이 있으면 방은 유휴가 아니고,
   * 아무도 안 누르면 3번에 닿을 일이 없다.
   */
  if (nowMs - room.aliveAt >= ROOM_IDLE_MS) return { reason: 'idle', refund: ['P1', 'P2'] };
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 3. 통 한 개 — 마감은 **받는 사람의 것**이다
// ═══════════════════════════════════════════════════════════════

/**
 * 단계가 바뀌었으면 그 시각을 다시 잰다. **제어권을 얻은 시각도 여기서 주입한다** —
 * `controlStartedAtMs`는 엔진이 못 채우는 값이고(실시간이다) 서버가 유일한 주인이다.
 */
function markPhase(room: RoomState, nowMs: number): void {
  if (room.battle.phase === room.phaseNow) return;
  room.phaseNow = room.battle.phase;
  room.phaseAt = nowMs;
  if (room.battle.phase === 'control') room.battle.controlStartedAtMs = nowMs;
}

/**
 * 지금 단계가 끝나기까지 **남은 ms** — 진영마다 다르다.
 *
 * | 단계 | 누구에게 | 무엇 |
 * |---|---|---|
 * | `deploy` (아직 준비 전) | 그 쪽 | `DEPLOY_MS` 잔여 |
 * | `deploy` (준비를 마쳤다 = 전선의 `waiting`) | 그 쪽 | `WAITING_MS` 잔여 |
 * | `scout` | 양쪽 | `SCOUT_MS` 잔여 |
 * | `control` | 양쪽 | `CONTROL_MS` 잔여 — **0이 되면 상대에게 `[차례 넘기기]`가 열린다** |
 *
 * 제어 마감을 싣는 것이 요점이다 — 안 실으면 화면이 제 시계로 20초를 다시 재고,
 * **상수가 두 벌이 되면 어긋나도 화면은 아무 말도 안 한다.**
 */
export function deadlineFor(room: RoomState, side: Side, nowMs: number): number | null {
  const b = room.battle;
  const left = (from: number, span: number): number => Math.max(0, span - (nowMs - from));
  if (b.phase === 'deploy') {
    if (!b.ready[side]) return left(room.phaseAt, DEPLOY_MS);
    return left(room.readyAt[side] ?? room.phaseAt, WAITING_MS);
  }
  if (b.phase === 'scout') return left(room.phaseAt, SCOUT_MS);
  if (b.phase === 'control') return left(room.phaseAt, CONTROL_MS);
  return null;
}

/** 통 하나 — 로그를 떼고, **받는 사람의 관점**으로 단계를 적고, 남은 ms를 싣는다 */
function sync(room: RoomState, side: Side, events: BattleEvent[], nowMs: number): ServerMsg {
  return {
    t: 'sync',
    state: toWire(room.battle, side),
    events,
    deadlineInMs: deadlineFor(room, side, nowMs),
  };
}
