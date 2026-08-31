/**
 * 부대 전투력 — pptx 44쪽
 *
 * ```
 * 부대 전투력 산출식 필요. 목적은, 온라인 대전 및 AI 대전에서 인접한 전투력을 가진 부대,
 * 동일 전투력 그룹 내에서 매핑을 하게 만들기 위함.
 * 3 vs 3, 5 vs 5 전투력 산출 각각 필요. 레벨 1~9 + 클래스 조합.
 * 전투 통계 기반으로 산출식을 도출하는 게 좋겠음.
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 전투력은 「점수」가 아니라 「승률로 환산되는 눈금」이다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 44쪽이 원하는 것은 예쁜 숫자가 아니라 **「이 값이 가까우면 대전이 성립한다」는 눈금**이다.
 * 그래서 형태를 이렇게 잡았다.
 *
 * ```
 * power(팀)   =  Σ 유닛별 기여                     ← 합이라 5v5가 3v3보다 자연히 크다
 * winChance   =  1 / (1 + exp(−(내 전투력 − 상대 전투력) / POWER_SCALE))
 * ```
 *
 * 눈금 `POWER_SCALE`을 **두 모드가 공유**하므로 「격차 100 = 예상 승률 몇 %」가 3v3에서나
 * 5v5에서나 같은 뜻이다. 가중치(`weights`)는 모드마다 따로 실측했다 — 유닛이 3명일 때와
 * 5명일 때 무엇이 얼마나 중요한지가 실제로 갈렸기 때문이다(§ 아래 「실측」).
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 등급이 아니라 능력치인가
 * ────────────────────────────────────────────────────────────────
 *
 * 44쪽은 「클래스 조합」이라고 적었지만 등급이 승률을 만드는 것이 아니다. 승률을 만드는
 * 것은 **무력(크리티컬)·지력(환술)·통솔(WT)·고유기술**이고 등급은 그 요약일 뿐이다.
 * 등급으로 접으면 ① 같은 S급인데 센 장수와 약한 장수가 같은 값이 되고
 * ② **레벨이 들어갈 자리가 없다** — 44쪽이 요구한 「레벨 1~9」가 사라진다.
 *
 * 그래서 특징은 엔진이 실제로 읽는 자리에서 뽑는다. 등급별 평균 전투력은 이 식에서
 * **파생**되며, `npm run power`가 등급 조합 표로 찍어 준다.
 *
 * > **기물은 일부러 뺐다** (2026-08-17 기획자 확정). 회귀에서는 유의했지만
 * > (`npm run power`가 그 크기를 찍는다), 전투력에 넣으면 **사람이 전투력을 보고 특정
 * > 기물을 고르거나 배제하게 된다.** 기물 선택은 전술이지 강함의 표시가 아니다.
 * > 표본에서 기물이 무작위라 빼도 나머지 계수는 흔들리지 않는다(직교).
 *
 * > **지력 가중치는 낮게 나온다 — 측정의 한계이지 설계가 아니다.** 기준 AI가 책략을
 * > 「칠 수 없는 턴에만」 쓰기 때문이다(`rules/ai.ts`). 임의로 올리면 **실측 기반이라는
 * > 근거 자체가 사라지므로** 측정값을 그대로 쓰고, 여기 적어 둔다. AI가 세지거나 실플레이
 * > 데이터가 쌓여 다시 재는 것은 **의도된 변경**이어야 한다 — 테스트가 계수를 고정한다.
 */

import { officerById, skillById } from '@samchess/data';
import { UNITS_PER_SIDE } from '@samchess/rules';
import type { BattleMode, OfficerId, RosterEntry } from '@samchess/rules';
import { statsFrom } from './profile.ts';
import type { StatPick } from './types.ts';

// ═══════════════════════════════════════════════════════════════
// 1. 특징 — 회귀가 재는 것과 식이 쓰는 것이 같은 함수여야 한다
// ═══════════════════════════════════════════════════════════════

/**
 * 유닛 하나의 특징. **`tools/power_fit.ts`의 회귀가 그대로 쓴다** —
 * 여기와 저기가 갈리면 「무엇을 재서 나온 계수인지」를 알 수 없게 된다.
 */
export interface PowerFeatures {
  /** 무력 — `criticalRate = 30 + 공.무력 − 방.무력` */
  might: number;
  /** 지력 — `illusionRate = 20 + 시전.지력 − 대상.지력` */
  intellect: number;
  /** 통솔 — `wtBase = 190 − 통솔`. 행동 빈도 */
  leadership: number;
  /** B급 고유기술 보유 (0/1) */
  skillB: number;
  /** A급 고유기술 보유 (0/1) */
  skillA: number;
  /** S급 고유기술 보유 (0/1) */
  skillS: number;
  /** 성장 후 최대 HP */
  hp: number;
  /** 성장 후 최대 MP */
  mp: number;
  /** 성장 후 공격력 */
  at: number;
}

