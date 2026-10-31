/**
 * 관리자의 계정 조정 (`packages/server-api/src/admin/`) — 재화 · 카드 · 시장 아이템 · 병기의 지급과 회수 (2026-10-20).
 *
 * **순수 함수다** — I/O도 시계도 없다(`nowMs`는 부르는 쪽이 넣는다). 판정이 거부하면
 * 사람 말로 던지고, 라우트가 그 말을 400으로 그대로 돌린다(`profileStore.ts`의 행위들과 같은 결).
 *
 * 게임 규칙을 **우회하는 자리**라 무엇을 지키고 무엇을 넘는지를 여기 적어 둔다:
 *
 * | 지킨다 | 넘는다 |
 * |---|---|
 * | 값은 0 밑으로 안 내려간다 | 궁궐 풀 상한 — 넘치는 카드는 보관함으로 간다(`addCard`) |
 * | 군량은 창고 상한까지 — 넘기면 다음 충전에서 `syncGrain`이 깎는다 | 대장간 종류당 자루 수 |
 * | 들려 보낼 예정(`marketCarry`)인 아이템은 못 거둔다 | 시장 보유 총량 · 하루 매물 |
 * | 장수가 끼고 있는 병기는 못 거둔다 | |
 *
 * **계정의 권위 자리(meta)에 둔다** — 서버(`server-api/src/admin/`)는 이 함수를 잠긴 행 위에서 부를 뿐이다.
 * 처음(2026-10-20)에는 기존 파일을 못 고치는 사정으로 server-api 안에 있었다.
 */
import { EQUIPMENT, MARKET_ITEMS, RAID, officerById } from '@samchess/data';
import { academyOf } from './academy.ts';
import { fightingAi, forfeitAiBattle } from './aiBattle.ts';
import { HEAL_MS, ROOM_CYCLE_MS, grainCap, healMsOf, injuryHealsAt, isInjured } from './city.ts';
import { forgeItemKey } from './forge.ts';
import { carriedCount, inPlayOf, isCarriedBattle, marketHeldCount, settleCarried } from './market.ts';
import { raidActive, raidDay, surrenderRaid } from './raid.ts';
import { addCard } from './profile.ts';
import { GARRISON_MODES, garrisonOf } from './garrison.ts';
import { BASIC_TUTORIALS, S_TUTORIAL_OFFICERS, sTutorialId, sortieGate, tutorialDone, tutorialStatus } from './tutorial.ts';
import type { CarriedBattle, PlayerProfile } from './types.ts';
import type { BattleMode, OfficerId } from '@samchess/rules';

export type Adjustment =
  | { kind: 'gold' | 'grain' | 'materials'; delta: number }
  | { kind: 'cards'; officer: string; delta: number }
  | { kind: 'item'; item: string; delta: number }
  | { kind: 'equipmentGrant'; equipmentId: string; count: number }
  | { kind: 'equipmentRevoke'; key: string };

/** 한 번에 움직일 수 있는 양 — 오타 하나(0을 셋 더 친 것)가 경제를 흔들지 않게 */
export const ADJUST_LIMITS = {
  gold: 100_000, grain: 100_000, materials: 10_000, cards: 100, item: 99, equipment: 10,
} as const;

const equipmentById = new Map(EQUIPMENT.map((e) => [e.id, e]));
const marketItemIds = new Set(MARKET_ITEMS.map((m) => m.id));

