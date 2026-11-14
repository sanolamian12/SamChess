/**
 * 튜토리얼 — 목록 · 진행 · 잠금 · 해금 (G3, `Design/튜토리얼_시나리오_초안.md`, 2026-10-22 기획자)
 *
 * ```
 * 기본 1 (기물 여섯) → 기본 2 (책략 · 아이템 · 협동) → 기본 3 (고유기술 · 시간 · SP)   ← 셋 다 끝나야 [출정하기]
 * 일기토 → 설전 — 기본 셋 뒤에 차례로 열린다. [출정하기]와는 무관하다(2026-11-12)
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
import { grantRewards } from './rewards.ts';
import type { RewardSpec } from './rewards.ts';
import type { BattleRewards, MetaResult, PlayerProfile } from './types.ts';

/** 필수 기본 튜토리얼 — **이 순서로** 열린다 */
export const BASIC_TUTORIALS = ['basic-1', 'basic-2', 'basic-3'] as const;
export type BasicTutorialId = typeof BASIC_TUTORIALS[number];

/**
 * **전투 기초의 일기토 · 설전 판** (2026-11-12, GDD §3.11) — 기본 셋을 끝내면 일기토, 일기토를 끝내면 설전이 열린다. 병영 목록에서는 기본 셋 뒤에 선다.
 * **2026-11-14부터 필수다**(기획자 — 실전에서 AI가 처음 일기토를 걸 때 안 해 본 사람이 있었다) — `SORTIE_TUTORIALS`.
 * 이미 기본 셋만 끝낸 계정은 [출정하기]가 다시 잠기고 병영이 둘을 마저 하라고 이끈다.
 */
export const DUEL_TUTORIALS = ['basic-duel', 'basic-debate'] as const;
export type DuelTutorialId = typeof DUEL_TUTORIALS[number];

/** 전투 기초 갈래 다섯 판 — 목록 · 배경음악 · 금빛 안내가 이 묶음을 본다 */
export const BASICS_TAB: readonly (BasicTutorialId | DuelTutorialId)[] = [...BASIC_TUTORIALS, ...DUEL_TUTORIALS];
export const isBasicsTab = (id: string): boolean => (BASICS_TAB as readonly string[]).includes(id);

/**
 * **[출정하기]를 여는 판** — 전투 기초 다섯 전부(2026-11-14 기획자, 그 전엔 기본 셋). `basicsDone`(기본 셋)은 일기토 · S급 판을 여는 데 그대로 쓴다
 */
export const SORTIE_TUTORIALS: readonly (BasicTutorialId | DuelTutorialId)[] = BASICS_TAB;

/** S급 튜토리얼 id — `s-{장수 id}` */
export type STutorialId = `s-${string}`;
export type TutorialId = BasicTutorialId | DuelTutorialId | STutorialId;

/** S급 30명 — 데이터 순서(가나다) 그대로 */
export const S_TUTORIAL_OFFICERS: readonly OfficerId[] = OFFICERS
  .filter((o) => o.grade === 'S')
  .map((o) => o.id as OfficerId);

export const sTutorialId = (officer: OfficerId): STutorialId => `s-${officer}`;

/**
 * **S급 판을 보여 주는 순서 — 그 판의 전투가 벌어진 역사 순서** (2026-11-11 기획자). 해(年)는 각 판 파일 머리의 것
 * (`tutorialS/*.ts`)이고, 같은 해 안은 일이 일어난 차례다(연의 기준). 목록이 30명을 빠짐없이 한 번씩 담는지는
 * `tutorial.test.ts`가 본다 — S급이 늘면 여기에 그 자리를 넣어야 떨어지지 않는다.
 */
export const S_TUTORIAL_HISTORY: readonly OfficerId[] = ([
  'gwan-u',        // 190 사수관
  'yeo-po',        // 190 호로관
  'son-gyeon',     // 191 양인
  'tae-sa-ja',     // 193 북해 구원
  'sun-uk',        // 196 서주 · 이호경식
  'ga-hu',         // 197 완성
  'ha-hu-don',     // 198 하비
  'jo-jo',         // 199 청매자주 영웅론
  'seo-seo',       // 201 신야 팔문금쇄
  'gwak-ga',       // 204~ 하북 평정
  'yu-bi',         // 207 융중 초려
  'jo-un',         // 208 장판 단기
  'jang-bi',       // 208 장판교
  'ju-yu',         // 208 적벽 전야 · 고육지책
  'bang-tong',     // 208 적벽 연환계
  'je-gal-ryang',  // 208 적벽 (동남풍 · 화공)
  'heo-jeo',       // 211 위수 도하
  'gam-nyeong',    // 213 유수구 백기 야습
  'son-gwon',      // 213 유수구 수비
  'ma-cho',        // 214 가맹관
  'no-suk',        // 215 익양 대치
  'jang-ryo',      // 215 합비 · 소요진
  'hwang-chung',   // 219 정군산
  'bang-deok',     // 219 번성
  'seo-hwang',     // 219 번성 구원
  'yeo-mong',      // 219 형주 기습 · 백의도강
  'yuk-son',       // 222 이릉
  'jang-hap',      // 228 가정
  'sa-ma-ui',      // 234 오장원
  'gang-yu',       // 253 철롱산
] as const).map((id) => id as OfficerId);

