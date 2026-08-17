/**
 * 성장 스택과 마이그레이션 회귀 — 저장 형식 v2 (2026-08-17, 작업계획 §3-B)
 *
 * **여기서 지키는 것은 넷이다.** 작업계획이 적은 완료 조건 그대로다.
 *  1. v1 프로필이 v2로 **정확히** 되접히는가
 *  2. `growth.length === level - 1`이 **언제나** 참인가
 *  3. 재설계 결과가 같은 레벨의 **정상 성장과 구별되지 않는가**
 *  4. `slice`로 자른 Lv5가 **진짜 Lv5와 같은가** ← E(레벨 하향)의 전제를 미리 고정한다
 *
 * 전부 **눈으로 볼 수 없는 종류**다. 「Lv7의 책략 아홉 개가 레벨별로 옳게 갈렸는가」는
 * 화면 어디에도 안 뜨고, 하향은 전투에 들어가야 드러난다.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { officerByName } from '@samchess/data';
import type { OfficerId, TacticId } from '@samchess/rules';
import {
  PROFILE_VERSION, applyLevelUp, applyRespec, addCard, canLevelUp, canRespec,
  cardsSpentOn, cardsToLevelUp, checkGrowth, createProfile, growthPreview, migrateProfile,
  newInstance, statPicksOf, statsOf, tacticChoices, tacticsOf, toRosterEntries,
  unitPower, RESPEC_GOLD,
} from '../src/index.ts';
import type { GrowthStep, OfficerInstance, PlayerProfile, StatPick } from '../src/index.ts';

const GWAN = officerByName.get('관우')!.id as OfficerId;

/** 능력 선택과 school을 정해 키운다. 정상 성장(`applyLevelUp`)만 쓴다 */
function grow(picks: StatPick[], schools: ('support' | 'illusion')[]): PlayerProfile {
  let p: PlayerProfile = { ...createProfile('시험성', 1), roster: { [GWAN]: newInstance(GWAN) }, cards: {} };
  for (const [i, stat] of picks.entries()) {
    p = addCard(p, GWAN, cardsToLevelUp(i + 1)!);
    p = applyLevelUp(p, GWAN, stat, schools[i]!);
  }
  return p;
}

/** v1 모양으로 되돌린 저장분 — 마이그레이션의 입력 */
function asV1(inst: OfficerInstance): Record<string, unknown> {
  return {
    officer: inst.officer,
    level: inst.level,
    statPicks: statPicksOf(inst),
    tactics: tacticsOf(inst),
    record: inst.record,
  };
}

const v1Profile = (inst: OfficerInstance): Record<string, unknown> => ({
  version: 1, cityName: '옛성', cityLevel: 1, grain: 12, gold: 0, materials: 0,
  roster: { [inst.officer]: asV1(inst) }, cards: { [inst.officer]: 4 },
});

// ── 1. v1 → v2 되접기 ──────────────────────────────────────────

