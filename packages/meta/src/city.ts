/**
 * 도시 — 레벨 · 건물 · 군량 시간 충전 · 부상과 치료
 * (pptx 41·54~59쪽 · GDD §5. 2026-08-18 시작, 2026-09-04 건물로 전면 개편)
 *
 * ────────────────────────────────────────────────────────────────
 * 도시 레벨이 정하는 것은 둘뿐이다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * **증축 자재 값**과 **건물 해금 게이트**. 생산량 · 상한 · 캐릭터 풀 · 부대 상한은
 * 예전에 이 레벨 하나가 전부 정했는데, 2026-09-04에 **건물 일곱**으로 갈라졌다.
 * 같은 값을 정하는 출처가 둘이면 어느 쪽이 정본인지 코드에 안 적히기 때문이다 —
 * 그래서 `city.json`에서 열 넷이 아예 사라졌고, 여기가 그 값을 읽는 자리다.
 *
 * ────────────────────────────────────────────────────────────────
 * 시계는 **밖에서 넣는다** ★
 * ────────────────────────────────────────────────────────────────
 *
 * `@samchess/meta`는 `Date.now()`를 부르지 않는다. 룰 엔진의 재현성 규칙과 같은
 * 이유이기도 하지만, 여기서는 **테스트로 고정하려면 그래야 하기 때문**이다 —
 * 「세 시간 뒤에 군량이 셋 찬다」·「한 시간 뒤에 부상이 낫는다」를 실제로 기다려
 * 확인할 수는 없다. `screens/backdrop.ts`의 `bandForHour(h)`와 같은 규약이다.
 *
 * **지금 시각을 넣는 자리는 `client/src/screens/App.tsx` 하나이고, 부르는 것도
 * `syncCity()` 하나다.** 군량 · 부상 · 병원 셋이 각자 정산 함수를 가지면 화면이
 * 셋 다 부르기를 기대하게 되는데, 하나를 잊으면 조용히 낡은 값이 남는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 숫자를 여기 적지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 해금 레벨 · 효과 값 · 부상 시간 · 부대 상한은 전부 엑셀 「도시 건물」 시트에서
 * 온다(`CITY_LEVELS` · `BUILDINGS` · `CITY_RULES`). 「기획 수치의 정본은
 * 엑셀이다」 — GDD §4.3 레벨업 카드 표와 §5 증축 자재 표가 각각 한 번씩
 * 낡아 어긋났던 자리다.
 */

import { BUILDINGS, CITY_LEVELS, CITY_RULES, buildingById, officerById } from '@samchess/data';
import type { BuildingId } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import type { MetaResult, OfficerInstance, PlayerProfile } from './types.ts';

/** 한 시간. 생산량이 「시간당」이라 눈금의 단위가 이것이다 */
export const MS_PER_HOUR = 3_600_000;
const MS_PER_MIN = 60_000;

/** 도시 레벨 한 줄. 범위 밖이면 Lv1로 물러난다 — 던지면 화면이 첫 칸에서 멈춘다 */
export const cityLevel = (level: number) =>
  CITY_LEVELS.find((c) => c.level === level) ?? CITY_LEVELS[0]!;

/** 데이터가 아는 가장 높은 도시 레벨(황궁 포함). 화면이 `10`을 적지 않게 */
export const MAX_CITY_LEVEL: number = CITY_LEVELS[CITY_LEVELS.length - 1]!.level;

// ── 황제 · 황궁 (GDD §5.5) ─────────────────────────────────────

/**
 * 헌제를 보유했는가. **효과는 「도시 레벨 상한이 하나 올라간다」 하나뿐이다.**
 *
 * 2026-08-17에 「지금 효과는 없다 — 도시 시설(황궁)이 붙을 때 정한다」로 미뤄
 * 두었던 자리가 여기서 채워졌다(2026-09-04). 등급 `E`는 헌제 한 명뿐이라
 * 개수가 아니라 있고 없음이다 (GDD §4.1).
 */
export const hasEmperor = (profile: PlayerProfile): boolean =>
  Object.keys(profile.roster).some((id) => officerById.get(id)?.grade === 'E');

