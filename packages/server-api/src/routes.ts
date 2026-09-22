/**
 * 계정 API 라우트. `/profile`(사용자 인증) + `/internal/grain`(서버 간 공유 비밀, H3b).
 */
import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BattleMode, Intent, OfficerId } from '@samchess/rules';
import type {
  BattleOutcome, DrawReward, GachaPullKind, OpponentKind, RecycleInputs, RosterPick, StatPick,
} from '@samchess/meta';
import type { RankBoard } from '@samchess/meta';
import { officerById } from '@samchess/data';
import type { BuildingId } from '@samchess/data';
import { verifyToken } from './auth.ts';
import { verifyInternalSecret } from './internalAuth.ts';
import {
  CITY_NAME_TAKEN, CityNameTakenError, applyAcademyAction, applyAccountAction, applyCityAction, applyForgeAction, applyGrainAction,
  RaidBlockedError, deleteProfile, getProfile, pullGacha, saveProfile,
} from './profileStore.ts';
import { settleRaidAction, startRaidAction, surrenderRaidAction } from './raid.ts';
import type { RaidActionResult } from './raid.ts';
import type { GrainAction } from './profileStore.ts';
import { settleAiBattle } from './aiBattle.ts';
import type { AiBattleRequest } from './aiBattle.ts';
import { settleOutcome } from './battleResult.ts';
import { queryMyRanks, queryRanking } from './ranking.ts';

