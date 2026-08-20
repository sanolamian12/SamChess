/**
 * 대기열의 **판정 층** — `room-logic.ts`와 같은 규약이다. Colyseus를 모르고,
 * 지금 몇 시인지도 인자로만 받는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 방과 갈라 두나
 * ────────────────────────────────────────────────────────────────
 *
 * 대기열은 **전투가 아니다** — 매칭됐어도 둘 다 [전투준비]를 눌러야 방이 열린다
 * (§5-60). 그 "찾음 → 확인 대기" 상태를 `room-logic.ts`(전투 판정)에 욱여넣으면
 * 판정 층에 전투 아닌 상태가 섞인다. `QueueRoom.ts`가 이 파일을 감싸는 껍데기다.
 *
 * ────────────────────────────────────────────────────────────────
 * 세 상태 — `waiting` → `pending` → (방이 열린다, 여기서는 사라진다)
 * ────────────────────────────────────────────────────────────────
 *
 * ```
 * enqueue()   같은 모드 · 서로 피하지 않음(§5-63) · isAdjacentPower(§7.1, 안 넓힌다)
 *             인 상대가 있으면 즉시 매칭 → PendingMatch. 없으면 waiting에 追加
 * confirm()   PendingMatch의 한쪽이 [전투준비] — 둘 다 확인되면 pending에서 빠진다
 * decline()   거절한 쪽: 기억(avoid) + 맨 앞으로 재대기. 거절당한 쪽: 패널티 없이
 *             맨 앞으로 재대기 — 둘 다 그 자리에서 **곧바로 재매칭을 시도한다**
 * gone()      끊겼다(진짜 나갔든 소켓이 죽었든) — waiting이면 즉시 빼고, pending이면
 *             **상대만** 되돌린다(진짜 거절이 아니므로 기억은 안 남긴다)
 * ```
 *
 * **거절 기억(`avoid`)은 방이 아니라 대기열의 것이고, 대기열이 사는 동안(서버
 * 프로세스 생애)만 산다** (§5-63, HANDOFF "미리 보이는 지뢰") — `QueueRoom`이
 * `autoDispose = false`로 계속 살아 있어야 이 값이 세션 동안 유지된다.
 */

import { isAdjacentPower } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import type { Enlist } from './protocol.ts';

/** 대기열 한 자리 — 아직 상대를 못 찾은 사람 */
export interface QueueEntry {
  readonly playerId: string;
  readonly mode: BattleMode;
  readonly power: number;
  readonly enlist: Enlist;
  readonly queuedAt: number;
}

/** 매칭됐지만 아직 방은 안 열렸다 — 둘 다 [전투준비]를 눌러야 한다 */
export interface PendingMatch {
  readonly id: string;
  readonly a: QueueEntry;
  readonly b: QueueEntry;
  readonly confirmed: ReadonlySet<string>;
}

export interface QueueState {
  readonly waiting: readonly QueueEntry[];
  readonly pending: readonly PendingMatch[];
  /** playerId → 그 사람이 피할 상대들 (§5-63) */
  readonly avoid: ReadonlyMap<string, ReadonlySet<string>>;
}

export const emptyQueue = (): QueueState => ({ waiting: [], pending: [], avoid: new Map() });

/** 순서 없는 쌍에서 결정적으로 하나의 id를 낸다 — 카운터를 안 두려는 것이다 */
const pendingId = (a: string, b: string): string => [a, b].sort().join('~');

const avoids = (state: QueueState, a: string, b: string): boolean =>
  (state.avoid.get(a)?.has(b) ?? false) || (state.avoid.get(b)?.has(a) ?? false);

// ═══════════════════════════════════════════════════════════════
// 1. 대기열에 넣는다 — 즉시 매칭을 시도한다
// ═══════════════════════════════════════════════════════════════

export interface EnqueueResult {
  state: QueueState;
  matched: PendingMatch | null;
}

/**
 * `entry`를 대기열에 넣는다. 같은 모드에 · 서로 피하지 않고 · 전투력이 인접한
 * (`isAdjacentPower` — 매칭 구간은 안 넓힌다, §5-62) 상대가 있으면 **즉시 매칭**한다.
 *
 * `priority`는 거절 뒤 재대기에서만 쓴다 — 거절당한 쪽이 "대기열 앞으로" 가는
 * 자리(§5-63)이고, 앞쪽이 **다음 매칭 시도에서 먼저 훑힌다.**
 */
export function enqueue(state: QueueState, entry: QueueEntry, priority = false): EnqueueResult {
  const idx = state.waiting.findIndex(
    (w) => w.mode === entry.mode && !avoids(state, w.playerId, entry.playerId)
      && isAdjacentPower(w.power, entry.power),
  );

  if (idx === -1) {
    const waiting = priority ? [entry, ...state.waiting] : [...state.waiting, entry];
    return { state: { ...state, waiting }, matched: null };
  }

  const partner = state.waiting[idx]!;
  const waiting = state.waiting.filter((_, i) => i !== idx);
  const match: PendingMatch = {
    id: pendingId(partner.playerId, entry.playerId), a: partner, b: entry, confirmed: new Set(),
  };
  return { state: { ...state, waiting, pending: [...state.pending, match] }, matched: match };
}