/**
 * 이 계정이 갈 수 있는 가장 높은 도시 레벨.
 *
 * **헌제가 없으면 `requiresEmperor`인 레벨 앞에서 멈춘다.** 데이터가 그 경계를
 * 들고 있으므로 여기서 `9`도 `10`도 적지 않는다.
 */
export const maxCityLevel = (profile: PlayerProfile): number => {
  const emperor = hasEmperor(profile);
  const reachable = CITY_LEVELS.filter((c) => emperor || !c.requiresEmperor);
  return reachable[reachable.length - 1]!.level;
};

// ── 건물 (GDD §5.2~§5.4) ───────────────────────────────────────

/**
 * 계정이 가진 건물 레벨. **`0`은 「아직 안 지었다」**이고 기본 건물은 늘 1 이상이다.
 *
 * ★ **건물 레벨을 읽는 자리는 여기 하나다.** `profile.buildings[id]`를 직접 펴면
 * 되접힌 옛 계정이나 손으로 고친 저장에서 `undefined`가 새어 나가고, 그것이
 * `values[level - 1]`에 닿으면 화면에 `undefined`가 뜬다 —
 * `statPicksOf()` · `tacticsOf()`가 성장 스택에 세운 규약과 같은 자리다.
 */
export const buildingLevel = (profile: PlayerProfile, id: BuildingId): number =>
  Math.max(0, Math.floor(profile.buildings?.[id] ?? 0));

/**
 * 그 건물이 그 레벨에서 정하는 값.
 *
 * **`level === 0`은 「안 지었을 때의 값」이다** — 대개 0이지만 농지만 `1`이다
 * (농지가 없어도 시간당 1은 찬다. 아예 안 차면 농지를 짓기 전까지 대전을 못
 * 하는데, 잠기는 것이 아니라 **느린 것**이라야 한다 — GDD §5.4).
 * 값이 없는 건물(시장·대장간, 품목 표 미정)은 `0`이다.
 */
export function buildingValue(id: BuildingId, level: number): number {
  const effect = buildingById.get(id)?.effect;
  if (!effect) return 0;
  if (level <= 0) return effect.absent ?? 0;
  return effect.values[Math.min(level, effect.values.length) - 1] ?? 0;
}

/** 계정 기준으로 그 건물이 지금 내고 있는 값 */
export const buildingEffect = (profile: PlayerProfile, id: BuildingId): number =>
  buildingValue(id, buildingLevel(profile, id));

/** 도시를 한 단계 올릴 때 받는 건설 기회 (GDD §5.2) */
export const BUILD_ACTIONS_PER_UPGRADE = CITY_RULES.buildActionsPerUpgrade;

/**
 * 남은 건설 기회. **`null`이면 제한이 없다** — 황궁 레벨에 닿았다는 뜻이다.
 *
 * ★ **기회를 읽는 자리는 여기 하나다.** 화면이 `profile.buildCredits`를 직접 보면
 * 황궁의 예외를 빠뜨려 「Lv10인데 못 짓는다」가 된다 — 그것은 화면에 이유도 안 뜬다.
 */
export const buildCreditsLeft = (profile: PlayerProfile): number | null =>
  profile.cityLevel >= MAX_CITY_LEVEL ? null : Math.max(0, Math.floor(profile.buildCredits ?? 0));

/** 새 계정의 건물 — 기본 셋은 Lv1, 추가 넷은 0(안 지음) */
export const initialBuildings = (): Record<BuildingId, number> =>
  Object.fromEntries(
    BUILDINGS.map((b) => [b.id, b.kind === 'basic' ? 1 : 0]),
  ) as Record<BuildingId, number>;

/**
 * 건물을 짓거나 올릴 수 있게 되는 도시 레벨 (GDD §5.2).
 *
 * ★ **레벨별 해금 표가 아니라 상수 하나다** (2026-09-04에 바로잡음). pptx 57쪽의
 * 격자를 조건표로 읽었었는데, 그것은 「기회를 3회씩 쓰면 어디까지 가나」를 순서대로
 * 놓아 본 **시뮬레이션**이었다. 도시가 이 레벨 이상이면 무엇이든 짓거나 올릴 수
 * 있고, 남은 제한은 **건설 기회**뿐이다.
 */
export const BUILD_CITY_LEVEL = CITY_RULES.buildCityLevel;

