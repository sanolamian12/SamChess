/**
 * 도시 — 군량 시간 충전과 증축 (pptx 41쪽 · GDD §5, 2026-08-18)
 *
 * ────────────────────────────────────────────────────────────────
 * 시계는 **밖에서 넣는다** ★
 * ────────────────────────────────────────────────────────────────
 *
 * `@samchess/meta`는 `Date.now()`를 부르지 않는다. 룰 엔진의 재현성 규칙과 같은
 * 이유이기도 하지만, 여기서는 **테스트로 고정하려면 그래야 하기 때문**이다 —
 * 「세 시간 뒤에 군량이 셋 찬다」를 세 시간 기다려 확인할 수는 없다.
 * `screens/backdrop.ts`의 `bandForHour(h)`와 같은 규약이고, C1의 `MatchRow.at`도
 * 같은 이유로 밖에서 받는다. **지금 시각을 넣는 자리는 `client/src/screens/App.tsx`
 * 하나다** — 군량을 읽는 화면이 넷(메인·병영·편성·도시)이라 화면마다 채우면
 * 어느 하나가 낡은 값을 본다.
 *
 * ────────────────────────────────────────────────────────────────
 * 저장 형식은 **필드 하나가 더해질 뿐**이다 (버전은 3 그대로)
 * ────────────────────────────────────────────────────────────────
 *
 * `PlayerProfile.grainAt` 하나뿐이고 기존 필드의 뜻은 바뀌지 않는다. 「버전은 뜻이
 * 바뀔 때만 올린다」(B가 굳힌 계약)에 따라 `PROFILE_VERSION`은 그대로 두고
 * `migrate.ts`가 없는 필드를 0으로 채운다.
 */

import { CITY_LEVELS } from '@samchess/data';
import { cityLevel } from './profile.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

/** 한 시간. 생산량이 「시간당」이라 눈금의 단위가 이것이다 */
export const MS_PER_HOUR = 3_600_000;

/** 도시 최대 레벨 — 데이터가 정한다(지금 9). 화면이 `9`를 적지 않게 */
export const MAX_CITY_LEVEL: number = CITY_LEVELS[CITY_LEVELS.length - 1]!.level;

/** 군량 1이 차는 데 걸리는 시간(ms). Lv1은 한 시간에 하나, Lv9는 9분에 하나 */
export const grainStepMs = (level: number): number => MS_PER_HOUR / cityLevel(level).grainPerHour;

/** 시간당 생산량 · 현재 상한 — 41쪽의 「시간 당 생산량 : 1  현재 xx / 최대 xx」 */
export const grainPerHour = (profile: PlayerProfile): number => cityLevel(profile.cityLevel).grainPerHour;
export const grainCap = (profile: PlayerProfile): number => cityLevel(profile.cityLevel).grainCap;

/**
 * 흘러간 시간만큼 군량을 채운다. **순수 함수** — `nowMs`는 부르는 쪽이 넣는다.
 *
 * ```
 * step   = 1시간 / 시간당 생산량
 * earned = floor((nowMs − grainAt) / step)
 * grain  = min(상한, grain + earned)
 * grainAt += earned × step        ← 나머지를 보존한다
 * ```
 *
 * **바뀐 것이 없으면 같은 객체를 돌려준다.** 부르는 쪽이 `next !== profile`로
 * 저장 여부를 정한다 — 60초마다 부르는데 매번 새 객체를 주면 아무 일도 없는
 * 계정을 분마다 디스크에 쓴다.
 *
 * ────────────────────────────────────────────────────────────────
 * 네 자리가 조용히 틀리기 쉽다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 1. **나머지를 버리면 안 된다.** `grainAt = nowMs`로 찍으면 30분마다 접속하는
 *    사람은 **영원히 한 톨도 못 받는다** — 매번 30분이 잘려 나간다. 번 만큼만
 *    앞으로 밀어 남은 30분이 다음 접속으로 이어지게 한다.
 * 2. **상한에 붙어 있어도 `grainAt`은 전진한다.** 안 그러면 시간이 은행처럼
 *    쌓여, 참가비를 내는 순간 그동안의 몇 시간이 한꺼번에 되돌아온다.
 *    상한은 「더 못 쌓는다」는 뜻이지 「나중에 받는다」가 아니다.
 * 3. **시계가 뒤로 가도 줄지 않고, `grainAt`을 `nowMs`로 당기지도 않는다.**
 *    당기면 시계를 앞뒤로 흔들어 군량을 뽑을 수 있다. 앞선 시각은 **진짜 시간이
 *    따라잡을 때까지** 그대로 둔다 — 사람이 손해 보는 방향이라 안전하다.
 * 4. **`grainAt === 0`은 「아직 정산한 적 없다」다.** 되접힌 옛 계정과 새 계정이
 *    그렇다. 0을 그대로 빼면 1970년부터의 시간이 들어와 접속하자마자 상한까지
 *    찬다 — 그래서 **도장만 찍고 아무것도 주지 않는다.** meta는 시계를 못 읽으니
 *    마이그레이션이 「지금」을 찍어 줄 수 없고, 그 자리를 여기가 메운다.
 */