describe('마이그레이션 — v1을 버리지 않고 되접는다', () => {
  /*
   * Lv9까지 키우되 **Lv6·Lv7에서 지원**을 골라 「한 번에 둘」을 만든다.
   * 그래야 v1의 `tactics`(10개)가 `statPicks`(8개)와 어긋난 진짜 상황이 된다 —
   * 이 어긋남이 「Lv7을 Lv5로 내려라」를 못 하게 만들던 원인이었다.
   */
  const schools = ['illusion', 'illusion', 'illusion', 'illusion', 'support', 'support', 'illusion', 'illusion'] as const;
  const picks: StatPick[] = ['hp', 'hp', 'at', 'hp', 'mp', 'at', 'hp', 'hp'];
  const lv9 = grow(picks, [...schools]).roster[GWAN]!;

  it('먼저 — v1에서는 두 배열의 길이가 실제로 어긋나 있다', () => {
    const old = asV1(lv9);
    assert.equal((old.statPicks as StatPick[]).length, 8);
    assert.equal((old.tactics as TacticId[]).length, 10, 'Lv6·7 지원이 둘씩 들어와 열 개다');
  });

  it('레벨별로 정확히 갈린다 — Lv6·Lv7만 한 쌍이다', () => {
    const back = migrateProfile(v1Profile(lv9))!.roster[GWAN]!;
    assert.equal(back.level, 9);
    assert.equal(back.growth.length, 8);
    assert.deepEqual(back.growth.map((s) => s.tactics.length), [1, 1, 1, 1, 2, 2, 1, 1]);
    assert.deepEqual(back.growth.map((s) => s.stat), picks);
    // Lv6 지원 = 화계 + 진화 (생성과 제거가 한 쌍이다 — GDD §3.7)
    assert.deepEqual(back.growth[4]!.tactics, tacticChoices(6).support);
    assert.deepEqual(back.growth[5]!.tactics, tacticChoices(7).support);
  });

  it('다시 펴면 원래 배열과 같다 — 되접기가 무엇도 잃지 않는다', () => {
    const back = migrateProfile(v1Profile(lv9))!.roster[GWAN]!;
    assert.deepEqual(statPicksOf(back), statPicksOf(lv9));
    assert.deepEqual(tacticsOf(back), tacticsOf(lv9));
    assert.deepEqual(statsOf(back), statsOf(lv9));
  });

  it('되접은 스택이 스스로의 검증도 통과한다', () => {
    const back = migrateProfile(v1Profile(lv9))!.roster[GWAN]!;
    assert.equal(checkGrowth(back.growth, back.level), null);
  });

  it('두 번 지나가도 같다 (멱등) — 다중 탭·재접속에서 실제로 두 번 지난다', () => {
    const once = migrateProfile(v1Profile(lv9))!;
    assert.deepEqual(migrateProfile(JSON.parse(JSON.stringify(once))), once);
  });

  it('도시·군량·카드가 함께 살아 넘어온다 — 버리던 것을 채워 넣기로 바꾼 이유다', () => {
    const back = migrateProfile(v1Profile(lv9))!;
    assert.equal(back.version, PROFILE_VERSION);
    assert.equal(back.cityName, '옛성');
    assert.equal(back.grain, 12);
    assert.equal(back.cards[GWAN], 4);
  });
});

describe('마이그레이션 — 망가진 것도 살릴 수 있는 만큼 살린다', () => {
  const lv3 = grow(['hp', 'at'], ['support', 'illusion']).roster[GWAN]!;

  it('데이터에서 사라진 장수만 지운다 (「장요→장료」 같은 id 정정)', () => {
    const raw = v1Profile(lv3);
    (raw.roster as Record<string, unknown>)['jang-yo'] = { level: 1, statPicks: [], tactics: [] };
    (raw.cards as Record<string, unknown>)['jang-yo'] = 9;
    const back = migrateProfile(raw)!;
    assert.equal(back.roster['jang-yo' as OfficerId], undefined);
    assert.equal(back.cards['jang-yo' as OfficerId], undefined);
    assert.ok(back.roster[GWAN], '나머지는 산다');
  });

  it('`statPicks`가 짧으면 레벨을 낮춰서라도 남긴다 — 계정째 버리지 않는다', () => {
    const raw = v1Profile(lv3);
    (raw.roster as Record<string, Record<string, unknown>>)[GWAN]!.statPicks = ['hp'];
    const back = migrateProfile(raw)!;
    assert.equal(back.roster[GWAN]!.level, 2, 'Lv3 → Lv2');
    assert.equal(back.roster[GWAN]!.growth.length, 1);
  });

  it('스택이 레벨보다 길어도 레벨을 올려 주지는 않는다', () => {
    const raw = v1Profile(lv3);
    (raw.roster as Record<string, Record<string, unknown>>)[GWAN]!.level = 2;
    assert.equal(migrateProfile(raw)!.roster[GWAN]!.level, 2);
  });

  /** 손으로 고친 저장분을 그대로 넣는다 */
  function loadGrowth(growth: unknown, level: number): OfficerInstance {
    const raw = v1Profile(lv3);
    (raw.roster as Record<string, unknown>)[GWAN] = {
      officer: GWAN, level, growth, record: { wins: 0, losses: 0, kills: 0 },
    };
    return migrateProfile(raw)!.roster[GWAN]!;
  }

  it('그 레벨에 없는 책략은 **같은 school의 옳은 것으로 고쳐 넣는다**', () => {
    // Lv4 자리에 Lv9의 「초선」(환술)이 심겨 있다 — 사람이 고칠 수 있는 자리다
    const forged = sameAll('hp', 4);
    forged[2] = { stat: 'hp', tactics: tacticChoices(9).illusion };
    assert.equal(checkGrowth(forged, 5)?.includes('Lv4'), true, '먼저 — 그 스택은 성립하지 않는다');

    const back = loadGrowth(forged, 5);
    assert.equal(back.level, 5, '레벨은 지킨다 — 카드를 쓴 것은 사실이다');
    assert.deepEqual(back.growth[2]!.tactics, tacticChoices(4).illusion, '환술을 골랐다는 것만 남는다');
    assert.equal(checkGrowth(back.growth, back.level), null);
  });

  it('Lv6·7 지원의 **짝이 하나뿐이면 채워 넣는다** — 제거 수단만 가진 빌드를 막는다', () => {
    // 생성과 제거가 한 쌍이다 (GDD §3.7)
    const half = sameAll('hp', 6);
    half[4] = { stat: 'hp', tactics: [tacticChoices(6).support[0]!] };
    assert.equal(checkGrowth(half, 7)?.includes('Lv6'), true);

    assert.deepEqual(loadGrowth(half, 7).growth[4]!.tactics, tacticChoices(6).support, '짝이 돌아온다');
  });

  it('되접기가 낸 스택은 **언제나** 스스로의 검증을 통과한다 (그물)', () => {
    // 지금 되접기는 school로 정규화하므로 깎이는 일이 없다 — 되접기와 검증이
    // 갈리는 순간 잡으라고 둔 그물이다. school조차 알 수 없으면 거기서 끊긴다.
    const broken = sameAll('hp', 4);
    broken[1] = { stat: 'hp', tactics: ['없는-책략' as never] };
    const back = loadGrowth(broken, 5);
    assert.equal(back.level, 2, '읽을 수 없는 자리에서 끊긴다');
    assert.equal(checkGrowth(back.growth, back.level), null);
  });

  it('알 수 없는 미래 형식은 버린다 — 짐작으로 열면 조용히 망가뜨린다', () => {
    assert.equal(migrateProfile({ ...v1Profile(lv3), version: PROFILE_VERSION + 1 }), null);
    assert.equal(migrateProfile(null), null);
    assert.equal(migrateProfile('망가진 문자열'), null);
  });
});

