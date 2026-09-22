/**
 * 태학 회귀 — 책략 개량 연구 (GDD §5.12, 2026-09-22).
 *
 * 여기서 고정하는 것.
 *  - **레벨마다 3중 택1 · 태학 Lv5에서 개량 5개** — 주제 표가 데이터에서 온다
 *  - **동시에 하나 · 레벨마다 하나 · 순서 무관** — 태학 레벨이 모자라면 거부한다
 *  - **1시간 뒤 `syncCity()`가 거두고 `notice`에 넣는다** — `doneAt`은 정산 시각이 아니라
 *    시작 + 1시간이다(재생 검증이 그 값으로 가른다)
 *  - **개량형은 원본을 「대체」한다** — 성장 스택은 원본 그대로이고 `toRosterEntries()`만
 *    갈아 끼운다. **판의 시작 시각 뒤에 끝난 연구는 그 판에 안 실린다** ★
 *  - **개량형은 레벨업 선택지에 안 뜬다** — `TACTICS`·`tacticsForLevel()`은 16종 그대로
 *  - 되돌리기는 금화 10냥 · 전부 비운다 · `academy`는 서버 소유 · 되접기가 이상한 줄을 거른다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACADEMY_TOPICS, TACTICS, TACTIC_UPGRADES, tacticById, tacticsForLevel } from '@samchess/data';
import type { OfficerId, TacticId } from '@samchess/rules';
import {
  ACADEMY_MAX_LEVEL, ACADEMY_REASONS, ACADEMY_RESEARCH_MS, ACADEMY_RESET_GOLD, RESPEC_GOLD,
  academySlots, academyTopics, applyAckResearch, applyCancelResearch, applyResetAcademy,
  applyStartResearch, battlePower, canResetAcademy, canStartResearch, createProfile, guardServerOwned,
  migrateProfile, officersUsingUpgrade, researchRemainingMs, researchedUpgrades, syncCity,
  toRosterEntries, upgradeTactics,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const T0 = 1_700_000_000_000;
const HOUR = ACADEMY_RESEARCH_MS;
const T = (name: string): TacticId => {
  const t = [...TACTICS, ...TACTIC_UPGRADES].find((x) => x.name === name);
  if (!t) throw new Error(`책략 없음: ${name}`);
  return t.id as TacticId;
};

/** 태학 Lv`lv` · 회복(Lv4 지원)을 익힌 Lv4 장수 하나를 가진 계정 */
function academy(lv: number, over: Partial<PlayerProfile> = {}): PlayerProfile {
  const p = createProfile('태학성', 5);
  const who = Object.keys(p.roster)[0] as OfficerId;
  const roster = {
    ...p.roster,
    [who]: {
      ...p.roster[who]!,
      level: 4,
      growth: [
        { stat: 'hp' as const, tactics: [T('증폭')] },
        { stat: 'hp' as const, tactics: [T('반감')] },
        { stat: 'hp' as const, tactics: [T('회복')] },
      ],
    },
  };
  return { ...p, roster, gold: 100, buildings: { ...p.buildings, academy: lv }, ...over };
}
const firstOfficer = (p: PlayerProfile): OfficerId => Object.keys(p.roster)[0] as OfficerId;

