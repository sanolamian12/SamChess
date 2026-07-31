/**
 * 시드 기반 난수 — 재현 가능한 전투의 토대 (GDD §3.3, §3.5)
 *
 * `Math.random()`은 룰 엔진에서 금지다. 모든 판정은 여기를 지난다.
 *
 * **카운터 기반(counter-based) 설계**를 택했다. 내부 상태를 굴리는 대신
 * `(seed, cursor) → 값`을 순수 해시로 계산한다. 그래서
 *
 *  - `BattleState`가 들고 있는 `seed`와 `rngCursor`만으로 난수열이 완전히 결정된다.
 *  - 상태를 직렬화·복제해도 난수 상태가 따라 흐트러지지 않는다(재접속·리플레이).
 *  - 임의 지점으로 점프할 수 있어 특정 판정만 재현해 디버깅할 수 있다.
 *
 * 소비할 때마다 `rngCursor`가 1 증가한다. 소비 순서가 곧 재현성이므로
 * **판정 순서를 바꾸면 같은 시드라도 결과가 달라진다.** 순서를 바꿀 땐 의도한 것인지 확인할 것.
 */

/** 난수를 소비할 수 있는 것 — 실질적으로 BattleState */
export interface RngSource {
  readonly seed: number;
  rngCursor: number;
}

/** splitmix32 — (seed, cursor) → uint32. 순수 함수 */
export function hash32(seed: number, cursor: number): number {
  let z = (seed + Math.imul(cursor, 0x9e3779b9)) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** 커서를 소비하지 않는 조회. [0, 1) */
export function floatAt(seed: number, cursor: number): number {
  return hash32(seed, cursor) / 0x1_0000_0000;
}

/** [0, 1) 실수 하나를 소비한다. */
export function nextFloat(rng: RngSource): number {
  return floatAt(rng.seed, rng.rngCursor++);
}

/** [0, n) 정수 하나를 소비한다. */
export function nextInt(rng: RngSource, n: number): number {
  if (n <= 0) throw new RangeError(`nextInt 범위가 잘못됨: ${n}`);
  return Math.floor(nextFloat(rng) * n) % n;
}

/** 배열에서 하나를 고른다. 빈 배열은 호출자 책임. */
export function pick<T>(rng: RngSource, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('빈 배열에서 뽑을 수 없다');
  return items[nextInt(rng, items.length)]!;
}

/**
 * 확률(%) 판정. **항상 난수를 1개 소비한다** — 0%/100%라고 건너뛰면
 * 이후 판정의 커서가 밀려 재현성이 깨진다.
 *
 * `rate <= 0`이면 절대 성공하지 않고, `rate >= 100`이면 반드시 성공한다 (GDD §3.5 clamp 규약).
 */
export function roll(rng: RngSource, ratePercent: number): boolean {
  return nextFloat(rng) * 100 < ratePercent;
}

/** Fisher–Yates. 원본을 바꾸지 않는다. */
export function shuffle<T>(rng: RngSource, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
