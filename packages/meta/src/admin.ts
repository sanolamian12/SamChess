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
import { academyOf } from './academy.ts';
import { fightingAi, forfeitAiBattle } from './aiBattle.ts';
import { HEAL_MS, ROOM_CYCLE_MS, grainCap, healMsOf, injuryHealsAt, isInjured } from './city.ts';
import { forgeItemKey } from './forge.ts';
import { carriedCount, inPlayOf, isCarriedBattle, marketHeldCount, settleCarried } from './market.ts';
import { raidActive, surrenderRaid } from './raid.ts';
import { addCard } from './profile.ts';
import type { CarriedBattle, PlayerProfile } from './types.ts';
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