/**
 * 지을 수 있는가(= 새로 짓거나 한 단계 올릴 수 있는가).
 * **왜 안 되는지 글자로 말한다** — 잠긴 단추만 두면 「고장인가」가 남는다.
 *
 * > **건축 자재가 들지 않는다.** 값을 받는 것은 **도시 증축**뿐이고, 건물이 쓰는
 * > 것은 **건설 기회**(`buildCredits`)다 — 증축 한 번에 `BUILD_ACTIONS_PER_UPGRADE`씩
 * > 쌓인다. 자재를 두 번 받으면 부담이 겹친다는 판단이다 (2026-09-04).
 * >
 * > **황궁 레벨에서는 기회를 안 본다** — 남은 것을 전부 지을 수 있다.
 */
export function canBuild(profile: PlayerProfile, id: BuildingId): MetaResult {
  const data = buildingById.get(id);
  if (!data) return { ok: false, reason: `모르는 건물이다 — ${id}` };
  const level = buildingLevel(profile, id);
  if (level >= data.maxLevel) {
    return { ok: false, reason: `${data.name}은 이미 최대 레벨이다 (Lv${data.maxLevel})` };
  }
  if (profile.cityLevel < BUILD_CITY_LEVEL) {
    return {
      ok: false,
      reason: level === 0
        ? `${data.name}을 지으려면 도시가 Lv${BUILD_CITY_LEVEL}이어야 한다 — 지금 Lv${profile.cityLevel}`
        : `도시가 Lv${BUILD_CITY_LEVEL}이어야 증축할 수 있다 — 지금 Lv${profile.cityLevel}`,
    };
  }
  const left = buildCreditsLeft(profile);
  if (left !== null && left <= 0) {
    return { ok: false, reason: '건설 기회를 다 썼다 — 도시를 증축하면 다시 생긴다' };
  }
  return { ok: true };
}

/**
 * 건물을 한 단계 올린다.
 *
 * **`nowMs`를 받아 먼저 정산한다 ★** 병영(최대 군량)과 농지(시간당 생산량)가
 * **생산 요율이 바뀌는 자리**다 — 정산하지 않고 올리면 그 전에 흘러간 시간이
 * 새 요율로 계산된다. 예전에는 도시 증축이 그 자리였고, 이제는 여기다.
 * 화면이 「짓기 전에 먼저 정산하기」를 잊지 않기를 기대하는 대신 규칙 층에 묶었다.
 */
export function applyBuild(profile: PlayerProfile, id: BuildingId, nowMs: number): PlayerProfile {
  const check = canBuild(profile, id);
  if (!check.ok) throw new Error(check.reason);
  const synced = syncCity(profile, nowMs);
  const left = buildCreditsLeft(synced);
  return {
    ...synced,
    buildings: { ...synced.buildings, [id]: buildingLevel(synced, id) + 1 },
    // 황궁 레벨에서는 안 깎는다 — 애초에 안 보는 값이라 0 아래로 밀 이유가 없다
    buildCredits: left === null ? synced.buildCredits : left - 1,
  };
}

// ── 건물이 정하는 값들 ─────────────────────────────────────────
//
// **한자리에 모아 둔다** — 「무엇을 올리면 무엇이 늘어나는가」가 흩어지면
// 화면이 엉뚱한 건물을 가리킨다. 왼쪽이 값, 오른쪽이 그것을 정하는 건물이다.

/** 캐릭터 풀 상한 ← **궁궐** */
export const poolCap = (profile: PlayerProfile): number => buildingEffect(profile, 'palace');
/** 군량 상한 ← **병영** */
export const grainCap = (profile: PlayerProfile): number => buildingEffect(profile, 'barracks');
/** 시간당 군량 ← **농지** (없어도 1) */
export const grainPerHour = (profile: PlayerProfile): number => buildingEffect(profile, 'farm');
/** 병원 치료 room 수 ← **병원** (없으면 0) */
export const hospitalRooms = (profile: PlayerProfile): number =>
  buildingEffect(profile, 'hospital');
/** 훈련 보정 상한 ← **태학**. 쓰임새는 태학 화면을 설계할 때 정한다 (§12) */
export const trainingBonus = (profile: PlayerProfile): number =>
  buildingEffect(profile, 'academy');

