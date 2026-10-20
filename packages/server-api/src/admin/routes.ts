/**
 * 관리자 API 라우트 — 전부 `/admin/*`이고 전부 `verifyAdmin()`을 지난다.
 *
 * 응답 모양은 `./types.ts` — 관리자 화면이 `import type`으로 읽는 계약이라 여기서도 그 모양에 맞춰 돌려준다.
 *
 * 쓰는 길은 `POST /admin/users/:uid/adjust` 하나이고 **사유가 없으면 받지 않는다** —
 * 감사 로그(`admin_audit_log`)에 남길 「왜」가 비면 나중에 아무도 그 조정을 설명하지 못한다.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ACADEMY_TOPICS, BUILDINGS, CITY_LEVELS, COLLECTIONS, ECONOMY, EQUIPMENT, MARKET_ITEMS, OFFICERS,
  TACTIC_UPGRADES, TACTICS, UNIQUE_SKILLS,
} from '@samchess/data';
import { applyAdjustment, parseAdjustment } from '@samchess/meta';
import { verifyAdmin } from './auth.ts';
import type { AdjustResponse, AdminGameData, AdminUser, AuditRow, BanResponse, UserRow } from './types.ts';
import { BAN_DAYS_MAX, listAudit, mutateWithAudit, readStats, readUser, searchUsers, setBan } from './store.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 500;

/** 관리자가 아니면 응답을 보내고 `null` — 라우트는 `if (!admin) return;` 한 줄로 멈춘다 */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AdminUser | null> {
  const r = await verifyAdmin(req.headers.authorization);
  if (r === 'unauthorized') { void reply.code(401).send({ error: 'unauthorized' }); return null; }
  if (r === 'forbidden') { void reply.code(403).send({ error: 'forbidden' }); return null; }
  return r;
}

/** 사유 — 감사 로그의 「왜」. 틀리면 사람 말 */
function parseReason(body: Record<string, unknown> | undefined): string | { error: string } {
  const reason = typeof body?.['reason'] === 'string' ? body['reason'].trim() : '';
  if (!reason) return { error: '사유(reason)가 필요하다' };
  if (reason.length > REASON_MAX) return { error: `사유는 ${REASON_MAX}자까지` };
  return reason;
}

const clampInt = (v: string | undefined, def: number, max: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
};

