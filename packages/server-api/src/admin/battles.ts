/**
 * 관리자 「전투」 — **지금 벌어지고 있는 판**을 계정과 상관없이 모아 본다 (2026-11-13). 읽기만 한다.
 *
 * 판이 사는 자리가 넷이라 넷을 따로 읽어 한 모양(`AdminLiveBattle`)으로 편다.
 *  · 사람 대 사람(대기열 · 선전포고) — 대전 서버(Colyseus)의 방. 그 프로세스의 `GET /internal/battles`를 서버 간 비밀로 묻는다
 *    (`packages/server/src/internalHttp.ts`). 못 닿아도 나머지 셋은 그대로 낸다 — 화면이 「대전 서버에 못 닿았다」를 띄운다.
 *  · AI 대전 · 공성전 — `profiles.data.aiBattle`이 `fighting`인 계정. 공성전은 `defender`가 있는 것.
 *  · 도적떼 — `profiles.data.raid`가 `fighting`인 계정.
 *  · 튜토리얼 — 서버에 판이 없다(클라이언트만 돈다). 접속 핑이 실어 오는 판 id(`presence.tutorial`)가 「접속 중」인 계정.
 *
 * **정산하지 않는다** — 게임의 읽기(`syncAtServer`)는 60분 넘게 방치된 판을 패배로 정산하는데, 그러면 그 판이 이 화면에서 사라져
 * 「방치된 판」을 못 본다. 되접기(`migrateProfile`)만 하고, 손대지 않으면 서버가 정산하는 시각은 `autoEndAt`으로 싣는다.
 */
import { aiAbandonAt, isPresent, migrateProfile, raidAutoSurrenderAt } from '@samchess/meta';
import type { LiveRoomSummary, PlayerProfile } from '@samchess/meta';
import { pool } from '../db.ts';
import { isTestEmail } from './store.ts';
import type { AdminBattlePlayer, AdminBattleSide, AdminBattlesResponse, AdminLiveBattle } from './types.ts';

/** 대전 서버의 HTTP 주소 — 클라이언트가 붙는 주소(`SAMCHESS_SERVER`, ws)와 같은 곳이다 */
const ROOMS_URL = `${(process.env['SAMCHESS_SERVER'] ?? 'ws://localhost:2567').replace(/^ws/, 'http').replace(/\/$/, '')}/internal/battles`;
/** 대전 서버가 늦으면 기다리지 않는다 — 나머지 셋은 DB에서 바로 나온다 */
const ROOMS_TIMEOUT_MS = 3000;

const iso = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString());

