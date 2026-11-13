/**
 * 관리자 「시스템」 (2026-11-13) — 서버 상태 · 트래픽 · 인프라 점검. 권한 `system`(관리자만). **읽기만 한다.**
 *
 * 숫자는 각 프로세스가 스스로 센다(`server-api/src/health.ts` · `server/src/health.ts`, 메모리에만) — 여기는 모아 보여 주기만 한다.
 * 게임 API · 대전 서버에는 `GET /internal/health`(서버 간 비밀)를 묻고, 관리자 API 자신은 제 것을 직접 읽는다. DB · Auth는 여기서
 * 한 번씩 두드려 왕복 시간을 잰다. **못 닿은 것은 그 줄만 붉다** — 하나가 죽었다고 화면 전체가 실패하지 않는다(「전투」와 같은 결).
 *
 * 알림은 여기서 하지 않는다 — 관리자 API는 늘 떠 있지 않고, 꺼진 서버는 제가 꺼졌다고 말하지 못한다. 배포 때 외부 감시가 맡는다.
 */
import { trafficRecent } from '@samchess/meta';
import type { ProcessHealth, ServiceId } from '@samchess/meta';
import { pool } from '../db.ts';
import { processHealth } from '../health.ts';
import { runInfraChecks } from '../infraCheck.ts';
import type { AdminSystemChecks, AdminSystemStatus, AdminSystemTraffic, SystemServiceRow } from './types.ts';

/** 대전 서버 — 클라이언트가 붙는 주소(`SAMCHESS_SERVER`, ws)와 같은 곳(`battles.ts`와 같다) */
const BATTLE_URL = (process.env['SAMCHESS_SERVER'] ?? 'ws://localhost:2567').replace(/^ws/, 'http').replace(/\/$/, '');
/** 게임 API — 대전 서버가 부르는 주소와 같은 값(`SERVER_API_URL`) */
const GAME_URL = (process.env['SERVER_API_URL'] ?? 'http://localhost:8787').replace(/\/$/, '');
const TIMEOUT_MS = 3000;
/** 상태 탭 · 대시보드 카드의 「최근」 */
const RECENT_MINUTES = 5;

type Probe = { ok: true; health: ProcessHealth; ms: number } | { ok: false; error: string; ms: number | null };

async function probe(base: string, label: string): Promise<Probe> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}/internal/health`, {
      headers: { 'x-internal-secret': process.env['INTERNAL_API_SECRET'] ?? '' }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      // 404면 서버는 살아 있는데 이 길을 모른다 — 대개 새 코드를 받고 다시 안 띄운 것이다(CLAUDE.md 「404는 못 닿았다가 아니다」)
      return { ok: false, ms, error: res.status === 404 ? `${label}가 이 길을 모른다(404) — 새 코드로 다시 띄웠는가` : `${label}가 ${res.status}로 답했다` };
    }
    return { ok: true, ms, health: (await res.json()) as ProcessHealth };
  } catch (e) {
    return { ok: false, ms: null, error: `${label}에 못 닿았다 (${e instanceof Error ? e.message : String(e)})` };
  }
}

async function probes(): Promise<Record<ServiceId, Probe>> {
  const [game, battle] = await Promise.all([probe(GAME_URL, '게임 API'), probe(BATTLE_URL, '대전 서버')]);
  return { 'game-api': game, battle, 'admin-api': { ok: true, ms: 0, health: processHealth('admin-api') } };
}

const SERVICES: ServiceId[] = ['game-api', 'battle', 'admin-api'];

function serviceRow(id: ServiceId, p: Probe): SystemServiceRow {
  if (!p.ok) return { id, ok: false, latencyMs: p.ms, error: p.error, process: null, database: null, auth: null };
  const { traffic, ...rest } = p.health;
  return {
    id, ok: true, latencyMs: id === 'admin-api' ? null : p.ms, error: null,
    process: { ...rest, recent: trafficRecent(traffic, RECENT_MINUTES) }, database: null, auth: null,
  };
}

async function dbRow(): Promise<SystemServiceRow> {
  const t0 = performance.now();
  try {
    const r = (await pool.query<{ version: string; connections: number; max: number }>(
      `select current_setting('server_version') as version,
              (select count(*)::int from pg_stat_activity) as connections,
              current_setting('max_connections')::int as max`)).rows[0]!;
    return {
      id: 'db', ok: true, latencyMs: Math.round(performance.now() - t0), error: null, process: null,
      database: { version: r.version, connections: r.connections, maxConnections: r.max }, auth: null,
    };
  } catch (e) {
    return { id: 'db', ok: false, latencyMs: null, error: `DB에 못 닿았다 (${e instanceof Error ? e.message : String(e)})`, process: null, database: null, auth: null };
  }
}

async function authRow(): Promise<SystemServiceRow> {
  const t0 = performance.now();
  const base = { id: 'auth' as const, process: null, database: null };
  try {
    const res = await fetch(`${process.env['SUPABASE_URL']}/auth/v1/health`, {
      headers: { apikey: process.env['SUPABASE_ANON_KEY'] ?? '' }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { ...base, ok: false, latencyMs: ms, error: `Auth가 ${res.status}로 답했다`, auth: null };
    const j = (await res.json()) as { version?: string };
    return { ...base, ok: true, latencyMs: ms, error: null, auth: { version: j.version ?? '?' } };
  } catch (e) {
    return { ...base, ok: false, latencyMs: null, error: `Auth에 못 닿았다 (${e instanceof Error ? e.message : String(e)})`, auth: null };
  }
}

export async function readSystemStatus(): Promise<AdminSystemStatus> {
  const [p, db, auth] = await Promise.all([probes(), dbRow(), authRow()]);
  return { at: new Date().toISOString(), services: [...SERVICES.map((id) => serviceRow(id, p[id])), db, auth] };
}

export async function readSystemTraffic(): Promise<AdminSystemTraffic> {
  const p = await probes();
  return {
    at: new Date().toISOString(),
    services: SERVICES.map((id) => {
      const x = p[id];
      return x.ok
        ? { id, ok: true, error: null, startedAt: x.health.startedAt, window: x.health.traffic }
        : { id, ok: false, error: x.error, startedAt: null, window: null };
    }),
  };
}

export async function readSystemChecks(): Promise<AdminSystemChecks> {
  const t0 = performance.now();
  const checks = await runInfraChecks(process.env, pool);
  return { at: new Date().toISOString(), durationMs: Math.round(performance.now() - t0), checks };
}