/** 요청 본문 → `Adjustment`. 모양이 틀리면 사람 말을 돌려준다 */
export function parseAdjustment(body: unknown): Adjustment | string {
  if (!body || typeof body !== 'object') return '본문이 없다';
  const b = body as Record<string, unknown>;
  const int = (v: unknown, max: number, allowNegative: boolean): number | null =>
    Number.isInteger(v) && v !== 0 && Math.abs(v as number) <= max && (allowNegative || (v as number) > 0)
      ? v as number : null;

  switch (b['kind']) {
    case 'gold': case 'grain': case 'materials': {
      const delta = int(b['delta'], ADJUST_LIMITS[b['kind']], true);
      return delta === null ? `delta는 0이 아닌 정수 · 절댓값 ${ADJUST_LIMITS[b['kind']]} 이하` : { kind: b['kind'], delta };
    }
    case 'cards': {
      const delta = int(b['delta'], ADJUST_LIMITS.cards, true);
      if (delta === null) return `delta는 0이 아닌 정수 · 절댓값 ${ADJUST_LIMITS.cards} 이하`;
      if (typeof b['officer'] !== 'string' || !officerById.has(b['officer'])) return '모르는 장수다';
      return { kind: 'cards', officer: b['officer'], delta };
    }
    case 'item': {
      const delta = int(b['delta'], ADJUST_LIMITS.item, true);
      if (delta === null) return `delta는 0이 아닌 정수 · 절댓값 ${ADJUST_LIMITS.item} 이하`;
      if (typeof b['item'] !== 'string' || !marketItemIds.has(b['item'])) return '모르는 아이템이다';
      return { kind: 'item', item: b['item'], delta };
    }
    case 'equipmentGrant': {
      const count = int(b['count'], ADJUST_LIMITS.equipment, false);
      if (count === null) return `count는 1~${ADJUST_LIMITS.equipment}`;
      if (typeof b['equipmentId'] !== 'string' || !equipmentById.has(b['equipmentId'])) return '모르는 병기다';
      return { kind: 'equipmentGrant', equipmentId: b['equipmentId'], count };
    }
    case 'equipmentRevoke':
      return typeof b['key'] === 'string' && b['key'] ? { kind: 'equipmentRevoke', key: b['key'] } : '자루 키(key)가 없다';
    default:
      return '모르는 kind다';
  }
}

/**
 * 조정 하나를 적용한다. **`profile`은 이미 서버 시계로 정산된 값이어야 한다** —
 * 군량 상한 판정이 정산된 군량 위에서 서야 한다(`mutateWithAudit`이 그렇게 넘긴다).
 */