async function fetchRooms(): Promise<{ ok: true; rooms: LiveRoomSummary[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(ROOMS_URL, {
      headers: { 'x-internal-secret': process.env['INTERNAL_API_SECRET'] ?? '' },
      signal: AbortSignal.timeout(ROOMS_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `대전 서버가 ${res.status}로 답했다` };
    return { ok: true, rooms: ((await res.json()) as { rooms: LiveRoomSummary[] }).rooms };
  } catch (e) {
    return { ok: false, error: `대전 서버에 못 닿았다 (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** 계정 줄 — 이메일 · 도시 이름. 방에 선 uid가 지워진 계정이면 이름 없이 uid만 */
async function playersOf(uids: readonly string[]): Promise<Map<string, AdminBattlePlayer>> {
  const out = new Map<string, AdminBattlePlayer>();
  if (!uids.length) return out;
  const r = await pool.query<{ uid: string; email: string | null; city: string | null }>(
    `select u.id as uid, u.email, p.data->>'cityName' as city
       from auth.users u left join profiles p on p.uid = u.id where u.id = any($1::uuid[])`, [uids]);
  for (const row of r.rows) out.set(row.uid, { uid: row.uid, email: row.email, cityName: row.city, test: isTestEmail(row.email) });
  return out;
}

const playerOr = (map: Map<string, AdminBattlePlayer>, uid: string): AdminBattlePlayer =>
  map.get(uid) ?? { uid, email: null, cityName: null, test: false };

function roomRow(r: LiveRoomSummary, players: Map<string, AdminBattlePlayer>): AdminLiveBattle {
  const side = (s: 'P1' | 'P2'): AdminBattleSide => {
    const seat = r.seats[s];
    return {
      player: playerOr(players, seat.uid), squadName: seat.squadName, power: seat.power, officers: seat.officers,
      room: { connected: seat.connected, alive: seat.alive, total: seat.total },
    };
  };
  return {
    kind: 'field', via: r.war ? 'war' : 'queue', key: r.roomId, mode: r.mode, startedAt: iso(r.openedAt),
    attacker: side('P1'), defender: side('P2'), phase: r.phase, moves: null, autoEndAt: null,
  };
}

/** 계정 하나에 걸린 AI 대전 · 공성전 · 도적떼 — 싸우는 중인 것만 */
function profileRows(profile: PlayerProfile, me: AdminBattlePlayer, players: Map<string, AdminBattlePlayer>): AdminLiveBattle[] {
  const rows: AdminLiveBattle[] = [];
  const ai = profile.aiBattle;
  if (ai?.status === 'fighting') {
    const d = ai.defender;
    rows.push({
      kind: d ? 'siege' : 'field', via: d ? null : 'ai', key: `${d ? 'siege' : 'ai'}:${me.uid}`, mode: ai.mode,
      startedAt: iso(ai.startedAt),
      attacker: {
        player: me, squadName: profile.squads?.find((s) => s.id === ai.squadId)?.name ?? null, power: null,
        officers: ai.picks.map((p) => p.officer),
      },
      defender: {
        player: d ? playerOr(players, d.uid) : null, squadName: d?.squadName ?? null, power: ai.foe.power,
        officers: ai.foe.entries.map((e) => e.officer),
      },
      phase: null, moves: ai.intents?.length ?? 0, autoEndAt: iso(aiAbandonAt(profile)),
      ...(d ? { siegeFort: !!d.policy } : {}),
    });
  }
  const raid = profile.raid;
  if (raid?.status === 'fighting' && raid.battle) {
    rows.push({
      kind: 'raid', via: null, key: `raid:${me.uid}`, mode: null, startedAt: iso(raid.battle.startedAt),
      attacker: { player: me, squadName: null, power: null, officers: raid.battle.guards.map((g) => g.officer) },
      defender: { player: null, squadName: null, power: null, officers: [] },
      phase: null, moves: raid.battle.intents?.length ?? 0, autoEndAt: iso(raidAutoSurrenderAt(profile)), bandits: raid.bandits,
    });
  }
  return rows;
}

export async function listLiveBattles(nowMs = Date.now()): Promise<AdminBattlesResponse> {
  const roomsP = fetchRooms();
  const fighting = await pool.query<{ uid: string; email: string | null; data: unknown }>(
    `select p.uid, u.email, p.data from profiles p join auth.users u on u.id = p.uid
      where p.data->'aiBattle'->>'status' = 'fighting' or p.data->'raid'->>'status' = 'fighting'`);
  const tutorials = await pool.query<{ uid: string; email: string | null; city: string | null; tutorial: string; tutorial_at: Date | null; last_seen_at: Date }>(
    `select pr.uid, u.email, p.data->>'cityName' as city, pr.tutorial, pr.tutorial_at, pr.last_seen_at
       from presence pr join auth.users u on u.id = pr.uid left join profiles p on p.uid = pr.uid
      where pr.tutorial is not null`);
  const rooms = await roomsP;

  const profiles = fighting.rows.map((r) => ({ uid: r.uid, email: r.email, profile: migrateProfile(r.data) }));
  // 이름을 붙일 다른 계정 — 방의 두 자리 · 공성전의 수비군
  const others = new Set<string>();
  if (rooms.ok) for (const r of rooms.rooms) { others.add(r.seats.P1.uid); others.add(r.seats.P2.uid); }
  for (const p of profiles) if (p.profile?.aiBattle?.defender) others.add(p.profile.aiBattle.defender.uid);
  const players = await playersOf([...others].filter((u) => /^[0-9a-f-]{36}$/i.test(u)));

  const rows: AdminLiveBattle[] = [];
  if (rooms.ok) for (const r of rooms.rooms) rows.push(roomRow(r, players));
  for (const p of profiles) {
    if (!p.profile) continue;
    const me: AdminBattlePlayer = { uid: p.uid, email: p.email, cityName: p.profile.cityName ?? null, test: isTestEmail(p.email) };
    rows.push(...profileRows(p.profile, me, players));
  }
  for (const t of tutorials.rows) {
    // 핑이 끊긴 계정(창을 닫음)은 판을 떠난 것이다 — 비우는 핑이 못 왔을 뿐
    if (!isPresent(t.last_seen_at.getTime(), nowMs)) continue;
    rows.push({
      kind: 'tutorial', via: null, key: `tutorial:${t.uid}`, mode: null, startedAt: iso(t.tutorial_at?.getTime()),
      attacker: { player: { uid: t.uid, email: t.email, cityName: t.city, test: isTestEmail(t.email) }, squadName: null, power: null, officers: [] },
      defender: null, phase: null, moves: null, autoEndAt: null, tutorial: t.tutorial, lastSeen: t.last_seen_at.toISOString(),
    });
  }
  // 오래된 판이 위 — 방치를 먼저 본다
  rows.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
  return { at: new Date(nowMs).toISOString(), rows, rooms: rooms.ok ? { ok: true } : { ok: false, error: rooms.error } };
}
