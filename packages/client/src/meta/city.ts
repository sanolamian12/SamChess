/**
 * 도시 행위 — 증축 · 건설 · 치료를 **서버에 시킨다** (2026-09-04, GDD §5 · §10).
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 `PUT /profile`로는 안 되는가 ★
 * ────────────────────────────────────────────────────────────────
 *
 * `PUT`은 `materials` · `buildings` · `buildCredits` · `hospitalBusy` · 부상을
 * **통째로 버리고 서버 값으로 되쓴다**(H3d가 `grain`에 세운 그대로). 그래서 그 값을
 * 바꾸는 행위를 로컬에서 계산해 `PUT`으로 올리면 **아무 오류 없이 삼켜진다** —
 * 화면에는 「증축했는데 자재만 줄고 레벨은 그대로」로 보인다. 무승부의 군량 택1이
 * `/battle/draw-result`를 새로 만들어야 했던 것과 같은 자리다.
 *
 * 그래서 **보내는 것은 「무엇을」뿐**이고 판정·계산·시각은 전부 서버가 한다.
 * 돌아오는 것은 새 프로필 전체이므로, 화면은 자기가 계산한 값을 정본으로 삼지
 * 않고 **받은 것으로 갈아 끼운다.**
 *
 * ────────────────────────────────────────────────────────────────
 * 실패하면 로컬로 물러난다
 * ────────────────────────────────────────────────────────────────
 *
 * 「서버가 꺼져 있어도 게임은 돈다」(§5-61)가 여기도 선다 — 부르는 쪽이 `null`을
 * 받으면 `@samchess/meta`의 같은 순수 함수를 로컬로 적용하고 `PUT`으로 올린다.
 * **그 순간에만 치팅 표면이 예전 수준으로 돌아간다**(`PUT`이 되쓰므로 실제로는
 * 다음 왕복에서 정정되지만, 화면은 그때까지 자기 값을 보여 준다).
 *
 * **서버가 거부한 이유는 그대로 던진다** — 「왜 안 되는지도 규칙이 말한다」가
 * API를 건너서도 서야 하기 때문이다. 규칙이 거부한 것(400)과 서버에 못 닿은
 * 것(그 외)은 **다른 사건**이라, 앞쪽은 사람에게 보여 주고 뒤쪽만 물러난다.
 */

import { migrateProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { BuildingId } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { authedFetch } from './storage.ts';

/** 규칙이 거부했다 — 사람에게 보여 줄 말이 들어 있다. 물러나면 안 되는 실패다 */
export class CityActionRejected extends Error {}

async function post(path: string, body: unknown): Promise<PlayerProfile | null> {
  let res: Response;
  try {
    res = await authedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(`[city] ${path} 에 못 닿았다 — 로컬로 물러난다`, err);
    return null;
  }
  if (res.status === 400) {
    // 규칙이 거부했다. 로컬로 물러나 봐야 같은 이유로 거부되므로 그대로 알린다
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new CityActionRejected(body.error ?? '할 수 없는 일이다');
  }
  if (!res.ok) {
    console.warn(`[city] ${path} → ${res.status} — 로컬로 물러난다`);
    return null;
  }
  const profile = migrateProfile(await res.json());
  if (!profile) {
    console.warn(`[city] ${path} 가 잘못된 프로필을 줬다 — 로컬로 물러난다`);
    return null;
  }
  return profile;
}

/** 도시를 한 단계 올린다. `null`이면 서버에 못 닿았다는 뜻 */
export const upgradeCityOnServer = (): Promise<PlayerProfile | null> => post('/city/upgrade', {});

/** 건물을 짓거나 한 단계 올린다 */
export const buildOnServer = (building: BuildingId): Promise<PlayerProfile | null> =>
  post('/city/build', { building });

/** 부상 장수를 병원 room에 넣는다 */
export const healOnServer = (officer: OfficerId): Promise<PlayerProfile | null> =>
  post('/city/heal', { officer });