/**
 * 저장할 수 있는 부대 개수 — **도시 레벨과 무관하게 고정**이다 (2026-09-04).
 *
 * 예전 규칙(`10 + (도시 레벨 − 1) × 5`)을 pptx 56쪽이 뒤집었다. 「저장 개수」는
 * 편의지 성장의 보상이 아니라는 판단이다. **인자를 그대로 받는다** — 부르는
 * 자리를 바꾸지 않으려는 것도 있지만, 다시 계정을 보게 될 여지를 남겨 둔다.
 */
export const squadCap = (_profile: PlayerProfile): number => CITY_RULES.squadCap;

/** 군량 1이 차는 데 걸리는 시간(ms) */
export const grainStepMs = (profile: PlayerProfile): number => MS_PER_HOUR / grainPerHour(profile);

// ── 군량 시간 충전 (GDD §5.6) ──────────────────────────────────

/**
 * 흘러간 시간만큼 군량을 채운다. **순수 함수** — `nowMs`는 부르는 쪽이 넣는다.
 *
 * ```
 * step   = 1시간 / 시간당 생산량      ← 농지가 정한다
 * earned = floor((nowMs − grainAt) / step)
 * grain  = min(상한, grain + earned)  ← 상한은 병영이 정한다
 * grainAt += earned × step            ← 나머지를 보존한다
 * ```
 *
 * **바깥에서 직접 부르지 않는다 — `syncCity()`를 부른다.** 시각을 넣는 자리가
 * 늘어나는 것을 막기 위해서다.
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
 *    찬다 — 그래서 **도장만 찍고 아무것도 주지 않는다.**
 */
export function syncGrain(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const now = Math.floor(nowMs);
  if (!Number.isFinite(now) || now <= 0) return profile;

  // 첫 정산 — 시각만 남기고 지나간다 (위 4번)
  if (profile.grainAt <= 0) return { ...profile, grainAt: now };

  const step = grainStepMs(profile);
  const earned = Math.floor((now - profile.grainAt) / step);
  if (earned <= 0) return profile;   // 아직 한 톨도 안 됐거나, 시계가 뒤로 갔다 (위 3번)

  return {
    ...profile,
    grain: Math.min(grainCap(profile), profile.grain + earned),
    grainAt: profile.grainAt + earned * step,
  };
}

// ── 부상과 치료 (GDD §5.7, 2026-09-04 신설) ────────────────────

/** 부상이 무·지·통에서 각각 깎는 값 */
export const INJURY_PENALTY = CITY_RULES.injuryPenalty;
/** 저절로 낫는 데 걸리는 시간 */
export const INJURY_RECOVER_MS = CITY_RULES.injuryRecoverMin * MS_PER_MIN;
/** 병원 치료에 걸리는 시간. **0이 아니다** — 즉시 완치면 치료가 화면에서 사라진다 */
export const HEAL_MS = CITY_RULES.healMin * MS_PER_MIN;
/** room 하나의 재사용 주기 — 치료 + 쿨타임 */
export const ROOM_CYCLE_MS = (CITY_RULES.healMin + CITY_RULES.roomCooldownMin) * MS_PER_MIN;

/**
 * 부상 능력치를 화면·전투가 쓰는 값으로. **하한 1.**
 *
 * 지금 데이터로는 하한에 닿는 장수가 없다 — 헌제(1/1/1)는 애초에 부상하지 않고,
 * 그다음으로 낮은 값이 11이다. **닿지 않는 방어를 남겨 두는 이유**는 엑셀의
 * 능력치가 바뀌면 조용히 0이나 음수가 새어 들어오기 때문이다.
 */
export const injuredStat = (base: number): number => Math.max(1, base - INJURY_PENALTY);

/**
 * 이 장수가 낫는 시각. 부상이 아니면 `null`.
 *
 * ★ **저장하는 것은 「사건이 일어난 때」이지 「끝나는 때」가 아니다.** 회복 60분과
 * 치료 1분이 **엑셀에서 오므로**, 끝 시각을 저장해 두면 그 값을 바꿔도 이미
 * 저장된 계정은 옛 규칙으로 남는다 — `grainAt`과 같은 결이다.
 */
export function injuryHealsAt(inst: OfficerInstance): number | null {
  if (inst.injuredAt === undefined) return null;
  return inst.healingAt !== undefined ? inst.healingAt + HEAL_MS : inst.injuredAt + INJURY_RECOVER_MS;
}

