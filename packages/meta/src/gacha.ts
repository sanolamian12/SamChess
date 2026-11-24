/**
 * 상점 가챠 — "계정별 유한 랜덤 어레이" (트랙 9,
 * `history/2026-08-21_트랙9_가격정책_초안.md` §4에서 확정)
 *
 * 무한 가챠를 막는다 — 계정마다 등급 풀(S·A·B·E, GDD §6.2)의 카드를 섞은 **유한
 * 배열**을 만들고, 뽑을 때마다 복원 없이 하나씩 빼낸다. 배열이 다 빠지면 그 등급
 * 가챠는 더 이상 못 한다(실측상 25,200장을 다 뽑으려면 현실적인 과금으로 불가능한
 * 규모라 — 정상 상한이 아니라 매크로 남용을 막는 안전장치다).
 *
 * ────────────────────────────────────────────────────────────────
 * 배열을 저장하지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 25,200장짜리 배열을 계정마다 통째로 저장하는 대신, `seed` 하나로 **같은 순서를
 * 언제나 다시 셔플해 낸다**(`@samchess/rules`의 `shuffle`) — 전투가 로그 대신
 * `seed`·`rngCursor`만 들고 다니는 것과 같은 결이다(CLAUDE.md 「룰 엔진에서
 * `Math.random()` 금지」). `drawn`개를 건너뛴 나머지가 곧 "남은 배열"이므로
 * 서버가 계정 하나에 정수 둘(`seed`, `drawn`)만 들고 있으면 충분하다.
 *
 * **`seed`는 첫 가챠 시점에 한 번만 만든다.** 재접속마다 다시 섞으면 "유한하다"는
 * 전제가 깨진다 — `drawGacha()`가 `profile.gachaPool`이 없을 때만 새로 만든다.
 *
 * ────────────────────────────────────────────────────────────────
 * 슬롯 수 = 레벨업 카드 수에서 그대로 끌어온다
 * ────────────────────────────────────────────────────────────────
 *
 * 장수 1명당 슬롯 수는 표를 새로 적지 않는다 — `cardsSpentOn(GROWTH.maxLevel)`
 * (레벨 9까지 드는 누적 카드 수, 지금 100장)에 `economy.json`의
 * `gachaSlotMultiplier`(지금 2)를 곱한다. `growth.json`이 바뀌면 슬롯 수도
 * 따라 바뀌고, 옮겨 적은 값이 없으니 어긋날 자리가 없다.
 */

import { ECONOMY, GROWTH, OFFICERS } from '@samchess/data';
import { shuffle } from '@samchess/rules';
import type { OfficerId } from '@samchess/rules';
import { addCard, cardsSpentOn, isSurplusOfficer, poolSeatsFree } from './profile.ts';
import type { MetaResult, PlayerProfile } from './types.ts';
import { rejectWith } from './reject.ts';


/** 장수 1명당 가챠 배열 슬롯 수 (지금 100 × 2 = 200) */
export const gachaSlotsPerOfficer = (): number => cardsSpentOn(GROWTH.maxLevel) * ECONOMY.gachaSlotMultiplier;

/**
 * 셔플 전, 등급 순 결정적 배열 — 가챠 풀에 든 장수(GDD §6.2, C·D 제외)를
 * 슬롯 수만큼 나열한다. **시드가 없다** — 셔플만 계정마다 갈린다.
 */
export function gachaDeckBase(): OfficerId[] {
  const slots = gachaSlotsPerOfficer();
  const pool = OFFICERS.filter((o) => (ECONOMY.gachaGrades as readonly string[]).includes(o.grade));
  const deck: OfficerId[] = [];
  for (const o of pool) for (let i = 0; i < slots; i++) deck.push(o.id as OfficerId);
  return deck;
}

/** 계정 시드로 결정적으로 섞은 전체 배열. 같은 시드는 언제나 같은 순서다 */
export function shuffledGachaDeck(seed: number): OfficerId[] {
  return shuffle({ seed, rngCursor: 0 }, gachaDeckBase());
}

export interface GachaDrawResult {
  profile: PlayerProfile;
  drawn: OfficerId[];
  /** 배열이 모자라 요청한 수보다 적게 나왔다 — 그 등급 풀이 소진됐다는 뜻 */
  exhausted: boolean;
}

/**
 * 가챠 배열에서 `count`장을 뺀다. 남은 수보다 많이 요청하면 **있는 만큼만** 주고
 * `exhausted: true`를 돌려준다 — 예외를 던지지 않는다(소진은 상한이 아니라
 * 안전장치이므로 도달해도 게임이 멈추면 안 된다).
 *
 * `newSeed`는 **이 계정이 처음 가챠를 도는 경우에만** 쓰인다(`profile.gachaPool`이
 * 없을 때) — `applyBattleResult`가 보상 카드 추첨에 쓰는 시드를 받는 것과 같은
 * 이유로, 이 함수는 `Math.random()`/`Date.now()`를 스스로 읽지 않는 순수 함수로
 * 남는다(CLAUDE.md 「meta에 시계를 들이지 않는다」). 이미 `gachaPool`이 있으면
 * 무시된다 — 재접속마다 다시 섞이면 "유한하다"는 전제가 깨지기 때문이다.
 */
