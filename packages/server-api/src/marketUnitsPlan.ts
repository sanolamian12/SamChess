/**
 * 시장 아이템 낱개 추적표의 **계획** — 순수 함수(DB · 시계 없음). 설명과 쓰는 자리는 `marketItems.ts`.
 */
import { marketItemById } from '@samchess/data';
import type { PlayerProfile } from '@samchess/meta';

export type UnitStatus = 'held' | 'inPlay' | 'used' | 'removed';
/** 어디서 왔나 — `baseline`은 추적표가 생기기 전부터 있던 것, `outside`는 장부 밖에서 생긴 것 */
export type MarketUnitOrigin = 'buy' | 'admin' | 'mail' | 'dev' | 'baseline' | 'outside' | 'other' | 'none';
export type UnitFlag = 'gold' | 'noSource' | 'phantom';

/** 아직 끝나지 않은 낱개 — 보유 중이거나 판에 나가 있다 */
export interface LiveUnit {
  unit: string;
  item: string;
  seq: number;
  status: 'held' | 'inPlay';
  holder: string | null;
  usedBy: string | null;
  usedBattle: string | null;
}

export interface NewUnit {
  unit: string;
  item: string;
  seq: number;
  origin: MarketUnitOrigin;
  status: 'held' | 'inPlay';
  boughtAt: number | null;
  goldBefore: number | null;
  goldAfter: number | null;
  price: number | null;
  holder: string | null;
  usedBy: string | null;
  usedBattle: string | null;
  flag: UnitFlag | null;
}

export type UnitChange =
  | { unit: string; kind: 'hand'; holder: string | null }
  | { unit: string; kind: 'play'; usedBy: string; usedBattle: string }
  | { unit: string; kind: 'back' }
  | { unit: string; kind: 'used' }
  | { unit: string; kind: 'removed' };

export interface Plan {
  creates: NewUnit[];
  changes: UnitChange[];
  /** 걸린 것 — 그 자리에서 이상 징후로 */
  flags: { flag: UnitFlag; item: string; units: string[]; detail: Record<string, unknown> }[];
}

/** 이번 단계가 무엇이었나 — 새 낱개의 출처와 금화 대조가 여기서 갈린다 */
export interface PlanContext {
  /** 요청 경로(`POST /market/items`) · `baseline` · `outside` · `sync` */
  source: string;
  goldBefore: number;
  goldAfter: number;
}

const BUY_ROUTES = new Set(['POST /market/item', 'POST /market/items']);
const ORIGIN_OF: Record<string, MarketUnitOrigin> = {
  'POST /admin/users/:uid/adjust': 'admin',
  'POST /mail/:id/claim': 'mail',
  'POST /dev/grant': 'dev',
  baseline: 'baseline',
  outside: 'outside',
};
const originOf = (source: string): MarketUnitOrigin => (BUY_ROUTES.has(source) ? 'buy' : ORIGIN_OF[source] ?? 'other');

/** 시장 아이템을 한 칸이라도 들고 있나 — 아무 데도 없으면 추적표를 안 연다 */
export const hasMarket = (p: PlayerProfile | null): boolean =>
  !!p && (Object.keys(p.marketOwned ?? {}).length > 0 || (p.marketInPlay?.length ?? 0) > 0 || Object.keys(p.marketCarry ?? {}).length > 0);

/**
 * 살아 있는 낱개(`live`)를 계정(`target`)에 맞추는 계획 — **순수 함수**다(시험이 DB 없이 민다).
 * `nextSeq`는 종류마다 다음 번호(끝난 낱개까지 센 것), 고친다.
 */