export function applyAdjustment(profile: PlayerProfile, adj: Adjustment, nowMs: number): PlayerProfile {
  switch (adj.kind) {
    case 'gold': case 'materials': {
      const next = profile[adj.kind] + adj.delta;
      const label = adj.kind === 'gold' ? '금화' : '건축 자재';
      if (next < 0) throw new Error(`${label}가 모자라다 — 지금 ${profile[adj.kind]}, 거두려는 양 ${-adj.delta}`);
      return { ...profile, [adj.kind]: next };
    }
    case 'grain': {
      const next = profile.grain + adj.delta;
      if (next < 0) throw new Error(`군량이 모자라다 — 지금 ${profile.grain}, 거두려는 양 ${-adj.delta}`);
      const cap = grainCap(profile);
      if (next > cap) throw new Error(`군량 창고 상한을 넘는다 — 상한 ${cap}, 지금 ${profile.grain}`);
      return { ...profile, grain: next };
    }
    case 'cards': {
      const officer = adj.officer as OfficerId;
      if (adj.delta > 0) return addCard(profile, officer, adj.delta);
      const have = profile.cards[officer] ?? 0;
      if (have < -adj.delta) throw new Error(`여분 카드가 모자라다 — 지금 ${have}장 (풀에 든 장수 본체는 카드로 세지 않는다)`);
      const cards = { ...profile.cards };
      if (have + adj.delta > 0) cards[officer] = have + adj.delta;
      else delete cards[officer];
      return { ...profile, cards };
    }
    case 'item': {
      const held = marketHeldCount(profile, adj.item);
      const boughtAt = [...(profile.marketBoughtAt?.[adj.item] ?? [])];
      if (adj.delta > 0) {
        return {
          ...profile,
          marketOwned: { ...profile.marketOwned, [adj.item]: held + adj.delta },
          // 보관함이 한 개에 한 줄을 그린다 — 지급 시각을 「구매일」 자리에 찍는다
          marketBoughtAt: { ...profile.marketBoughtAt, [adj.item]: [...boughtAt, ...Array(adj.delta).fill(nowMs)] },
        };
      }
      const left = held + adj.delta;
      if (left < 0) throw new Error(`아이템이 모자라다 — 지금 ${held}개`);
      const carried = carriedCount(profile, adj.item);
      if (left < carried) throw new Error(`들려 보낼 예정인 것이 ${carried}개라 ${held - carried}개까지만 거둘 수 있다`);
      // 소모처럼 **가장 오래된 것부터** 빠진다(`marketBoughtAt` 머리말)
      const owned = { ...profile.marketOwned };
      if (left > 0) owned[adj.item] = left;
      else delete owned[adj.item];
      return {
        ...profile,
        marketOwned: owned,
        marketBoughtAt: { ...profile.marketBoughtAt, [adj.item]: boughtAt.slice(Math.min(boughtAt.length, -adj.delta)) },
      };
    }
    case 'equipmentGrant': {
      const forgeOwned = { ...profile.forgeOwned };
      const forgeMadeAt = { ...profile.forgeMadeAt };
      // 번호 짓기는 `collectForgeOrder`의 `nextCopy`와 같다 — 비어 있는 가장 작은 번호
      for (let i = 0, n = 1; i < adj.count; i += 1) {
        while (forgeItemKey(adj.equipmentId, n) in forgeOwned) n += 1;
        const key = forgeItemKey(adj.equipmentId, n);
        forgeOwned[key] = null;
        forgeMadeAt[key] = nowMs;
      }
      return { ...profile, forgeOwned, forgeMadeAt };
    }
    case 'equipmentRevoke': {
      if (!(adj.key in profile.forgeOwned)) throw new Error(`그런 자루가 없다 — ${adj.key}`);
      const holder = profile.forgeOwned[adj.key];
      if (holder) throw new Error(`${officerById.get(holder)?.name ?? holder}이(가) 끼고 있다 — 지급을 먼저 풀어야 한다`);
      const { [adj.key]: _owned, ...forgeOwned } = profile.forgeOwned;
      const { [adj.key]: _made, ...forgeMadeAt } = profile.forgeMadeAt ?? {};
      return { ...profile, forgeOwned, forgeMadeAt };
    }
  }
}

/** 감사 로그의 `before`/`after` — 바뀐 최상단 필드만 */
export function changedProfileFields(before: PlayerProfile, after: PlayerProfile): { before: object; after: object } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof PlayerProfile>;
  for (const k of keys) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    b[k] = before[k] ?? null;
    a[k] = after[k] ?? null;
  }
  return { before: b, after: a };
}

// ── 멈춘 상태 정리 (2026-10-20) ──────────────────────────────────

