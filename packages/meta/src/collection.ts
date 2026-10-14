/**
 * 컬렉션 — 대자보 [컬렉션 보기] (2026-10-13 기획 확정, `Design/컬렉션_기획.md`).
 *
 * ────────────────────────────────────────────────────────────────
 * 확정 규칙 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 1. **칸마다 하나씩 채운다 · 부분 등록 가능 · 되돌릴 수 없다.** 모든 칸이 차야 완성이고
 *    그때 점수와 효과가 생긴다(부분 등록은 아무것도 없다).
 * 2. **장수 카드는 여분이 1장이라도 있으면** 낼 수 있고 **여분만** 쓴다 — 본체는 빠지지 않는다.
 *    「여분」은 풀의 장수면 `cards` 그대로, **보관함의 장수면 `cards − 1`**이다 — 보관함의
 *    장수는 본체가 카드 한 장으로 들어 있다(`boxedOfficers`). 그 한 장까지 내면 장수가 사라진다.
 * 3. **병기는 미지급 자루만** 낸다. 낸 자루는 `forgeOwned`에서 빠지므로 대장간의 종류당 상한
 *    (`forgeCopiesOwned`)이 저절로 「만든 수 − 낸 수」가 된다 — 따로 세는 칸이 없다.
 * 4. **아이템은 이번 판에 들려 보낼 것(`marketCarry`)을 뺀 수량**만 낸다. 가장 오래 산 것부터 빠진다.
 *
 * ────────────────────────────────────────────────────────────────
 * 개인 값은 계정에, 집계 값은 서버에
 * ────────────────────────────────────────────────────────────────
 *
 * 「내가 무엇을 채웠나 · 내 점수」는 프로필(`collection`)에서 바로 낸다 — 들어갈 때 기다림이 없다.
 * 서버 내 순위만 서버 조회다. **점수는 저장하지 않는다** — `completedAt`에서 낸다(「한 번만 세고
 * 합으로 낸다」). 저장하면 데이터의 점수가 바뀔 때 계정마다 옛 값이 남는다.
 *
 * 등록은 **서버가 판정한다**(`POST /collection/register`) — 카드 · 병기 · 아이템이 전부 서버 소유
 * 필드라 `PUT`으로 올리면 버려진다. 이 파일의 함수는 순수하고 시계는 밖에서 받는다.
 */

import { COLLECTIONS, collectionById, equipmentById, marketItemById, officerById } from '@samchess/data';
import type { CollectionData, CollectionSlotData } from '@samchess/data';
import type { OfficerId, RosterBonus } from '@samchess/rules';
import { equipmentIdOfKey } from './forge.ts';
import { carriedCount, marketHeldCount } from './market.ts';
import type { CollectionProgress, MetaResult, PlayerProfile } from './types.ts';

const EMPTY: CollectionProgress = { slots: {}, completedAt: {} };

/** 읽는 자리는 이 함수 하나 — 옛 계정에는 필드가 없다 */
export const collectionOf = (profile: PlayerProfile): CollectionProgress => profile.collection ?? EMPTY;

export const filledSlots = (profile: PlayerProfile, id: string): readonly number[] => collectionOf(profile).slots[id] ?? [];

export type CollectionStatus = 'none' | 'partial' | 'done';

export function collectionStatus(profile: PlayerProfile, c: CollectionData): CollectionStatus {
  if (collectionOf(profile).completedAt[c.id] !== undefined) return 'done';
  return filledSlots(profile, c.id).length > 0 ? 'partial' : 'none';
}

// ── 칸 하나 ─────────────────────────────────────────────────────

/** 장수의 **여분** 카드 — 풀의 장수는 `cards` 그대로, 보관함의 장수는 본체 한 장을 뺀다 (머리말 ★2) */
export function spareCards(profile: PlayerProfile, officer: string): number {
  const n = profile.cards[officer as OfficerId] ?? 0;
  return profile.roster[officer as OfficerId] ? n : Math.max(0, n - 1);
}

/** 그 병기의 **미지급** 자루 키 — 번호가 큰 것부터(먼저 만든 자루가 남는다) */
export function spareWeaponKeys(profile: PlayerProfile, equipmentId: string): string[] {
  return Object.entries(profile.forgeOwned)
    .filter(([key, holder]) => holder === null && equipmentIdOfKey(key) === equipmentId)
    .map(([key]) => key)
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
}

/** 그 아이템 중 낼 수 있는 수 — 들려 보낼 예약을 뺀다 */
export const spareItems = (profile: PlayerProfile, item: string): number =>
  Math.max(0, marketHeldCount(profile, item) - carriedCount(profile, item));