/** 검색을 그만둔다(뒤로 가기) — 매칭 전이라 되돌릴 사람이 없다 */
export function leave(state: QueueState, playerId: string): QueueState {
  return { ...state, waiting: state.waiting.filter((e) => e.playerId !== playerId) };
}

// ═══════════════════════════════════════════════════════════════
// 2. 매칭됐다 — [전투준비] 확인을 기다린다
// ═══════════════════════════════════════════════════════════════

export interface ConfirmResult {
  state: QueueState;
  /** 둘 다 확인됐으면 그 매칭 — 여기서 방을 연다 */
  opened: PendingMatch | null;
}

export function confirm(state: QueueState, matchId: string, playerId: string): ConfirmResult {
  const m = state.pending.find((p) => p.id === matchId);
  if (!m || (m.a.playerId !== playerId && m.b.playerId !== playerId)) {
    return { state, opened: null };
  }
  const confirmed = new Set(m.confirmed);
  confirmed.add(playerId);

  if (confirmed.has(m.a.playerId) && confirmed.has(m.b.playerId)) {
    return { state: { ...state, pending: state.pending.filter((p) => p.id !== matchId) }, opened: m };
  }
  const updated: PendingMatch = { ...m, confirmed };
  return { state: { ...state, pending: state.pending.map((p) => (p.id === matchId ? updated : p)) }, opened: null };
}

/**
 * 거절한다(「다시 찾기」). **거절한 쪽만** 기억에 남고, 둘 다 대기열 맨 앞으로 —
 * 그 자리에서 **곧바로 재매칭을 시도한다**(다른 사람이 이미 기다리고 있을 수 있다).
 *
 * 참가비·거절 군량은 여기서 다루지 않는다 — 클라이언트가 `@samchess/meta`의
 * `declineMatch()`로 낸다(H3 전까지 서버가 검증하지 않는다, §5-61).
 */
export interface DeclineResult {
  state: QueueState;
  /** 거절당한 쪽에게 「상대가 거절했습니다」를 보낸다 */
  notifyDeclined: QueueEntry | null;
  /** 거절한 쪽이 그 자리에서 다른 사람과 곧바로 매칭됐으면 */
  decliderMatch: PendingMatch | null;
  /** 거절당한 쪽이 그 자리에서 다른 사람과 곧바로 매칭됐으면 */
  partnerMatch: PendingMatch | null;
}

export function decline(state: QueueState, matchId: string, deciderId: string, nowMs: number): DeclineResult {
  const m = state.pending.find((p) => p.id === matchId);
  if (!m || (m.a.playerId !== deciderId && m.b.playerId !== deciderId)) {
    return { state, notifyDeclined: null, decliderMatch: null, partnerMatch: null };
  }
  const decider = m.a.playerId === deciderId ? m.a : m.b;
  const partner = m.a.playerId === deciderId ? m.b : m.a;

  const mem = new Set(state.avoid.get(decider.playerId) ?? []);
  mem.add(partner.playerId);
  const avoid = new Map(state.avoid);
  avoid.set(decider.playerId, mem);

  /*
   * **거절당한 쪽만 「대기열 앞으로」다** — 잘못한 사람이 없는 쪽이라 새 상대가
   * 나타나면 먼저 받는다. **거절한 쪽은 맨 뒤로** 보낸다 — 둘 다 앞에 넣으면
   * 나중에 넣는 쪽(거절한 쪽)이 앞자리를 차지해 버려 정확히 거꾸로 된다.
   */
  let s: QueueState = { ...state, pending: state.pending.filter((p) => p.id !== matchId), avoid };
  const r1 = enqueue(s, { ...partner, queuedAt: nowMs }, true);
  s = r1.state;
  const r2 = enqueue(s, { ...decider, queuedAt: nowMs }, false);

  return { state: r2.state, notifyDeclined: partner, decliderMatch: r2.matched, partnerMatch: r1.matched };
}

// ═══════════════════════════════════════════════════════════════
// 3. 사라졌다 — 소켓이 끊기거나 나갔다
// ═══════════════════════════════════════════════════════════════

export interface GoneResult {
  state: QueueState;
  /** 매칭 대기(pending) 중이었으면 상대에게 알린다 — **기억은 안 남긴다**(진짜 거절이 아니다) */
  notifyPartner: QueueEntry | null;
  /** 되돌아간 상대가 그 자리에서 다른 사람과 곧바로 매칭됐으면 */
  rematched: PendingMatch | null;
}

/**
 * **대기열은 「나갔다」를 즉시 알아야 한다** — 전투 방의 재접속 유예(60초)를
 * 대기열에 그대로 쓰면 없는 사람과 짝지어진다. 유예 없이 바로 정리한다.
 */
export function gone(state: QueueState, playerId: string, nowMs: number): GoneResult {
  if (state.waiting.some((e) => e.playerId === playerId)) {
    return { state: leave(state, playerId), notifyPartner: null, rematched: null };
  }
  const m = state.pending.find((p) => p.a.playerId === playerId || p.b.playerId === playerId);
  if (!m) return { state, notifyPartner: null, rematched: null };

  const partner = m.a.playerId === playerId ? m.b : m.a;
  const pending = state.pending.filter((p) => p.id !== m.id);
  const r = enqueue({ ...state, pending }, { ...partner, queuedAt: nowMs }, true);
  return { state: r.state, notifyPartner: partner, rematched: r.matched };
}
