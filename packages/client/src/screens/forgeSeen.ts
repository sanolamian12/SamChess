/**
 * 대장간 연구 완료 알림 (2026-11-28 대장간 연구 개편).
 *
 * - **축하를 봤나**는 서버가 쥔다(`forge.notice` — 본 뒤에야 장터에 진열되므로 판정에 쓰인다). `POST /forge/ack`가 비운다.
 * - **메인에서 불렀나**(2026-11-22 기획자) — 끝났는데 아직 대장간에 안 온 연구를, 메인에서 대장장이가 오른쪽 아래로 나와
 *   「대장간으로 와 주세요」라고 **한 번** 부른다. 이것은 화면 편의값이라 `localStorage`에 둔다(못 읽으면 한 번 더 부를 뿐).
 *
 * 「불렀다」의 열쇠는 그 연구의 **레벨 + 끝난 시각**이다 — 계정과 상관없이 브라우저에 남는 값이라, 레벨만 적으면 시험 계정에서 본
 * 「Lv1 연구」가 새 계정의 Lv1 연구 부름을 건너뛴다(2026-11-23 옛 자루 알림이 그렇게 틀렸다). 끝난 시각은 한 번 찍히고 안 바뀐다.
 */
import type { PlayerProfile } from '@samchess/meta';

const CALLED_KEY = 'samchess.forge.called';

function load(): Set<string> {
  try {
    const raw = window.localStorage.getItem(CALLED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function save(ids: Set<string>): void {
  try {
    window.localStorage.setItem(CALLED_KEY, JSON.stringify([...ids]));
  } catch {
    /* 못 쓰면 다음에도 다시 부를 뿐 — 판정에 안 쓰는 값이다 */
  }
}

/** 축하를 아직 못 본 연구가 있나 — 메인의 [연구 완료] 단추(`App.tsx`) */
export const hasUnseenForged = (profile: PlayerProfile): boolean => (profile.forge?.notice?.length ?? 0) > 0;

/** 축하를 기다리는 연구의 열쇠들 — 그 병기가 든 레벨 줄마다 `lv{L}@{끝난 시각}` */
function unseenKeys(profile: PlayerProfile): string[] {
  const notice = new Set(profile.forge?.notice ?? []);
  return (profile.forge?.done ?? []).filter((d) => d.items.some((id) => notice.has(id))).map((d) => `lv${d.level}@${d.doneAt}`);
}

/** 메인에서 불러야 할 연구 — 아직 축하를 못 봤고, 메인에서 부른 적도 없는 것 */
export function forgeCallKeys(profile: PlayerProfile): string[] {
  const called = load();
  return unseenKeys(profile).filter((k) => !called.has(k));
}

/** 불렀다 — 말풍선이 펴진 순간 적는다(✔를 안 눌러도 들은 것이다) */
export function markForgeCalled(keys: string[]): void {
  const called = load();
  keys.forEach((k) => called.add(k));
  save(called);
}