/**
 * 관리자의 「지금 정리」. 아래 상태는 전부 **시간이 지나면 저절로 풀린다** — 정리는 그 기다림을 건너뛸 뿐이고,
 * **게임에 이미 있는 처리를 그대로 부른다**(새 환불 길을 만들지 않는다). 대장간 제작은 넣지 않는다 —
 * 「Lv × 1분」(2026-09-10)이라 멈추지 않고, 취소 · 환불은 2026-09-25에 걷어 냈다.
 *
 * | kind | 하는 일 | 저절로는 |
 * |---|---|---|
 * | `aiBattle` | 지금 **패배로 정산** — `syncAiBattle`의 60분 정산과 같은 함수(`forfeitAiBattle`) | 시작 + 60분 |
 * | `raid` | 지금 **항복** — 약탈까지, `POST /raid/surrender`와 같다 | 대기 10분 · 전투 60분 |
 * | `academy` | 진행 중인 연구를 **지금 끝낸다** — `doneAt`은 지금, `startedAt`은 안 옮긴다 | 시작 + 연구 시간 |
 * | `injury` | 장수 하나를 **지금 낫게** — 낫는 시각이 지금이 되게 시각을 옮긴다(필드를 안 지운다) | 60분 · 치료 1분 |
 * | `inPlay` | 판 도중 빠진 아이템 — **판(`battle`)을 하나 골라** 그 판의 줄만. 기본 **소모**, `refund`면 돌려준다(`settleCarried`) | 그 판이 정산될 때 |
 *
 * **시각을 옮기는 쪽은 언제나 「지금」까지만이다** — 이미 시작한 판의 재생은 그 판의 시작 시각으로 계정을 보므로
 * (`researchedUpgrades` · 부상), 「지금」보다 앞을 찍지 않으면 진행 중인 판과 어긋나지 않는다.
 *
 * ⚠ AI 대전 · 도적떼 · 아이템은 **그 판을 지금 하고 있을 수 있다** — 정리하면 그 판의 정산은 거절된다(「한 번만
 * 정산」의 고리가 그 기록이다). 화면이 실행 전에 알린다.
 */
export type Resolution =
  | { kind: 'aiBattle' | 'raid' | 'academy' }
  | { kind: 'injury'; officer: string }
  | { kind: 'inPlay'; battle: CarriedBattle; refund: boolean };

export function parseResolution(body: unknown): Resolution | string {
  if (!body || typeof body !== 'object') return '본문이 없다';
  const b = body as Record<string, unknown>;
  switch (b['kind']) {
    case 'aiBattle': case 'raid': case 'academy':
      return { kind: b['kind'] };
    case 'injury':
      return typeof b['officer'] === 'string' && officerById.has(b['officer']) ? { kind: 'injury', officer: b['officer'] } : '모르는 장수다';
    case 'inPlay':
      if (!isCarriedBattle(b['battle'])) return 'battle(ai · raid · online)이 없다';
      return typeof b['refund'] === 'boolean' ? { kind: 'inPlay', battle: b['battle'], refund: b['refund'] } : 'refund(true/false)가 없다';
    default:
      return '모르는 kind다';
  }
}

/** 정리 하나를 적용한다. **`profile`은 서버 시계로 정산된 값이어야 한다** — 이미 풀린 상태를 정리라고 하지 않게 */
export function applyResolution(profile: PlayerProfile, res: Resolution, nowMs: number): PlayerProfile {
  const now = Math.floor(nowMs);
  switch (res.kind) {
    case 'aiBattle': {
      const ai = fightingAi(profile);
      if (!ai || ai.startedAt === undefined) throw new Error('싸우는 중인 AI 대전이 없다');
      return forfeitAiBattle(profile, now);
    }
    case 'raid':
      if (!raidActive(profile.raid)) throw new Error('살아 있는 도적떼가 없다');
      // 항복해도 들고 간 것은 안 돌아온다 — 게임의 항복과 같다(`surrenderRaid`가 내려놓는다)
      return surrenderRaid(profile, now);
    case 'academy': {
      const a = academyOf(profile);
      const r = a.research;
      if (!r) throw new Error('진행 중인 연구가 없다');
      const { research: _drop, ...rest } = a;
      // 되돌리기 뒤의 즉시 연구(`applyStartResearch`)와 같은 모양 — 끝난 시각은 지금, 축하 팝업도 뜬다
      return {
        ...profile,
        academy: {
          ...rest,
          done: [...a.done.filter((d) => d.level !== r.level), { level: r.level, tactic: r.tactic, doneAt: now }],
          notice: [...(a.notice ?? []).filter((t) => t !== r.tactic), r.tactic],
        },
      };
    }
    case 'injury': {
      const officer = res.officer as OfficerId;
      const inst = profile.roster[officer];
      if (!inst) throw new Error('풀에 없는 장수다');
      const healsAt = injuryHealsAt(inst);
      if (healsAt === null || !isInjured(inst, now)) throw new Error('부상이 아니다');
      // 낫는 시각을 지금으로 당긴다 — 부상 · 치료 시각을 같은 만큼 앞으로 옮긴다. 치료 중이면 그 방의 해제 시각도
      // 같이 옮긴다(방과 환자는 `healingAt + 주기 === 해제 시각`으로 짝짓는다, `hospitalWards`)
      const shift = healsAt - now;
      const healed = {
        ...inst,
        ...(inst.injuredAt !== undefined ? { injuredAt: inst.injuredAt - shift } : {}),
        ...(inst.healingAt !== undefined ? { healingAt: inst.healingAt - shift } : {}),
      };
      let hospitalBusy = profile.hospitalBusy;
      if (inst.healingAt !== undefined) {
        const freeAt = inst.healingAt + healMsOf(inst) + ROOM_CYCLE_MS - HEAL_MS; // city.ts의 roomCycleOf와 같은 셈
        const i = hospitalBusy.indexOf(freeAt);
        if (i >= 0) hospitalBusy = hospitalBusy.map((t, j) => (j === i ? t - shift : t));
      }
      return { ...profile, roster: { ...profile.roster, [officer]: healed }, hospitalBusy };
    }
    case 'inPlay':
      // 그 판의 줄만 — 다른 판은 아직 돌고 있을 수 있다(`settleCarried`)
      if (inPlayOf(profile, res.battle).length === 0) throw new Error('그 판에 빠진 아이템이 없다');
      return settleCarried(profile, !res.refund, res.battle);
  }
}

