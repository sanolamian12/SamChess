/**
 * 공성전 — 도시 목록 · 상대 정하기 · 방어 기록 (2026-10-27, GDD §8.8 단계 2. 규칙은 `@samchess/meta`의 `siege.ts` · `aiBattle.ts`).
 *
 *  · 도시 목록(`GET /siege/targets`) — `defenses` 표에서 그 모드의 수비군을 내 도시 레벨 이상으로 넉넉히 읽고,
 *    meta의 `pickSiegeRows()`로 탭에 맞게 고르고 세운다. 정지된 계정 · 내 도시는 뺀다.
 *  · 상대 정하기(`POST /siege/match`) — **표에서 그 순간의 수비군을 다시 읽어** `matchSiege()`로 판의 상대로 굳힌다.
 *    클라이언트가 보낸 것은 「누구를」뿐이다(명단 · 전투력 · 배치는 자칭할 수 없다). 그 뒤 시작 · 덧붙이기 · 정산은
 *    AI 대전의 길(`/battle/ai-start` · `/battle/ai-intents` · `/battle/ai-result`) 그대로다.
 *  · 접속 표시(2026-10-28, 단계 3) — 목록은 `presence`를 left join해 줄마다 `online`을 싣고(판정은 서버 시계 + meta의 `isPresent`),
 *    상대 정하기는 **그 순간** 접속 중인 도시를 거절한다(`siege.online`) — 화면이 낡은 목록을 들고 있을 수 있다.
 *  · 방어 기록(`defense_log`) — 판이 끝날 때 한 줄 덧붙인다. 방어자의 계정 행은 안 잡는다. 남기는 자리는 둘이다 —
 *    끝까지 둔 판은 정산(`settleAiAction`)이, 60분 방치 · 관리자 정리는 계정을 쓰는 트랜잭션(`profileStore.ts`의 `transact`)이.
 *    둘 다 **계정을 쓰는 같은 트랜잭션** 안이라 「정산은 됐는데 기록이 없다」가 생기지 않는다.
 */
import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { aiOpponentOf, battlePower, cityScore, garrisonSnapshot, isPresent, matchSiege, migrateProfile, pickSiegeRows } from '@samchess/meta';
import type { AiBattleState, BattleResult, MatchOpponent, PlayerProfile, RosterPick, SiegeListRow, SiegeTab, SiegeTarget } from '@samchess/meta';
import { REPLAY_VERSION, baseTactic, defaultSkillRules, defaultStances, defaultTacticRules } from '@samchess/rules';
import type { BattleMode, DefensePolicy, Intent, RosterEntry, UnitId, Vec2 } from '@samchess/rules';
import { pool } from './db.ts';
import { getProfile, mutateProfile } from './profileStore.ts';
import type { AiAction } from './aiBattle.ts';
import { isOnlineNow } from './presence.ts';

/** 표에서 한 번에 읽는 줄 — 탭으로 고르기 전의 넉넉한 몫(내보내는 것은 `SIEGE_LIST_LIMIT`) */
const SCAN = 200;

interface DefenseJoinRow {
  uid: string;
  mode: BattleMode;
  squad_name: string;
  power: number;
  city_level: number;
  snapshot: { entries: RosterEntry[]; deploy: { unit: UnitId; pos: Vec2 }[] | null; policy?: unknown };
  data: unknown;
  last_seen_at: Date | null;
  busy: boolean | null;
}

const SELECT = `
  select d.uid, d.mode, d.squad_name, d.power, d.city_level, d.snapshot, p.data, s.last_seen_at, s.busy
    from defenses d
    join profiles p on p.uid = d.uid
    left join presence s on s.uid = d.uid
    left join auth.users u on u.id = d.uid
   where (u.banned_until is null or u.banned_until <= now())`;

/** 도시 목록 — 내 계정이 없으면 `null` */
export async function listSiegeTargets(uid: string, mode: BattleMode, tab: SiegeTab): Promise<SiegeListRow[] | null> {
  const me = await getProfile(uid);
  if (!me) return null;
  const mine = Math.floor(me.cityLevel);
  const r = await pool.query<DefenseJoinRow>(
    `${SELECT} and d.mode = $1 and d.uid <> $2 and ${tab === 'recommended' ? 'd.city_level = $3' : 'd.city_level > $3'}
      order by d.city_level asc, d.power desc limit ${SCAN}`,
    [mode, uid, mine],
  );
  const rows: SiegeListRow[] = [];
  const now = Date.now();
  for (const row of r.rows) {
    const profile = migrateProfile(row.data);
    if (!profile) continue;
    rows.push({
      defenderId: row.uid, cityName: profile.cityName, cityLevel: row.city_level, mode: row.mode,
      squadName: row.squad_name, power: row.power, entries: row.snapshot.entries, score: cityScore(profile),
      online: isPresent(row.last_seen_at ? row.last_seen_at.getTime() : null, now),
      busy: isPresent(row.last_seen_at ? row.last_seen_at.getTime() : null, now) && Boolean(row.busy),
    });
  }
  return pickSiegeRows(rows, tab, mine);
}

/** 표에 실린 방침이 단계 6의 모양인가 — 그 전의 줄은 문자열 'default'다 */
const isPolicy = (v: unknown): v is DefensePolicy =>
  !!v && typeof v === 'object' && Array.isArray((v as DefensePolicy).tactics) && Array.isArray((v as DefensePolicy).skills);

/** 계정에서도 못 낼 때(수비군이 방금 사라졌다)의 기본 — 명단에서 바로 낸다 */
const defaultPolicyOf = (entries: readonly RosterEntry[]): DefensePolicy => ({
  stances: defaultStances(entries.map((e) => e.piece)),
  tactics: defaultTacticRules(new Set(entries.flatMap((e) => e.tactics.map(baseTactic)))),
  skills: defaultSkillRules(entries.map((e) => e.officer)),
});

