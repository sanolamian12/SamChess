/**
 * 계정 저장 — 지금은 브라우저 `localStorage`다.
 *
 * `@samchess/meta`는 순수 규칙만 갖고 I/O를 모른다. 저장 자리를 여기 하나로 몰아 두면
 * **온라인이 붙을 때 이 파일만 서버 API로 바뀐다** — 화면은 그대로다.
 * 룰 엔진과 화면 사이에 `playback.ts`를 둔 것과 같은 이유다.
 *
 * > **주의: 이름을 바꾸면 id가 바뀐다** (GDD §9). 장수 id는 이름에서 만든 로마자
 * > 슬러그라, 「장요 → 장료」 같은 정정이 생기면 저장된 프로필의 키가 어긋난다.
 * > 없어진 id를 지우는 것도, 옛 형식을 되접는 것도 `@samchess/meta`의
 * > `migrateProfile()`이 한다 — **이 파일에는 읽고 쓰는 일만 남긴다.**
 *
 * > **형식이 달라도 계정을 버리지 않는다** (2026-08-17, 저장 형식 v2). 예전에는
 * > `version`이 다르면 곧바로 `null`이었다. 부대(E)와 전적(C1)이 쌓이기 시작하면
 * > 형식을 올릴 때마다 사람의 기록이 날아가므로 「채워 넣기」로 뒤집었다.
 */

import { migrateProfile, createProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';

/**
 * 저장 자리의 이름.
 *
 * > **끝의 `v1`은 형식 버전이 아니라 이름의 일부다.** 형식 버전은 프로필 안의
 * > `version` 필드이고, 그것이 올라도 이 키는 그대로여야 한다 — 키를 함께 바꾸면
 * > 되접을 대상이 사라져 마이그레이션을 만든 뜻이 없어진다.
 */
const KEY = 'samchess.profile.v1';

/**
 * 개발용 계정 갈래 — `?seat=2`면 **다른 계정**을 쓴다.
 *
 * 같은 브라우저의 두 탭은 `localStorage`가 같아 계정이 하나다. 온라인 대전을
 * 혼자 확인하려면 탭 둘이 필요한데, 계정이 하나면 **한쪽의 군량 차감이 다른
 * 쪽에도 보이고** 상대의 부대가 곧 내 부대가 된다. 접미사 하나로 가른다.
 *
 * **개발용 통로다** — 로그인(H3)이 붙으면 계정이 서버에 있으므로 함께 지운다.
 * 「카드 +5」·「금화 +10」·`?demo=1`과 같은 자리다.
 */
const seatKey = (): string => {
  const seat = new URLSearchParams(location.search).get('seat');
  return seat && seat !== '1' ? `${KEY}.seat${seat}` : KEY;
};

/**
 * 저장된 계정을 읽어 지금 형식으로 되접는다.
 *
 * **되접었으면 그 자리에서 저장한다.** 안 그러면 옛 형식이 디스크에 남아 접속할
 * 때마다 다시 되접히고, 「살릴 수 있는 만큼 살린」 복구도 굳지 않는다.
 * 바뀐 게 없으면 쓰지 않는다 — 읽기만 했는데 저장 시각이 흔들릴 이유가 없다.
 */
export function loadProfile(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(seatKey());
    if (!raw) return null;
    const profile = migrateProfile(JSON.parse(raw));
    if (profile && JSON.stringify(profile) !== raw) saveProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(seatKey(), JSON.stringify(profile));
  } catch {
    // 저장 실패(사생활 보호 모드 등)로 게임이 멈추지는 않게 한다
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(seatKey());
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
