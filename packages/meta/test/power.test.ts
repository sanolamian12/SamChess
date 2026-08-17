/**
 * 부대 전투력 회귀 — pptx 44쪽
 *
 * **여기가 산출식의 유일한 그물이다.** 전투력은 화면에 숫자로만 나타나서, 계수가 흔들려도
 * 「좀 달라졌네」로만 보이고 아무것도 깨지지 않는다. 그런데 이 값이 매칭 상대를 정하므로
 * 조용히 바뀌면 대전 성립 자체가 무너진다.
 *
 * 그래서 두 종류를 건다.
 *  - **고정 표본** — 정해 둔 편성의 전투력을 숫자로 못 박는다. 계수를 다시 재는 것은
 *    반드시 **의도된 변경**이어야 하고, 그때 이 숫자가 먼저 깨진다
 *  - **성질** — 레벨 단조성·순서 무관·모드 검증처럼 계수가 바뀌어도 지켜져야 하는 것
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { OFFICERS, officerByName } from '@samchess/data';
import { UNITS_PER_SIDE } from '@samchess/rules';
import type { BattleMode, OfficerId, PieceType, RosterEntry } from '@samchess/rules';
import {
  MATCH_BAND, POWER_FEATURES, POWER_MODELS, POWER_SCALE,
  battlePower, isAdjacentPower, teamFeatures, unitFeatures, unitPower, winChance,
} from '../src/index.ts';
import type { StatPick } from '../src/index.ts';

const idOf = (name: string): OfficerId => {
  const d = officerByName.get(name);
  assert.ok(d, `장수 「${name}」이 데이터에 없다`);
  return d.id as OfficerId;
};

/** 균형 성장 — `hp, mp, at, hp, …`. 도구의 대표값과 같은 규약이다 */
const mix = (level: number): StatPick[] =>
  Array.from({ length: level - 1 }, (_, i) => (['hp', 'mp', 'at'] as const)[i % 3]!);

const PIECES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];

const team = (names: string[], level = 1): RosterEntry[] =>
  names.map((name, i) => ({
    officer: idOf(name), piece: PIECES[i]!, level, statPicks: mix(level), tactics: [],
  }));

describe('전투력 — 특징 뽑기', () => {
  it('기물을 보지 않는다 (기획자 확정 — 전투력을 보고 기물을 고르게 하지 않는다)', () => {
    const gwan = { officer: idOf('관우'), statPicks: mix(5) };
    assert.deepEqual(unitFeatures(gwan), unitFeatures({ ...gwan }));
    const a = team(['관우', '장비', '조운'], 5);
    const b: RosterEntry[] = [
      { ...a[0]!, piece: 'Queen' }, { ...a[1]!, piece: 'King' }, { ...a[2]!, piece: 'Pawn' },
    ];
    assert.equal(battlePower('3v3', a), battlePower('3v3', b));
  });

  it('팀 특징은 유닛 특징의 합이고 순서에 흔들리지 않는다', () => {
    const t = team(['관우', '가후', '헌제'], 4);
    const sum = teamFeatures(t);
    const manual = POWER_FEATURES.map((f) => t.reduce((n, e) => n + unitFeatures(e)[f], 0));
    assert.deepEqual(POWER_FEATURES.map((f) => sum[f]), manual);
    assert.deepEqual(teamFeatures([...t].reverse()), sum);
  });

  it('성장분이 레벨을 타고 들어온다 — Lv1과 Lv9의 hp/mp/at가 다르다', () => {
    const lo = unitFeatures({ officer: idOf('관우'), statPicks: mix(1) });
    const hi = unitFeatures({ officer: idOf('관우'), statPicks: mix(9) });
    assert.equal(lo.might, hi.might, '무력은 레벨로 오르지 않는다');
    assert.ok(hi.hp > lo.hp && hi.mp > lo.mp && hi.at > lo.at);
  });
});