/** 그 순간의 수비군 — 없거나(부대를 지웠다) 정지된 계정이면 `null` */
async function readTarget(defenderId: string, mode: BattleMode): Promise<SiegeTarget | null> {
  const r = await pool.query<DefenseJoinRow>(`${SELECT} and d.uid = $1 and d.mode = $2`, [defenderId, mode]);
  const row = r.rows[0];
  const profile = row ? migrateProfile(row.data) : null;
  if (!row || !profile) return null;
  const entries = row.snapshot.entries;
  return {
    uid: row.uid, cityName: profile.cityName, cityLevel: row.city_level, squadName: row.squad_name,
    deploy: row.snapshot.deploy ?? null, mode: row.mode, entries,
    // 수비군 방침(단계 6) — 표의 값. 단계 6 전에 쓰인 줄('default')은 계정에서 지금 낸다(그 계정이 아직 안 써졌다)
    policy: isPolicy(row.snapshot.policy) ? row.snapshot.policy : garrisonSnapshot(profile, mode)?.policy ?? defaultPolicyOf(entries),
    // 표의 값을 믿지 않고 다시 잰다 — 같은 함수(`garrisonSnapshot`이 쓴 `battlePower`)라 보통은 같다
    power: battlePower(mode, entries),
  };
}

type SiegeMatch = AiAction<{ seed: number; opponent: MatchOpponent; defender: AiBattleState['defender'] }>;

/** 상대를 정한다 — 시드는 서버가 뽑는다. 군량은 안 낸다(AI 대전의 「상대 찾기」와 같다) */
export async function matchSiegeAction(
  uid: string, defenderId: string, mode: BattleMode, picks: readonly RosterPick[], squadId: string | null,
): Promise<SiegeMatch> {
  if (defenderId === uid) return { ok: false, status: 400, reason: '내 도시는 칠 수 없다', code: 'siege.self' };
  const target = await readTarget(defenderId, mode);
  if (!target) return { ok: false, status: 404, reason: '그 도시의 수비군이 없다', code: 'siege.noTarget' };
  // 접속 중인 도시는 공성전이 아니라 선전포고(단계 4)의 상대다 — 목록이 낡았을 수 있어 그 순간을 다시 본다
  if (await isOnlineNow(defenderId)) return { ok: false, status: 409, reason: '그 도시는 지금 접속 중이다', code: 'siege.online' };
  const seed = randomInt(0, 2 ** 31);
  return mutateProfile<SiegeMatch>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    const r = matchSiege(profile, target, picks, squadId, seed);
    if (!r.ok) return { next: null, value: { ok: false, status: r.code === 'ai.badPicks' ? 400 : 409, reason: r.reason, code: r.code } };
    return { next: r.profile, value: { ok: true, seed: r.ai.seed, opponent: aiOpponentOf(r.ai), defender: r.ai.defender } };
  });
}

/**
 * 방어 기록 한 줄을 덧붙인다 — 공성전이 아니면(`defender`가 없다) 아무것도 안 한다.
 * `result`는 **공격한 쪽**의 결말이다(엔진의 P1).
 */
export async function logDefense(
  tx: PoolClient, attackerUid: string, attacker: PlayerProfile, ai: AiBattleState,
  result: BattleResult, intents: readonly Intent[], reason: 'settled' | 'abandoned',
): Promise<void> {
  const d = ai.defender;
  if (!d) return;
  const winner = result === 'win' ? 'P1' : result === 'lose' ? 'P2' : null;
  const replay = {
    entries: { P1: ai.entries ?? [], P2: ai.foe.entries },
    deploy: { P1: ai.deploy ?? null, P2: d.deploy },
    intents,
    // 수성전(단계 6) — 판 종류와 방침을 함께 남긴다. 없는 옛 줄은 야전 판 · 기본 AI로 다시 둔다
    ...(d.policy ? { scenario: 'siege' as const, policy: d.policy } : {}),
  };
  await tx.query(
    `insert into defense_log (defender_id, attacker_id, attacker_city, mode, seed, winner, reason,
       attacker_power, defender_power, defender_squad, replay, rules_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [d.uid, attackerUid, attacker.cityName, ai.mode, ai.seed, winner, reason,
      battlePower(ai.mode, ai.entries ?? []), ai.foe.power, d.squadName, JSON.stringify(replay),
      // 이 판을 낸 엔진 · 데이터 — 다시 볼 때 지금 값과 같아야 같은 판이 나온다(단계 5, 다르면 결과만)
      REPLAY_VERSION],
  );
}

/**
 * 계정을 쓰는 트랜잭션에서 부른다(`profileStore.ts`의 `transact`) — **방치로 끝난 공성전**을 찾아 기록한다.
 * 읽은 값(`before`)에서 싸우던 공성전이 쓸 값(`after`)에서 `abandoned`가 되었으면 그 판이다(60분 정산 · 관리자 정리 둘 다
 * `forfeitAiBattle`을 지나 그 모양이 된다). 끝까지 둔 판은 판이 지워지므로 여기 안 걸린다 — 정산이 따로 남긴다.
 */
export async function logAbandonedSiege(
  tx: PoolClient, uid: string, before: PlayerProfile | null, after: PlayerProfile,
): Promise<void> {
  const was = before?.aiBattle;
  const now = after.aiBattle;
  if (was?.status !== 'fighting' || !was.defender) return;
  if (now?.status !== 'abandoned' || now.seed !== was.seed) return;
  await logDefense(tx, uid, after, was, 'lose', was.intents ?? [], 'abandoned');
}
