/**
 * 끊긴 온라인 대전에 다시 붙는 표 (2026-10-15).
 *
 * 서버(`BattleRoom`)는 끊긴 쪽을 `RECONNECT_GRACE_MS`(60초) 동안 기다리고 판도 서버가 들고 있다 — 다시 붙는 데
 * 필요한 것은 **Colyseus의 재접속 열쇠** 하나다. 다만 전투 화면을 다시 세우려면 상대 · 부대 · 모드 · 시드가 함께
 * 있어야 한다(재접속은 판 스냅샷만 준다). 그래서 방에 붙는 순간 이것들을 기기에 적어 두고, 판이 끝나면 지운다.
 *
 * **판 상태는 안 적는다** — 정본은 서버다. 여기 있는 것은 「어느 방의 어느 자리였나」와 화면 재료뿐이라 고쳐도 얻는 것이
 * 없다(열쇠를 바꾸면 남의 자리에 못 앉고, 상대 · 부대를 바꾸면 화면 글자만 틀린다 — 정산은 서버가 방에서 한다).
 *
 * `aliveAt`은 「마지막으로 판이 살아 있던 때」 — 전투 화면이 몇 초마다 민다. 다시 들어왔을 때 이것이 유예보다 오래됐으면
 * 붙어 보지도 않는다(서버가 이미 자리를 접었다). 브라우저 저장소는 예외를 던질 수 있어 전부 감싼다.
 */

import type { BattleMode, Side } from '@samchess/rules';
import type { MatchOpponent, RosterPick, Squad } from '@samchess/meta';

const KEY = 'samchess.online.resume';

export interface OnlineResume {
  /** 이 표를 만든 계정 — 다른 계정으로 들어오면 안 쓴다 */
  uid: string;
  token: string;
  side: Side;
  mode: BattleMode;
  picks: RosterPick[];
  seed: number;
  squad: Squad | null;
  opponent: MatchOpponent;
  aliveAt: number;
}

export function saveOnlineResume(r: OnlineResume): void {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* 저장소가 막혔다 — 다시 붙기만 못 한다 */ }
}

export function readOnlineResume(): OnlineResume | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<OnlineResume>;
    if (typeof r.uid !== 'string' || typeof r.token !== 'string' || typeof r.aliveAt !== 'number' || !r.opponent) return null;
    return r as OnlineResume;
  } catch {
    return null;
  }
}

/** 판이 아직 살아 있다 — 전투 화면이 몇 초마다 부른다 */
export function touchOnlineResume(nowMs: number): void {
  const r = readOnlineResume();
  if (r) saveOnlineResume({ ...r, aliveAt: nowMs });
}

export function clearOnlineResume(): void {
  try { localStorage.removeItem(KEY); } catch { /* 없다 */ }
}
