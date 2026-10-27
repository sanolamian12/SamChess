/**
 * 튜토리얼 — 목록 · 진행 · 잠금 · 해금 (G3, `Design/튜토리얼_시나리오_초안.md`, 2026-10-22 기획자)
 *
 * ```
 * 기본 1 (기물 여섯) → 기본 2 (책략 · 아이템 · 협동) → 기본 3 (고유기술 · 시간 · SP)   ← 셋 다 끝나야 [출정하기]
 * S급 (30)  — 그 S급을 **보유**해야 보이고, 기본 셋을 끝내야 켜진다
 * ```
 *
 * - **해금은 저장하지 않고 계산한다.** S급 판이 보이는가 = `ownedOfficers()`(풀 + 보관함)에 그 장수가 있는가.
 *   카드를 얻는 길(가챠 · 전투 보상 · 우편 · 관리자 지급)마다 「해금」을 켜는 코드를 두면, 한 길이 빠졌을 때
 *   조용히 안 열린다.
 * - **완료 기록만 저장한다** — `PlayerProfile.tutorial`, 서버 소유(`SERVER_OWNED_FIELDS`). 보상이 없으므로
 *   재생 검증은 하지 않는다 — 건너뛰어 얻는 것은 [출정하기]가 일찍 열리는 것뿐이다.
 * - **판에 서는 장수는 데이터에 고정이다** — 계정의 카드와 무관하게 언제나 같은 연출(`tutorialBattles.ts`).
 *
 * 순수 함수다. 시계 · 난수를 들이지 않는다.
 */

import { OFFICERS } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { ownedOfficers } from './profile.ts';
import { garrisonGate } from './garrison.ts';
import { raidBlocksSortie } from './raid.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

/** 필수 기본 튜토리얼 — **이 순서로** 열린다 */
export const BASIC_TUTORIALS = ['basic-1', 'basic-2', 'basic-3'] as const;
export type BasicTutorialId = typeof BASIC_TUTORIALS[number];

/** S급 튜토리얼 id — `s-{장수 id}` */
export type STutorialId = `s-${string}`;
export type TutorialId = BasicTutorialId | STutorialId;

/** S급 30명 — 데이터 순서(가나다) 그대로 */
export const S_TUTORIAL_OFFICERS: readonly OfficerId[] = OFFICERS
  .filter((o) => o.grade === 'S')
  .map((o) => o.id as OfficerId);

export const sTutorialId = (officer: OfficerId): STutorialId => `s-${officer}`;

export const ALL_TUTORIALS: readonly TutorialId[] = [...BASIC_TUTORIALS, ...S_TUTORIAL_OFFICERS.map(sTutorialId)];

const KNOWN = new Set<string>(ALL_TUTORIALS);
export const isTutorialId = (id: unknown): id is TutorialId => typeof id === 'string' && KNOWN.has(id);

/**
 * 한 판의 상태.
 *  - `done` — 끝냈다(다시 할 수 있다)
 *  - `open` — 할 수 있다
 *  - `locked` — 보이지만 앞 판을 먼저 끝내야 한다
 *  - `hidden` — 안 보인다(S급인데 그 장수가 없다)
 */
export type TutorialStatus = 'done' | 'open' | 'locked' | 'hidden';

export const tutorialDone = (profile: PlayerProfile, id: TutorialId): boolean =>
  profile.tutorial?.done.includes(id) ?? false;

/** **필수 셋을 다 끝냈는가** — [출정하기]가 열리는 조건 */
export const basicsDone = (profile: PlayerProfile): boolean =>
  BASIC_TUTORIALS.every((id) => tutorialDone(profile, id));

/**
 * **[출정하기]가 막히는가** — 막는 것은 셋이다: 기본 튜토리얼을 안 끝냈다 · 3v3 · 5v5 수비군이 없다(GDD §8.8,
 * 2026-10-27 — 부대가 하나라도 있으면 수비군이 선다) · 도적떼가 살아 있다(GDD §5.11).
 * 병영의 단추 · AI 대전 시작 · AI 참가비가 모두 이 하나를 부른다 — 자리마다 따로 물으면 한쪽만 낡는다.
 * 튜토리얼이 먼저다(도적떼는 농지가 있어야 오는데, 기본 셋을 끝내기 전에는 대개 농지가 없다). 수비군은 그다음 —
 * 튜토리얼을 끝낸 사람이 곧바로 하러 갈 일이기 때문이다(병영 안내가 그리로 이끈다).
 */
/** [출정하기]를 막는 이유 코드 — 화면 문구(`reason.*`)가 열 언어에 다 있는지 회귀가 이 목록으로 본다 */
export const SORTIE_REASONS = ['tutorial.required', 'sortie.noGarrison', 'raid.blocksSortie'] as const;

export function sortieGate(profile: PlayerProfile): MetaResult {
  if (!basicsDone(profile)) return { ok: false, reason: '기본 튜토리얼을 먼저 끝내야 출정할 수 있다', code: 'tutorial.required' };
  const garrison = garrisonGate(profile);
  if (!garrison.ok) return garrison;
  return raidBlocksSortie(profile);
}

export function tutorialStatus(profile: PlayerProfile, id: TutorialId): TutorialStatus {
  if (!isTutorialId(id)) return 'hidden';
  if (tutorialDone(profile, id)) return 'done';
  const basic = BASIC_TUTORIALS.indexOf(id as BasicTutorialId);
  if (basic >= 0) {
    return basic === 0 || tutorialDone(profile, BASIC_TUTORIALS[basic - 1]!) ? 'open' : 'locked';
  }
  // S급 — 보유가 먼저(안 보이면 잠겼는지도 모른다), 그다음 기본 셋
  const officer = id.slice(2) as OfficerId;
  if (!ownedOfficers(profile).includes(officer)) return 'hidden';
  return basicsDone(profile) ? 'open' : 'locked';
}

/** 병영 목록이 그리는 줄 — 안 보이는 것은 빠진다 */
export function tutorialList(profile: PlayerProfile): { id: TutorialId; status: Exclude<TutorialStatus, 'hidden'> }[] {
  const out: { id: TutorialId; status: Exclude<TutorialStatus, 'hidden'> }[] = [];
  for (const id of ALL_TUTORIALS) {
    const status = tutorialStatus(profile, id);
    if (status !== 'hidden') out.push({ id, status });
  }
  return out;
}

/**
 * 끝냈다고 적는다 — **열려 있거나 이미 끝낸 판만** 받는다(다시 한 판은 그대로 둔다).
 * 서버의 `POST /tutorial/complete`가 부른다. 잠긴 판 · 안 보이는 판 · 모르는 id는 던진다.
 */
export function applyTutorialDone(profile: PlayerProfile, id: TutorialId): PlayerProfile {
  const status = tutorialStatus(profile, id);
  if (status === 'done') return profile;
  if (status !== 'open') throw new Error(`튜토리얼 ${id}는 지금 끝낼 수 없다 (${status})`);
  return { ...profile, tutorial: { done: [...(profile.tutorial?.done ?? []), id] } };
}
