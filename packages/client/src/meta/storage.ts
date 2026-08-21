/**
 * 계정 저장 — **`server-api`가 정본이다** (H3a, 2026-08-20에 `localStorage`에서 옮겼다).
 *
 * `@samchess/meta`는 순수 규칙만 갖고 I/O를 모른다. 저장 자리를 여기 하나로 몰아 두면
 * 저장 위치가 바뀔 때 **이 파일만** 바뀐다 — 룰 엔진과 화면 사이에 `playback.ts`를 둔 것과
 * 같은 이유다.
 *
 * ────────────────────────────────────────────────────────────────
 * 로컬은 이제 **캐시**다 — 정본이 아니다
 * ────────────────────────────────────────────────────────────────
 *
 * `localStorage`(`samchess.profile.cache`)에는 마지막으로 서버에서 받은 스냅샷을
 * 하나 둔다. 서버가 안 닿을 때 **읽기만** 이걸로 물러난다(오프라인 표시와 함께) —
 * **쓰기는 막는다.** 오프라인 상태에서 진행한 것을 로컬에 몰래 쌓아 두면, 나중에
 * 서버 값과 갈라져 어느 쪽이 정본인지 다시 정해야 하는 문제가 생긴다(§5-92).
 *
 * > **주의: 이름을 바꾸면 id가 바뀐다** (GDD §9). 장수 id는 이름에서 만든 로마자
 * > 슬러그라, 「장요 → 장료」 같은 정정이 생기면 저장된 프로필의 키가 어긋난다.
 * > 없어진 id를 지우는 것도, 옛 형식을 되접는 것도 `@samchess/meta`의
 * > `migrateProfile()`이 한다 — **이 파일에는 읽고 쓰는 일만 남긴다.**
 */

import { migrateProfile, createProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { getAccessToken } from './auth.ts';

const CACHE_KEY = 'samchess.profile.cache';

/** 서버 API 주소. `battle/online.ts`의 `serverUrl()`과 같은 결이다 */
export function apiUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.['VITE_SAMCHESS_API'] ?? 'http://localhost:8787';
}

/** 마지막으로 서버가 준 값을 그대로 읽는다 — 검증하지 않는다(캐시가 곧 정본이던 값이다) */
function readCache(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? migrateProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(profile: PlayerProfile): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(profile)); } catch { /* 무시 */ }
}

/** 마지막 서버 왕복이 실패했는가 — 화면이 "오프라인" 표시를 켤 때 읽는다 */
let offline = false;
export function isOffline(): boolean { return offline; }

/** `meta/aiBattle.ts`도 쓴다 — 계정 API를 부르는 자리는 이 함수 하나다 */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new Error('로그인이 필요하다');
  return fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

/**
 * 로그인한 계정의 프로필을 읽는다.
 *
 * - 서버에 있으면 그대로 돌려주고 캐시를 갱신한다.
 * - 서버에 **없으면**(404) 로컬 캐시가 남아 있는 경우에만 그걸 한 번 올린다(1회 이전) —
 *   그 외에는 `null`(새 계정 흐름으로 보낸다).
 * - 서버에 **못 닿으면** 캐시를 읽기 전용으로 돌려주고 `isOffline()`을 켠다.
 */
export async function loadProfile(): Promise<PlayerProfile | null> {
  try {
    const res = await authedFetch('/profile');
    if (res.status === 404) {
      offline = false;
      const cached = readCache();
      if (!cached) return null;
      await saveProfile(cached); // 1회 이전 — 실패해도 화면은 이 값으로 시작한다
      return cached;
    }
    if (!res.ok) throw new Error(`GET /profile → ${res.status}`);
    const profile = migrateProfile(await res.json());
    offline = false;
    if (profile) writeCache(profile);
    return profile;
  } catch (err) {
    console.warn('[storage] 프로필을 못 읽었다 — 캐시로 물러난다', err);
    offline = true;
    return readCache();
  }
}

/**
 * 저장한다. **실패해도 던지지 않는다** — 온라인이 안 되는 것 때문에 게임이 멈추면
 * 안 된다(§5-61과 같은 결). 성공했을 때만 캐시를 갱신한다 — 실패한 쓰기를 캐시에
 * 반영하면 다음에 오프라인으로 물러날 때 "저장 안 된 것"을 저장된 것처럼 보여 준다.
 *
 * **호출 순서대로 하나씩 나간다** — `App.tsx`의 `setProfile()`은 부르고 기다리지
 * 않는다(화면이 매번 저장 완료를 기다리면 느려진다). 그런데 클릭이 잦으면 `PUT`이
 * 여러 개 동시에 날아가고, **네트워크는 보낸 순서대로 도착한다고 보장하지 않는다** —
 * 늦게 보낸 것이 먼저 land하면 그 뒤에 도착하는 **먼저 보낸(옛) 값이 나중에 덮어써
 * 최신 상태를 지운다.** 그래서 여기서 앞선 저장이 끝나기 전에는 다음 저장의 요청
 * 자체를 시작하지 않는다 — 응답을 기다렸다가 보내면 도착 순서가 보낸 순서와 같아진다.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * 지금까지 넣은 저장이 다 나갈 때까지 기다린다.
 *
 * `App.tsx`가 부르고 기다리지 않는 `saveProfile()`과 짝이다 — 화면은 기다릴 필요가
 * 없지만(§5-61), **브라우저를 실제로 새로고침하기 직전에는 기다려야 한다**. 자연스러운
 * 새로고침(F5)이 진행 중인 요청을 끊어 버릴 수 있는 것은 이 계약 밖의 일반적인
 * 브라우저 동작이다(그건 여기서 막지 않는다) — 이 함수는 "이미 부른 저장이 실제로
 * 끝났는가"만 알려 준다. `App.tsx`의 확인용 통로(`window.__profile.flush`)가 쓴다.
 */
export function pendingSave(): Promise<unknown> { return writeQueue; }

export function saveProfile(profile: PlayerProfile): Promise<boolean> {
  const run = writeQueue.then(async () => {
    try {
      const res = await authedFetch('/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error(`PUT /profile → ${res.status}`);
      offline = false;
      writeCache(profile);
      return true;
    } catch (err) {
      console.warn('[storage] 저장하지 못했다 — 오프라인으로 표시한다', err);
      offline = true;
      return false;
    }
  });
  writeQueue = run;
  return run;
}

/** 로그아웃·계정 전환 때 캐시를 지운다 — 다음 사람의 오프라인 화면에 내 프로필이 남지 않게 */
export function clearCache(): void {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* 무시 */ }
}

/** 새 계정. 시드는 이름에서 뽑아 같은 이름이면 같은 초기 장수가 나오게 한다 */
export function startProfile(cityName: string): PlayerProfile {
  let seed = 0;
  for (const ch of cityName) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return createProfile(cityName.trim() || '무명성', seed || 1);
}