export function registerRoutes(app: FastifyInstance): void {
  app.get('/profile', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    // 로그인은 **출몰의 문**이다 — 날이 바뀐 뒤 첫 접속에 도적떼가 온다 (GDD §5.11)
    const profile = await getProfile(user.uid, { spawnRaid: true });
    if (!profile) return reply.code(404).send({ error: 'not found' });
    return profile;
  });

  /**
   * 있으면 덮어쓰고 없으면 만든다(upsert) — 로그인 뒤 "서버에 없으면 로컬 걸
   * 한 번 올린다"(가져오기)와 평소 저장이 **같은 엔드포인트**다. 둘을 가르면
   * 클라이언트가 "이번이 처음인가"를 스스로 판단해야 하는데, 서버가 upsert면
   * 그 판단이 필요 없다.
   *
   * **`grain`·`grainAt`은 여기서 안 믿는다** (H3d, `profileStore.saveProfile()` 참조) —
   * 시간 충전·전투 보상 둘 다 정본이 따로 있다.
   */
  app.put('/profile', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    // 첫 저장(도시 생성)에서 이름이 다른 계정과 겹치면 409 — 그 뒤로는 이름이 서버
    // 소유라(`guardServerOwned`) 여기서 겹칠 일이 없다. 바꾸는 길은 `/city/rename`이다
    let profile;
    try {
      profile = await saveProfile(user.uid, req.body);
    } catch (e) {
      if (e instanceof CityNameTakenError) return reply.code(409).send({ error: CITY_NAME_TAKEN });
      throw e;
    }
    if (!profile) return reply.code(400).send({ error: 'invalid profile' });
    return profile;
  });

  /**
   * 도시 행위 셋 — 증축 · 건설 · 치료 (2026-09-04).
   *
   * `PUT /profile`이 `materials`·`buildings`·`buildCredits`·`hospitalBusy`·부상을
   * 통째로 버리므로(H3d의 `grain`과 같은 자리), **그 값을 바꾸는 행위마다 전용
   * 경로가 필요하다** — 안 만들면 「증축했는데 레벨은 그대로」로 조용히 삼킨다.
   *
   * 클라이언트가 보내는 것은 **「무엇을」뿐**이다. 판정도 계산도 시각도 전부
   * 서버가 하고(`applyCityAction`), 규칙이 거부하면 **그 이유를 그대로 돌려준다** —
   * 화면이 이유를 다시 지어내지 않게(§8.5 「왜 안 되는지도 그쪽이 말한다」).
   */
  /**
   * **AI 대전 참가비** (2026-09-04). 온라인은 `QueueRoom`이 방을 열며 서버에
   * 직접 물리지만(H3b), AI는 그 방이 없어 **클라이언트만 냈다** — 그리고
   * `PUT /profile`이 `grain`을 버리므로(H3d) **서버에는 한 톨도 안 남았다.**
   * 화면에서는 줄어 보이고 다음 새로고침에 되살아난다.
   *
   * 「버리기만 하고 경로를 안 만들면 조용히 삼킨다」에 정확히 걸리는 자리이고,
   * H3d 이후로 있던 구멍이다 — 스모크가 이미 재고 있었는데 그 스모크 자체가
   * 낡아 멈춰 있어 아무도 못 봤다.
   */
  app.post('/battle/fee', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ mode: BattleMode }>;
    if (!b.mode) return reply.code(400).send({ error: 'invalid body' });
    try {
      // 출정의 문 — 도적떼를 출몰시키고, 살아 있으면 막는다 (GDD §5.11)
      const profile = await applyGrainAction(user.uid, b.mode, 'spend', { gateRaid: true });
      if (!profile) return reply.code(404).send({ error: 'no profile' });
      return profile;
    } catch (e) {
      if (e instanceof RaidBlockedError) return reply.code(409).send({ error: e.message, code: e.code });
      // 군량이 모자라면 `spendGrain`이 던진다 — 사람 말 그대로 올린다
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'cannot spend' });
    }
  });

  /**
   * 도적떼 (GDD §5.11) — 시작 · 결과 · 항복. 시드와 시각은 서버가 넣고, 결과는 사람이 낸
   * 의도만 받아 **재생해서** 믿는다(`raid.ts` 머리말). 규칙이 거부하면 이유 코드를 함께 돌린다.
   */
  const sendRaid = (reply: import('fastify').FastifyReply, r: RaidActionResult) =>
    (r.ok ? r.profile : reply.code(r.status).send({ error: r.reason, ...(r.code ? { code: r.code } : {}) }));

  app.post('/raid/start', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return sendRaid(reply, await startRaidAction(user.uid));
  });

  app.post('/raid/surrender', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return sendRaid(reply, await surrenderRaidAction(user.uid));
  });

  app.post('/raid/result', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ humanIntents: Intent[] }>;
    if (!Array.isArray(b.humanIntents)) return reply.code(400).send({ error: 'invalid body' });
    return sendRaid(reply, await settleRaidAction(user.uid, b.humanIntents));
  });

  app.post('/city/upgrade', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const r = await applyCityAction(user.uid, { kind: 'upgrade' });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  app.post('/city/build', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ building: BuildingId }>;
    if (!b.building) return reply.code(400).send({ error: 'invalid body' });
    // **id가 진짜인지는 `canBuild()`가 본다** — 여기서 목록을 한 벌 더 적으면
    // 건물이 늘 때 한쪽만 낡는다
    const r = await applyCityAction(user.uid, { kind: 'build', building: b.building });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  app.post('/city/heal', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ officer: OfficerId }>;
    if (!b.officer) return reply.code(400).send({ error: 'invalid body' });
    const r = await applyCityAction(user.uid, { kind: 'heal', officer: b.officer });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /**
   * **건축 자재 구매** (2026-09-04). 장터의 「거래」에서 부르지만 판정은 도시
   * 규칙(`applyBuyMaterials`)이고, 바꾸는 것이 `materials`(서버 소유 필드)라
   * `/city/*` 셋과 같은 기계를 탄다 — 로컬로 계산해 `PUT`으로 올리면 자재가
   * 조용히 삼켜지고 금화만 준다.
   *
   * **얼마나 사는지는 클라이언트가 안 고른다** — 묶음 크기·값은 규칙 상수
   * (`MATERIAL_PACK`·`materialPackCost()`)라 몸통이 비어 있다. 개수를 받으면
   * 그 값을 서버가 다시 검증해야 하는데, 검증할 것이 「양수인가」뿐이라면
   * 그냥 안 받는 편이 표면이 좁다.
   */
  app.post('/market/materials', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const r = await applyCityAction(user.uid, { kind: 'buyMaterials' });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /**
   * 대장간 제조 (2026-09-09). 금화를 내고 시작 시각을 찍는 것이 `/city/*`와
   * 같은 「서버 소유 필드를 바꾸는 행위」라 같은 기계를 탄다 — `forgeOrder`는
   * `PUT`이 통째로 버리므로(§authority.ts) 이 경로가 없으면 「제조했는데 주문이
   * 안 생긴다」로 조용히 삼킨다.
   */
  app.post('/forge/order', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ equipmentId: string }>;
    if (!b.equipmentId) return reply.code(400).send({ error: 'invalid body' });
    const r = await applyForgeAction(user.uid, { kind: 'start', equipmentId: b.equipmentId });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /** 진행 중인 주문을 취소하고 전액 환불한다. 완성 전이면 언제든 부를 수 있다 */
  app.post('/forge/cancel', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const r = await applyForgeAction(user.uid, { kind: 'cancel' });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  // ── 태학 — 책략 개량 연구 (2026-09-22, GDD §5.12) ─────────────────────
  //
  // `academy`가 서버 소유라(`PUT`이 버린다) 바꾸는 길이 이 넷뿐이다. 보내는 것은 「무엇을」
  // 뿐이고 시각은 서버가 찍는다 — 클라이언트 시계로 1시간을 당길 수 없다.

  /** 연구 시작 — 개량형 id 하나. 레벨·동시 진행·이미 끝낸 레벨은 `canStartResearch()`가 본다 */
  app.post('/academy/research', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ tactic: string }>;
    if (typeof b.tactic !== 'string') return reply.code(400).send({ error: 'invalid body' });
    const r = await applyAcademyAction(user.uid, { kind: 'research', tactic: b.tactic });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /** 진행 중인 연구 취소 — 무료라 돌려줄 것이 없다. 그 레벨은 다시 고를 수 있다 */
  app.post('/academy/cancel', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const r = await applyAcademyAction(user.uid, { kind: 'cancel' });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /** 축하 팝업을 봤다 — `notice`를 비운다. 비어 있어도 200(두 번 눌려도 된다) */
  app.post('/academy/ack', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const r = await applyAcademyAction(user.uid, { kind: 'ack' });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /**
   * 연구 되돌리기 — 금화 10냥(둔갑천서와 같은 값). **상점에서 파는 칸은 아직 없다** —
   * 기획자 지시로 서버 경로만 먼저 섰다(2026-09-22).
   */
  app.post('/academy/reset', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const r = await applyAcademyAction(user.uid, { kind: 'reset' });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  // ── 계정 거래 — 금화를 쓰거나 받는 수 (2026-09-14, A1) ───────────────────
  //
  // **`gold`·`gachaPool`이 서버 소유가 되었다**(`meta/authority.ts`) — 그전에는 가챠·도시
  // 이름·재설계가 로컬로 계산해 `PUT`으로 올렸고, API를 직접 부르면 금화를 마음대로
  // 적을 수 있었다. `/market/materials`·`/forge/*`와 같은 결로, 보내는 것은 「무엇을」뿐이다.

  /**
   * 가챠 한 판. **시드는 서버가 만든다** — 첫 가챠에서만 쓰이고(`drawGacha()`), 클라이언트가
   * 고를 수 있으면 좋은 배열이 나오는 시드를 골라 올 수 있다. 뽑은 장수가 프로필과 함께 간다.
   */
  app.post('/market/gacha', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ kind: GachaPullKind }>;
    if (b.kind !== 'single' && b.kind !== 'ten') return reply.code(400).send({ error: 'invalid body' });
    const r = await pullGacha(user.uid, b.kind, randomInt(1, 2 ** 31 - 1));
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return { profile: r.profile, drawn: r.drawn, exhausted: r.exhausted };
  });

  /** 도시 이름 변경 — 금화를 낸다. 쿨다운 시각도 서버 시계로 찍힌다 */
  app.post('/city/rename', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ name: string }>;
    if (typeof b.name !== 'string') return reply.code(400).send({ error: 'invalid body' });
    const r = await applyAccountAction(user.uid, { kind: 'rename', name: b.name });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /** 재설계(둔갑천서) — 금화를 내고 쓴 카드를 돌려받는다 */
  app.post('/officer/respec', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ officer: OfficerId }>;
    if (typeof b.officer !== 'string') return reply.code(400).send({ error: 'invalid body' });
    const r = await applyAccountAction(user.uid, { kind: 'respec', officer: b.officer });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /**
   * **레벨업** (2026-09-14, A2) — `roster`·`cards`가 서버 소유가 되었다. 능력 하나 · 학파
   * 하나만 보낸다(책략 id는 데이터가 정한다 — `applyLevelUp()` 머리말). 그전에는 API를 직접
   * 불러 레벨을 적을 수 있어 **장수 레벨 상한(도시 레벨)이 무력했다.**
   */
  app.post('/officer/levelup', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ officer: OfficerId; stat: StatPick; school: 'support' | 'illusion' }>;
    if (
      typeof b.officer !== 'string'
      || (b.stat !== 'hp' && b.stat !== 'mp' && b.stat !== 'at')
      || (b.school !== 'support' && b.school !== 'illusion')
    ) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const r = await applyAccountAction(user.uid, { kind: 'levelUp', officer: b.officer, stat: b.stat, school: b.school });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /** **카드 정리** (A2) — 받을 장수와 재료 수만 보낸다. 3:1 · 2장 이상만 재료는 `canRecycle()`이 본다 */
  app.post('/market/recycle', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = req.body as Partial<{ target: OfficerId; inputs: Record<string, unknown> }>;
    if (typeof b.target !== 'string' || !b.inputs || typeof b.inputs !== 'object' || Array.isArray(b.inputs)) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const inputs: RecycleInputs = {};
    for (const [id, n] of Object.entries(b.inputs)) {
      if (!Number.isInteger(n) || (n as number) < 0) return reply.code(400).send({ error: 'invalid inputs' });
      inputs[id as OfficerId] = n as number;
    }
    const r = await applyAccountAction(user.uid, { kind: 'recycle', target: b.target, inputs });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /**
   * **개발용 지급**(금화 · 장수 카드 · 강제 부상) — **`SAMCHESS_DEV_GRANTS=1`일 때만** 받는다.
   *
   * 금화가 들어오는 길이 아직 이것뿐이다(금화팩 결제 전). 기본은 **닫혀 있다** — 배포에
   * 켜 두면 그 자체가 금화를 찍어 내는 치팅 경로다. 꺼져 있을 때 404가 아니라
   * **400으로 이유를 준다** — 클라이언트는 404를 「서버가 낡아 이 길을 모른다」로 읽는다.
   */
  /**
   * 개발용 지급이 켜져 있는가 (2026-09-18) — 화면이 개발용 단추를 **켜져 있을 때만** 그리려고 묻는다.
   * 꺼진 서버에서 단추를 눌러 「꺼져 있다」를 받는 것은 시험이 끝난 뒤에도 단추가 남아 있는 것으로
   * 읽혔다(기획자 지적). 값은 스위치 하나뿐이라 인증 없이 답한다.
   */
  app.get('/dev/status', async () => ({ grants: process.env['SAMCHESS_DEV_GRANTS'] === '1' }));

  app.post('/dev/grant', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (process.env['SAMCHESS_DEV_GRANTS'] !== '1') {
      return reply.code(400).send({ error: '개발용 지급이 꺼져 있다 — server-api를 SAMCHESS_DEV_GRANTS=1로 띄운다' });
    }
    const b = req.body as Partial<{
      gold: number; officer: OfficerId; cards: number; injure: OfficerId[]; finishResearch: boolean;
    }>;
    const gold = b.gold ?? 0;
    const cards = b.cards ?? 0;
    const inRange = (n: unknown, max: number): boolean => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
    if (!inRange(gold, 100_000) || !inRange(cards, 100)) return reply.code(400).send({ error: 'invalid body' });
    if (cards > 0 && (typeof b.officer !== 'string' || !officerById.has(b.officer))) {
      return reply.code(400).send({ error: 'unknown officer' });
    }
    // 병원 시험용 강제 부상 (2026-09-18) — 보유하지 않은 장수는 `applyInjuries()`가 건너뛴다
    const injure = b.injure ?? [];
    if (!Array.isArray(injure) || injure.length > 10 || !injure.every((id) => typeof id === 'string' && officerById.has(id))) {
      return reply.code(400).send({ error: 'invalid injure' });
    }
    const r = await applyAccountAction(user.uid, {
      kind: 'devGrant', gold, officer: b.officer ?? null, cards, injure, finishResearch: b.finishResearch === true,
    });
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    return r.profile;
  });

  /**
   * 계정 초기화(테스트용) — 지금 프로필을 지우고 새 도시 생성 흐름으로 되돌린다.
   * `deleteProfile()`은 원래 스모크·테스트 정리용이었는데, 화면에서 도시를 다시
   * 만들어 테스트하려 해도 되돌아갈 방법이 없어 여기 그대로 얹었다.
   */
  app.delete('/profile', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    await deleteProfile(user.uid);
    return { ok: true };
  });

  /**
   * 도시/부대/장수 랭킹 — 전체 유저 top 3(또는 검색 결과 셋, 2026-09-18). "내 랭킹"은 여기 안
   * 온다(`ranking.ts` 머리말 참조) — 클라이언트가 자기 프로필로 직접 낸다.
   * `/profile`과 같은 인증 수준(로그인한 유저면 누구나 조회).
   */
  app.get('/ranking', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const query = req.query as Record<string, string | undefined>;
    const board = query['board'];
    if (board !== 'city' && board !== 'squad' && board !== 'officer') {
      return reply.code(400).send({ error: 'invalid board' });
    }
    const filter = query['filter'];
    if (filter !== 'all' && filter !== 'online' && filter !== 'ai') {
      return reply.code(400).send({ error: 'invalid filter' });
    }
    const mode = query['mode'];
    if (mode !== undefined && mode !== '3v3' && mode !== '5v5') {
      return reply.code(400).send({ error: 'invalid mode' });
    }
    const q = query['q'];
    const rows = await queryRanking({
      board: board as RankBoard, filter, ...(mode ? { mode } : {}),
      sort: query['sort'] ?? 'total', ...(q ? { q } : {}),
    });
    return { rows };
  });

  /**
   * 내 도시·최고 부대·최고 장수의 **순위** — 랭킹 메뉴 위쪽 판(2026-09-18). 행은
   * 클라이언트가 제 프로필로 내고, 몇 등인지만 여기서 전체를 훑어 준다
   * (`queryMyRanks`). 필터 검사는 `/ranking`과 같다.
   */
  app.get('/ranking/mine', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const query = req.query as Record<string, string | undefined>;
    const filter = query['filter'] ?? 'all';
    if (filter !== 'all' && filter !== 'online' && filter !== 'ai') {
      return reply.code(400).send({ error: 'invalid filter' });
    }
    const mode = query['mode'];
    if (mode !== undefined && mode !== '3v3' && mode !== '5v5') {
      return reply.code(400).send({ error: 'invalid mode' });
    }
    const ranks = await queryMyRanks(user.uid, filter, mode);
    if (!ranks) return reply.code(404).send({ error: 'no profile' });
    return { ranks };
  });

  /**
   * 참가비·거절 군량·환불 재계산 — **내부 전용**(서버 간 공유 비밀, 사용자 토큰이
   * 아니다). `packages/server`(Colyseus)의 `QueueRoom`·`BattleRoom`이 각각 방이
   * 열리는·거절되는·접히는 그 순간에 직접 부른다(H3b). 요청 본문의 `mode`·`action`만
   * 쓰고 **`grain` 값은 아예 받지 않는다** — 서버가 가진 프로필에서 다시 계산한다.
   */
  app.post('/internal/grain', async (req, reply) => {
    if (!verifyInternalSecret(req.headers['x-internal-secret'] as string | undefined)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const body = req.body as { uid?: string; mode?: BattleMode; action?: GrainAction };
    if (!body.uid || !body.mode || !body.action) return reply.code(400).send({ error: 'invalid body' });

    try {
      const profile = await applyGrainAction(body.uid, body.mode, body.action);
      if (!profile) return reply.code(404).send({ error: 'not found' });
      return { ok: true };
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : 'conflict' });
    }
  });

  /**
   * AI 대전 결과 — 사람이 낸 의도만 받아 **같은 시드로 재생**해 검증한 뒤 보상을
   * 반영한다(§5-96). 사용자 토큰이다 — `PUT /profile`과 같은 인증. 무승부는 여기
   * 안 온다(사람이 택1을 고른 뒤 `/battle/draw-result`로 간다, H3d).
   */
  app.post('/battle/ai-result', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const b = req.body as Partial<{
      mode: BattleMode; seed: number; targetPower: number; exclude: OfficerId[];
      picks: RosterPick[]; squadId: string | null; humanIntents: Intent[]; startedAt: number;
    }>;
    if (
      !b.mode || typeof b.seed !== 'number' || typeof b.targetPower !== 'number'
      || !Array.isArray(b.exclude) || !Array.isArray(b.picks) || !Array.isArray(b.humanIntents)
    ) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const body: AiBattleRequest = {
      mode: b.mode, seed: b.seed, targetPower: b.targetPower, exclude: b.exclude,
      picks: b.picks, squadId: b.squadId ?? null, humanIntents: b.humanIntents,
      // 없으면 `settleAiBattle`이 「지금」으로 본다 — 옛 클라이언트도 그대로 돈다
      ...(typeof b.startedAt === 'number' ? { startedAt: b.startedAt } : {}),
    };

    const result = await settleAiBattle(user.uid, body);
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { profile: result.profile, rewards: result.rewards };
  });

  /**
   * 온라인 대전 승/패 반영 — **내부 전용** (서버 간 공유 비밀, H3d).
   * `packages/server`(Colyseus)의 `BattleRoom`이 `room.battle.phase === 'finished'`가
   * 되는 그 순간, **자신이 이미 판정을 끝낸 상태**에서 각 진영의 결과를 직접 통보한다 —
   * `/battle/ai-result`처럼 재생해서 검증할 필요가 없다(Colyseus 자신이 판정
   * 주체였다). 무승부(`winner === null`, 실측 0.02%)는 여기 안 온다 — 사람이 택1을
   * 고른 뒤에만 반영되므로 `/battle/draw-result`로 간다.
   */
  app.post('/internal/battle-result', async (req, reply) => {
    if (!verifyInternalSecret(req.headers['x-internal-secret'] as string | undefined)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const b = req.body as Partial<{
      uid: string; mode: BattleMode; result: 'win' | 'lose'; seed: number;
      picks: RosterPick[]; kills: Record<string, number>; fallen: OfficerId[];
      power: { mine: number; theirs: number };
      opponentId: string | null; mySquad: string | null; theirSquad: string | null;
    }>;
    if (
      !b.uid || !b.mode || (b.result !== 'win' && b.result !== 'lose')
      || typeof b.seed !== 'number' || !Array.isArray(b.picks) || !b.power
    ) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const outcome: BattleOutcome = {
      result: b.result, mode: b.mode, opponent: 'online', picks: b.picks,
      ...(b.kills ? { kills: b.kills } : {}),
      // 퇴각한 장수는 승패·무승부와 무관하게 부상이 된다 (GDD §5.7)
      ...(b.fallen ? { fallen: b.fallen } : {}),
      power: b.power, at: Date.now(),
      opponentId: b.opponentId ?? null, mySquad: b.mySquad ?? null, theirSquad: b.theirSquad ?? null,
    };
    const settled = await settleOutcome(b.uid, outcome, b.seed);
    if (!settled.ok) return reply.code(settled.status).send({ error: settled.reason });
    return { rewards: settled.rewards };
  });

  /**
   * 무승부 택1 반영 — **AI·온라인이 갈리지 않는다** (GDD §6.4). 사용자 토큰이다.
   *
   * `picks`·`kills`·`power`는 여전히 클라이언트가 대는 값이다 — 승/패와 달리
   * 무승부는 「사람이 셋 중 하나를 고른 뒤에만 반영한다」는 UI 상태를 서버가
   * 미리 알 수 없어(고르기 전까지는 계정에 아무것도 반영하지 않는다), 판정
   * 주체(로컬 AI 재생 또는 Colyseus)가 이미 사라진 뒤에 온다. **위조 여지가 여기에만
   * 좁게 남는다** — H3c가 AI 무승부에 남겨 둔 것과 같은, 알고 남긴 낮은 심각도의
   * 공백이다(§5-96). `PUT /profile`이 `grain`을 더는 안 믿게 되며(H3d) 이 경로가
   * 없으면 무승부의 군량 보상이 조용히 사라지므로, 승/패와 달리 새로 만들었다.
   */
  app.post('/battle/draw-result', async (req, reply) => {
    const user = await verifyToken(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const b = req.body as Partial<{
      mode: BattleMode; opponent: OpponentKind; seed: number; drawPick: DrawReward;
      picks: RosterPick[]; kills: Record<string, number>; fallen: OfficerId[];
      power: { mine: number; theirs: number };
      opponentId: string | null; mySquad: string | null; theirSquad: string | null;
    }>;
    if (
      !b.mode || (b.opponent !== 'ai' && b.opponent !== 'online')
      || typeof b.seed !== 'number' || !Array.isArray(b.picks) || !b.power
      || (b.drawPick !== 'card' && b.drawPick !== 'material' && b.drawPick !== 'grain')
    ) {
      return reply.code(400).send({ error: 'invalid body' });
    }
    const outcome: BattleOutcome = {
      result: 'draw', mode: b.mode, opponent: b.opponent, picks: b.picks,
      ...(b.kills ? { kills: b.kills } : {}),
      // 퇴각한 장수는 승패·무승부와 무관하게 부상이 된다 (GDD §5.7)
      ...(b.fallen ? { fallen: b.fallen } : {}),
      power: b.power, at: Date.now(), drawPick: b.drawPick,
      opponentId: b.opponentId ?? null, mySquad: b.mySquad ?? null, theirSquad: b.theirSquad ?? null,
    };
    const settled = await settleOutcome(user.uid, outcome, b.seed);
    if (!settled.ok) return reply.code(settled.status).send({ error: settled.reason });
    return { profile: settled.profile, rewards: settled.rewards };
  });
}