export const POWER_FEATURES = [
  'might', 'intellect', 'leadership', 'skillB', 'skillA', 'skillS', 'hp', 'mp', 'at',
] as const;

export type PowerFeature = (typeof POWER_FEATURES)[number];

/**
 * 성장 능력치. **`profile.ts`의 것을 그대로 부른다** — 같은 식을 두 번 적어 두면
 * 한쪽만 고쳐졌을 때 「화면의 HP와 전투력이 계산하는 HP가 다른」 어긋남이 난다.
 * 이름을 남겨 둔 것은 D의 회귀와 `tools/power_fit.ts`가 이 이름을 부르기 때문이다.
 */
export const statsFromPicks = statsFrom;

/**
 * 유닛 하나의 특징을 뽑는다. `piece`는 보지 않는다 (위 주석).
 *
 * **고유기술을 「보유 0/1」이 아니라 등급 더미 셋으로 나눈 이유 ★**
 *
 * 처음에는 `보유(0/1)` + `SP 코스트`로 뒀는데 둘 다 못 쓸 이유가 있었다.
 *  - 둘을 함께 넣으면 거의 공선이라 계수가 서로를 밀어냈다 (보유 −52.6, 코스트 +14.3).
 *  - **코스트는 외삽이 위험하다.** 표본의 고유기술은 B 4 / A 5 / S 6뿐인데 헌제만 7이라,
 *    기울기를 외삽하면 **실측 최약체인 헌제가 D급보다 세게 나온다**(실제로 그랬다).
 *  - 보유만 남기면 **S급 고유기술과 B급 고유기술이 같은 값**이 된다. 그 차이는 실제로
 *    크다 — 코스트를 뺐더니 설명력이 logLik 101만큼 날아갔다.
 *
 * 등급 더미 셋이면 관측된 세 등급을 **각각** 재고 외삽이 없다. **헌제(E급 기술)는 셋 다
 * 0**이 되어 고유기술 몫을 받지 않는데, 이게 옳다 — 능력치 1/1/1이라 「무적 990」만으로
 * 버티지 못해 책략이 도는 판에서 실측 승률이 35.8%로 최하다(HANDOFF §7).
 */
export function unitFeatures(entry: { officer: OfficerId; statPicks: readonly StatPick[] }): PowerFeatures {
  const officer = officerById.get(entry.officer);
  if (!officer) throw new Error(`알 수 없는 장수: ${entry.officer}`);
  const skill = officer.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
  const stats = statsFromPicks(entry.statPicks);
  return {
    might: officer.might,
    intellect: officer.intellect,
    leadership: officer.leadership,
    skillB: skill?.tier === 'B' ? 1 : 0,
    skillA: skill?.tier === 'A' ? 1 : 0,
    skillS: skill?.tier === 'S' ? 1 : 0,
    hp: stats.hp,
    mp: stats.mp,
    at: stats.at,
  };
}

/** 팀 특징 = 유닛 특징의 합. 순서를 바꿔도 같다 */
export function teamFeatures(
  entries: readonly { officer: OfficerId; statPicks: readonly StatPick[] }[],
): PowerFeatures {
  const sum = Object.fromEntries(POWER_FEATURES.map((f) => [f, 0])) as unknown as PowerFeatures;
  for (const entry of entries) {
    const f = unitFeatures(entry);
    for (const key of POWER_FEATURES) sum[key] += f[key];
  }
  return sum;
}

// ═══════════════════════════════════════════════════════════════
// 2. 실측 — 이 상수는 `npm run power`에서 나온다
// ═══════════════════════════════════════════════════════════════

export interface PowerModel {
  /** 특징 1단위당 전투력 (이미 `POWER_SCALE`이 곱해진 표시 단위다) */
  weights: Readonly<Record<PowerFeature, number>>;
  /** 유닛 1인마다 더하는 바닥값 — 눈금이 음수로 내려가지 않게 한다 */
  offset: number;
}

/**
 * 승률 환산 눈금. **두 모드가 공유한다.**
 *
 * ```
 * 격차   0 →  50%      격차 100 → 73%      격차 200 → 88%
 * ```
 *
 * 100이라는 값 자체에 뜻은 없다 — 로짓 1단위를 100점으로 부르기로 한 것뿐이다.
 * 그래서 「격차 100 = 승률 73%」 하나만 외우면 나머지가 따라온다.
 */
export const POWER_SCALE = 100;