describe('전투력 — 계약', () => {
  it('인원이 모드와 맞지 않으면 던진다 (3v3과 5v5를 같은 자로 재는 사고를 막는다)', () => {
    assert.throws(() => battlePower('3v3', team(['관우', '장비'])), /3명/);
    assert.throws(() => battlePower('5v5', team(['관우', '장비', '조운'])), /5명/);
  });

  it('순서를 바꿔도 같은 값이다 (마지막에 한 번만 반올림한다)', () => {
    const t = team(['관우', '가후', '유비'], 6);
    assert.equal(battlePower('3v3', t), battlePower('3v3', [...t].reverse()));
  });

  it('팀 합계는 유닛 기여의 합을 반올림한 것이다', () => {
    const t = team(['관우', '가후', '유비'], 6);
    const raw = t.reduce((n, e) => n + unitPower('3v3', e), 0);
    assert.equal(battlePower('3v3', t), Math.round(raw));
  });

  it('두 모드의 값 범위가 겹친다 — 나란히 놓고 비교하면 안 되는 값이다 ★', () => {
    // 42쪽 목업이 3v3 `33` · 5v5 `55`라 「5v5가 더 크다」로 읽히지만 실측은 그렇지 않다.
    // 5v5 계수가 3v3의 약 1/1.7이라 인원이 늘어난 만큼 상쇄된다.
    // 숫자가 비슷해 보이는 것이 위험해서, 섞어 재는 것을 계약(위 예외)이 막는다.
    const three = battlePower('3v3', team(['관우', '장비', '조운'], 5));
    const five = battlePower('5v5', team(['관우', '장비', '조운', '황충', '마초'], 5));
    assert.ok(Math.abs(five - three) < three * 0.2,
      `두 모드가 비슷한 범위여야 한다 — 3v3 ${three} · 5v5 ${five}`);
  });

  it('전투력은 언제나 양수다 — 바닥값(offset)이 눈금을 들어 올린다', () => {
    for (const mode of ['3v3', '5v5'] as BattleMode[]) {
      for (const o of OFFICERS) {
        for (const level of [1, 9]) {
          assert.ok(unitPower(mode, { officer: o.id as OfficerId, statPicks: mix(level) }) > 0,
            `${o.name} Lv${level} (${mode})`);
        }
      }
    }
  });
});

describe('전투력 — 레벨 단조성 (E의 「레벨 하향」이 여기에 걸린다)', () => {
  it('모든 장수 · 모든 레벨에서 Lv N < Lv N+1', () => {
    for (const mode of ['3v3', '5v5'] as BattleMode[]) {
      for (const o of OFFICERS) {
        for (let level = 1; level < 9; level++) {
          const lo = unitPower(mode, { officer: o.id as OfficerId, statPicks: mix(level) });
          const hi = unitPower(mode, { officer: o.id as OfficerId, statPicks: mix(level + 1) });
          assert.ok(hi > lo, `${o.name} Lv${level}(${lo}) → Lv${level + 1}(${hi}) — ${mode}`);
        }
      }
    }
  });

  it('어떤 성장 선택으로도 레벨이 오르면 전투력이 내려가지 않는다', () => {
    // hp/mp/at 가중치에 하한 0을 걸어 둔 것이 지키는 성질이다.
    for (const stat of ['hp', 'mp', 'at'] as StatPick[]) {
      for (let level = 1; level < 9; level++) {
        const picks = (n: number): StatPick[] => new Array<StatPick>(n).fill(stat);
        const lo = unitPower('3v3', { officer: idOf('여포'), statPicks: picks(level - 1) });
        const hi = unitPower('3v3', { officer: idOf('여포'), statPicks: picks(level) });
        assert.ok(hi >= lo, `${stat} 몰빵 Lv${level} → Lv${level + 1}`);
      }
    }
  });

  it('growth를 잘라 만든 Lv5는 진짜 Lv5와 같은 전투력이다 (E의 전제)', () => {
    const full = mix(9);
    const cut = full.slice(0, 4);
    assert.deepEqual(cut, mix(5));
    assert.equal(
      unitPower('3v3', { officer: idOf('조조'), statPicks: cut }),
      unitPower('3v3', { officer: idOf('조조'), statPicks: mix(5) }),
    );
  });
});

