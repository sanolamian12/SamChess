/**
 * 방과 클라이언트가 주고받는 **메시지 이름과 모양** — 양쪽이 이 파일 하나를 본다.
 *
 * 전투 자체의 계약(`ServerMsg` · `toWire`/`applyWire`)은 `@samchess/rules`의
 * `wire.ts`에 있다. 여기 있는 것은 **방에 들어가고 나오는 데 필요한 것**뿐이다.
 *
 * ```
 * 클라 → 대전 방   'enlist'  내 편성·부대 이름·배치 프리셋 (들어가면서 한 번)
 *                  'intent'  의도 하나                      ← 판정 결과는 절대 안 보낸다
 * 대전 방 → 클라   'opened'  내 진영 · 상대(값) · 첫 스냅샷
 *                  'sync'    ServerMsg (GDD §10)
 *                  'settled' 승/패 보상 반영 결과 (H3d) — 무승부에는 안 온다
 *
 * 클라 → 대기열    'search'   모드 · 전투력 · 편성 (들어가면서 한 번)
 *                  'confirm'  [전투준비] — 매칭된 상대를 받아들인다
 *                  'decline'  [다시 찾기] — 매칭된 상대를 거절한다
 * 대기열 → 클라    'matched'    상대를 찾았다(값) — 아직 방은 안 열렸다
 *                  'declined'   상대가 거절했다(또는 사라졌다) — 자동으로 다시 대기한다
 *                  'reservation'  둘 다 확인했다 — 대전 방 좌석 예약(H2b)
 * ```
 *
 * **상대는 값으로 온다** — `MatchOpponent`와 같은 모양이라 `BattleScreen`이
 * 「누구와 싸우는지」를 다시 만들지 않는다(F가 굳힌 계약이 서버에서도 그대로 선다).
 */

import type { matchMaker } from '@colyseus/core';
import type { BattleMode, RosterEntry, ServerMsg, Side, Vec2, UnitId, Intent } from '@samchess/rules';
import type { BattleRewards } from '@samchess/meta';

/** 개발용 주소. **배포는 코드가 아니라 설정이 바뀐다** (§5-59) */
export const SERVER_URL = process.env['SAMCHESS_SERVER'] ?? 'ws://localhost:2567';
export const SERVER_PORT = Number(process.env['SAMCHESS_PORT'] ?? 2567);
export const BATTLE_ROOM = 'battle';
export const QUEUE_ROOM = 'queue';

/** 방에 들어가며 내미는 것 */
export interface Enlist {
  /**
   * 재접속용 안정된 키 — Supabase uid (H3a). **클라이언트가 적어 보낸 값은 안 믿는다** —
   * `BattleRoom`/`QueueRoom`이 `onAuth`로 검증한 uid로 항상 덮어쓴다(§5-91).
   */
  playerId: string;
  entries: RosterEntry[];
  /** 부대 이름. 이력의 `theirSquad`가 이 값이다 */
  squadName: string | null;
  /** 전투력 — 화면이 「예상 승률」을 그리는 데 쓴다 */
  power: number;
  /** 저장된 배치 프리셋. **어긋나면 서버가 조용히 안 깐다**(§5-45) */
  deploy: { unit: UnitId; pos: Vec2 }[] | null;
}

/** 방이 열렸다 — 진영이 정해지고 첫 스냅샷이 왔다 */
export interface Opened {
  side: Side;
  /** 상대. `MatchOpponent`와 같은 모양이다 */
  opponent: { id: string; squadName: string | null; entries: RosterEntry[]; power: number };
  first: ServerMsg;
}

/**
 * 승/패 보상이 반영됐다 (H3d) — `BattleRoom`이 `server-api`에 직접 물어 받은 값을
 * 그 좌석에게만 돌려준다. **`null`이면 반영에 실패했다**(server-api가 안 닿았거나
 * 계정을 못 찾음) — 그때 화면은 예전 방식(로컬 계산 + `PUT`)으로 물러난다.
 */
export interface Settled {
  rewards: BattleRewards | null;
}

export type ClientMessage =
  | { t: 'enlist'; enlist: Enlist }
  | { t: 'intent'; intent: Intent };

// ═══════════════════════════════════════════════════════════════
// 대기열 (H2b)
// ═══════════════════════════════════════════════════════════════

/** 대기열에 들어가며 내미는 것 */
export interface QueueSearch {
  mode: BattleMode;
  /** 매칭이 인접 전투력을 고르는 눈금 — 온라인·AI가 같은 눈금을 본다(§7.1) */
  power: number;
  enlist: Enlist;
}

/** 상대를 찾았다 — 아직 방은 안 열렸다. 둘 다 `confirm`을 보내야 열린다 */
export interface QueueMatched {
  matchId: string;
  /** 상대. `MatchOpponent`와 같은 모양이다 */
  opponent: { id: string; squadName: string | null; entries: RosterEntry[]; power: number };
}

/**
 * 좌석 예약 — `matchMaker.reserveSeatFor()`가 낸 값 그대로다. 클라는
 * `Client.consumeSeatReservation()`에 그대로 넘겨 대전 방에 붙는다.
 */
export type Reservation = matchMaker.SeatReservation;

export type QueueClientMessage =
  | { t: 'search'; search: QueueSearch }
  | { t: 'confirm'; matchId: string }
  | { t: 'decline'; matchId: string };