/** 지금 부상인가. **낫는 시각이 지났으면 필드가 남아 있어도 아니다** (정리는 sync가 늦게 한다) */
export function isInjured(inst: OfficerInstance, nowMs: number): boolean {
  const at = injuryHealsAt(inst);
  return at !== null && nowMs < at;
}

/** 치료 중인가 — 부상이면서 room에 들어가 있다 */
export const isHealing = (inst: OfficerInstance, nowMs: number): boolean =>
  inst.healingAt !== undefined && isInjured(inst, nowMs);

/**
 * 지금 비어 있는 room 수.
 *
 * ★ **room에 번호를 붙이지 않는다.** 필요한 사실은 「몇 개가 바쁜가」뿐이라
 * `hospitalBusy`는 **해제 시각의 목록**일 뿐이고, 지난 값은 `syncCity()`가
 * 지우므로 살아 있는 길이가 곧 바쁜 수다. room을 식별하면 쓰지 않는 정체성이
 * 저장 형식에 영원히 남는다.
 */
export function freeRooms(profile: PlayerProfile, nowMs: number): number {
  const busy = (profile.hospitalBusy ?? []).filter((t) => t > nowMs).length;
  return Math.max(0, hospitalRooms(profile) - busy);
}

/** 다음 room이 비는 시각. 전부 비어 있으면 `null` */
export function nextRoomFreeAt(profile: PlayerProfile, nowMs: number): number | null {
  if (freeRooms(profile, nowMs) > 0) return null;
  const busy = (profile.hospitalBusy ?? []).filter((t) => t > nowMs).sort((a, b) => a - b);
  return busy[0] ?? null;
}

/** 치료할 수 있는가. **왜 안 되는지 글자로 말한다** */
export function canHeal(profile: PlayerProfile, officer: OfficerId, nowMs: number): MetaResult {
  if (hospitalRooms(profile) <= 0) return { ok: false, reason: '병원이 없다 — 먼저 지어야 한다' };
  const inst = profile.roster[officer];
  if (!inst) return { ok: false, reason: '없는 장수다' };
  if (!isInjured(inst, nowMs)) return { ok: false, reason: '부상이 아니다' };
  if (isHealing(inst, nowMs)) return { ok: false, reason: '이미 치료 중이다' };
  if (freeRooms(profile, nowMs) <= 0) return { ok: false, reason: '빈 room이 없다' };
  return { ok: true };
}

/**
 * 치료를 시작한다 — room 하나를 잡고 `HEAL_MS` 뒤에 낫는다.
 *
 * **「즉시 완치」가 아니다.** 처음 안은 즉시였는데, 그러면 병원 Lv3에서 3v3
 * 전멸이 **0분**이 되어 「치료하러 간다」가 화면에서 사라진다. 1분을 두면
 * Lv3의 3v3과 Lv5의 5v5가 정확히 1분이 된다 (GDD §5.7의 표).
 */
export function applyHeal(profile: PlayerProfile, officer: OfficerId, nowMs: number): PlayerProfile {
  const check = canHeal(profile, officer, nowMs);
  if (!check.ok) throw new Error(check.reason);
  const inst = profile.roster[officer]!;
  return {
    ...profile,
    roster: { ...profile.roster, [officer]: { ...inst, healingAt: nowMs } },
    hospitalBusy: [...(profile.hospitalBusy ?? []).filter((t) => t > nowMs), nowMs + ROOM_CYCLE_MS],
  };
}

/**
 * 전투에서 HP 0으로 퇴각한 장수들에게 부상을 매긴다.
 *
 * **헌제는 건너뛴다** — 능력치가 1/1/1이라 깎을 것이 없다 (GDD §5.7).
 * **중첩되지 않는다** — 이미 부상이어도 `−10` 그대로이고 **타이머만 다시 선다.**
 * 중첩시키면 연패한 계정이 회복 불가능해진다. 치료 중이었다면 그 치료는
 * 무효가 된다(`healingAt`을 지운다) — 다시 다쳤으니 room을 다시 잡아야 한다.
 */
