/**
 * 장수 일람 회귀 — 정렬 · 검색 · 요약 · AT 범위 (pptx 37·38쪽)
 *
 * **눈으로 못 보는 것만 여기서 고정한다.** 「가나다순」이 진짜 한국어 자모 순인지,
 * 동점일 때 순서가 흔들리지 않는지, `AT 2.5`가 `2-5`로 나오는지는 스크린샷으로
 * 확인할 수 없다. 화면이 이 함수들만 부르므로 여기가 유일한 검증 수단이다.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { officerByName, officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  atRange, createProfile, gradeTally, newInstance, officerRows, searchRows, sortRows,
  tacticChoices,
} from '../src/index.ts';
import type { OfficerInstance, OfficerSort, PlayerProfile, StatPick } from '../src/index.ts';

/**
 * 능력 선택만 정해 키운 관우. 책략은 아무거나 채운다 —
 * **`growth.length === level - 1`을 지키려면 단계마다 책략도 있어야 한다.**
 */
function grown(picks: StatPick[]): OfficerInstance {
  const base = newInstance('gwan-u' as OfficerId);
  return {
    ...base,
    level: picks.length + 1,
    growth: picks.map((stat, i) => ({ stat, tactics: tacticChoices(i + 2).illusion })),
  };
}

/** 이름으로 계정을 짓는다 — 시드로 뽑으면 어느 장수가 나올지 테스트가 못 정한다 */
function profileOf(names: string[]): PlayerProfile {
  const base = createProfile('시험성', 1);
  const roster: PlayerProfile['roster'] = {};
  for (const name of names) {
    const data = officerByName.get(name);
    assert.ok(data, `장수 「${name}」이 데이터에 없다`);
    roster[data.id as OfficerId] = newInstance(data.id as OfficerId);
  }
  return { ...base, roster, cards: {} };
}

const names = (rows: { name: string }[]): string[] => rows.map((r) => r.name);

describe('장수 일람 — 줄 만들기', () => {
  it('보유한 장수만 나오고 37쪽의 열이 다 있다', () => {
    const rows = officerRows(profileOf(['관우', '가후']));
    assert.equal(rows.length, 2);
    const gwan = rows.find((r) => r.name === '관우')!;
    const data = officerById.get(gwan.officer)!;
    assert.equal(gwan.grade, data.grade);
    assert.equal(gwan.might, data.might);
    assert.equal(gwan.intellect, data.intellect);
    assert.equal(gwan.leadership, data.leadership);
    assert.equal(gwan.level, 1);
  });

  it('레벨업 Flag는 카드를 채워야 켜진다 — 판정은 canLevelUp이 한다', () => {
    const p = profileOf(['관우']);
    const id = officerRows(p)[0]!.officer;
    assert.equal(officerRows(p)[0]!.canLevelUp, false);

    // Lv1 → Lv2에 3장 (growth.json). 두 장은 모자라고 세 장이면 켜진다
    const two = { ...p, cards: { [id]: 2 } };
    assert.equal(officerRows(two)[0]!.canLevelUp, false);
    const three = { ...p, cards: { [id]: 3 } };
    assert.equal(officerRows(three)[0]!.canLevelUp, true);
    assert.equal(officerRows(three)[0]!.cards, 3);
  });

  it('데이터에 없는 장수 id는 조용히 버린다 — 이름이 바뀌면 옛 저장분이 그럴 수 있다', () => {
    const p = profileOf(['관우']);
    const broken = { ...p, roster: { ...p.roster, 'jang-yo': newInstance('jang-yo' as OfficerId) } };
    assert.deepEqual(names(officerRows(broken)), ['관우']);
  });
});

describe('장수 일람 — 정렬 4종 (37쪽)', () => {
  const rows = officerRows(profileOf(['관우', '가후', '하후돈', '마량']));

  it('가나다순 — 초성부터 한국어 사전 순이다', () => {
    assert.deepEqual(names(sortRows(rows, 'name')), ['가후', '관우', '마량', '하후돈']);
  });

  it('무력·지력·통솔은 높은 쪽이 위다', () => {
    for (const sort of ['might', 'intellect', 'leadership'] as OfficerSort[]) {
      const got = sortRows(rows, sort);
      for (let i = 1; i < got.length; i++) {
        assert.ok(
          got[i - 1]![sort] >= got[i]![sort],
          `${sort} 정렬이 어긋난다: ${got[i - 1]!.name}(${got[i - 1]![sort]}) < ${got[i]!.name}(${got[i]![sort]})`,
        );
      }
    }
  });

  it('동점이면 가나다로 갈린다 — 같은 목록을 두 번 그려도 순서가 같아야 한다', () => {
    // 무력 45 동점인 셋. 데이터가 바뀌면 이 전제가 먼저 깨진다
    const tied = officerRows(profileOf(['순상', '감택', '마량']));
    assert.deepEqual(tied.map((r) => r.might), [45, 45, 45]);
    assert.deepEqual(names(sortRows(tied, 'might')), ['감택', '마량', '순상']);
  });

  it('원본 배열을 건드리지 않는다', () => {
    const before = names(rows);
    sortRows(rows, 'might');
    assert.deepEqual(names(rows), before);
  });
});

describe('장수 일람 — 검색 (37쪽)', () => {
  const rows = officerRows(profileOf(['관우', '관평', '가후']));

  it('부분일치이고 빈 칸이면 전부 나온다', () => {
    assert.equal(searchRows(rows, '').length, 3);
    assert.equal(searchRows(rows, '   ').length, 3);
    assert.deepEqual(names(sortRows(searchRows(rows, '관'), 'name')), ['관우', '관평']);
    assert.deepEqual(names(searchRows(rows, '관우')), ['관우']);
    assert.deepEqual(names(searchRows(rows, '없는이름')), []);
  });
});

describe('장수 일람 — 요약 줄 (38·39쪽)', () => {
  it('[E]는 개수가 아니라 있고 없음이다 — 헌제 한 명뿐이다', () => {
    assert.equal(gradeTally(profileOf(['관우'])).hasEmperor, false);
    const withEmperor = gradeTally(profileOf(['헌제', '관우']));
    assert.equal(withEmperor.hasEmperor, true);
    assert.equal(withEmperor.S, 1);
  });

  it('등급별로 센다', () => {
    const tally = gradeTally(profileOf(['관우', '가후', '간옹', '하후돈']));
    assert.deepEqual(tally, { hasEmperor: false, S: 3, A: 0, B: 1, C: 0, D: 0 });
  });

  it('새 계정은 S·A·B·C·D 각 1명이다 (GDD §8)', () => {
    assert.deepEqual(gradeTally(createProfile('시험성', 7)), {
      hasEmperor: false, S: 1, A: 1, B: 1, C: 1, D: 1,
    });
  });
});

describe('공격력 범위 표기 (GDD §4.2 · §3.10)', () => {
  it('Lv1은 2-4, AT를 한 번 찍으면 2-5다 — 매 타격 내림이라 홀수 선택은 크리티컬만 오른다', () => {
    const inst = newInstance('gwan-u' as OfficerId);
    assert.deepEqual(atRange(inst), { min: 2, max: 4 });

    assert.deepEqual(atRange(grown(['at'])), { min: 2, max: 5 });
    assert.deepEqual(atRange(grown(['at', 'at'])), { min: 3, max: 6 });
  });

  it('HP·MP를 찍어도 공격력은 그대로다', () => {
    assert.deepEqual(atRange(grown(['hp', 'mp'])), { min: 2, max: 4 });
  });
});
