/**
 * 대장간 완성 알림의 「봤다」 두 가지 — 판정이 아니라 이 브라우저의 화면 편의값이라 `localStorage`에 둔다.
 *
 * - **축하 화면을 봤다**(`celebrated`) — 대장간에 들어가 「제작 완료」 축하를 본 자루. 그 뒤로는 어디서도 안 알린다.
 * - **메인에서 불렀다**(`called`, 2026-11-22 기획자) — 완성됐는데 아직 대장간에 안 온 자루를, 메인(성 안이든 산 너머든)에서
 *   대장장이가 오른쪽 아래로 나와 「대장간으로 와 주세요」라고 **한 번** 불렀다. 안 오고 다시 메인에 와도 또 부르지 않는다.
 *
 * 키는 자루에 **제작 시각**을 붙인 것(`{id}#{n}@{madeAt}`)이다 (2026-11-23). 자루 번호만 적었더니 이 값이 계정과 상관없이 브라우저에 남아,
 * 시험 계정에서 「Lv1 병기 #1」의 축하를 본 브라우저는 **새 계정이 처음 만든 같은 병기**의 축하도 대장장이 부름도 건너뛰었다
 * (기획자 실기 — 1분 제작 뒤 아무 일도 없이 보유 1만 늘었다). 제작 시각은 자루마다 한 번 찍히고(`collectForgeOrder`) 안 바뀐다.
 * 못 읽거나 못 쓰면 조용히 다시 보여 줄 뿐이다 — 판정에 안 쓰는 값이다.
 * 계정 저장 형식에 끼워 넣으면 「알림을 봤는가」 같은 것까지 서버 왕복을 타게 된다.
 */
import { equipmentById } from '@samchess/data';
import type { EquipmentData } from '@samchess/data';
import { equipmentIdOfKey } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';

const CELEBRATED_KEY = 'samchess.forge.celebrated';
const CALLED_KEY = 'samchess.forge.called';

function load(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    // v5까지는 병기 id를 적었다 — 키가 자루(`{id}#{n}`)가 되며(v6) 옛 기록은 `#1`로 읽는다.
    // 안 그러면 이미 본 완성 알림이 되접기 뒤에 한 번씩 다시 뜬다
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(ids.map((k) => (k.includes('#') ? k : `${k}#1`)));
  } catch {
    return new Set();
  }
}
function save(key: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* 못 쓰면 다음에도 다시 뜰 뿐 — 판정에 안 쓰는 값이다 */
  }
}

export const loadCelebrated = (): Set<string> => load(CELEBRATED_KEY);
export const saveCelebrated = (ids: Set<string>): void => save(CELEBRATED_KEY, ids);

/** 「봤다」를 적는 열쇠 — 자루 + 제작 시각(위 머리말). 제작 시각이 아직 안 찍힌 옛 자루는 자루만 */
function sightKey(profile: PlayerProfile, key: string): string {
  const madeAt = profile.forgeMadeAt?.[key];
  return madeAt ? `${key}@${madeAt}` : key;
}

/** 완성됐지만 대장간에서 아직 축하를 못 본 자루 — 미지급(`null`)이고 `celebrated`에 없는 것. `key`는 「봤다」 열쇠(`sightKey`)다 */
export function unseenForged(profile: PlayerProfile, celebrated: Set<string>): { key: string; item: EquipmentData }[] {
  const out: { key: string; item: EquipmentData }[] = [];
  for (const [key, holder] of Object.entries(profile.forgeOwned)) {
    const sight = sightKey(profile, key);
    if (holder !== null || celebrated.has(sight)) continue;
    const item = equipmentById.get(equipmentIdOfKey(key));
    if (item) out.push({ key: sight, item });
  }
  return out;
}

/** 축하를 아직 못 본 자루가 있나 — 메인의 [제작 완료] 단추(`App.tsx`) */
export const hasUnseenForged = (profile: PlayerProfile): boolean => unseenForged(profile, loadCelebrated()).length > 0;

/** 메인에서 불러야 할 자루 — 아직 축하를 못 봤고, 메인에서 부른 적도 없는 것 */
export function forgeCallKeys(profile: PlayerProfile): string[] {
  const called = load(CALLED_KEY);
  return unseenForged(profile, loadCelebrated()).map((u) => u.key).filter((k) => !called.has(k));
}

/** 불렀다 — 말풍선이 펴진 순간 적는다(✔를 안 눌러도 들은 것이다) */
export function markForgeCalled(keys: string[]): void {
  const called = load(CALLED_KEY);
  keys.forEach((k) => called.add(k));
  save(CALLED_KEY, called);
}