// ── 역할 나누기 — 관리자 / CS (2026-10-21c, `history/2026-10-21c_관리자역할나누기_설계.md`) ──────────
//
// **권한 표는 이것 하나다** — 서버(`admin/routes.ts`의 `requireAdmin`)는 이 표로 막고, 화면은 `/admin/me`가 실어 주는
// 이 표의 줄로 단추를 감출 뿐이다(감춘 단추를 우회해 불러도 서버가 403).
//
// | 권한 | 하는 일 | admin | cs |
// |---|---|---|---|
// | `view` | 대시보드 · 추이 · 유저 · 계정 상세 · 게임 데이터 · 우편 목록 · 감사 로그(전부) | ✓ | ✓ |
// | `resolve` | 멈춘 상태 정리 | ✓ | ✓ |
// | `grant` | 조정 중 주는 쪽 | ✓ | ✓ CS 상한 안에서 |
// | `revoke` | 조정 중 거두는 쪽(음수 · `equipmentRevoke`) | ✓ | |
// | `mail.one` | 한 사람 우편 | ✓ | ✓ 보상은 CS 상한 안에서 |
// | `mail.all` · `mail.revoke` | 전체 우편 · 우편 회수 | ✓ | |
// | `ban` | 정지 `CS_BAN_DAYS_MAX`(7)일 이하 | ✓ | ✓ |
// | `ban.long` | 그보다 긴 정지 · 영구 | ✓ | |
// | `unban` | 정지 해제 | ✓ | |
// | `rename` | 도시 이름 강제 변경(+ 알림 우편, 2026-10-22) | ✓ | ✓ |
//
// 역할 주기 · MFA 지우기는 표에 없다 — 서비스 키를 쥔 도구(`tools/admin_role.ts`)만 한다.

export const ADMIN_ROLES = ['admin', 'cs'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];
export const isAdminRole = (v: unknown): v is AdminRole => (ADMIN_ROLES as readonly unknown[]).includes(v);

export const ADMIN_PERMISSIONS = [
  'view', 'resolve', 'grant', 'revoke', 'mail.one', 'mail.all', 'mail.revoke', 'ban', 'ban.long', 'unban', 'rename',
] as const;
export type AdminPermission = typeof ADMIN_PERMISSIONS[number];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  admin: ADMIN_PERMISSIONS,
  cs: ['view', 'resolve', 'grant', 'mail.one', 'ban', 'rename'],
};

