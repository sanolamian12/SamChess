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
import { EQUIPMENT, MARKET_ITEMS, officerById } from '@samchess/data';
import { grainCap } from './city.ts';
import { forgeItemKey } from './forge.ts';
import { carriedCount, marketHeldCount } from './market.ts';
import { addCard } from './profile.ts';
import type { PlayerProfile } from './types.ts';
import type { OfficerId } from '@samchess/rules';

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