// ── 2. 불변식 ──────────────────────────────────────────────────

describe('growth.length === level - 1 은 언제나 참이다', () => {
  it('새 인스턴스 · 레벨업 8회 · 마이그레이션 · 재설계 전부', () => {
    assert.equal(newInstance(GWAN).growth.length, 0);

    let p = { ...createProfile('시험성', 1), roster: { [GWAN]: newInstance(GWAN) }, cards: {} };
    for (let lv = 1; lv < 9; lv++) {
      p = applyLevelUp(addCard(p, GWAN, cardsToLevelUp(lv)!), GWAN, 'hp', lv % 2 ? 'support' : 'illusion');
      const inst = p.roster[GWAN]!;
      assert.equal(inst.growth.length, inst.level - 1, `Lv${inst.level}`);
    }

    const back = migrateProfile(v1Profile(p.roster[GWAN]!))!.roster[GWAN]!;
    assert.equal(back.growth.length, back.level - 1);

    // 재설계는 **되감기**라 Lv1 · 스택 0으로 간다 — `0 === 0`으로 여전히 참이다
    const respecced = applyRespec({ ...p, gold: RESPEC_GOLD }, GWAN).roster[GWAN]!;
    assert.equal(respecced.level, 1);
    assert.equal(respecced.growth.length, respecced.level - 1);
  });
});

/** Lv2..Lv(n+1)을 전부 환술로 채운 스택 — 손상 입력을 만들 때 쓴다 */
const sameAll = (stat: StatPick, n: number): GrowthStep[] =>
  Array.from({ length: n }, (_, i) => ({ stat, tactics: tacticChoices(i + 2).illusion }));

// ── 3. 재설계(둔갑천서) — 「되감기」다 ──────────────────────────