export const ALL_TUTORIALS: readonly TutorialId[] = [...BASICS_TAB, ...S_TUTORIAL_OFFICERS.map(sTutorialId)];

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

/** **출정에 드는 판을 다 끝냈는가** — 전투 기초 다섯(일기토 · 설전까지, 2026-11-14). 병영의 잠금 · 안내가 이것을 본다 */
export const sortieTutorialsDone = (profile: PlayerProfile): boolean =>
  SORTIE_TUTORIALS.every((id) => tutorialDone(profile, id));

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
  if (!sortieTutorialsDone(profile)) return { ok: false, reason: '전투 기초 튜토리얼을 먼저 끝내야 출정할 수 있다', code: 'tutorial.required' };
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
  // 일기토 → 설전 — 일기토는 기본 셋 뒤에, 설전은 일기토 뒤에 열린다(2026-11-12 기획자 — 둘 다 열려 있으면 「다음」 표가 한쪽에만 서서 헷갈렸다)
  if (id === 'basic-duel') return basicsDone(profile) ? 'open' : 'locked';
  if (id === 'basic-debate') return tutorialDone(profile, 'basic-duel') ? 'open' : 'locked';
  // S급 — 보유가 먼저(안 보이면 잠겼는지도 모른다), 그다음 기본 셋
  const officer = id.slice(2) as OfficerId;
  if (!ownedOfficers(profile).includes(officer)) return 'hidden';
  return basicsDone(profile) ? 'open' : 'locked';
}

/** 병영 목록이 그리는 줄 — 안 보이는 것은 빠진다. 전투 기초 다섯(기본 셋 → 일기토 · 설전)이 먼저, S급은 역사 순서(`S_TUTORIAL_HISTORY`) */
export function tutorialList(profile: PlayerProfile): { id: TutorialId; status: Exclude<TutorialStatus, 'hidden'> }[] {
  const out: { id: TutorialId; status: Exclude<TutorialStatus, 'hidden'> }[] = [];
  for (const id of [...BASICS_TAB, ...S_TUTORIAL_HISTORY.map(sTutorialId)]) {
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

/**
 * **튜토리얼 첫 클리어 보상** (2026-11-11 기획자) — 군량 1 · 자재 1 · C~D급 장수 카드 1장(보유 · 미보유 가리지 않음).
 * 전투 기초 · S급 모두, **처음 끝낼 때 한 번만**이다 — [다시 하기]로 반복해 카드를 모으는 길을 막는다.
 * 엑셀(`economy.json`)의 보상표에 줄이 없어 여기 적는다 — 엑셀은 읽기 전용이라 줄을 더하려면 기획 쪽에서 넣는다.
 */
export const TUTORIAL_REWARD: RewardSpec = {
  cards: [{ owned: ['C', 'D'], fresh: ['C', 'D'] }],
  materials: 1,
  grain: 1,
};

/**
 * 끝냈다고 적고, **처음이면** 보상을 준다 — 서버의 `POST /tutorial/complete`가 부른다(시드는 서버가 만든다).
 * 이미 끝낸 판이면 계정은 그대로이고 `rewards`는 `null`이다(화면은 승리 장면만 보이고 「이미 받았다」고 적는다).
 *
 * ⚠ 판을 재생해 검증하지 않는다 — 판을 안 두고 이 요청만 보내도 끝낸 것으로 적힌다. 얻는 것은 판마다 한 번의
 * 이 작은 보상과 [출정하기]가 일찍 열리는 것뿐이라(판은 서른셋), 재생 검증의 값보다 작다고 보고 남긴 공백이다.
 */
export function completeTutorial(
  profile: PlayerProfile, id: TutorialId, seed: number,
): { profile: PlayerProfile; rewards: BattleRewards | null } {
  const first = tutorialStatus(profile, id) !== 'done';
  const done = applyTutorialDone(profile, id);
  if (!first) return { profile: done, rewards: null };
  return grantRewards(done, TUTORIAL_REWARD, seed);
}