export const hasPermission = (role: AdminRole, perm: AdminPermission): boolean => ROLE_PERMISSIONS[role].includes(perm);

/** CS가 걸 수 있는 가장 긴 정지 — 이보다 길면 `ban.long` */
export const CS_BAN_DAYS_MAX = 7;

/**
 * 한 번에 걸 수 있는 가장 긴 정지 — 100년, 화면의 「영구」. 관리자 API가 `days`를 1 ~ 이 값으로 받는다.
 * 리터럴 타입이라 관리자 화면이 `satisfies BanDaysMax`로 묶는다(2026-10-22, 전에는 `server-api/src/admin/store.ts`에 있었다 —
 * 화면의 typecheck가 그 파일을 읽으면 `pg`까지 딸려 가서 옮겼다).
 */
export const BAN_DAYS_MAX = 36_500;

/** 권한이 없을 때 서버가 함께 돌려주는 사람 말 — 「이 일은 관리자에게」 */
export const PERMISSION_LABELS: Record<AdminPermission, string> = {
  view: '보기', resolve: '멈춘 상태 정리', grant: '지급', revoke: '회수', 'mail.one': '한 사람 우편', 'mail.all': '전체 우편',
  'mail.revoke': '우편 회수', ban: '정지', 'ban.long': `${CS_BAN_DAYS_MAX}일보다 긴 정지 · 영구 정지`, unban: '정지 해제',
  rename: '도시 이름 강제 변경',
};

/** `role_forbidden`에 싣는 사람 말 — 라우트의 `permit`과 정지 줄이기(`banTx`)가 같은 말을 쓴다 */
export const roleForbiddenMessage = (perm: AdminPermission): string => `${PERMISSION_LABELS[perm]}은(는) 관리자만 한다 — 관리자에게 넘긴다`;

/** 주는 양에 CS 상한이 걸리는 역할 */
export const isGrantCapped = (role: AdminRole): boolean => role === 'cs';

/** 조정 하나가 주는 쪽인가 — 양수 delta · 병기 지급. 음수 · `equipmentRevoke`는 거두는 쪽이다 */
export const isGrant = (adj: Adjustment): boolean =>
  adj.kind === 'equipmentGrant' || (adj.kind !== 'equipmentRevoke' && adj.delta > 0);

/** 같은 `/adjust`라도 **본문을 보고** 권한이 갈린다 */
export const adjustPermission = (adj: Adjustment): AdminPermission => (isGrant(adj) ? 'grant' : 'revoke');

/**
 * 정지 일수 → 권한(영구는 화면의 36500일). ⚠ **이미 정지된 계정에서 끝나는 시각을 앞당기는 정지는 사실상 해제다** —
 * 그때는 `unban`도 요구한다(영구를 1일로 줄이지 못하게, 본체 검토). 지금 끝나는 시각은 잠근 행에서 읽어야 해서 판정은 `banTx`가 한다.
 */
export const banPermission = (days: number): AdminPermission => (days <= CS_BAN_DAYS_MAX ? 'ban' : 'ban.long');

/** 받는 사람이 없으면(`null`) 전체 우편 */
export const mailPermission = (draft: { targetUid: string | null }): AdminPermission =>
  (draft.targetUid === null ? 'mail.all' : 'mail.one');

// ── CS 상한 ──
//
// 한 번 상한은 관리자(`ADJUST_LIMITS`)의 1/10(내림, 최소 1), 하루(KST) 합계는 한 번 × `CS_DAILY_FACTOR`.
// **「한 번」은 요청 하나다** — 우편 한 통에 장수 카드 줄이 여럿이면 그 합으로 잰다(줄을 나눠 넘기지 못하게, `6b1951e`와 같은 구멍).
// **지급과 우편 보상은 같은 하루 합계를 나눠 쓴다** — 합계는 감사 로그(`adjust.*`의 주는 쪽 · `mail.send`의 `rewards`)에서 센다.