export function applyInjuries(
  profile: PlayerProfile, fallen: readonly OfficerId[], nowMs: number,
): PlayerProfile {
  const roster = { ...profile.roster };
  let changed = false;
  for (const id of fallen) {
    const inst = roster[id];
    if (!inst || officerById.get(id)?.grade === 'E') continue;
    const { healingAt: _drop, ...rest } = inst;
    roster[id] = { ...rest, injuredAt: nowMs };
    changed = true;
  }
  return changed ? { ...profile, roster } : profile;
}

// ── 정산 ★ 시각을 넣는 자리는 여기 하나다 ───────────────────────

/**
 * 흘러간 시간을 계정에 반영한다 — **화면이 부르는 것은 이것 하나다.**
 *
 * 군량 충전 · 나은 부상 정리 · 지난 room 정리 셋을 함께 한다. 셋을 따로 두면
 * 화면이 셋 다 부르기를 기대하게 되고, 하나를 잊으면 조용히 낡은 값이 남는다 —
 * 「군량을 읽는 화면이 넷이라 도시 화면에서만 채우면 나머지가 낡은 값을 본다」와
 * 같은 사고를 부상에서 반복하지 않기 위해서다.
 *
 * **바뀐 것이 없으면 같은 객체를 돌려준다.** 부르는 쪽이 `next !== profile`로
 * 저장 여부를 정한다 — 분마다 부르는데 매번 새 객체를 주면 아무 일도 없는
 * 계정을 분마다 서버에 쓴다.
 */
export function syncCity(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const now = Math.floor(nowMs);
  if (!Number.isFinite(now) || now <= 0) return profile;
  let next = syncGrain(profile, now);

  // 나은 장수의 부상 자국을 지운다. **판정(`isInjured`)은 이미 나은 것으로 보므로
  // 이 정리가 늦어도 규칙은 옳다** — 저장을 덜 하기 위한 청소일 뿐이다.
  let roster: PlayerProfile['roster'] | null = null;
  for (const [id, inst] of Object.entries(next.roster)) {
    if (inst.injuredAt === undefined || isInjured(inst, now)) continue;
    const { injuredAt: _a, healingAt: _b, ...rest } = inst;
    roster ??= { ...next.roster };
    roster[id as OfficerId] = rest;
  }
  if (roster) next = { ...next, roster };

  const busy = (next.hospitalBusy ?? []).filter((t) => t > now);
  if (busy.length !== (next.hospitalBusy ?? []).length) next = { ...next, hospitalBusy: busy };

  return next;
}

// ── 도시 증축 (GDD §5.1) ───────────────────────────────────────

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
  const cap = maxCityLevel(profile);
  if (profile.cityLevel >= cap) {
    // 헌제가 없어서 막힌 것과 진짜 끝인 것을 **가려서 말한다** — 「이미 최대」라고만
    // 하면 황궁이 레벨을 하나 더 연다는 사실이 화면 어디에도 안 남는다
    return {
      ok: false,
      reason: cap < MAX_CITY_LEVEL
        ? `Lv${cap}이 상한이다 — Lv${MAX_CITY_LEVEL}은 황제를 옹립해야 갈 수 있다`
        : `이미 최대 레벨이다 (Lv${MAX_CITY_LEVEL})`,
    };
  }
  const cost = upgradeCost(profile.cityLevel);
  if (cost === null) return { ok: false, reason: `이미 최대 레벨이다 (Lv${profile.cityLevel})` };
  if (profile.materials < cost) {
    return { ok: false, reason: `건축 자재가 모자란다 — ${profile.materials}/${cost}` };
  }
  return { ok: true };
}

/**
 * 도시를 한 단계 올린다. 재료를 내고 `cityLevel += 1`.
 *
 * **늘어나는 것은 「지을 수 있는 것」이지 능력치가 아니다** (2026-09-04). 예전에는
 * 상한·풀·생산량 셋이 이 한 줄을 따라 함께 올라갔는데, 이제는 건물을 지어야
 * 올라간다 — 그래서 확인 팝업의 글도 「무엇이 늘어나는가」가 아니라 **「무엇을
 * 지을 수 있게 되는가」**다 (GDD §8.5).
 *
 * **`nowMs`를 받아 먼저 정산한다.** 여기서 요율이 바뀌지는 않지만(그것은
 * `applyBuild`다), 자재를 쓰는 한 수 앞에서 계정을 최신으로 맞춰 두는 편이
 * 낫다 — 증축 직후 화면이 낡은 군량을 보여 주지 않는다.
 */
