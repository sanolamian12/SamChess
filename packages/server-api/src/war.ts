/**
 * 선전포고 (2026-10-28, GDD §8.8 단계 4. 걸음 · 만료 · 걸 수 있는가는 `@samchess/meta`의 `war.ts`).
 *
 *  · 걸기(`POST /war/declare`) — 상대 · 모드 · 내 부대 id만 받는다. 서버가 그 순간의 접속 · 전투 중 · 쿨다운 · 출전 조건을 보고
 *    **두 사람을 잠근 채**(`pg_advisory_xact_lock`) 한 줄을 넣는다 — 둘이 동시에 같은 도시에 걸어도 하나만 선다.
 *  · 전하기 — 받는 쪽의 접속 핑(`POST /presence`)이 열린 선전포고를 싣고, 전투 중이 아니면 그 순간을 `delivered_at`으로 적는다.
 *    응답 30초는 거기서부터다(기획자 확정). 걸려 있는 동안 두 화면은 5초마다 `GET /war/:id`로 묻는다.
 *  · 응전 · 거절(`/war/:id/reply`) · 수락 · 취소(`/war/:id/accept`) — 걸음이 맞을 때만, 그 순간의 시각으로 만료를 대 본 뒤에.
 *  · 방 열기(`POST /internal/war/:id/open`) — 대전 서버(`BattleRoom`)가 방을 만들며 부른다. **두 명단 · 배치를 여기서 낸다** —
 *    방이 열리는 시각으로(부상 · 태학 개량 · 컬렉션), 서버의 계정에서. 클라이언트가 보낸 편성은 이 방에서 안 쓴다.
 *
 * 만료는 적지 않는다 — 읽을 때 `warStatusAt`이 낸다. 시각은 이 프로세스의 시계 하나로 적고 읽는다(DB의 `now()`와 섞지 않는다).
 */
import type { PoolClient } from 'pg';
import {
  declareGate, isPresent, isWarOpen, isWarRefused, migrateProfile, viewWar, warEndedAt, warEnlist, warReadyGate,
  warSquadView, warStatusAt,
} from '@samchess/meta';
import type { PlayerProfile, WarCity, WarRecord, WarSquadView, WarStatus, WarView } from '@samchess/meta';
import type { BattleMode, RosterEntry, UnitId, Vec2 } from '@samchess/rules';
import { withCheckout } from './checkout.ts';
import { pool } from './db.ts';
import { getProfile } from './profileStore.ts';

export type WarAction<T> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 404 | 409; reason: string; code?: string; params?: Record<string, number> };

interface WarRow {
  id: string;
  attacker: string;
  defender: string;
  mode: BattleMode;
  status: WarStatus;
  data: { attacker: WarCity; defender: WarCity; attackerSquad: WarSquadView; defenderSquad: WarSquadView | null };
  created_at: Date;
  delivered_at: Date | null;
  replied_at: Date | null;
  accepted_at: Date | null;
  ended_at: Date | null;
}

const ms = (d: Date | null): number | null => (d ? d.getTime() : null);

const toRecord = (r: WarRow): WarRecord => ({
  id: r.id, mode: r.mode, status: r.status,
  attacker: r.data.attacker, defender: r.data.defender, attackerSquad: r.data.attackerSquad, defenderSquad: r.data.defenderSquad,
  createdAt: r.created_at.getTime(), deliveredAt: ms(r.delivered_at), repliedAt: ms(r.replied_at),
  acceptedAt: ms(r.accepted_at), endedAt: ms(r.ended_at),
});

const fail = (status: 400 | 404 | 409, code: string, reason: string, params?: Record<string, number>) =>
  ({ ok: false as const, status, code, reason, ...(params ? { params } : {}) });

/** 한 트랜잭션 — 잠근 두 사람의 열린 선전포고를 보고 쓰는 동안 남이 끼지 못한다 */
async function inTx<T>(uids: readonly string[], fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  return withCheckout(() => pool.connect(), '선전포고 트랜잭션', async (tx) => {
    await tx.query('begin');
    try {
      for (const u of [...new Set(uids)].sort()) await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`war:${u}`]);
      const out = await fn(tx);
      await tx.query('commit');
      return out;
    } catch (e) {
      await tx.query('rollback').catch(() => {});
      throw e;
    }
  });
}