export function syncGrain(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const now = Math.floor(nowMs);
  if (!Number.isFinite(now) || now <= 0) return profile;

  // 첫 정산 — 시각만 남기고 지나간다 (위 4번)
  if (profile.grainAt <= 0) return { ...profile, grainAt: now };

  const step = grainStepMs(profile.cityLevel);
  const earned = Math.floor((now - profile.grainAt) / step);
  if (earned <= 0) return profile;   // 아직 한 톨도 안 됐거나, 시계가 뒤로 갔다 (위 3번)

  return {
    ...profile,
    grain: Math.min(grainCap(profile), profile.grain + earned),
    grainAt: profile.grainAt + earned * step,
  };
}

// ── 증축 (GDD §5) ──────────────────────────────────────────────

/**
 * 다음 레벨에 드는 건축 자재. 최대 레벨이면 `null`.
 *
 * **표를 옮겨 적지 않는다** — `city.json`의 `materialsToUpgrade`가 단일 출처이고
 * 그것은 엑셀에서 나온다. GDD §5의 표가 한동안 엑셀과 달랐던 자리다
 * (`30/40/50…` vs 실제 `10/15/20…`). 코드가 데이터를 읽고 있어 동작은 멀쩡했다.
 */
export function upgradeCost(level: number): number | null {
  const next = CITY_LEVELS.find((c) => c.level === level + 1);
  return next?.materialsToUpgrade ?? null;
}

/** 증축할 수 있는가. **왜 안 되는지 글자로 말한다** — 잠긴 단추만 두면 「고장인가」가 남는다 */
export function canUpgradeCity(profile: PlayerProfile): MetaResult {
  const cost = upgradeCost(profile.cityLevel);
  if (cost === null) return { ok: false, reason: `이미 최대 레벨이다 (Lv${MAX_CITY_LEVEL})` };
  if (profile.materials < cost) {
    return { ok: false, reason: `건축 자재가 모자란다 — ${profile.materials}/${cost}` };
  }
  return { ok: true };
}

/**
 * 도시를 한 단계 올린다. 재료를 내고 `cityLevel += 1`.
 *
 * **`nowMs`를 받아 먼저 정산한다 ★** 이 파일에서 유일한 비대칭인데 이유가 있다 —
 * 증축은 **생산 요율이 바뀌는 자리**다. 정산하지 않고 레벨을 올리면 그 전에 흘러간
 * 시간이 **새 요율로** 계산된다(Lv1에서 세 시간 놀다 증축하면 3이 아니라 6이 들어온다).
 * 화면이 「증축 전에 `syncGrain`을 먼저 부르기」를 잊지 않기를 기대하는 대신
 * 규칙 층에 묶었다 — 잊어도 조용히 어긋나기만 하는 종류다.
 *
 * 상한(`grainCap`)·풀(`poolCap`)은 `cityLevel`을 보고 있어 **저절로 따라온다.**
 * 둘 다 레벨이 오르면 커지기만 하므로 잘라 낼 것도 없다.
 */
export function applyCityUpgrade(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const check = canUpgradeCity(profile);
  if (!check.ok) throw new Error(check.reason);
  const cost = upgradeCost(profile.cityLevel)!;
  const synced = syncGrain(profile, nowMs);
  return { ...synced, cityLevel: synced.cityLevel + 1, materials: synced.materials - cost };
}
