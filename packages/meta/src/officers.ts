/**
 * 장수 일람 — 줄 만들기 · 검색 · 정렬 · 요약 (pptx 37·38쪽)
 *
 * 37쪽 원문이 「장수 검색, 가나다순, 무력/지력/통솔력 sorting 지원」이고
 * 열은 「클래스, 성명, [무력, 지력, 통솔력], 레벨, [레벨업 Flag]」다.
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 화면이 아니라 여기 있나
 * ────────────────────────────────────────────────────────────────
 *
 * 정렬·검색은 **눈으로 확인하기 가장 어려운 종류**다. 「가나다순」이 실제로 한국어
 * 자모 순인지, 「무력순」이 동점일 때 흔들리지 않는지는 스크린샷으로는 알 수 없다.
 * 순수 함수로 떼면 `packages/meta/test/officers.test.ts`가 경계를 고정한다 —
 * `client/src/screens/backdrop.ts`를 화면에서 떼어 낸 것과 같은 이유다.
 *
 * **「레벨업 가능」 판정을 화면이 다시 적지 않는다.** `canLevelUp()`을 그대로 부른다.
 * 화면이 `카드 >= 필요분`을 따로 쓰면 규칙이 바뀌었을 때 **배지만** 조용히 어긋난다.
 */

import { officerById } from '@samchess/data';
import { FORMULA } from '@samchess/rules';
import type { Grade, OfficerId } from '@samchess/rules';
import { canLevelUp, statsOf } from './profile.ts';
import type { OfficerInstance, PlayerProfile } from './types.ts';

/** 37쪽이 지정한 정렬 4종 + 등급·레벨(2026-09-02 추가 — 표 열 순서(등급·레벨이
    맨 앞)와 맞춰 정렬 목록도 그 둘을 앞에 둔다). 기본은 가나다다 — 목업의
    첫째 항목이다. */
export type OfficerSort = 'grade' | 'level' | 'name' | 'might' | 'intellect' | 'leadership';

export const OFFICER_SORTS: readonly OfficerSort[] = ['grade', 'level', 'name', 'might', 'intellect', 'leadership'];

/** 등급 순서 — 「S 보라 · A 빨강 · B 파랑 · C 초록 · D 회색 · E 황금」(등급 색
    단일 출처 주석과 같은 순서, `style.css` 참조). 값이 작을수록 위(등급순 정렬의
    "높은 쪽")다. 헌제(E)는 전투 등급 축이 아니라 특수 배역이라 맨 뒤에 둔다. */
const GRADE_RANK: Record<Grade, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };

/** 일람 한 줄. 37쪽의 열 구성 그대로다 */
export interface OfficerRow {
  officer: OfficerId;
  name: string;
  grade: Grade;
  might: number;
  intellect: number;
  leadership: number;
  level: number;
  /** 레벨업 Flag — 「카드를 보유하고 있다면 ON」(37쪽) */
  canLevelUp: boolean;
  /** 여분 카드 수. 레벨업으로 소모되는 쪽이다 */
  cards: number;
}

/**
 * 보유 장수를 줄로 편다. **데이터에 없는 장수는 버린다** —
 * 이름이 바뀌어 id가 갈리면(§9 「장요→장료」) 옛 저장분이 그럴 수 있다.
 */
export function officerRows(profile: PlayerProfile): OfficerRow[] {
  const rows: OfficerRow[] = [];
  for (const inst of Object.values(profile.roster)) {
    const data = officerById.get(inst.officer);
    if (!data) continue;
    rows.push({
      officer: inst.officer,
      name: data.name,
      grade: data.grade,
      might: data.might,
      intellect: data.intellect,
      leadership: data.leadership,
      level: inst.level,
      canLevelUp: canLevelUp(profile, inst.officer).ok,
      cards: profile.cards[inst.officer] ?? 0,
    });
  }
  return rows;
}

/**
 * 정렬. 능력치·레벨은 **높은 쪽이 위**, 등급은 `GRADE_RANK`가 낮은 쪽(S가 먼저)이
 * 위다. 동점이면 가나다로 갈린다 — 그래야 같은 목록을 두 번 그려도 순서가 같다
 * (동점이 흔하다: 무력 45가 11명, 다들 Lv1).
 */
export function sortRows(rows: readonly OfficerRow[], sort: OfficerSort): OfficerRow[] {
  const byName = (a: OfficerRow, b: OfficerRow): number => a.name.localeCompare(b.name, 'ko');
  const next = [...rows];
  if (sort === 'name') return next.sort(byName);
  if (sort === 'grade') return next.sort((a, b) => GRADE_RANK[a.grade] - GRADE_RANK[b.grade] || byName(a, b));
  return next.sort((a, b) => b[sort] - a[sort] || byName(a, b));
}

/**
 * 이름 검색. 부분일치이고 앞뒤 공백은 버린다 — 빈 칸이면 **전부** 돌려준다.
 *
 * 대소문자를 접는 것은 나중에 이름이 로마자로도 검색될 때를 위한 것이다.
 * 한국어에는 대소문자가 없어 지금은 아무 일도 하지 않는다.
 */
export function searchRows(rows: readonly OfficerRow[], query: string): OfficerRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

/** 일람 아래 요약 줄 — 「장수 : Cur / Max 명 · [E]: Y/N. [S]: x, …」 (38·39쪽) */
export interface GradeTally {
  /** `[E]: Y/N` — 헌제는 한 명뿐이라 개수가 아니라 있고 없음이다 (GDD §4.1) */
  hasEmperor: boolean;
  S: number;
  A: number;
  B: number;
  C: number;
  D: number;
}

export function gradeTally(profile: PlayerProfile): GradeTally {
  const tally: GradeTally = { hasEmperor: false, S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const id of Object.keys(profile.roster)) {
    const grade = officerById.get(id)?.grade;
    if (!grade) continue;
    if (grade === 'E') tally.hasEmperor = true;
    else tally[grade] += 1;
  }
  return tally;
}

/**
 * 공격력 표기 범위 — 평타와 크리티컬 (GDD §4.2 · §3.10, 2026-08-12 확정).
 *
 * 데미지는 매 타격마다 따로 내림하므로 `AT 2.5`는 평타 2 · 크리티컬 5다.
 * 단일 숫자로 적으면 「AT를 찍었는데 왜 그대로지」가 된다.
 *
 * **`FORMULA.damage`를 반드시 지나간다.** 전투 화면이 `attackRange()`에 묻는 것과
 * 같은 자리인데, 그쪽은 `BattleState`를 요구해서 편성 밖에서는 쓸 수 없다.
 * 여기서 `at * 2`를 다시 적으면 내림 규칙이 바뀌었을 때 **표시만** 어긋난다.
 */
export function atRange(inst: OfficerInstance): { min: number; max: number } {
  const at = statsOf(inst).at;
  return {
    min: FORMULA.damage(at, false, false, false),
    max: FORMULA.damage(at, true, false, false),
  };
}
