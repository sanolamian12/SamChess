/**
 * 수비군 — 성을 지키는 부대 (2026-10-27 기획자 확정, GDD §8.8 단계 1)
 *
 * 공성전(GDD §8.8)에서 다른 플레이어가 공격해 오면 **수비군**이 성을 지킨다 — AI가 조종한다.
 * 모드(3v3 · 5v5)마다 부대 하나다. **수비대 칸이 곧 수비군이다**(2026-11-14 부대 개편 — 그전에는 부대 여럿 가운데
 * 하나를 고르고, 안 고르면 첫 부대였다. 그 고르기 · `PlayerProfile.garrison`은 없어졌다). 같은 장수가 공격대에도
 * 함께 설 수 있다. 농지의 **보초병**(`raid.ts`의 `guardsOf`)과는 다르다 — 보초병은
 * 부대에 들 수 없으니(`releaseGuards`) 수비군에도 들 수 없다.
 *
 * 읽는 자리는 `garrisonOf()` 하나다 — 화면 · 출정 잠금 · 서버의 스냅샷(`defenses` 표)이 같은 답을 본다.
 *
 * **출정 조건이 이것을 본다**(`sortieGate`) — 두 모드 모두 수비군이 서야 [출정하기]가 열린다.
 *
 * meta는 시계 · 난수를 안 읽는다.
 */

import type { BattleMode, DefensePolicy, RosterEntry, Side, UnitId, Vec2 } from '@samchess/rules';
import { resolvePolicy } from './garrisonPolicy.ts';
import { battlePower } from './power.ts';
import { toRosterEntries, validateRoster } from './roster.ts';
import { squadAt, squadDeployment } from './squads.ts';
import type { MetaResult, PlayerProfile, Squad } from './types.ts';

/** 수비군이 서는 모드 — 둘 다 있어야 출정한다 */
export const GARRISON_MODES: readonly BattleMode[] = ['3v3', '5v5'];

/** 수비군은 북군(P2)에 선다 — 공격하는 쪽이 남군(P1). 배치 프리셋도 그 진영 것을 쓴다 */
export const GARRISON_SIDE: Side = 'P2';

/** 방어 AI 방침 — 엔진의 `DefensePolicy`(풀린 값). 부대에 저장하고 판에 싣는 것은 `garrisonPolicy.ts` (GDD §8.8 단계 6) */
export type GarrisonPolicy = DefensePolicy;

/** 수비군이 될 수 있는 부대인가 — 저장된 부대가 지금 계정으로 성립하는가(장수가 빠지지 않았는가) */
const standing = (profile: PlayerProfile, squad: Squad): boolean =>
  validateRoster(profile, squad.mode, squad.picks, false).ok;

/** 그 모드의 수비군 — **수비대 칸**. 비었거나 성립하지 않으면(장수가 계정에서 빠졌다) `null` */
export function garrisonOf(profile: PlayerProfile, mode: BattleMode): Squad | null {
  const squad = squadAt(profile, mode, 'defense');
  return squad && standing(profile, squad) ? squad : null;
}

/** 이 부대가 지금 수비군인가 — 수비대 칸이고 성립한다 */
export const isGarrison = (profile: PlayerProfile, squad: Squad): boolean =>
  garrisonOf(profile, squad.mode)?.id === squad.id;

/**
 * **출정 조건의 수비군 몫** — 두 모드 모두 수비군이 서 있는가. 없으면 코드 `sortie.noGarrison`과
 * 모자란 모드의 인원(`size` 3 · 5)을 싣는다. 부르는 자리는 `sortieGate()` 하나다.
 */
export function garrisonGate(profile: PlayerProfile): MetaResult {
  for (const mode of GARRISON_MODES) {
    if (!garrisonOf(profile, mode)) {
      const size = mode === '3v3' ? 3 : 5;
      return {
        ok: false, code: 'sortie.noGarrison', params: { size },
        reason: `${size}대${size} 수비대를 채워야 출정할 수 있다 — 수비대가 성을 지키는 수비군이다`,
      };
    }
  }
  return { ok: true };
}

/**
 * 수비군 한 모드의 **스냅샷** — 공성전의 상대가 이 값으로 선다(GDD §8.8). 서버가 계정을 쓸 때마다 다시 내
 * `defenses` 표에 둔다(`server-api/src/defenses.ts`).
 *
 * 명단 · 전투력은 **시각 없이** 낸다 — 매칭 화면과 같은 눈금이고, 수비군은 부상을 입지 않는다(GDD §8.8).
 * 배치는 북군 프리셋이 어긋나면 `null`(공격할 때 기본 배치가 깔린다 — §8.6과 같다).
 */
export interface GarrisonSnapshot {
  mode: BattleMode;
  squadId: string;
  /** 남에게 보이는 부대 이름 — **도시 이름**이다(아이디가 곧 부대명, 2026-11-14). `defenses.squad_name` 열이 이것이다 */
  squadName: string;
  power: number;
  entries: RosterEntry[];
  deploy: { unit: UnitId; pos: Vec2 }[] | null;
  policy: GarrisonPolicy;
}

export function garrisonSnapshot(profile: PlayerProfile, mode: BattleMode): GarrisonSnapshot | null {
  const squad = garrisonOf(profile, mode);
  if (!squad) return null;
  const entries = toRosterEntries(profile, squad.picks);
  return {
    mode,
    squadId: squad.id,
    squadName: profile.cityName,
    power: battlePower(mode, entries),
    entries,
    deploy: squadDeployment(profile, squad, GARRISON_SIDE),
    policy: resolvePolicy(profile, squad),
  };
}

/** 두 모드의 스냅샷 — 선 것만 */
export const garrisonSnapshots = (profile: PlayerProfile): GarrisonSnapshot[] =>
  GARRISON_MODES.map((m) => garrisonSnapshot(profile, m)).filter((s): s is GarrisonSnapshot => s !== null);