describe('재설계(둔갑천서) — 쓴 카드를 돌려주고 Lv1로 (GDD §4.3)', () => {
  const lv5 = () => ({ ...grow(['hp', 'hp', 'hp', 'hp'], ['support', 'support', 'support', 'support']), gold: RESPEC_GOLD });

  it('Lv1이 되고 성장 스택이 빈다 — 기억해야 할 것이 남지 않는다', () => {
    const after = applyRespec(lv5(), GWAN).roster[GWAN]!;
    assert.equal(after.level, 1);
    assert.deepEqual(after.growth, []);
    assert.deepEqual(statsOf(after), { hp: 10, mp: 5, at: 2 }, 'Lv1 기본치로 돌아간다');
    assert.deepEqual(tacticsOf(after), []);
  });

  it('레벨업에 쓴 카드를 **전부** 돌려받는다 (Lv5까지 26장 — GDD §4.3)', () => {
    assert.equal(cardsSpentOn(1), 0);
    assert.equal(cardsSpentOn(5), 26, '3+5+8+10');
    assert.equal(cardsSpentOn(9), 100, '누적 100장이 상한이다');
    assert.equal(applyRespec(lv5(), GWAN).cards[GWAN], 26);
  });

  it('이미 갖고 있던 여분 카드에 **더한다** — 모아 둔 것이 사라지지 않는다', () => {
    const p = addCard(lv5(), GWAN, 7);
    assert.equal(p.cards[GWAN], 7);
    assert.equal(applyRespec(p, GWAN).cards[GWAN], 33, '7 + 26');
  });

  /*
   * ★ 이 세션에서 가장 값진 계약이다.
   *
   * 「쓴 것을 그대로 되돌려준다」가 참이면, 재설계 뒤 같은 레벨까지 다시 올렸을 때
   * 카드가 **남지도 모자라지도 않아야** 한다. 여기가 어긋나면 재설계가 카드를 찍어
   * 내거나(파밍) 조용히 삼킨다.
   */
  it('돌려받은 카드로 같은 레벨까지 정확히 다시 올릴 수 있다 — 남지도 모자라지도 않는다 ★', () => {
    let p = applyRespec(lv5(), GWAN);
    assert.equal(p.roster[GWAN]!.level, 1);

    for (let lv = 1; lv < 5; lv++) {
      assert.equal(canLevelUp(p, GWAN).ok, true, `Lv${lv} → Lv${lv + 1}에 카드가 모자란다`);
      p = applyLevelUp(p, GWAN, 'mp', 'illusion');   // 이번엔 다른 빌드로 간다
    }
    assert.equal(p.roster[GWAN]!.level, 5, '같은 레벨로 돌아왔다');
    assert.equal(p.cards[GWAN], undefined, '카드가 딱 떨어진다 — 한 장도 남지 않는다');
    assert.deepEqual(statsOf(p.roster[GWAN]!), { hp: 10, mp: 13, at: 2 }, '빌드는 새로 갈렸다');
  });

  it('금화가 나가고 전적·보유는 그대로다', () => {
    const before = { ...lv5(), gold: RESPEC_GOLD + 4 };
    before.roster[GWAN]!.record = { wins: 3, losses: 1, kills: 7 };
    const after = applyRespec(before, GWAN);
    assert.equal(after.gold, 4, '둔갑천서 값만 나간다');
    assert.deepEqual(after.roster[GWAN]!.record, { wins: 3, losses: 1, kills: 7 },
      '되감는 것은 성장이지 그 캐릭터가 싸운 역사가 아니다');
    assert.ok(after.roster[GWAN], '풀에서 빠지지 않는다');
  });

  it('결과가 처음부터 Lv1이던 장수와 **구별되지 않는다**', () => {
    const respecced = applyRespec(lv5(), GWAN).roster[GWAN]!;
    const fresh = newInstance(GWAN);
    assert.deepEqual({ ...respecced, record: fresh.record }, fresh, '표식도 흔적도 남지 않는다');
  });

  it('입력 프로필을 건드리지 않는다 (룰 엔진의 apply와 같은 규약)', () => {
    const before = lv5();
    const snapshot = JSON.stringify(before);
    applyRespec(before, GWAN);
    assert.equal(JSON.stringify(before), snapshot);
  });

  it('Lv1과 금화 부족은 애초에 열리지 않는다', () => {
    const fresh = { ...createProfile('시험성', 1), roster: { [GWAN]: newInstance(GWAN) }, cards: {} };
    assert.equal(canRespec(fresh, GWAN).ok, false, 'Lv1은 되감을 것이 없다');
    assert.equal(canRespec({ ...lv5(), gold: 0 }, GWAN).ok, false, '둔갑천서 없이는 못 한다');
    assert.equal(canRespec(lv5(), GWAN).ok, true);
    assert.throws(() => applyRespec(fresh, GWAN), /재설계할 수 없다/);
  });
});

// ── 4. 레벨 하향 — E(42쪽)의 전제를 여기서 고정한다 ★ ────────────