/** 그 사람이 걸었거나 받은, 아직 열린 선전포고 — 한 사람에 하나뿐이다 */
async function openWarOf(q: PoolClient | typeof pool, uid: string, nowMs: number): Promise<WarRecord | null> {
  const r = await q.query<WarRow>(
    `select * from wars where (attacker = $1 or defender = $1) and status in ('sent', 'delivered', 'replied', 'accepted')
      order by created_at desc limit 5`, [uid]);
  return r.rows.map(toRecord).find((w) => isWarOpen(warStatusAt(w, nowMs))) ?? null;
}

async function warById(q: PoolClient | typeof pool, id: string): Promise<WarRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await q.query<WarRow>('select * from wars where id = $1', [id]);
  return r.rows[0] ? toRecord(r.rows[0]) : null;
}

/** 걸음을 옮겨 적는다 — 시각 칸은 이름으로 고른다 */
async function writeStatus(
  tx: PoolClient, id: string, status: WarStatus, at: 'delivered_at' | 'replied_at' | 'accepted_at' | 'ended_at', nowMs: number,
  data?: WarRow['data'],
): Promise<void> {
  await tx.query(
    `update wars set status = $2, ${at} = $3${data ? ', data = $4' : ''} where id = $1`,
    data ? [id, status, new Date(nowMs), JSON.stringify(data)] : [id, status, new Date(nowMs)],
  );
}

/** 남의 계정은 되쓰지 않고 읽기만 한다(도시 목록과 같은 결) */
async function peekProfile(q: PoolClient | typeof pool, uid: string): Promise<PlayerProfile | null> {
  const r = await q.query<{ data: unknown }>('select data from profiles where uid = $1', [uid]);
  return r.rows[0] ? migrateProfile(r.rows[0].data) : null;
}

async function presenceOf(q: PoolClient | typeof pool, uid: string, nowMs: number): Promise<{ online: boolean; busy: boolean }> {
  const r = await q.query<{ last_seen_at: Date; busy: boolean }>('select last_seen_at, busy from presence where uid = $1', [uid]);
  const row = r.rows[0];
  const online = isPresent(row ? row.last_seen_at.getTime() : null, nowMs);
  return { online, busy: online && Boolean(row?.busy) };
}

const cityOf = (uid: string, p: PlayerProfile): WarCity => ({ uid, cityName: p.cityName, cityLevel: Math.floor(p.cityLevel) });

// ═══════════════════════════════════════════════════════════════

/**
 * 접속 핑 — 시각을 서버 시계로 적고, **열린 선전포고를 돌려준다.** 받는 쪽이고 전투 중이 아니면 이 순간이 「화면에 뜬 순간」이다.
 * 실패해도 게임은 돈다(핑이 빠진 것과 같다).
 */