export function applyCityUpgrade(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const check = canUpgradeCity(profile);
  if (!check.ok) throw new Error(check.reason);
  const cost = upgradeCost(profile.cityLevel)!;
  const synced = syncCity(profile, nowMs);
  return {
    ...synced,
    cityLevel: synced.cityLevel + 1,
    materials: synced.materials - cost,
    // **증축이 사는 것은 이것이다** — 능력치가 아니라 「지을 기회」다 (GDD §5.2)
    buildCredits: (synced.buildCredits ?? 0) + BUILD_ACTIONS_PER_UPGRADE,
  };
}

/** 도시 관리 화면의 건물 한 줄 — 화면이 조립하지 않게 규칙이 낸다 */
export interface BuildingRow {
  id: BuildingId;
  name: string;
  kind: 'basic' | 'extra';
  /** **0이면 아직 안 지었다.** 기본 건물은 늘 1 이상 */
  level: number;
  maxLevel: number;
  /**
   * 이 건물이 정하는 값의 **지금과 다음**. 만렙이면 `next`가 `null`,
   * 값이 없는 건물(시장·대장간)은 통째로 `null`이다.
   */
  effect: { label: string; unit: string; now: number; next: number | null } | null;
  /** 값이 없는 건물(시장·대장간)이 그래도 무엇을 하는지 — 「구매 장비」 */
  purpose: string;
  /**
   * 화면에 적을 한 줄. **규칙이 정해서 준다** — 화면이 「지었나 안 지었나」로
   * 갈라 문구를 고르면 그 갈림이 두 군데(여기와 화면)에 적힌다.
   *
   * | 상태 | 무엇을 적나 |
   * |---|---|
   * | 안 지었고 소개가 있다 | **「장수 훈련 가능」** — 증분은 아직 뜻이 없다 |
   * | 지었다 | 「캐릭터 풀 60 → 110」 |
   * | 만렙 | 「캐릭터 풀 260」 |
   * | 값이 없다(시장·대장간) | 「구매 장비」 + 화면이 「품목 미정」을 붙인다 |
   */
  line: string | null;
  /** 지금 짓거나 올릴 수 있는가. **안 되면 이유가 들어 있다** */
  can: MetaResult;
}

/**
 * 도시 관리 화면이 그리는 건물 일곱 줄.
 *
 * ★ **화면이 숫자를 만들지 않는다.** 「지금 60 → 다음 110」 같은 증분은 규칙이
 * 내고 화면은 옮겨 적기만 한다 — 레벨업의 `growthPreview()`·공격 확인창의
 * `forecastAttack()`과 같은 자리다. 화면이 `values[level]`을 직접 펴면 만렙
 * 경계에서 `undefined`가 새고, 그건 화면에 그대로 뜬다.
 *
 * **못 짓는 줄도 뺴지 않는다** — 무엇이 있는지 보이지 않으면 도시를 왜 올리는지
 * 알 수 없다. 대신 `can.reason`이 왜 지금은 안 되는지 말한다.
 */
export function buildingRows(profile: PlayerProfile): BuildingRow[] {
  return BUILDINGS.map((b) => {
    const level = buildingLevel(profile, b.id);
    const effect = b.effect
      ? {
        label: b.effect.label,
        unit: b.effect.unit,
        now: buildingValue(b.id, level),
        next: level < b.maxLevel ? buildingValue(b.id, level + 1) : null,
      }
      : null;
    // **안 지었으면 소개를 먼저 본다** — 「훈련 보정 0 → 2」는 그 건물이 뭘 하는지
    // 모르는 사람에게 아무 말도 안 한다. 짓기 전에 필요한 것은 증분이 아니다.
    const line = level === 0 && b.blurb
      ? b.blurb
      : effect === null
        ? null
        : effect.next === null
          ? `${effect.label} ${effect.now}`
          : `${effect.label} ${effect.now} → ${effect.next}`;
    return {
      id: b.id, name: b.name, kind: b.kind, level, maxLevel: b.maxLevel,
      effect, purpose: b.purpose, line, can: canBuild(profile, b.id),
    };
  });
}