describe('예상 승률', () => {
  it('격차 0이면 정확히 50% — 동일 전투력끼리는 어느 쪽이 이겨도 같다', () => {
    assert.equal(winChance(500, 500), 0.5);
  });

  it('대칭이다', () => {
    for (const [a, b] of [[400, 700], [900, 120], [555, 556]]) {
      assert.ok(Math.abs(winChance(a!, b!) + winChance(b!, a!) - 1) < 1e-12);
    }
  });

  it('격차 POWER_SCALE이면 약 73% — 눈금의 뜻', () => {
    const p = winChance(100 + POWER_SCALE, 100);
    assert.ok(Math.abs(p - 0.731) < 0.001, `${p}`);
  });

  it('매칭 구간은 예상 승률 45~55%다 (45쪽 「인접한 전투력」)', () => {
    assert.ok(winChance(1000 + MATCH_BAND, 1000) <= 0.5502);
    assert.ok(winChance(1000 + MATCH_BAND, 1000) >= 0.5498);
    assert.ok(isAdjacentPower(1000, 1000 + MATCH_BAND));
    assert.ok(!isAdjacentPower(1000, 1000 + MATCH_BAND + 1));
  });
});

describe('전투력 — 고정 표본 ★ 계수를 다시 재면 여기가 먼저 깨진다', () => {
  it('실측 계수가 그대로다', () => {
    assert.equal(POWER_SCALE, 100);
    assert.deepEqual(POWER_MODELS['3v3'].weights, EXPECTED['3v3'].weights);
    assert.equal(POWER_MODELS['3v3'].offset, EXPECTED['3v3'].offset);
    assert.deepEqual(POWER_MODELS['5v5'].weights, EXPECTED['5v5'].weights);
    assert.equal(POWER_MODELS['5v5'].offset, EXPECTED['5v5'].offset);
  });

  it('정해 둔 편성의 전투력이 그대로다', () => {
    for (const [label, mode, names, level, expected] of FIXTURES) {
      assert.equal(battlePower(mode, team(names, level)), expected, label);
    }
  });

  it('등급 중앙값이 D < C < B < A < S로 단조다', () => {
    /** 등급 안에서 유닛 전투력의 중앙값 */
    const median = (grade: string, mode: BattleMode, level: number): number => {
      const vs = OFFICERS.filter((o) => o.grade === grade)
        .map((o) => unitPower(mode, { officer: o.id as OfficerId, statPicks: mix(level) }))
        .sort((a, b) => a - b);
      return vs[Math.floor(vs.length / 2)]!;
    };
    for (const mode of ['3v3', '5v5'] as BattleMode[]) {
      for (const level of [1, 5, 9]) {
        const rank = ['D', 'C', 'B', 'A', 'S'].map((g) => median(g, mode, level));
        for (let i = 1; i < rank.length; i++) {
          assert.ok(rank[i]! > rank[i - 1]!,
            `${mode} Lv${level} — D<C<B<A<S 여야 하는데 ${rank.map((v) => v.toFixed(1)).join(' , ')}`);
        }
      }
    }
  });

  it('개별 장수는 등급을 가로질러 겹친다 — 등급은 요약이지 전투력이 아니다 ★', () => {
    // 「등급이 아니라 능력치로 잰다」는 설계가 실제로 그런 결과를 내는지 본다.
    // 중앙값은 등급 순서를 지키지만(위 테스트) 개별 장수의 범위는 서로 파고든다 —
    // B급 최약(164)은 C급 중앙값(254)에도 못 미친다. 실측에서 B↔C 승률이 1.7%p밖에
    // 벌어지지 않는 것과 같은 자리다 (HANDOFF §7).
    const of = (grade: string) => OFFICERS.filter((o) => o.grade === grade)
      .map((o) => unitPower('3v3', { officer: o.id as OfficerId, statPicks: mix(5) }))
      .sort((a, b) => a - b);
    const b = of('B');
    const c = of('C');
    assert.ok(b[0]! < c[Math.floor(c.length / 2)]!, 'B급 최약 < C급 중앙값');
    assert.ok(c[c.length - 1]! > b[0]!, 'C급 최강 > B급 최약 — 범위가 겹친다');
  });

  it('인원 수가 모드와 맞다 — 고정 표본이 계약을 어기지 않았는지', () => {
    for (const [, mode, names] of FIXTURES) assert.equal(names.length, UNITS_PER_SIDE[mode]);
  });

  it('헌제(E)가 Lv1 전투력의 바닥이다 — 실측 승률 최하와 맞다', () => {
    const heon = { officer: idOf('헌제'), statPicks: [] as StatPick[] };
    for (const mode of ['3v3', '5v5'] as BattleMode[]) {
      assert.equal(unitPower(mode, heon), 20, `${mode} 바닥값`);
      for (const o of OFFICERS) {
        const v = unitPower(mode, { officer: o.id as OfficerId, statPicks: [] });
        assert.ok(v >= 20, `${o.name}(${v})이 헌제보다 낮다 — ${mode}`);
      }
    }
  });

  it('고유기술 등급이 셀수록 값이 크다 — B ≤ A ≤ S, 헌제(E)는 몫이 없다', () => {
    for (const mode of ['3v3', '5v5'] as BattleMode[]) {
      const w = POWER_MODELS[mode].weights;
      assert.ok(w.skillB <= w.skillA && w.skillA <= w.skillS,
        `${mode}: B ${w.skillB} ≤ A ${w.skillA} ≤ S ${w.skillS}`);
    }
    // E급 기술(헌제)은 표본에 없어 셋 다 0이다 — 외삽하지 않는다
    const f = unitFeatures({ officer: idOf('헌제'), statPicks: [] });
    assert.deepEqual([f.skillB, f.skillA, f.skillS], [0, 0, 0]);
    const gwan = unitFeatures({ officer: idOf('관우'), statPicks: [] });
    assert.deepEqual([gwan.skillB, gwan.skillA, gwan.skillS], [0, 0, 1], '관우는 S급 고유기술');
  });
});