/**
 * 모드별 계수. `tools/power_fit.ts`가 찍어 준 값을 손으로 옮겨 적는다 —
 * **실행할 때마다 다시 적합시키지 않는다.** 전투력이 조용히 흔들리면 매칭도 흔들린다.
 *
 * 측정 조건은 파일 맨 아래 「실측 기록」에 적어 뒀다.
 */
export const POWER_MODELS: Readonly<Record<BattleMode, PowerModel>> = {
  '3v3': {
    weights: {
      might: 1.433, intellect: 0.466, leadership: 0.66,
      skillB: 5.302, skillA: 15.785, skillS: 34.315,
      hp: 6.529, mp: 0.997, at: 38.399,
    },
    offset: -129.632,
  },
  '5v5': {
    weights: {
      might: 0.743, intellect: 0.261, leadership: 0.411,
      // skillB는 |z|=1.2 — 표본이 「모른다」고 답했다. 0으로 둔다
      skillB: 0, skillA: 6.769, skillS: 16.379,
      hp: 3.458, mp: 0.837, at: 21.228,
    },
    offset: -62.636,
  },
};

// ═══════════════════════════════════════════════════════════════
// 3. 화면·서버가 부르는 것
// ═══════════════════════════════════════════════════════════════

/**
 * 유닛 한 명의 전투력 기여. 편성 화면이 한 줄씩 보여줄 때 쓴다.
 *
 * **반올림하지 않는다** — 유닛마다 반올림하면 5v5에서 오차가 쌓인다. 화면에 찍을 때만
 * 반올림하고, 팀 합계는 `battlePower()`가 마지막에 한 번만 반올림한다.
 */
export function unitPower(mode: BattleMode, entry: { officer: OfficerId; statPicks: readonly StatPick[] }): number {
  const model = POWER_MODELS[mode];
  const f = unitFeatures(entry);
  let sum = model.offset;
  for (const key of POWER_FEATURES) sum += model.weights[key] * f[key];
  return sum;
}

/**
 * 부대 전투력. **인원이 모드와 맞지 않으면 던진다.**
 *
 * 느슨하게 받으면 3v3 부대와 5v5 부대를 같은 자로 재는 사고가 조용히 지나간다 —
 * 그게 이 함수에서 제일 위험한 실수라 계약으로 막는다.
 */
export function battlePower(mode: BattleMode, entries: readonly RosterEntry[]): number {
  const need = UNITS_PER_SIDE[mode];
  if (entries.length !== need) {
    throw new Error(`${mode}의 전투력은 ${need}명으로 낸다 — 지금 ${entries.length}명`);
  }
  let sum = 0;
  for (const entry of entries) sum += unitPower(mode, entry);
  return Math.round(sum);
}

/**
 * 예상 승률 (0~1). 격차만 보므로 **모드를 묻지 않는다** — 눈금이 공유이기 때문이다.
 *
 * 카드 보상은 이 값으로 갈리지 **않는다** (2026-08-17 기획자 확정) — 담합으로 큰 이변을
 * 만들어 좋은 카드를 한 계정에 몰아줄 수 있어서다. 쓰이는 곳은 둘이다.
 *  - **매칭** — 「인접한 전투력」의 폭을 승률로 정의한다 (`MATCH_BAND`)
 *  - **전적** — 이긴 쪽의 예상 승률을 남겨 「12%를 뒤집은 승리」를 보여 준다 (명예)
 */
export function winChance(minePower: number, theirsPower: number): number {
  return 1 / (1 + Math.exp(-(minePower - theirsPower) / POWER_SCALE));
}

/**
 * 매칭이 「인접하다」고 보는 전투력 폭 (45쪽). 예상 승률 45~55%에 해당한다.
 *
 * 서버가 상대를 고를 때 `|내 전투력 − 상대 전투력| <= MATCH_BAND`를 본다.
 * **화면이 이 폭을 다시 적지 않는다** — 눈금이 바뀌면 조용히 어긋난다.
 */
export const MATCH_BAND = Math.round(POWER_SCALE * Math.log(0.55 / 0.45));

/** 두 부대가 매칭 대상인가 */
export const isAdjacentPower = (a: number, b: number): boolean => Math.abs(a - b) <= MATCH_BAND;