describe('slice로 자른 Lv5가 진짜 Lv5와 같다', () => {
  const picks: StatPick[] = ['hp', 'at', 'mp', 'hp', 'at', 'hp'];
  const schools = ['support', 'illusion', 'support', 'illusion', 'support', 'support'] as const;

  it('능력 선택 · 책략 · 능력치 · 전투력 넷 다 같다', () => {
    const lv7 = grow(picks, [...schools]).roster[GWAN]!;
    const lv5 = grow(picks.slice(0, 4), [...schools].slice(0, 4)).roster[GWAN]!;

    assert.equal(lv7.level, 7);
    assert.equal(lv5.level, 5);
    assert.deepEqual(statPicksOf(lv7, 5), statPicksOf(lv5));
    assert.deepEqual(tacticsOf(lv7, 5), tacticsOf(lv5));
    assert.deepEqual(statsOf(lv7, 5), statsOf(lv5));

    for (const mode of ['3v3', '5v5'] as const) {
      assert.equal(
        unitPower(mode, { officer: GWAN, statPicks: statPicksOf(lv7, 5) }),
        unitPower(mode, { officer: GWAN, statPicks: statPicksOf(lv5) }),
        `${mode} 전투력이 갈리면 하향이 매칭을 속인다`,
      );
    }
  });

  it('Lv6의 지원 한 쌍이 경계에서 통째로 남거나 통째로 빠진다', () => {
    const lv7 = grow(picks, [...schools]).roster[GWAN]!;
    // Lv6에서 지원(화계+진화)을 골랐다 — 5로 자르면 둘 다 없고, 6이면 둘 다 있다
    const pair = tacticChoices(6).support;
    assert.equal(tacticsOf(lv7, 5).some((t) => pair.includes(t)), false);
    assert.equal(pair.every((t) => tacticsOf(lv7, 6).includes(t)), true);
  });

  it('cap이 지금 레벨보다 크거나 없으면 그대로다', () => {
    const lv7 = grow(picks, [...schools]).roster[GWAN]!;
    assert.deepEqual(tacticsOf(lv7, 99), tacticsOf(lv7));
    assert.deepEqual(statPicksOf(lv7, 1), [], 'Lv1은 고른 것이 없다');
  });
});

// ── 5. D(전투력)의 경로가 안 끊겼다 ────────────────────────────

describe('저장 형식이 바뀌어도 전투력은 같은 값을 낸다', () => {
  it('v1 프로필을 되접어 편성해도 전투력이 그대로다', () => {
    const p = grow(['hp', 'at', 'mp'], ['support', 'illusion', 'support']);
    const back = migrateProfile(v1Profile(p.roster[GWAN]!))!;
    const picks = [{ piece: 'King' as const, officer: GWAN }];
    assert.deepEqual(toRosterEntries(back, picks), toRosterEntries(p, picks));
  });
});

// ── 6. 39쪽의 증분 미리보기 ────────────────────────────────────

describe('증분 미리보기 — 숫자는 화면이 아니라 여기서 낸다 (39쪽)', () => {
  it('고른 줄만 증분이 붙고 나머지는 +0이다', () => {
    const rows = growthPreview(newInstance(GWAN), 'hp');
    assert.deepEqual(rows.map((r) => r.add), [5, 0, 0]);
    assert.deepEqual(rows.map((r) => [r.now, r.next]), [[10, 15], [5, 5], [2, 2]]);
  });

  it('AT는 언제나 범위다 — `2-4 → 2-5`. 매 타격 내림이라 평타는 그대로다', () => {
    const at = growthPreview(newInstance(GWAN), 'at').find((r) => r.key === 'at')!;
    assert.equal(at.add, 0.5);
    assert.deepEqual(at.range, { now: { min: 2, max: 4 }, next: { min: 2, max: 5 } });

    // 두 번째 AT에서 평타가 오른다 — 「홀수 번째 선택은 크리티컬일 때만 값을 한다」
    const once = grow(['at'], ['support']).roster[GWAN]!;
    const twice = growthPreview(once, 'at').find((r) => r.key === 'at')!;
    assert.deepEqual(twice.range, { now: { min: 2, max: 5 }, next: { min: 3, max: 6 } });
  });

  it('재설계 도중의 임시 스택에도 그대로 쓰인다 (화면이 같은 함수를 부른다)', () => {
    const partial: OfficerInstance = { ...newInstance(GWAN), level: 3, growth: sameAll('hp', 2) };
    const rows = growthPreview(partial, 'hp');
    assert.deepEqual(rows.map((r) => [r.now, r.next])[0], [20, 25]);
  });
});