export function drawGacha(profile: PlayerProfile, count: number, newSeed: number): GachaDrawResult {
  if (count <= 0) throw new RangeError(`뽑을 장수는 1장 이상이어야 한다: ${count}`);

  const pool = profile.gachaPool ?? { seed: newSeed, drawn: 0 };
  const deck = shuffledGachaDeck(pool.seed);
  const remaining = deck.length - pool.drawn;
  const take = Math.min(count, Math.max(remaining, 0));
  const drawn = deck.slice(pool.drawn, pool.drawn + take);

  const next: PlayerProfile = { ...profile, gachaPool: { seed: pool.seed, drawn: pool.drawn + take } };
  return { profile: next, drawn, exhausted: take < count };
}

// ── 골드 구매 (상점 UI, 트랙 9) ────────────────────────────────

/**
 * 모집 한 판의 종류 — **1명 · 3명 · 5명** (2026-11-24 기획자 — 용병 시장 개편, 옛 단발 · 8연을 대신한다).
 * 값과 수는 `economy.json`의 `gachaPull`이 정한다.
 */
export const GACHA_PULL_KINDS = ['one', 'three', 'five'] as const;
export type GachaPullKind = typeof GACHA_PULL_KINDS[number];
export const isGachaPullKind = (v: unknown): v is GachaPullKind => (GACHA_PULL_KINDS as readonly unknown[]).includes(v);

/** 뽑기 한 판의 가격·장수. 단일 출처는 `economy.json`의 `gachaPull` */
export function gachaPullCost(kind: GachaPullKind): { gold: number; count: number } {
  const p = ECONOMY.gachaPull[kind];
  return { gold: p.gold, count: p.count };
}

/**
 * 이 계정이 지금 이 모집을 할 수 있는가 — 화면은 이 판정을 다시 적지 않는다.
 *
 * **궁궐의 빈자리가 모집 수보다 적으면 막는다** (2026-11-24 기획자) — 빈자리 2석이면 1명 모집만 열린다. 나온 장수가
 * 전부 새 장수여도 다 등용되므로, 모집에서 「자리가 없어 못 받은 장수」는 생기지 않는다. 자리를 먼저 보고 금화를 본다 —
 * 금화를 채워 봐야 못 하는 것이 더 앞선 사실이다(레벨업의 도시 상한과 같은 차례).
 */
export function canPullGacha(profile: PlayerProfile, kind: GachaPullKind): MetaResult {
  const { gold, count } = gachaPullCost(kind);
  const free = poolSeatsFree(profile);
  if (free < count) return { ok: false, reason: `궁궐에 빈자리가 모자랍니다 — ${free}/${count}석`, code: 'market.recruit.noSeat', params: { free, need: count } };
  if (profile.gold < gold) return { ok: false, reason: `금화가 부족합니다 — ${profile.gold}/${gold}`, code: 'market.notEnoughGold', params: { have: profile.gold, need: gold } };
  return { ok: true };
}

/**
 * 뽑은 한 장이 어디로 갔나 —
 * `new` 새 장수가 풀에 등용됐다 · `card` 이미 거느린(또는 보관함의) 장수의 카드 · `surplus` Lv9 장수의 카드라 잉여 카드가 됐다.
 */
export type GachaFate = 'new' | 'card' | 'surplus';

export interface GachaPullResult {
  profile: PlayerProfile;
  drawn: OfficerId[];
  /** `drawn`과 같은 차례 — 각 장이 어디로 갔나 */
  fates: GachaFate[];
  /** 배열이 모자라 요청한 수보다 적게 나왔다 — `drawGacha`의 결과를 그대로 물려받는다 */
  exhausted: boolean;
}

/**
 * 골드를 내고 뽑아 카드를 계정에 넣는다 — `drawGacha`(배열 소비) + `addCard`(지급)를 한데 묶은 것.
 * **판정(빈자리 · 금화)은 이 함수가 다시 한다** — 화면이 칸을 막아도 최종 판정은 여기다.
 * 빈자리를 미리 봤으므로 새 장수는 전부 풀에 든다. Lv9 장수의 카드는 `addCard`가 잉여 카드로 돌린다.
 *
 * `newSeed`는 `drawGacha`와 같은 이유로 계정이 처음 가챠를 도는 경우에만 쓰인다.
 */
export function buyGacha(profile: PlayerProfile, kind: GachaPullKind, newSeed: number): GachaPullResult {
  const check = canPullGacha(profile, kind);
  if (!check.ok) rejectWith(check);

  const { gold, count } = gachaPullCost(kind);
  const { profile: pulled, drawn, exhausted } = drawGacha(profile, count, newSeed);

  let next: PlayerProfile = { ...pulled, gold: pulled.gold - gold };
  const fates: GachaFate[] = [];
  for (const officer of drawn) {
    const owned = !!next.roster[officer] || (next.cards[officer] ?? 0) > 0;
    fates.push(!owned ? 'new' : isSurplusOfficer(next, officer) ? 'surplus' : 'card');
    next = addCard(next, officer);
  }

  return { profile: next, drawn, fates, exhausted };
}
