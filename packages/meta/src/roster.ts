/**
 * 기물 편성 — GDD §3.9 「기물 편성」
 *
 * ```
 * King 필수 + 나머지 기물을 1개씩만 선택 → 각 기물에 장수 카드 매치
 * ```
 *
 * **엔진이 최종 권위다.** `createBattle`이 인원수·기물 중복·King 필수·장수 중복을 다시 검사하고
 * 어기면 던진다. 여기서 하는 일은 그보다 앞서서 **왜 안 되는지 화면에 말해 주는 것**과,
 * 엔진이 모르는 것(보유 여부·군량)을 보태는 것이다. 전투 UI가 `validate()`에 묻는 것과 같은 결이다.
 */

import { officerById } from '@samchess/data';
import { UNITS_PER_SIDE, hash32 } from '@samchess/rules';
import type { BattleMode, OfficerId, PieceType, RosterEntry } from '@samchess/rules';
import { statPicksOf, tacticsOf } from './profile.ts';
import type { MetaResult, OfficerInstance, PlayerProfile, RosterPick } from './types.ts';

/** 편성에 쓸 수 있는 기물 6종. King은 반드시 들어간다 */
export const PIECE_TYPES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];

/** 대전 참가 군량 — 기물 1개당 1 (GDD §6.1) */
export const grainCost = (mode: BattleMode): number => UNITS_PER_SIDE[mode];

export const teamSize = (mode: BattleMode): number => UNITS_PER_SIDE[mode];

/**
 * 편성이 성립하는지 본다. 화면은 이 결과를 그대로 보여주고, 통과했을 때만 출전 버튼을 켠다.
 *
 * `checkGrain`을 끄면 군량만 빼고 검사한다 — 편성 도중에는 아직 낼 수 있는 상태가 아니라서
 * "군량이 모자란다"를 계속 띄우면 방해가 된다.
 */
export function validateRoster(
  profile: PlayerProfile,
  mode: BattleMode,
  picks: readonly RosterPick[],
  checkGrain = true,
): MetaResult {
  const need = teamSize(mode);
  if (picks.length !== need) return no(`${mode}은 ${need}명을 채워야 한다 — 지금 ${picks.length}명`);

  const pieces = new Set(picks.map((p) => p.piece));
  if (pieces.size !== picks.length) return no('기물은 종류당 1개만 고를 수 있다');
  if (!pieces.has('King')) return no('King(군주)은 반드시 넣어야 한다');

  // 한 진영에 같은 장수가 둘 이상 나오지 않는다 (GDD §12, 2026-07-31 확정)
  const officers = new Set(picks.map((p) => p.officer));
  if (officers.size !== picks.length) return no('같은 장수를 두 번 넣을 수 없다');

  for (const pick of picks) {
    if (!profile.roster[pick.officer]) {
      const name = officerById.get(pick.officer)?.name ?? pick.officer;
      return no(`보유하지 않은 장수다 — ${name}`);
    }
  }
  if (checkGrain && profile.grain < grainCost(mode)) {
    return no(`군량이 모자란다 — ${profile.grain}/${grainCost(mode)}`);
  }
  return { ok: true };
}

/**
 * 편성을 룰 엔진이 받는 형식으로 옮긴다.
 *
 * 레벨·능력 선택·책략은 **보유 장수 인스턴스에서 그대로 가져온다** — 편성 화면에서 다시
 * 고르는 것이 아니다. 빌드는 장수 관리(레벨업)에서 결정된다(GDD §4.2).
 *
 * **여기가 성장 스택이 평탄해지는 유일한 자리다.** 룰 엔진의 `RosterEntry`는 예전처럼
 * `{level, statPicks, tactics}` 평면 형식이라, 저장 형식이 v2로 바뀌어도
 * `packages/rules`는 한 글자도 안 바뀐다. 전투력(`power.ts`)도 이 형식만 본다.
 *
 * ────────────────────────────────────────────────────────────────
 * 부대의 **레벨 하향도 여기 하나에 걸린다** ★ (E · 42쪽)
 * ────────────────────────────────────────────────────────────────
 *
 * `pick.level`은 「상한」이지 「스냅샷」이 아니다 — 그 레벨의 능력치·책략을 새로
 * 정하는 것이 아니라 **성장 스택에서 그대로 꺼낸다**(`growthUpTo`의 `slice`).
 * 그래서 하향 Lv5는 처음부터 Lv5로 키운 캐릭터와 **완전히 같다**(회귀가 고정한다).
 *
 * **보유 레벨보다 크면 눌러 담는다.** 재설계(둔갑천서)로 Lv9가 Lv1이 되면 저장된
 * 부대가 「Lv9 조조」를 가리킨 채 남는데, 그대로 두면 `createBattle`이 전투 직전에
 * 던진다 — 화면에는 아무 표시도 없다. 눌러 담으면 **약해지는 방향**이라 안전하고,
 * 「저장된 부대는 언제나 룰 엔진을 통과한다」가 계약으로 선다.
 */