describe('주제 표 (데이터)', () => {
  it('태학 Lv1~5가 3중 택1이고 개량은 15종 — 진화+는 없다', () => {
    assert.equal(ACADEMY_MAX_LEVEL, 5);
    for (let lv = 1; lv <= 5; lv++) assert.equal(academyTopics(lv).length, 3, `Lv${lv}`);
    assert.equal(TACTIC_UPGRADES.length, 15);
    assert.ok(!TACTIC_UPGRADES.some((t) => t.name === '진화+'));
    assert.deepEqual(academyTopics(3).map((t) => t.name), ['화계+', '함정+', '탈진+']);
    assert.deepEqual(academyTopics(5).map((t) => t.name), ['질병+', '대회복+', '초선+']);
  });

  it('기획 수치 그대로다 (2026-09-22 확정)', () => {
    const mp = (n: string) => tacticById.get(T(n))!.mpCost;
    assert.equal(mp('증폭+'), 2);
    assert.equal(mp('진화'), 1, '원본은 그대로');
    assert.equal(mp('화계+'), 1);
    assert.equal(mp('초선+'), 2);
    assert.equal(mp('대회복+'), 3);
    const eff = (n: string) => tacticById.get(T(n))!.effects as Record<string, unknown>[];
    assert.equal(eff('증폭+')[0]!.charges, 2);
    assert.equal(eff('공포+')[0]!.duration, 300);
    assert.equal(eff('회복+')[0]!.pctMaxHp, 0.3);
    assert.deepEqual([eff('함정+')[0]!.delta, eff('함정+')[1]!.flat], [70, 2]);
    assert.deepEqual([eff('탈진+')[0]!.magnitude, eff('탈진+')[0]!.period], [2, 300]);
  });

  it('개량형은 원본의 level·school을 잇고, 레벨업 선택지(TACTICS)에는 안 뜬다 ★', () => {
    assert.equal(TACTICS.length, 16);
    for (let lv = 2; lv <= 9; lv++) assert.ok(tacticsForLevel(lv).every((t) => !t.base), `Lv${lv}`);
    for (const up of TACTIC_UPGRADES) {
      const base = tacticById.get(up.base!)!;
      assert.equal(up.level, base.level);
      assert.equal(up.school, base.school);
      assert.equal(up.name, `${base.name}+`);
      assert.ok(ACADEMY_TOPICS.get(up.academyLevel!)!.includes(up.id));
    }
  });
});

describe('연구 시작 · 취소', () => {
  it('태학이 없거나 레벨이 모자라면 거부한다 — 이유 코드와 함께', () => {
    const none = canStartResearch(academy(0), T('증폭+'));
    assert.equal(none.ok, false);
    assert.equal(!none.ok && none.code, 'academy.notBuilt');
    const low = canStartResearch(academy(2), T('함정+'));
    assert.equal(!low.ok && low.code, 'academy.locked');
    const unknown = canStartResearch(academy(2), 'no-such-plus');
    assert.equal(!unknown.ok && unknown.code, 'academy.unknown');
    assert.equal(canStartResearch(academy(5), T('회복')).ok, false, '원본 id는 주제가 아니다');
  });

  it('순서는 자유다 — 태학 Lv3이면 Lv3 주제부터 해도 된다', () => {
    assert.equal(canStartResearch(academy(3), T('탈진+')).ok, true);
  });

  it('동시에 하나 — 진행 중이면 다른 레벨의 주제도 막는다', () => {
    const p = applyStartResearch(academy(3), T('증폭+'), T0);
    assert.deepEqual(p.academy!.research, { level: 1, tactic: T('증폭+'), startedAt: T0 });
    const busy = canStartResearch(p, T('회복+'));
    assert.equal(!busy.ok && busy.code, 'academy.busy');
  });

  it('취소는 무료이고 그 레벨을 다시 연다', () => {
    const p = applyStartResearch(academy(1), T('증폭+'), T0);
    const back = applyCancelResearch(p, T0 + 10);
    assert.equal(back.academy!.research, undefined);
    assert.equal(back.gold, p.gold);
    assert.equal(canStartResearch(back, T('공포+')).ok, true);
  });

  it('이미 끝난 연구는 취소로 지울 수 없다', () => {
    const p = applyStartResearch(academy(1), T('증폭+'), T0);
    assert.throws(() => applyCancelResearch(p, T0 + HOUR));
  });
});