// ═══════════════════════════════════════════════════════════════
// 4. 실측 기록 (2026-08-31 재적합) — 이 상수가 어디서 왔는가
// ═══════════════════════════════════════════════════════════════
//
//   npm run power -- 20000 --calib 5000        (모드당 2만 판, 총 613초)
//
// **왜 다시 쟀나** — 크리티컬 확률(`30+무력차`→`20+무력차`)과 지원책 성공률
// (100% 확정→`시전자지력+대상지력`)을 바꿨다(2026-08-31, GDD §3.5). 둘 다 이 표의
// 원재료인 `autoBattle()` 승패에 직접 영향을 준다 — 재는 것을 안 바꿔도 결과가
// 흔들리므로 **의도된 재측정**이다. 아래 2026-08-17 기록은 옛 공식 기준이라 지운다.
//
// 표본은 **유닛마다 등급(S~D 균등) · 레벨(1~9) · 능력 선택을 독립으로** 굴렸다.
// 고정 정책이면 hp/mp/at이 레벨과 공선이라 셋의 가중치가 분리되지 않는다.
//
// ── 모형이 맞는가 (보정 검사, 적합에 쓰지 않은 새 시드 5천 판) ────────────────
//
//   3v3   예측 승률 11개 구간 전부 실제와 −5.4 ~ +1.5%p
//   5v5   〃                            −2.4 ~ +2.1%p
//
// ── 「전투력이 높은 편성이 이기는가」 (3v3, Δ등급점수 × Δ평균레벨) ─────────────
//
//              Δ레벨 ≤−3   −3~−1   −1~1    1~3    ≥3
//   Δ등급 ≤−12      0.0%    6.6%   10.9%  23.6%  50.0%
//   Δ등급  −2~2    13.0%   27.7%   44.8%  66.8%  81.0%
//   Δ등급  ≥12     51.9%   68.2%   82.5%  92.3%  99.0%
//
//   두 방향 모두 어긋난 칸 없이 단조다. P1 승 50.2%(3v3)·50.0%(5v5) — 선공 이점 없음.
//
// ── 지력 가중치가 실제로 올랐다 — 의도한 변경이 반영됐는지의 검증 ─────────────
//
//   3v3   intellect 0.315 → 0.466 (+48%),  might 1.47 → 1.433 (−3%)
//   5v5   intellect 0.283 → 0.261 (−8%),   might 0.889 → 0.743 (−16%)
//
//   지원책이 더는 공짜가 아니게 되면서 **무력이 지력보다 상대적으로 덜 세졌다** —
//   3v3에서는 지력 가중치 자체가 뚜렷이 올랐고, 5v5에서는 무력이 더 크게 깎여
//   상대적 격차가 좁혀졌다. 둘 다 "고지력 캐릭터가 상대적으로 덜 밀린다"는
//   의도(2026-08-31 논의)와 같은 방향이다. 다만 여전히 지력 가중치가 무력의
//   3분의 1 안팎이라 — 지원책이 저지력을 배제하는 효과는 주로 **지원책을 쓸 수
//   있는가 없는가**에서 오지, 이 계수 자체가 지력 우대로 뒤집힌 것은 아니다.
//
// ── 분포 (균형 성장 기준) ────────────────────────────────────────────────
//
//   3v3 부대   Lv1 D×3 = 211   ~   Lv9 S×3 = 1313
//   5v5 부대   Lv1 D×5 = 238   ~   Lv9 S×5 = 1239
//   유닛 1인   20(헌제 Lv1) ~ 557(3v3) · 308(5v5)
//
//   → 표시는 **세 자리에서 네 자리**. 42쪽의 `000`은 자릿수 힌트가 아니라 예시일
//     뿐이라(기획자 확인) 눈금을 자릿수에 맞추지 않고 `POWER_SCALE`의 뜻에 맞췄다.
//
// ── 모드별 계수가 필요한 이유 (44쪽 「각각 필요」의 근거) ────────────────────
//
//   3v3 계수가 5v5보다 대체로 **1.6~2.3배** 크다(겹치는 건 `mp`뿐, z=0.5) —
//   한 명이 셋 중 하나일 때가 다섯 중 하나일 때보다 판을 더 크게 좌우한다.
//
//   **그래서 두 모드의 값 범위가 비슷해졌다** — 계수가 작아진 만큼 인원이 늘어
//   상쇄된다(3v3 211~1313, 5v5 238~1239). 나란히 놓으면 비교하고 싶어지는 숫자인데
//   **비교하면 안 된다.** `battlePower()`가 인원 불일치에 예외를 던지는 이유다.
//
// ── 기물을 뺀 대가 (기획자 확정, 위 주석) ────────────────────────────────
//
//   3v3   Rock +16.9 · Knight +18.9 · Queen +26.4 · Bishop −6.9 (Pawn 기준)
//         → 전투력이 같아도 기물 조합만으로 승률이 최대 8.3%p 갈린다
//   5v5   Rock +8.7 · Bishop +6.5 · Knight +8.6 · Queen +8.2 → 최대 2.2%p
//
//   매칭이 이만큼은 못 맞춘다는 뜻이다. 구간 폭(±20 = 승률 ±5%p)과 비슷한 크기라
//   **기물 때문에 한 구간만큼 어긋날 수 있다**고 보면 된다.
//   Bishop이 3v3에서만 음수인 것은 전투력과 별개의 밸런스 관찰이다 (GDD §11).

