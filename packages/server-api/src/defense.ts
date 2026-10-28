/**
 * 방어 기록 화면 (2026-10-28, GDD §8.8 단계 5. 읽는 규칙은 `@samchess/meta`의 `defense.ts`, 다시 볼 수 있는가는 `@samchess/rules`의 `replayable`).
 *
 *  · 목록(`GET /defense`) — 내가 막은 · 뚫린 판, 최신부터 `DEFENSE_LIST_LIMIT`판 + 합계(전부). 줄마다 `replayable`(규칙 버전) · `seen`.
 *  · 다시 보기(`GET /defense/:id/replay`) — 그 판의 시드 · 두 명단 · 두 배치 · 공격자의 수. **방어자 본인만**, 버전이 다르면 409.
 *  · 안 본 판(`GET /defense/unseen`) · 다 봤다(`POST /defense/seen`) — 들어올 때 팝업 · 대자보 표지. 시각은 서버 시계.
 *
 * 쓰는 것은 방어자의 줄의 `seen_at`뿐이다 — 기록을 남기는 자리(공격자의 계정을 쓰는 트랜잭션, `siege.ts`의 `logDefense`)와 겹치지 않는다.
 */
import { DEFENSE_LIST_LIMIT, defenseHeld, defenseResultOf } from '@samchess/meta';
import type { DefenseReplayData, DefenseRow, DefenseSummary, DefenseUnseen } from '@samchess/meta';
import { replayable } from '@samchess/rules';
import type { BattleMode } from '@samchess/rules';
import { pool } from './db.ts';

interface LogRow {
  id: string;
  attacker_city: string;
  mode: BattleMode;
  seed: string;
  winner: 'P1' | 'P2' | null;
  reason: 'settled' | 'abandoned';
  attacker_power: number;
  defender_power: number;
  defender_squad: string;
  moves: number;
  rules_version: string | null;
  seen_at: Date | null;
  at: Date;
}

/** 목록 + 합계 */
export async function listDefense(uid: string): Promise<{ rows: DefenseRow[]; summary: DefenseSummary }> {
  const r = await pool.query<LogRow>(
    `select id, attacker_city, mode, seed, winner, reason, attacker_power, defender_power, defender_squad,
            coalesce(jsonb_array_length(replay->'intents'), 0) as moves, rules_version, seen_at, at
       from defense_log where defender_id = $1 order by at desc limit ${DEFENSE_LIST_LIMIT}`, [uid]);
  const c = await pool.query<{ total: string; held: string }>(
    `select count(*) as total, count(*) filter (where winner = 'P2') as held from defense_log where defender_id = $1`, [uid]);
  const rows = r.rows.map((x): DefenseRow => ({
    id: Number(x.id), attackerCity: x.attacker_city, mode: x.mode, result: defenseResultOf(x.winner, x.reason),
    attackerPower: x.attacker_power, defenderPower: x.defender_power, defenderSquad: x.defender_squad,
    at: x.at.getTime(), moves: x.moves, replayable: replayable(x.rules_version), seen: x.seen_at !== null,
  }));
  return { rows, summary: { total: Number(c.rows[0]?.total ?? 0), held: Number(c.rows[0]?.held ?? 0) } };
}

/** 그 판을 다시 볼 재료 — 남의 판 · 없는 판은 `null`, 규칙이 바뀐 판은 `'stale'` */
export async function defenseReplay(uid: string, id: number): Promise<DefenseReplayData | null | 'stale'> {
  if (!Number.isSafeInteger(id)) return null;
  const r = await pool.query<{ seed: string; mode: BattleMode; winner: 'P1' | 'P2' | null; reason: 'settled' | 'abandoned'; replay: DefenseReplayData['replay']; rules_version: string | null }>(
    'select seed, mode, winner, reason, replay, rules_version from defense_log where id = $1 and defender_id = $2', [id, uid]);
  const x = r.rows[0];
  if (!x) return null;
  if (!replayable(x.rules_version)) return 'stale';
  return { id, seed: Number(x.seed), mode: x.mode, result: defenseResultOf(x.winner, x.reason), replay: x.replay };
}

/** 안 본 판 — 공격 수 · 그중 막은 수 */
export async function unseenDefense(uid: string): Promise<DefenseUnseen> {
  const r = await pool.query<{ winner: 'P1' | 'P2' | null; reason: 'settled' | 'abandoned' }>(
    'select winner, reason from defense_log where defender_id = $1 and seen_at is null', [uid]);
  return { attacks: r.rows.length, held: r.rows.filter((x) => defenseHeld(defenseResultOf(x.winner, x.reason))).length };
}

/** 목록을 열었다 — 지금까지의 판을 다 본 것으로 */
export async function markDefenseSeen(uid: string): Promise<void> {
  await pool.query('update defense_log set seen_at = now() where defender_id = $1 and seen_at is null', [uid]);
}