/**
 * 칸 하나의 상태 — 화면의 홀더가 이것만 그린다.
 *  - `done` 등록됨 · `ready` 지금 낼 수 있음 · `blocked` 못 냄(`reason`이 이유)
 *  - `have`는 홀더에 적는 「여분 / 보유」 수
 */
export type SlotBlock = 'noSpare' | 'notOwned' | 'equipped' | 'carried';
export interface SlotState {
  state: 'done' | 'ready' | 'blocked';
  reason?: SlotBlock;
  have: number;
}

export function slotState(profile: PlayerProfile, c: CollectionData, index: number): SlotState {
  const slot = c.slots[index]!;
  const done = filledSlots(profile, c.id).includes(index);
  if (slot.kind === 'card') {
    const have = spareCards(profile, slot.id);
    if (done) return { state: 'done', have };
    if (have > 0) return { state: 'ready', have };
    const owned = !!profile.roster[slot.id as OfficerId] || (profile.cards[slot.id as OfficerId] ?? 0) > 0;
    return { state: 'blocked', reason: owned ? 'noSpare' : 'notOwned', have };
  }
  if (slot.kind === 'weapon') {
    const have = spareWeaponKeys(profile, slot.id).length;
    if (done) return { state: 'done', have };
    if (have > 0) return { state: 'ready', have };
    const owned = Object.keys(profile.forgeOwned).some((k) => equipmentIdOfKey(k) === slot.id);
    return { state: 'blocked', reason: owned ? 'equipped' : 'notOwned', have };
  }
  const have = spareItems(profile, slot.id);
  if (done) return { state: 'done', have };
  if (have > 0) return { state: 'ready', have };
  return { state: 'blocked', reason: marketHeldCount(profile, slot.id) > 0 ? 'carried' : 'notOwned', have };
}

// ── 목록 줄 ─────────────────────────────────────────────────────

export interface CollectionRow {
  collection: CollectionData;
  status: CollectionStatus;
  filled: number;
  total: number;
  /** 지금 낼 수 있는 빈칸 수 */
  ready: number;
  /** 지금 가진 것으로도 못 채우는 빈칸 수 — 0이면 「지금 바로 완성할 수 있다」 */
  missing: number;
}

export function collectionRows(profile: PlayerProfile): CollectionRow[] {
  return COLLECTIONS.map((c) => {
    const states = c.slots.map((_, i) => slotState(profile, c, i).state);
    const filled = states.filter((s) => s === 'done').length;
    const ready = states.filter((s) => s === 'ready').length;
    return {
      collection: c, status: collectionStatus(profile, c), filled, total: c.slots.length,
      ready, missing: c.slots.length - filled - ready,
    };
  });
}

export type CollectionSort = 'era' | 'points' | 'reach';
export const COLLECTION_SORTS: readonly CollectionSort[] = ['era', 'points', 'reach'];

/**
 * 정렬 셋 (기획자 지정).
 *  - `era` 시대순 — 엑셀의 번호(처음 기본)
 *  - `points` 점수순 — 점수 큰 것부터, 같으면 시대순 (2026-10-14 「등급순」에서 바꿨다 — 화면에 등급을 안 띄운다)
 *  - `reach` 달성조건순 — 완성은 맨 뒤 · **못 채우는 칸이 적은 것** → **지금 낼 수 있는 칸이 많은 것** → 시대순.
 *    같은 여분 카드 한 장이 여러 컬렉션에서 「낼 수 있음」으로 셀 수 있다 — 컬렉션마다 따로 잰다
 */
export function sortCollections(rows: readonly CollectionRow[], sort: CollectionSort): CollectionRow[] {
  const era = (a: CollectionRow, b: CollectionRow): number => a.collection.no - b.collection.no;
  const out = [...rows];
  if (sort === 'era') return out.sort(era);
  if (sort === 'points') return out.sort((a, b) => b.collection.points - a.collection.points || era(a, b));
  return out.sort((a, b) =>
    Number(a.status === 'done') - Number(b.status === 'done')
    || a.missing - b.missing
    || b.ready - a.ready
    || era(a, b));
}

/**
 * 검색 — 타이틀 · 한자 · 설명 · **요건의 장수 · 품목 이름**(「관우」를 치면 관우가 든 컬렉션이 다 뜬다).
 * 화면이 표시 언어의 이름을 `extra`로 더 넘긴다 — meta는 한국어 이름만 안다.
 */
export function searchCollections(
  rows: readonly CollectionRow[],
  query: string,
  extra?: (c: CollectionData) => readonly string[],
): CollectionRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter(({ collection: c }) => {
    const hay = [c.title, c.displayTitle, c.hanja, c.desc, ...c.slots.map(slotName), ...(extra?.(c) ?? [])];
    return hay.some((s) => s.toLowerCase().includes(q));
  });
}

