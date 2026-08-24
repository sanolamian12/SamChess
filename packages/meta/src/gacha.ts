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
import { cardsSpentOn } from './profile.ts';
import type { PlayerProfile } from './types.ts';

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