export function toRosterEntries(profile: PlayerProfile, picks: readonly RosterPick[]): RosterEntry[] {
  return picks.map((pick) => {
    const inst = profile.roster[pick.officer];
    if (!inst) throw new Error(`보유하지 않은 장수다: ${pick.officer}`);
    const level = pickLevel(inst, pick.level);
    return {
      officer: inst.officer,
      piece: pick.piece,
      level,
      // 성장 스택을 직접 펴지 않는다 — 파생 함수 둘이 단일 출처다(레벨 하향이 여기 걸린다)
      statPicks: statPicksOf(inst, level),
      tactics: tacticsOf(inst, level),
    };
  });
}

/**
 * 편성 한 자리가 실제로 설 레벨. **1 ~ 보유 레벨로 눌러 담는다.**
 *
 * `growthUpTo()`도 같은 범위로 자르므로 둘은 언제나 맞물린다 — 여기서 따로 세면
 * 「레벨은 5인데 능력 선택이 여섯」 같은 것이 나와 엔진이 던진다.
 */
export function pickLevel(inst: OfficerInstance, wanted?: number): number {
  if (wanted === undefined || !Number.isFinite(wanted)) return inst.level;
  return Math.max(1, Math.min(Math.floor(wanted), inst.level));
}

/** 군량을 낸다. 전투를 시작할 때 한 번 부른다 */
export function spendGrain(profile: PlayerProfile, mode: BattleMode): PlayerProfile {
  const cost = grainCost(mode);
  if (profile.grain < cost) throw new Error(`군량이 모자란다: ${profile.grain}/${cost}`);
  return { ...profile, grain: profile.grain - cost };
}

/**
 * 상대(AI) 편성을 시드에서 결정적으로 뽑는다.
 *
 * **내 팀의 등급 점수에 맞춘다** (GDD §7의 팀 등급 점수) — 아무나 뽑으면 S급 셋을 들고
 * D급 셋을 만나거나 그 반대가 되어 대전이 성립하지 않는다. 완전히 같은 점수를 맞추기보다
 * 가까운 것을 고르는 쪽이 편성이 다양해진다.
 */
export function makeAiPicks(
  mode: BattleMode,
  myScore: number,
  seed: number,
  gradeScoreOf: (officer: OfficerId) => number,
  pool: readonly OfficerId[],
): RosterPick[] {
  const size = teamSize(mode);
  const target = myScore / size;
  // 점수 차가 작은 순으로 후보를 세우고, 시드로 그 앞쪽에서 고른다
  const ranked = [...pool].sort((a, b) =>
    Math.abs(gradeScoreOf(a) - target) - Math.abs(gradeScoreOf(b) - target)
    || a.localeCompare(b));

  const picks: RosterPick[] = [];
  const used = new Set<OfficerId>();
  const pieces: PieceType[] = ['King', ...shuffled(PIECE_TYPES.filter((p) => p !== 'King'), seed)];

  for (let i = 0; i < size; i++) {
    // 앞쪽 후보군(팀 크기의 4배) 안에서 골라 매번 같은 얼굴만 나오지 않게 한다
    const window = ranked.filter((o) => !used.has(o)).slice(0, Math.max(1, size * 4));
    const chosen = window[hash32(seed, i * 131 + 7) % window.length]!;
    used.add(chosen);
    picks.push({ piece: pieces[i]!, officer: chosen });
  }
  return picks;
}

/** Fisher–Yates를 시드 해시로 돌린다 (`Math.random()` 금지 — 룰 엔진과 같은 규약) */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hash32(seed, i * 7717) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const no = (reason: string): MetaResult => ({ ok: false, reason });