// ── 실측치 (`npm run power -- 20000 --calib 5000`, 2026-08-17) ──
//
// 여기 숫자는 **도구가 찍어 준 것을 손으로 옮겨 적은 것**이다. 도구를 다시 돌려 값이
// 달라지면 이 테스트가 먼저 깨진다 — 그때 **의도된 변경인지 먼저 확인한다.**
// 전투력이 조용히 흔들리면 매칭 상대도 함께 흔들린다.

const EXPECTED: Record<BattleMode, { weights: Record<string, number>; offset: number }> = {
  '3v3': {
    weights: {
      might: 1.47, intellect: 0.315, leadership: 0.756,
      skillB: 5.669, skillA: 16.52, skillS: 34.125,
      hp: 6.344, mp: 0.779, at: 38.3,
    },
    offset: -126.476,
  },
  '5v5': {
    weights: {
      might: 0.889, intellect: 0.283, leadership: 0.382,
      skillB: 0, skillA: 4.173, skillS: 13.539,
      hp: 3.444, mp: 1.122, at: 22.042,
    },
    offset: -65.688,
  },
};

/** 라벨 · 모드 · 장수 · 레벨 · 전투력 */
const FIXTURES: [string, BattleMode, string[], number, number][] = [
  ['3v3 Lv1 관우·장비·조운', '3v3', ['관우', '장비', '조운'], 1, 857],
  ['3v3 Lv9 관우·장비·조운', '3v3', ['관우', '장비', '조운'], 9, 1272],
  ['3v3 Lv1 헌제·조식·유선 (최약체 근처)', '3v3', ['헌제', '조식', '유선'], 1, 169],
  ['3v3 Lv5 가후·순욱·곽가 (지력형)', '3v3', ['가후', '순욱', '곽가'], 5, 797],
  ['5v5 Lv1 오호대장', '5v5', ['관우', '장비', '조운', '황충', '마초'], 1, 854],
  ['5v5 Lv9 오호대장', '5v5', ['관우', '장비', '조운', '황충', '마초'], 9, 1256],
  ['5v5 Lv5 헌제·조식·유선·동소·양수', '5v5', ['헌제', '조식', '유선', '동소', '양수'], 5, 547],
];