describe('완료 — syncCity가 거둔다', () => {
  it('1시간 전에는 그대로, 지나면 done·notice로 옮긴다 — doneAt은 시작 + 1시간 ★', () => {
    const p = applyStartResearch(academy(2), T('회복+'), T0);
    assert.equal(researchRemainingMs(p, T0 + HOUR - 1), 1);
    const early = syncCity(p, T0 + HOUR - 1);
    assert.deepEqual(early.academy, p.academy);
    // 정산이 한참 늦어도(5시간 뒤 접속) 끝난 시각은 시작 + 1시간이다
    const late = syncCity(p, T0 + 5 * HOUR);
    assert.deepEqual(late.academy, {
      done: [{ level: 2, tactic: T('회복+'), doneAt: T0 + HOUR }],
      notice: [T('회복+')],
    });
  });

  it('레벨마다 하나 — 끝낸 레벨의 다른 주제는 거부한다', () => {
    const p = syncCity(applyStartResearch(academy(2), T('회복+'), T0), T0 + HOUR);
    const again = canStartResearch(p, T('결계+'));
    assert.equal(!again.ok && again.code, 'academy.levelDone');
    assert.equal(canStartResearch(p, T('증폭+')).ok, true, '다른 레벨은 된다');
  });

  it('ack가 notice를 비운다 — 비어 있으면 같은 객체', () => {
    const p = syncCity(applyStartResearch(academy(1), T('공포+'), T0), T0 + HOUR);
    const seen = applyAckResearch(p);
    assert.equal(seen.academy!.notice, undefined);
    assert.equal(seen.academy!.done.length, 1);
    assert.equal(applyAckResearch(seen), seen);
  });

  it('칸 표 — locked · open · researching · done', () => {
    let p = syncCity(applyStartResearch(academy(3), T('반감+'), T0), T0 + HOUR);
    p = applyStartResearch(p, T('탈진+'), T0 + HOUR);
    assert.deepEqual(academySlots(p).map((s) => s.state), ['done', 'open', 'researching', 'locked', 'locked']);
  });
});

describe('개량형은 원본을 대체한다 — toRosterEntries', () => {
  const done = (lv: number, name: string) => {
    const p = academy(lv);
    return syncCity(applyStartResearch(p, T(name), T0), T0 + HOUR);
  };

  it('원본을 익힌 장수는 개량형으로 싸운다 — 성장 스택은 원본 그대로', () => {
    const p = done(2, '회복+');
    const who = firstOfficer(p);
    const [entry] = toRosterEntries(p, [{ piece: 'King', officer: who }], T0 + 2 * HOUR);
    assert.deepEqual(entry!.tactics, [T('증폭'), T('반감'), T('회복+')]);
    assert.ok(p.roster[who]!.growth[2]!.tactics.includes(T('회복')), '계정의 성장 스택은 안 바뀐다');
    assert.equal(officersUsingUpgrade(p, T('회복+')), 1);
    assert.equal(officersUsingUpgrade(p, T('결계+')), 0);
  });

  it('판이 시작된 **뒤에** 끝난 연구는 그 판에 안 실린다 — 재생 검증과 같은 답 ★', () => {
    const p = done(2, '회복+');
    const who = firstOfficer(p);
    const before = toRosterEntries(p, [{ piece: 'King', officer: who }], T0 + HOUR - 1);
    assert.equal(before[0]!.tactics[2], T('회복'));
    const at = toRosterEntries(p, [{ piece: 'King', officer: who }], T0 + HOUR);
    assert.equal(at[0]!.tactics[2], T('회복+'));
  });

  it('아직 안 거둔 연구도 그 시각에 끝나 있었다면 센다 — 정산이 늦었을 뿐이다', () => {
    const p = applyStartResearch(academy(2), T('회복+'), T0);
    assert.ok(researchedUpgrades(p, T0 + HOUR).has(T('회복+')));
    assert.ok(!researchedUpgrades(p).has(T('회복+')), '시각이 없으면(화면) 끝낸 것만');
    assert.deepEqual(upgradeTactics(p, [T('회복')], T0 + HOUR), [T('회복+')]);
  });

  it('전투력은 연구와 무관하다 (책략을 안 본다 — 기획자 확정)', () => {
    const plain = academy(2);
    const up = done(2, '회복+');
    const picks = Object.keys(plain.roster).slice(0, 3)
      .map((officer, i) => ({ piece: (['King', 'Rock', 'Bishop'] as const)[i]!, officer: officer as OfficerId }));
    assert.equal(battlePower('3v3', toRosterEntries(up, picks)), battlePower('3v3', toRosterEntries(plain, picks)));
  });
});