export type CsLimitKind = keyof typeof ADJUST_LIMITS;
export type CsUsage = Record<CsLimitKind, number>;
const CS_LIMIT_KINDS = Object.keys(ADJUST_LIMITS) as CsLimitKind[];

export const CS_DAILY_FACTOR = 5;
export const CS_LIMITS = Object.fromEntries(
  CS_LIMIT_KINDS.map((k) => [k, Math.max(1, Math.floor(ADJUST_LIMITS[k] / 10))]),
) as CsUsage;
export const CS_DAILY_LIMITS = Object.fromEntries(CS_LIMIT_KINDS.map((k) => [k, CS_LIMITS[k] * CS_DAILY_FACTOR])) as CsUsage;

export const CS_LIMIT_LABELS: Record<CsLimitKind, string> = {
  gold: '금화', grain: '군량', materials: '건축 자재', cards: '장수 카드', item: '시장 아이템', equipment: '병기',
};

const zeroUsage = (): CsUsage => Object.fromEntries(CS_LIMIT_KINDS.map((k) => [k, 0])) as CsUsage;

/** 주는 쪽의 양을 종류별로 더한다 — 거두는 쪽은 세지 않는다 */
export function grantUsage(grants: readonly Adjustment[]): CsUsage {
  const u = zeroUsage();
  for (const g of grants) {
    if (!isGrant(g)) continue;
    if (g.kind === 'equipmentGrant') u.equipment += g.count;
    else if (g.kind !== 'equipmentRevoke') u[g.kind] += g.delta;
  }
  return u;
}

/**
 * 감사 로그 줄들 → 그 사이에 준 양. `adjust.<kind>`의 `params`는 `Adjustment`, `mail.send`의 `params.rewards`는 보상 배열이다.
 * 줄의 모양은 `parseAdjustment`로 다시 읽는다 — 모양이 틀린 줄(있을 리 없지만)은 세지 않고 넘긴다.
 */
export function csUsageFromAudit(rows: readonly { action: string; params: unknown }[]): CsUsage {
  const grants: Adjustment[] = [];
  const take = (raw: unknown): void => {
    const adj = parseAdjustment(raw);
    if (typeof adj !== 'string') grants.push(adj);
  };
  for (const r of rows) {
    if (r.action.startsWith('adjust.')) take(r.params);
    else if (r.action === 'mail.send') {
      const rewards = (r.params as { rewards?: unknown } | null)?.rewards;
      if (Array.isArray(rewards)) rewards.forEach(take);
    }
  }
  return grantUsage(grants);
}

export type CsCheck =
  | { ok: true }
  | {
    ok: false; kind: CsLimitKind; scope: 'once' | 'daily';
    /** 그 범위의 상한 */
    limit: number;
    /** 오늘 이미 준 양(이번 것 빼고) */
    used: number;
    /** 이번 요청이 주려는 양 */
    amount: number;
    message: string;
  };

/** CS의 지급 · 우편 보상 판정 — 이번 요청(`grants`)이 한 번 상한 · 오늘 합계(`usedToday`)를 넘는가 */
export function csCheck(grants: readonly Adjustment[], usedToday: CsUsage): CsCheck {
  const amount = grantUsage(grants);
  const n = (v: number): string => v.toLocaleString('en-US');
  for (const kind of CS_LIMIT_KINDS) {
    const a = amount[kind];
    if (a === 0) continue;
    const used = usedToday[kind];
    const label = CS_LIMIT_LABELS[kind];
    if (a > CS_LIMITS[kind]) {
      return { ok: false, kind, scope: 'once', limit: CS_LIMITS[kind], used, amount: a,
        message: `CS 한 번 상한을 넘는다 — ${label}는 한 번에 ${n(CS_LIMITS[kind])}까지(이번 ${n(a)}). 더 큰 지급은 관리자에게` };
    }
    if (used + a > CS_DAILY_LIMITS[kind]) {
      return { ok: false, kind, scope: 'daily', limit: CS_DAILY_LIMITS[kind], used, amount: a,
        message: `CS 하루 합계를 넘는다 — ${label}는 오늘 ${n(CS_DAILY_LIMITS[kind])}까지, 이미 ${n(used)} · 이번 ${n(a)}`
          + `(남은 ${n(Math.max(0, CS_DAILY_LIMITS[kind] - used))}). 지급과 우편 보상을 함께 센다` };
    }
  }
  return { ok: true };
}

