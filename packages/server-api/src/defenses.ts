/**
 * 수비군 스냅샷을 `defenses` 표에 맞춘다 (2026-10-27, GDD §8.8 단계 1 · `sql/schema.sql`).
 *
 * **계정을 쓰는 트랜잭션 안에서** 부른다(`profileStore.ts`의 `transact` · `saveProfileTrusted`) — 계정과 수비군이
 * 갈리지 않는다. 무엇이 수비군인지 · 명단 · 전투력은 meta의 `garrisonSnapshots()`가 정하고 여기는 옮겨 적기만 한다.
 * 쓰기 전과 후의 줄이 같으면 아무것도 안 한다 — 계정 쓰기는 AI 대전의 수 하나마다 오는 요청이라 잦다.
 */
import type { PoolClient } from 'pg';
import { garrisonSnapshots } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';

/** 표의 한 줄 — `schema.sql`의 `defenses`와 칸이 같다 */
export interface DefenseRow {
  mode: '3v3' | '5v5';
  squadId: string;
  squadName: string;
  power: number;
  cityLevel: number;
  snapshot: { entries: unknown; deploy: unknown; policy: unknown };
}

/** 계정 하나의 줄들 — 선 수비군만. 계정이 성립하지 않으면(명단을 못 만든다) 줄이 없다 */
export function defenseRows(profile: PlayerProfile | null): DefenseRow[] {
  if (!profile) return [];
  try {
    return garrisonSnapshots(profile).map((s) => ({
      mode: s.mode as DefenseRow['mode'],
      squadId: s.squadId,
      squadName: s.squadName,
      power: s.power,
      cityLevel: Math.floor(profile.cityLevel),
      snapshot: { entries: s.entries, deploy: s.deploy, policy: s.policy },
    }));
  } catch {
    return [];
  }
}

/**
 * `before` → `after`로 바뀐 만큼 표를 고친다. `before`가 `null`이면 새 계정이거나 표를 아직 모르는 것 —
 * 그때는 지우고 다시 넣는다(`saveProfileTrusted`처럼 읽지 않고 쓰는 길).
 */
export async function syncDefenses(
  tx: PoolClient, uid: string, before: PlayerProfile | null, after: PlayerProfile, opts: { force?: boolean } = {},
): Promise<void> {
  const next = defenseRows(after);
  if (!opts.force && JSON.stringify(next) === JSON.stringify(defenseRows(before))) return;
  await tx.query('delete from defenses where uid = $1 and not (mode = any($2::text[]))', [uid, next.map((r) => r.mode)]);
  for (const r of next) {
    await tx.query(
      `insert into defenses (uid, mode, squad_id, squad_name, power, city_level, snapshot, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (uid, mode) do update set squad_id = excluded.squad_id, squad_name = excluded.squad_name,
         power = excluded.power, city_level = excluded.city_level, snapshot = excluded.snapshot, updated_at = now()`,
      [uid, r.mode, r.squadId, r.squadName, r.power, r.cityLevel, JSON.stringify(r.snapshot)],
    );
  }
}