describe('되돌리기 · 서버 소유 · 되접기', () => {
  it('금화 10냥(둔갑천서와 같은 값)으로 끝낸 것과 진행 중인 것을 전부 비운다', () => {
    assert.equal(ACADEMY_RESET_GOLD, RESPEC_GOLD);
    let p = syncCity(applyStartResearch(academy(3), T('증폭+'), T0), T0 + HOUR);
    p = applyStartResearch(p, T('회복+'), T0 + HOUR);
    const r = applyResetAcademy(p);
    assert.deepEqual(r.academy, { done: [] });
    assert.equal(r.gold, p.gold - ACADEMY_RESET_GOLD);
    assert.equal(canStartResearch(r, T('반감+')).ok, true, 'Lv1부터 다시 고른다');
  });

  it('되돌릴 것이 없거나 금화가 모자라면 거부한다', () => {
    assert.equal(canResetAcademy(academy(3)).ok, false);
    const poor = { ...syncCity(applyStartResearch(academy(1), T('증폭+'), T0), T0 + HOUR), gold: 9 };
    const r = canResetAcademy(poor);
    assert.equal(!r.ok && r.code, 'academy.gold');
  });

  it('academy는 서버 소유다 — PUT이 연구를 지어내도 서버 값이 이긴다', () => {
    const current = academy(3);
    const incoming: PlayerProfile = {
      ...current,
      academy: { done: [{ level: 1, tactic: T('증폭+'), doneAt: T0 }] },
    };
    assert.equal(guardServerOwned(incoming, current).academy, undefined);
  });

  it('되접기 — 모르는 id·레벨이 안 맞는 줄·겹친 레벨은 거르고, 두 번 지나도 같다', () => {
    const raw = {
      ...academy(3),
      academy: {
        done: [
          { level: 1, tactic: T('증폭+'), doneAt: T0 },
          { level: 1, tactic: T('반감+'), doneAt: T0 },        // 같은 레벨 둘째 — 버린다
          { level: 2, tactic: T('함정+'), doneAt: T0 },        // 함정+는 Lv3 주제 — 버린다
          { level: 4, tactic: 'jin-hwa-plus', doneAt: T0 },    // 없는 개량 — 버린다
        ],
        research: { level: 1, tactic: T('공포+'), startedAt: T0 }, // 끝낸 레벨 — 버린다
        notice: [T('증폭+'), T('반감+')],
      },
    };
    const once = migrateProfile(raw)!;
    assert.deepEqual(once.academy, { done: [{ level: 1, tactic: T('증폭+'), doneAt: T0 }], notice: [T('증폭+')] });
    assert.deepEqual(migrateProfile(once), once);
    assert.equal('academy' in migrateProfile(academy(1))!, false, '없으면 키도 안 만든다');
  });

  it('이유 코드 목록이 규칙이 내는 코드를 전부 덮는다', () => {
    const codes = [
      canStartResearch(academy(0), T('증폭+')),
      canStartResearch(academy(1), T('회복+')),
      canResetAcademy(academy(1)),
    ].map((r) => (!r.ok ? r.code : null));
    for (const c of codes) assert.ok(ACADEMY_REASONS.includes(c as typeof ACADEMY_REASONS[number]), String(c));
  });
});
