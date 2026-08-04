/**
 * 계정 저장 — 지금은 브라우저 `localStorage`다.
 *
 * `@samchess/meta`는 순수 규칙만 갖고 I/O를 모른다. 저장 자리를 여기 하나로 몰아 두면
 * **온라인이 붙을 때 이 파일만 서버 API로 바뀐다** — 화면은 그대로다.
 * 룰 엔진과 화면 사이에 `playback.ts`를 둔 것과 같은 이유다.
 *
 * > **주의: 이름을 바꾸면 id가 바뀐다** (GDD §9). 장수 id는 이름에서 만든 로마자
 * > 슬러그라, 「장요 → 장료」 같은 정정이 생기면 저장된 프로필의 키가 어긋난다.
 * > 지금은 저장 형식 버전(`PROFILE_VERSION`)이 그 신호이고, 맞지 않으면 새로 시작한다.
 */

import { PROFILE_VERSION, createProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { officerById } from '@samchess/data';

const KEY = 'samchess.profile.v1';

export function loadProfile(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerProfile;
    if (parsed.version !== PROFILE_VERSION) return null;
    // 데이터가 바뀌어 없어진 장수가 있으면(이름 정정 등) 조용히 지운다.
    // 남겨 두면 편성 화면에서 이름 없는 칸이 뜬다.
    const roster = parsed.roster as Record<string, unknown>;
    const cards = parsed.cards as Record<string, unknown>;
    for (const id of Object.keys(roster)) if (!officerById.has(id)) delete roster[id];
    for (const id of Object.keys(cards)) if (!officerById.has(id)) delete cards[id];
    return parsed;
  } catch {
    return null;
  }
}

export function saveProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // 저장 실패(사생활 보호 모드 등)로 게임이 멈추지는 않게 한다
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* 무시 */ }
}

/** 새 계정. 시드는 이름에서 뽑아 같은 이름이면 같은 초기 장수가 나오게 한다 */
export function startProfile(cityName: string): PlayerProfile {
  let seed = 0;
  for (const ch of cityName) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const profile = createProfile(cityName.trim() || '무명성', seed || 1);
  saveProfile(profile);
  return profile;
}
