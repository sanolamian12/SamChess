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
import { UNITS_PER_SIDE } from '@samchess/rules';
import type { BattleMode, PieceType, RosterEntry } from '@samchess/rules';
import { statPicksOf, tacticsOf } from './profile.ts';
import { grainCap, isInjured } from './city.ts';
import type { MetaResult, PlayerProfile, RosterPick } from './types.ts';

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
 * 레벨은 **언제나 보유 레벨 그대로다** ★ (2026-09-16 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * 부대는 장수를 가리킬 뿐 레벨을 들지 않는다(`RosterPick` 참조). 그래서 궁궐에서
 * 레벨업·재설계를 하면 그 장수가 속한 **모든 부대**가 다음 전투부터 곧바로 따라간다.
 * 재설계로 Lv9가 Lv1이 되어도 부대가 「Lv9」를 가리킬 방법이 없으니 눌러 담을
 * 것도 없고, **「저장된 부대는 언제나 룰 엔진을 통과한다」**가 구조로 선다.
 *
 * 클라이언트가 보낸 편성에 옛 `level`이 섞여 와도(서버의 AI 재생 검증) 여기서
 * 읽지 않는다 — 레벨을 자칭할 길이 없다.
 *
 * ────────────────────────────────────────────────────────────────
 * 부상은 **`nowMs`를 준 자리에서만** 실린다 ★ (GDD §5.7, 2026-09-04)
 * ────────────────────────────────────────────────────────────────
 *
 * 「빠뜨리면 조용히 안 걸리는」 모양인데 **일부러 그렇다** — 이 함수를 부르는 자리가
 * 뜻이 다른 둘이기 때문이다.
 *
 * | 부르는 곳 | `nowMs` | 왜 |
 * |---|---|---|
 * | 전투를 만들 때 | **넣는다** | 부상을 안고 싸운다 |
 * | 전투력을 잴 때 (`squadPower`·`battlePower`) | **안 넣는다** | 반영하면 **일부러 부상 상태로 나가 약한 상대를 고르는** 길이 열린다 — 매칭이 전투력으로 상대를 고른다(GDD §7.1) |
 *
 * 그래서 기본값이 「부상 무시」다. 회귀가 양쪽을 다 고정한다.
 */
export function toRosterEntries(
  profile: PlayerProfile, picks: readonly RosterPick[], nowMs?: number,
): RosterEntry[] {
  return picks.map((pick) => {
    const inst = profile.roster[pick.officer];
    if (!inst) throw new Error(`보유하지 않은 장수다: ${pick.officer}`);
    const injured = nowMs !== undefined && isInjured(inst, nowMs);
    return {
      officer: inst.officer,
      piece: pick.piece,
      level: inst.level,
      // 성장 스택을 직접 펴지 않는다 — 파생 함수 둘이 단일 출처다
      statPicks: statPicksOf(inst),
      tactics: tacticsOf(inst),
      // `exactOptionalPropertyTypes` — 아닐 때는 키 자체를 안 넣는다
      ...(injured ? { injured: true } : {}),
    };
  });
}

/** 군량을 낸다. 전투를 시작할 때 한 번 부른다 */
export function spendGrain(profile: PlayerProfile, mode: BattleMode): PlayerProfile {
  const cost = grainCost(mode);
  if (profile.grain < cost) throw new Error(`군량이 모자란다: ${profile.grain}/${cost}`);
  return { ...profile, grain: profile.grain - cost };
}

/**
 * **성립하지 않은 판**의 참가비를 돌려준다 (GDD §3.9 이탈 표 · H2).
 *
 * 배치 중에 상대가 사라졌거나, 양쪽이 다 사라졌거나, 양쪽이 손을 놓아 방이 접힌
 * 경우다. **전적도 보상도 없다** — `applyBattleResult`를 부르지 않는 자리이고,
 * 그래서 여기가 계정을 만지는 유일한 곳이다.
 *
 * **창고를 넘기지 않는다** — 상한을 넘겨 돌려주면 「환불로 군량을 불린다」가 된다.
 * 보상이 `Math.min(…, grainCap)`으로 적는 것과 같은 규약이다.
 *
 * ⚠ **사라진 쪽에게는 부르지 않는다** — 돌려주면 참가비를 낸 뒤 끊어서 회피할 수
 * 있어 「다시 찾기」(군량 −1)가 통째로 무력해진다(§5-65). 누구에게 돌려주는지는
 * 서버가 `RoomClose.refund`로 말한다.
 */
export function refundGrain(profile: PlayerProfile, mode: BattleMode): PlayerProfile {
  const cap = grainCap(profile);
  return { ...profile, grain: Math.min(profile.grain + grainCost(mode), cap) };
}

/*
 * **AI 상대 편성은 여기 없다** — `match.ts`의 `makeAiOpponent()`다 (F · 45쪽).
 *
 * 옛 `makeAiPicks()`는 **등급 점수**로 맞췄고, 그래서 레벨을 아예 못 봤다 —
 * Lv9 S급 셋(전투력 1211)이 Lv1 S급 셋(797)을 만났다. 온라인 매칭이 `MATCH_BAND`로
 * 고르는 것과 **같은 눈금**이라야 「상대가 바뀐 것뿐」이 성립하므로 `battlePower()`
 * 기준으로 갈아 끼웠다. 이 파일은 **사람의 편성**만 본다.
 */

const no = (reason: string): MetaResult => ({ ok: false, reason });