/** CS 하루의 시작 — 게임의 「하루」(`raidDay`, KST)와 같은 경계. 날짜 셈을 두 벌 적지 않는다 */
export const csDayStartMs = (nowMs: number): number =>
  Date.parse(`${raidDay(nowMs)}T00:00:00Z`) - RAID.dayUtcOffsetHours * 3_600_000;

// ── 계정 상세가 보여 주는 진행 상태 (2026-10-31) ─────────────────
//
// CS 문의 「출정하기가 안 열린다」에 답하려고 — 화면이 규칙을 다시 짓지 않게 게임과 같은 함수(`sortieGate` · `tutorialStatus` ·
// `garrisonOf`)가 낸 값만 싣는다. 수비군의 전투력 · 갱신 시각은 서버가 `defenses` 표에서 더한다(여기는 계정만 본다).

/** 계정 상세의 진행 상태 — `UserDetail.play` */
export interface AdminPlayStatus {
  /** [출정하기]를 막는 첫 이유(`sortieGate`) — 열려 있으면 `null`. `code`는 `SORTIE_REASONS` 가운데 하나 */
  sortie: { code: string; message: string } | null;
  tutorial: {
    /** 기본 셋 — 끝낸 순서와 상관없이 `BASIC_TUTORIALS` 차례로 */
    basics: { id: string; done: boolean }[];
    /** S급 — 끝낸 수 · 보유해서 열린(또는 끝낸) 수 · 전부 */
    sDone: number;
    sOwned: number;
    sTotal: number;
  };
  /** 모드마다 지금 서는 수비군 — 부대가 없으면 `squad: null` */
  garrisons: {
    mode: BattleMode;
    squad: { id: string; name: string } | null;
    /** 사람이 고른 부대인가 — 아니면 그 모드의 첫 부대가 저절로 선다 */
    picked: boolean;
    /** 방침을 고친 탭 — 비면 전부 기본(그때그때 낸다) */
    customPolicy: ('stances' | 'tactics' | 'skills')[];
  }[];
}

export function adminPlayStatus(profile: PlayerProfile): AdminPlayStatus {
  const gate = sortieGate(profile);
  const sIds = S_TUTORIAL_OFFICERS.map(sTutorialId);
  const sStatus = sIds.map((id) => tutorialStatus(profile, id));
  return {
    sortie: gate.ok ? null : { code: gate.code ?? '', message: gate.reason },
    tutorial: {
      basics: BASIC_TUTORIALS.map((id) => ({ id, done: tutorialDone(profile, id) })),
      sDone: sStatus.filter((s) => s === 'done').length,
      sOwned: sStatus.filter((s) => s !== 'hidden').length,
      sTotal: sIds.length,
    },
    garrisons: GARRISON_MODES.map((mode) => {
      const squad = garrisonOf(profile, mode);
      const policy = squad?.policy;
      return {
        mode,
        squad: squad ? { id: squad.id, name: squad.name } : null,
        picked: !!squad && profile.garrison?.[mode] === squad.id,
        customPolicy: (['stances', 'tactics', 'skills'] as const).filter((k) => policy?.[k] !== undefined),
      };
    }),
  };
}