export async function pingAction(uid: string, busy: boolean): Promise<WarView | null> {
  const nowMs = Date.now();
  try {
    await pool.query(
      `insert into presence (uid, last_seen_at, busy) values ($1, $2, $3)
         on conflict (uid) do update set last_seen_at = excluded.last_seen_at, busy = excluded.busy`,
      [uid, new Date(nowMs), busy],
    );
    const open = await openWarOf(pool, uid, nowMs);
    if (!open) return null;
    if (open.defender.uid === uid && warStatusAt(open, nowMs) === 'sent') {
      if (busy) return null;   // 전투 중에는 띄우지 않는다 — 끝나고 한도 안이면 그때 뜬다
      return inTx([open.attacker.uid, uid], async (tx) => {
        const again = await warById(tx, open.id);
        if (!again || warStatusAt(again, nowMs) !== 'sent') return again ? viewWar(again, uid, nowMs) : null;
        await writeStatus(tx, open.id, 'delivered', 'delivered_at', nowMs);
        return viewWar({ ...again, status: 'delivered', deliveredAt: nowMs }, uid, nowMs);
      });
    }
    return viewWar(open, uid, nowMs);
  } catch (e) {
    console.warn('접속 핑 처리 실패 — 게임은 그대로', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 선전포고를 건다 — 보내는 것은 「누구에게 · 어느 모드 · 내 어느 부대로」뿐이다 */
export async function declareWarAction(uid: string, defenderId: string, mode: BattleMode, squadId: string):
  Promise<WarAction<{ war: WarView }>> {
  if (defenderId === uid) return fail(400, 'siege.self', '내 도시에는 걸 수 없다');
  const nowMs = Date.now();
  const me = await getProfile(uid);   // 내 계정은 정산까지 거친 값(군량)
  if (!me) return fail(404, 'war.noProfile', 'no profile');
  return inTx([uid, defenderId], async (tx) => {
    const them = await peekProfile(tx, defenderId);
    if (!them) return fail(404, 'siege.noTarget', '그 도시가 없다');
    const presence = await presenceOf(tx, defenderId, nowMs);
    const last = await tx.query<WarRow>(
      'select * from wars where attacker = $1 and defender = $2 order by created_at desc limit 1', [uid, defenderId]);
    const lastRec = last.rows[0] ? toRecord(last.rows[0]) : null;
    const lastRefusedAt = lastRec && isWarRefused(warStatusAt(lastRec, nowMs)) ? warEndedAt(lastRec, nowMs) : null;
    const gate = declareGate({
      attacker: me, defenderCityLevel: Math.floor(them.cityLevel), mode,
      defenderOnline: presence.online, defenderBusy: presence.busy,
      attackerOpen: (await openWarOf(tx, uid, nowMs)) !== null,
      defenderOpen: (await openWarOf(tx, defenderId, nowMs)) !== null,
      lastRefusedAt, nowMs,
    });
    if (!gate.ok) return fail(409, gate.code ?? 'war.rejected', gate.reason, gate.params);
    const squad = warSquadView(me, squadId, mode);
    if (!squad) return fail(400, 'war.badSquad', '그 모드의 부대가 아니거나 성립하지 않는다');
    const data: WarRow['data'] = { attacker: cityOf(uid, me), defender: cityOf(defenderId, them), attackerSquad: squad, defenderSquad: null };
    const r = await tx.query<WarRow>(
      `insert into wars (attacker, defender, mode, status, data, created_at) values ($1, $2, $3, 'sent', $4, $5) returning *`,
      [uid, defenderId, mode, JSON.stringify(data), new Date(nowMs)]);
    return { ok: true as const, war: viewWar(toRecord(r.rows[0]!), uid, nowMs) };
  });
}

/** 한 장 — 건 사람 · 받은 사람만 본다 */
export async function getWarAction(uid: string, id: string): Promise<WarAction<{ war: WarView }>> {
  const w = await warById(pool, id);
  if (!w || (w.attacker.uid !== uid && w.defender.uid !== uid)) return fail(404, 'war.notFound', '그 선전포고가 없다');
  return { ok: true, war: viewWar(w, uid, Date.now()) };
}

/** 받은 쪽 — 그 모드의 제 부대로 [응전](`squadId`), 또는 [거절](`null`) */
export async function replyWarAction(uid: string, id: string, squadId: string | null): Promise<WarAction<{ war: WarView }>> {
  const nowMs = Date.now();
  const me = squadId ? await getProfile(uid) : null;
  const w0 = await warById(pool, id);
  if (!w0 || w0.defender.uid !== uid) return fail(404, 'war.notFound', '그 선전포고가 없다');
  return inTx([w0.attacker.uid, uid], async (tx) => {
    const w = (await warById(tx, id))!;
    if (warStatusAt(w, nowMs) !== 'delivered') return fail(409, 'war.stale', '이미 끝났거나 회신한 선전포고다');
    if (!squadId) {
      await writeStatus(tx, id, 'declined', 'ended_at', nowMs);
      return { ok: true as const, war: viewWar({ ...w, status: 'declined', endedAt: nowMs }, uid, nowMs) };
    }
    if (!me) return fail(404, 'war.noProfile', 'no profile');
    const ready = warReadyGate(me, w.mode);
    if (!ready.ok) return fail(409, ready.code ?? 'war.rejected', ready.reason, ready.params);
    const squad = warSquadView(me, squadId, w.mode);
    if (!squad) return fail(400, 'war.badSquad', '그 모드의 부대가 아니거나 성립하지 않는다');
    const data: WarRow['data'] = { attacker: w.attacker, defender: w.defender, attackerSquad: w.attackerSquad, defenderSquad: squad };
    await writeStatus(tx, id, 'replied', 'replied_at', nowMs, data);
    return { ok: true as const, war: viewWar({ ...w, status: 'replied', repliedAt: nowMs, defenderSquad: squad }, uid, nowMs) };
  });
}

/** 건 쪽 — 회신을 보고 [수락](`true`), 또는 언제든 [취소](`false`, 걸어 둔 채 기다리던 중에도) */
export async function acceptWarAction(uid: string, id: string, accept: boolean): Promise<WarAction<{ war: WarView }>> {
  const nowMs = Date.now();
  const me = accept ? await getProfile(uid) : null;
  const w0 = await warById(pool, id);
  if (!w0 || w0.attacker.uid !== uid) return fail(404, 'war.notFound', '그 선전포고가 없다');
  return inTx([uid, w0.defender.uid], async (tx) => {
    const w = (await warById(tx, id))!;
    const status = warStatusAt(w, nowMs);
    if (!accept) {
      if (!isWarOpen(status) || status === 'accepted') return fail(409, 'war.stale', '이미 끝났거나 수락한 선전포고다');
      await writeStatus(tx, id, 'cancelled', 'ended_at', nowMs);
      return { ok: true as const, war: viewWar({ ...w, status: 'cancelled', endedAt: nowMs }, uid, nowMs) };
    }
    if (status !== 'replied') return fail(409, 'war.stale', '수락할 회신이 없다');
    if (!me) return fail(404, 'war.noProfile', 'no profile');
    const ready = warReadyGate(me, w.mode);
    if (!ready.ok) return fail(409, ready.code ?? 'war.rejected', ready.reason, ready.params);
    await writeStatus(tx, id, 'accepted', 'accepted_at', nowMs);
    return { ok: true as const, war: viewWar({ ...w, status: 'accepted', acceptedAt: nowMs }, uid, nowMs) };
  });
}

/** 대전 방이 받는 것 — `packages/server`의 `Enlist`와 같은 모양(서로 import하지 않으므로 여기 다시 적는다) */
export interface WarEnlist {
  playerId: string;
  entries: RosterEntry[];
  squadName: string | null;
  power: number;
  deploy: { unit: UnitId; pos: Vec2 }[] | null;
}

/**
 * 방을 연다 — **내부 전용.** 수락된 선전포고를 `started`로 옮기고 두 명단을 낸다. 건 쪽이 남군(P1), 받은 쪽이 북군(P2).
 * 부대가 그새 성립하지 않으면 끝낸다(`expired`) — 방을 안 연다.
 */
export async function openWarRoomAction(id: string): Promise<WarAction<{ mode: BattleMode; P1: WarEnlist; P2: WarEnlist }>> {
  const nowMs = Date.now();
  const w0 = await warById(pool, id);
  if (!w0) return fail(404, 'war.notFound', '그 선전포고가 없다');
  const [a, d] = await Promise.all([getProfile(w0.attacker.uid), getProfile(w0.defender.uid)]);
  return inTx([w0.attacker.uid, w0.defender.uid], async (tx) => {
    const w = (await warById(tx, id))!;
    if (warStatusAt(w, nowMs) !== 'accepted' || !w.defenderSquad) return fail(409, 'war.stale', '열 수 있는 선전포고가 아니다');
    const p1 = a && warEnlist(a, w.attackerSquad.squadId, w.mode, 'P1', nowMs);
    const p2 = d && warEnlist(d, w.defenderSquad.squadId, w.mode, 'P2', nowMs);
    if (!p1 || !p2) {
      await writeStatus(tx, id, 'expired', 'ended_at', nowMs);
      return fail(409, 'war.badSquad', '부대가 그새 성립하지 않는다');
    }
    await writeStatus(tx, id, 'started', 'ended_at', nowMs);
    return { ok: true as const, mode: w.mode, P1: { playerId: w.attacker.uid, ...p1 }, P2: { playerId: w.defender.uid, ...p2 } };
  });
}