export function planUnits(
  live: readonly LiveUnit[], target: PlayerProfile, nextSeq: Map<string, number>, ctx: PlanContext,
): Plan {
  const plan: Plan = { creates: [], changes: [], flags: [] };
  const units = live.map((u) => ({ ...u }));
  const owned = target.marketOwned ?? {};
  const inPlay = target.marketInPlay ?? [];
  const carry = target.marketCarry ?? {};
  const items = new Set<string>([...units.map((u) => u.item), ...Object.keys(owned), ...inPlay.map((x) => x.item), ...Object.values(carry).filter(Boolean) as string[]]);
  const origin = originOf(ctx.source);
  // 금화 대조 — 이 단계에서 산 것들의 값을 차례로 뺀다
  let gold = ctx.goldBefore;
  let bought = 0;
  const boughtUnits: string[] = [];

  const mint = (item: string, status: 'held' | 'inPlay', o: MarketUnitOrigin, extra: Partial<NewUnit>): NewUnit => {
    const seq = nextSeq.get(item) ?? 1;
    nextSeq.set(item, seq + 1);
    const row: NewUnit = {
      unit: `${item}#${seq}`, item, seq, origin: o, status, boughtAt: null, goldBefore: null, goldAfter: null, price: null,
      holder: null, usedBy: null, usedBattle: null, flag: null, ...extra,
    };
    plan.creates.push(row);
    units.push({ unit: row.unit, item, seq, status, holder: row.holder, usedBy: row.usedBy, usedBattle: row.usedBattle });
    return row;
  };

  for (const item of [...items].sort()) {
    const mine = () => units.filter((u) => u.item === item).sort((a, b) => a.seq - b.seq);
    const wantHeld = Math.max(0, owned[item] ?? 0);
    // ── A. 판에서 돌아왔나 — 계정의 판 목록에 없는 「판에 나간 낱개」
    const wantPlay = inPlay.filter((x) => x.item === item).map((x) => `${x.officer}|${x.battle}`);
    const left: typeof units = [];
    for (const u of mine().filter((x) => x.status === 'inPlay')) {
      const i = wantPlay.indexOf(`${u.usedBy}|${u.usedBattle}`);
      if (i >= 0) wantPlay.splice(i, 1); else left.push(u);
    }
    // 보유가 모자란 만큼은 **환불**(판이 무름)이고, 나머지는 **쓰였다**
    const heldNow = mine().filter((x) => x.status === 'held').length;
    const refunds = Math.min(left.length, Math.max(0, wantHeld - heldNow));
    left.forEach((u, i) => {
      if (i < refunds) {
        u.status = 'held'; u.usedBy = null; u.usedBattle = null; u.holder = null;
        plan.changes.push({ unit: u.unit, kind: 'back' });
      } else {
        u.status = 'used' as never;
        plan.changes.push({ unit: u.unit, kind: 'used' });
      }
    });
    // ── B. 새로 판에 나간 것 — 그 장수가 들고 있던 낱개, 없으면 아무도 안 든 오래된 것, 그래도 없으면 **낱개 없이 사용**
    for (const key of wantPlay) {
      const [officer, battle] = key.split('|') as [string, string];
      const held = mine().filter((x) => x.status === 'held');
      const u = held.find((x) => x.holder === officer) ?? held.find((x) => x.holder === null) ?? held[0];
      if (u) {
        u.status = 'inPlay'; u.usedBy = officer; u.usedBattle = battle;
        plan.changes.push({ unit: u.unit, kind: 'play', usedBy: officer, usedBattle: battle });
      } else {
        const row = mint(item, 'inPlay', 'none', { usedBy: officer, usedBattle: battle, flag: 'phantom' });
        plan.flags.push({ flag: 'phantom', item, units: [row.unit], detail: { officer, battle, source: ctx.source } });
      }
    }
    // ── C. 보유 수 맞추기 — 늘었으면 새 낱개(출처는 이 단계의 길), 줄었으면 아무도 안 든 오래된 것부터 빠진다
    let held = mine().filter((x) => x.status === 'held');
    if (wantHeld > held.length) {
      const dates = [...(target.marketBoughtAt?.[item] ?? [])].sort((a, b) => a - b);
      const added: string[] = [];
      for (let i = held.length; i < wantHeld; i++) {
        if (origin === 'buy') {
          const price = marketItemById.get(item)?.gold ?? 0;
          const row = mint(item, 'held', 'buy', { price, goldBefore: gold, goldAfter: gold - price, boughtAt: dates.at(-(wantHeld - i)) ?? null });
          gold -= price;
          bought += price;
          boughtUnits.push(row.unit);
        } else {
          // 처음 본 것은 계정에 남은 구매 시각을 오래된 것부터 붙인다
          const at = origin === 'baseline' ? dates[i] ?? null : dates.at(-(wantHeld - i)) ?? null;
          added.push(mint(item, 'held', origin, { boughtAt: at, flag: origin === 'other' || origin === 'outside' ? 'noSource' : null }).unit);
        }
      }
      if (added.length > 0 && (origin === 'other' || origin === 'outside')) {
        plan.flags.push({ flag: 'noSource', item, units: added, detail: { source: ctx.source, count: added.length } });
      }
    } else if (wantHeld < held.length) {
      const order = [...held.filter((x) => x.holder === null), ...held.filter((x) => x.holder !== null)];
      for (const u of order.slice(0, held.length - wantHeld)) {
        u.status = 'removed' as never;
        plan.changes.push({ unit: u.unit, kind: 'removed' });
      }
    }
    // ── D. 들고 갈 장수 — 바뀐 낱개에 양도일
    held = mine().filter((x) => x.status === 'held');
    const carriers = (Object.keys(carry) as string[]).filter((o) => carry[o as keyof typeof carry] === item).sort();
    for (const u of held) {
      if (u.holder !== null && !carriers.includes(u.holder)) {
        u.holder = null;
        plan.changes.push({ unit: u.unit, kind: 'hand', holder: null });
      }
    }
    for (const officer of carriers) {
      if (held.some((x) => x.holder === officer)) continue;
      const free = held.find((x) => x.holder === null);
      if (!free) continue;   // 가진 것보다 많이 들려 보냈다 — 서버가 이미 걷는다(`fitCarry`)
      free.holder = officer;
      plan.changes.push({ unit: free.unit, kind: 'hand', holder: officer });
    }
  }

  if (origin === 'buy' && boughtUnits.length > 0 && ctx.goldBefore - ctx.goldAfter !== bought) {
    for (const c of plan.creates) if (boughtUnits.includes(c.unit)) c.flag = 'gold';
    plan.flags.push({
      flag: 'gold', item: '*', units: boughtUnits,
      detail: { source: ctx.source, price: bought, goldBefore: ctx.goldBefore, goldAfter: ctx.goldAfter, spent: ctx.goldBefore - ctx.goldAfter },
    });
  }
  return plan;
}