/** 칸의 한국어 이름 — 장수 · 병기 · 아이템 */
export function slotName(slot: CollectionSlotData): string {
  if (slot.kind === 'card') return officerById.get(slot.id)?.name ?? slot.id;
  if (slot.kind === 'weapon') return equipmentById.get(slot.id)?.name ?? slot.id;
  return marketItemById.get(slot.id)?.name ?? slot.id;
}

/** 요건을 종류별로 센다 — 목록 첫 줄의 「🂠×2 ✦×1」 */
export function slotCounts(c: CollectionData): Record<CollectionSlotData['kind'], number> {
  const n = { card: 0, weapon: 0, item: 0 };
  for (const s of c.slots) n[s.kind] += 1;
  return n;
}

// ── 요약 (상단 패널) ────────────────────────────────────────────

export interface CollectionSummary {
  done: number;
  partial: number;
  total: number;
  points: number;
  maxPoints: number;
  /** 지금까지 낸 것 — 카드는 등급별 */
  invested: { cards: Record<string, number>; weapons: number; items: number };
}

export function collectionSummary(profile: PlayerProfile): CollectionSummary {
  const prog = collectionOf(profile);
  const invested = { cards: {} as Record<string, number>, weapons: 0, items: 0 };
  let done = 0; let partial = 0; let points = 0;
  for (const c of COLLECTIONS) {
    const filled = prog.slots[c.id] ?? [];
    if (prog.completedAt[c.id] !== undefined) { done += 1; points += c.points; } else if (filled.length) partial += 1;
    for (const i of filled) {
      const s = c.slots[i];
      if (!s) continue;
      if (s.kind === 'card') {
        const g = officerById.get(s.id)?.grade ?? '?';
        invested.cards[g] = (invested.cards[g] ?? 0) + 1;
      } else if (s.kind === 'weapon') invested.weapons += 1;
      else invested.items += 1;
    }
  }
  return {
    done, partial, total: COLLECTIONS.length, points,
    maxPoints: COLLECTIONS.reduce((n, c) => n + c.points, 0), invested,
  };
}

/** 점수 — 완성한 것의 합. 랭킹이 이 값을 쓴다 */
export const collectionPoints = (profile: PlayerProfile): number => collectionSummary(profile).points;

// ── 서버 순위 (컬렉션 화면의 [랭킹 보기], 2026-10-13) ─────────────────────

/** 컬렉션 랭킹 팝업이 1~10등을 보인다 */
export const COLLECTION_RANK_TOP = 10;

export interface CollectionRankRow {
  /** 1부터 — 동점이 없도록 순서를 끝까지 정하므로 같은 등수는 없다 */
  rank: number;
  cityName: string;
  points: number;
  done: number;
}

/**
 * 컬렉션 순위 — 점수 큰 순 → 완성 수 많은 순 → **마지막 완성이 이른 순**(같은 점수에 먼저 닿은 쪽) → 도시 이름.
 * 도시 이름은 계정 사이에 고유해서(`profiles_city_name_key`) 순서가 끝까지 정해진다. **점수 0은 줄에 안 선다** —
 * 아무것도 완성 안 한 계정 수천이 같은 꼴찌로 서면 「몇 위」가 뜻이 없다.
 * 서버(`GET /ranking/collection`)가 전체 계정을 훑어 부르고, 화면은 그 결과를 그린다.
 */
export function collectionRankRows(profiles: readonly PlayerProfile[]): CollectionRankRow[] {
  return profiles
    .map((p) => {
      const s = collectionSummary(p);
      const at = Object.values(collectionOf(p).completedAt);
      return { cityName: p.cityName, points: s.points, done: s.done, lastAt: at.length ? Math.max(...at) : 0 };
    })
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || b.done - a.done || a.lastAt - b.lastAt
      || (a.cityName < b.cityName ? -1 : a.cityName > b.cityName ? 1 : 0))
    .map((r, i) => ({ rank: i + 1, cityName: r.cityName, points: r.points, done: r.done }));
}

// ── 등록 ────────────────────────────────────────────────────────

export function canRegisterSlot(profile: PlayerProfile, id: string, index: number): MetaResult {
  const c = collectionById.get(id);
  if (!c) return { ok: false, reason: `모르는 컬렉션이다 — ${id}` };
  if (!Number.isInteger(index) || index < 0 || index >= c.slots.length) {
    return { ok: false, reason: `「${c.title}」에 ${index}번 칸이 없다` };
  }
  const s = slotState(profile, c, index);
  if (s.state === 'done') return { ok: false, reason: '이미 등록한 칸이다' };
  if (s.state === 'blocked') {
    const name = slotName(c.slots[index]!);
    const why: Record<SlotBlock, string> = {
      noSpare: `${name}의 여분 카드가 없다`,
      notOwned: `${name}을(를) 가지고 있지 않다`,
      equipped: `${name}이(가) 모두 장수에게 지급되어 있다 — 대장간에서 해제한다`,
      carried: `${name}이(가) 이번 판에 들려 보낼 예정이다`,
    };
    return { ok: false, reason: why[s.reason!] };
  }
  return { ok: true };
}