export function registerAdminRoutes(app: FastifyInstance): void {
  /** 화면이 로그인 직후 「이 계정이 관리자인가」를 묻는다 */
  app.get('/admin/me', async (req, reply): Promise<AdminUser | undefined> => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    return admin;
  });

  app.get('/admin/stats', async (req, reply) => {
    if (!await requireAdmin(req, reply)) return;
    return readStats();
  });

  /** `?q=` 이메일 · 도시 이름 일부 · uid. `?test=1`이면 시험 계정(@samchess.test)도 */
  app.get('/admin/users', async (req, reply) => {
    if (!await requireAdmin(req, reply)) return;
    const query = req.query as Record<string, string | undefined>;
    const rows: UserRow[] = await searchUsers(query['q'] ?? '', clampInt(query['limit'], 50, 200), query['test'] === '1');
    return { rows };
  });

  app.get('/admin/users/:uid', async (req, reply) => {
    if (!await requireAdmin(req, reply)) return;
    const { uid } = req.params as { uid: string };
    if (!UUID.test(uid)) return reply.code(400).send({ error: 'invalid uid' });
    const user = await readUser(uid);
    if (!user) return reply.code(404).send({ error: 'not found' });
    return user;
  });

  /**
   * 지급 · 회수. 본문은 `@samchess/meta`(`meta/src/admin.ts`)의 `Adjustment` + `reason`.
   * 규칙이 거부하면 그 말을 400으로 그대로 돌린다(서버가 이유를 다시 짓지 않는다).
   */
  app.post('/admin/users/:uid/adjust', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const { uid } = req.params as { uid: string };
    if (!UUID.test(uid)) return reply.code(400).send({ error: 'invalid uid' });

    const body = req.body as Record<string, unknown> | undefined;
    const reason = parseReason(body);
    if (typeof reason !== 'string') return reply.code(400).send(reason);

    const adj = parseAdjustment(body);
    if (typeof adj === 'string') return reply.code(400).send({ error: adj });

    const r = await mutateWithAudit(uid, admin, { action: `adjust.${adj.kind}`, params: adj, reason },
      (profile, now) => applyAdjustment(profile, adj, now));
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return { profile: r.profile, auditId: r.auditId } satisfies AdjustResponse;
  });

  /**
   * 계정 정지 · 해제 — 게임 API는 403 `account_banned`(+ 기간 · 사유), 대전 서버는 대기열 · 방에 못 들이고,
   * 정지 전에 시작된 판의 보상은 정산이 거절한다(`../ban.ts` · `../battleResult.ts`). 사유는 필수.
   */
  app.post('/admin/users/:uid/ban', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const { uid } = req.params as { uid: string };
    if (!UUID.test(uid)) return reply.code(400).send({ error: 'invalid uid' });
    const body = req.body as Record<string, unknown> | undefined;
    const reason = parseReason(body);
    if (typeof reason !== 'string') return reply.code(400).send(reason);
    const days = body?.['days'];
    if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > BAN_DAYS_MAX) {
      return reply.code(400).send({ error: `days는 1~${BAN_DAYS_MAX}의 정수` });
    }
    const r = await setBan(uid, admin, days as number, reason);
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return { bannedUntil: r.bannedUntil, auditId: r.auditId } satisfies BanResponse;
  });

  app.post('/admin/users/:uid/unban', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const { uid } = req.params as { uid: string };
    if (!UUID.test(uid)) return reply.code(400).send({ error: 'invalid uid' });
    const reason = parseReason(req.body as Record<string, unknown> | undefined);
    if (typeof reason !== 'string') return reply.code(400).send(reason);
    const r = await setBan(uid, admin, null, reason);
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return { bannedUntil: r.bannedUntil, auditId: r.auditId } satisfies BanResponse;
  });

  /** `?target=uid`면 그 계정 것만. `?before=id`로 다음 쪽 */
  app.get('/admin/audit', async (req, reply) => {
    if (!await requireAdmin(req, reply)) return;
    const query = req.query as Record<string, string | undefined>;
    const target = query['target'];
    if (target !== undefined && !UUID.test(target)) return reply.code(400).send({ error: 'invalid target' });
    const before = query['before'] !== undefined ? Number(query['before']) : undefined;
    if (before !== undefined && !Number.isInteger(before)) return reply.code(400).send({ error: 'invalid before' });
    const rows: AuditRow[] = await listAudit({
      ...(target ? { targetUid: target } : {}), limit: clampInt(query['limit'], 50, 200), ...(before ? { beforeId: before } : {}),
    });
    return { rows };
  });

  /**
   * 게임 데이터 — 화면이 id를 이름으로 풀고 운영 데이터 화면을 그리는 데 쓴다. **읽기 전용이다**
   * (정본은 엑셀 → `npm run extract`). 관리자 화면은 별도 저장소라 `@samchess/data`를 직접 못 들인다.
   */
  app.get('/admin/gamedata', async (req, reply) => {
    if (!await requireAdmin(req, reply)) return;
    const data: AdminGameData = {
      officers: OFFICERS, uniqueSkills: UNIQUE_SKILLS, tactics: TACTICS, tacticUpgrades: TACTIC_UPGRADES,
      academyTopics: Object.fromEntries(ACADEMY_TOPICS), equipment: EQUIPMENT, marketItems: MARKET_ITEMS,
      collections: COLLECTIONS, buildings: BUILDINGS, cityLevels: CITY_LEVELS, economy: ECONOMY,
    };
    return data;
  });
}