/**
 * 칸 하나를 채운다 — 카드 · 병기 · 아이템을 하나 소모하고, 마지막 칸이면 완성 시각을 찍는다.
 * **부르는 자리는 서버다**(`server-api`의 `/collection/register`). 거부는 던진다.
 */
export function applyRegisterSlot(profile: PlayerProfile, id: string, index: number, nowMs: number): PlayerProfile {
  const ok = canRegisterSlot(profile, id, index);
  if (!ok.ok) throw new Error(ok.reason);
  const c = collectionById.get(id)!;
  const slot = c.slots[index]!;
  let next: PlayerProfile = { ...profile };

  if (slot.kind === 'card') {
    const cards = { ...profile.cards };
    const left = (cards[slot.id as OfficerId] ?? 0) - 1;
    if (left > 0) cards[slot.id as OfficerId] = left; else delete cards[slot.id as OfficerId];
    next.cards = cards;
  } else if (slot.kind === 'weapon') {
    const key = spareWeaponKeys(profile, slot.id)[0]!;
    const { [key]: _owned, ...forgeOwned } = profile.forgeOwned;
    next.forgeOwned = forgeOwned;
    if (profile.forgeMadeAt && key in profile.forgeMadeAt) {
      const { [key]: _made, ...forgeMadeAt } = profile.forgeMadeAt;
      next.forgeMadeAt = forgeMadeAt;
    }
  } else {
    const owned = { ...profile.marketOwned };
    const left = (owned[slot.id] ?? 0) - 1;
    if (left > 0) owned[slot.id] = left; else delete owned[slot.id];
    next.marketOwned = owned;
    const dates = profile.marketBoughtAt?.[slot.id];
    if (dates?.length) next.marketBoughtAt = { ...profile.marketBoughtAt, [slot.id]: dates.slice(1) };
  }

  const prog = collectionOf(profile);
  const filled = [...(prog.slots[id] ?? []), index].sort((a, b) => a - b);
  const complete = filled.length === c.slots.length;
  next = {
    ...next,
    collection: {
      slots: { ...prog.slots, [id]: filled },
      completedAt: complete ? { ...prog.completedAt, [id]: nowMs } : prog.completedAt,
    },
  };
  return next;
}

// ── 전투 효과 ───────────────────────────────────────────────────

/**
 * 이 장수가 판에 들고 갈 컬렉션 효과 — `toRosterEntries()`만 부른다 (2026-10-14, 기획 §3.3).
 *
 * **`atMs` 이전에 완성된 것만** 싣는다 — 판의 시작 시각을 넣는다. 태학 `doneAt`과 같은 이유다:
 * 판 도중에 완성된 것이 서버의 AI 재생에만 실리면 정상 플레이가 거부된다.
 *
 * 붙이는 규칙:
 *  - 능력치 · 고유기술 SP → `who`에 든 장수에게
 *  - 진영 SP → `with`에 든 장수 **각각**에게 (엔진이 진영마다 가장 큰 값 하나만 쓴다 — 배지도 그 장수들에게 뜬다)
 *  - 도시 효과 → 판에 안 간다
 *
 * 조건은 여기서 판정하지 않는다 — 상대 명단을 아는 것은 `createBattle`뿐이다.
 */
export function collectionBonusesFor(profile: PlayerProfile, officer: string, atMs: number): RosterBonus[] {
  const done = collectionOf(profile).completedAt;
  const out: RosterBonus[] = [];
  for (const c of COLLECTIONS) {
    const at = done[c.id];
    if (at === undefined || at > atMs) continue;
    const e = c.effect;
    const cond = {
      ...('with' in e && e.with ? { with: e.with as OfficerId[] } : {}),
      ...('min' in e && e.min ? { min: e.min } : {}),
      ...('vs' in e && e.vs ? { vs: e.vs as OfficerId[] } : {}),
    };
    if (e.kind === 'stat' && e.who.includes(officer)) {
      out.push({ source: c.id, kind: 'stat', stat: e.stat, value: e.value, ...cond });
    } else if (e.kind === 'skillSp' && e.who.includes(officer)) {
      out.push({ source: c.id, kind: 'skillSp', skill: e.skill, delta: e.delta });
    } else if (e.kind === 'teamSp' && e.with?.includes(officer)) {
      out.push({ source: c.id, kind: 'teamSp', value: e.value, ...cond });
    }
  }
  return out;
}
