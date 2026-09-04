/**
 * 부대 편성 · 배치 프리셋 회귀 (2026-08-18, 작업계획 §3-E · pptx 42·43쪽)
 *
 * **완료 조건 다섯을 그대로 옮긴 것이다.**
 *  1. 부대 CRUD — 이름 12자 · 중복 불허 · 상한
 *  2. **저장된 부대가 `createBattle`도 통과하는가** ← 편성 검증과 룰 엔진이 갈리면 안 된다
 *  3. **하향 Lv5가 진짜 Lv5와 같은가** — B가 `growth.test.ts`에 박은 것을 **부대 경로로** 다시 지난다
 *  4. **어긋난 배치가 화면을 깨지 않고 물러나는가** (`null`, 던지지 않는다)
 *  5. **상한이 도시 레벨을 따라가는가** (`squadCap`)
 *
 * 전부 **화면에 안 뜨는 종류**다. 하향은 전투에 들어가야 드러나고, 어긋난 배치는
 * 「어라, 기본 배치네」로만 보인다.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CITY_RULES, officerByName } from '@samchess/data';
import { createBattle, deployZone, inZone } from '@samchess/rules';
import type { BattleMode, OfficerId, PieceType, Side } from '@samchess/rules';
import {
  SQUAD_NAME_MAX, addCard, addSquad, applyLevelUp, applyRespec, battlePower,
  canAddSquad, cardsToLevelUp, createProfile, defaultSquadCells, isDeployable,
  MAX_CITY_LEVEL, migrateProfile, newInstance, removeSquad, squadById, squadCap, squadDeployment,
  squadPower, squadRow, squadsOf, statPicksOf, statsOf, tacticsOf, toRosterEntries,
  updateSquad, validateSquad, validateSquadName,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick, Squad, SquadDraft } from '../src/index.ts';

const NAMES = ['관우', '장비', '조운', '황충', '마초', '위연'] as const;
const ID = (name: string): OfficerId => officerByName.get(name)!.id as OfficerId;
const PIECES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'];

/** 여섯 명을 보유한 계정. 부대 검증에 필요한 것은 「보유하고 있는가」뿐이다 */
function base(): PlayerProfile {
  const p = createProfile('시험성', 7);
  return {
    ...p,
    roster: Object.fromEntries(NAMES.map((n) => [ID(n), newInstance(ID(n))])),
    cards: {},
  };
}

/** 모드에 맞는 정원의 구성. `levels`를 주면 그만큼 하향한다 */
function picksOf(mode: BattleMode, levels?: number[]): RosterPick[] {
  const n = mode === '3v3' ? 3 : 5;
  return NAMES.slice(0, n).map((name, i) => (levels?.[i] === undefined
    ? { piece: PIECES[i]!, officer: ID(name) }
    : { piece: PIECES[i]!, officer: ID(name), level: levels[i]! }));
}

const draft = (name: string, mode: BattleMode = '3v3', levels?: number[]): SquadDraft =>
  ({ name, mode, picks: picksOf(mode, levels) });

/** 한 장수를 Lv까지 정상 성장으로 올린다 (하향과 비교할 「진짜」를 만든다) */
function raise(profile: PlayerProfile, officer: OfficerId, to: number): PlayerProfile {
  let p = profile;
  for (let lv = 1; lv < to; lv++) {
    p = addCard(p, officer, cardsToLevelUp(lv)!);
    p = applyLevelUp(p, officer, lv % 2 === 0 ? 'hp' : 'at', lv % 3 === 0 ? 'illusion' : 'support');
  }
  return p;
}

// ── 1. 상한은 도시 레벨을 따라간다 ★ (C2가 남긴 §4-6①) ──────────

describe('부대 개수 상한 — 도시 레벨과 무관하게 고정 (2026-09-04에 뒤집힘)', () => {
  it('엑셀이 정한 상수 하나다 — 코드가 숫자를 다시 적지 않는다', () => {
    assert.equal(CITY_RULES.squadCap, 10, 'pptx 56쪽');
  });

  /**
   * **옛 규칙(`10 + (레벨−1)×5`)이 되살아나면 여기서 깨진다.** 도시 레벨을 바꿔
   * 봐도 값이 안 움직이는 것이 이 규칙의 전부라, 레벨 하나만 보면 「기본값과
   * 같은 값을 확인하는」 검사가 된다 — 그래서 양 끝을 함께 본다.
   */
  it('`squadCap()`은 도시 레벨을 봐도 안 바뀐다 ★', () => {
    const p = base();
    assert.equal(squadCap(p), CITY_RULES.squadCap);
    assert.equal(squadCap({ ...p, cityLevel: 3 }), CITY_RULES.squadCap);
    assert.equal(squadCap({ ...p, cityLevel: MAX_CITY_LEVEL }), CITY_RULES.squadCap);
  });

  it('상한에 닿으면 더 못 만들고 **왜인지 말한다**', () => {
    let p = base();
    for (let i = 0; i < squadCap(p); i++) p = addSquad(p, draft(`부대${i}`)).profile;
    assert.equal(p.squads.length, 10);

    const room = canAddSquad(p);
    assert.equal(room.ok, false);
    assert.match(room.ok ? '' : room.reason, /10개까지/);
    assert.throws(() => addSquad(p, draft('열한번째')), /10개까지/);

    // ★ **증축해도 안 열린다** (2026-09-04에 뒤집힘). 예전에는 여기가
    // 「증축하면 그대로 열린다」였다 — 규칙이 바뀐 것을 이 한 줄이 붙잡는다
    assert.equal(canAddSquad({ ...p, cityLevel: MAX_CITY_LEVEL }).ok, false);
  });
});

// ── 2. 이름 — 12자 · 중복 불허 ─────────────────────────────────

describe('부대 이름', () => {
  it('빈 이름 · 공백뿐인 이름은 거부한다', () => {
    const p = base();
    assert.equal(validateSquadName(p, '').ok, false);
    assert.equal(validateSquadName(p, '   ').ok, false);
  });

  it(`${SQUAD_NAME_MAX}자까지다 — 한 자 넘으면 거부`, () => {
    const p = base();
    assert.equal(validateSquadName(p, '가'.repeat(SQUAD_NAME_MAX)).ok, true);
    assert.equal(validateSquadName(p, '가'.repeat(SQUAD_NAME_MAX + 1)).ok, false);
  });

  it('중복은 불허하되 **수정 중인 자기 이름은 허용한다**', () => {
    const made = addSquad(base(), draft('초전박살'));
    const p = made.profile;
    assert.equal(validateSquadName(p, '초전박살').ok, false);
    // 이 예외가 없으면 이름을 그대로 두고 구성만 고치는 것이 「중복」으로 막힌다
    assert.equal(validateSquadName(p, '초전박살', made.squad.id).ok, true);
    // 앞뒤 공백은 떼고 본다 — 「초전박살 」로 우회할 수 없다
    assert.equal(validateSquadName(p, ' 초전박살 ').ok, false);
  });
});

// ── 3. CRUD ────────────────────────────────────────────────────

describe('부대 CRUD', () => {
  it('만들면 id가 붙고 `squadSeq`가 는다 — **지운 번호를 다시 쓰지 않는다**', () => {
    let p = base();
    const a = addSquad(p, draft('가'));
    p = a.profile;
    const b = addSquad(p, draft('나'));
    p = b.profile;
    assert.notEqual(a.squad.id, b.squad.id);
    assert.equal(p.squadSeq, 3);

    p = removeSquad(p, a.squad.id);
    const c = addSquad(p, draft('다'));
    assert.notEqual(c.squad.id, a.squad.id, '지운 번호가 되살아나면 옛 참조가 엉뚱한 부대를 가리킨다');
  });

  it('고칠 때 참여 인원은 못 바꾼다 — 배치도 구성도 뜻이 없어진다', () => {
    const made = addSquad(base(), draft('가'));
    assert.throws(
      () => updateSquad(made.profile, made.squad.id, draft('가', '5v5')),
      /참여 인원은 바꿀 수 없다/,
    );
  });

  it('성립하지 않는 구성은 만들 수 없다 — `validateRoster`가 그대로 말한다', () => {
    const p = base();
    const noKing: SquadDraft = { name: '왕없음', mode: '3v3', picks: picksOf('3v3').slice(1) };
    assert.equal(validateSquad(p, noKing).ok, false);
    assert.throws(() => addSquad(p, noKing), /채워야 한다|King/);

    const dupe: SquadDraft = {
      name: '중복', mode: '3v3',
      picks: [
        { piece: 'King', officer: ID('관우') },
        { piece: 'Rock', officer: ID('관우') },
        { piece: 'Bishop', officer: ID('장비') },
      ],
    };
    const said = validateSquad(p, dupe);
    assert.equal(said.ok, false);
    assert.match(said.ok ? '' : said.reason, /같은 장수/);
  });

  it('목록은 모드로 갈라 볼 수 있다 — 값 범위가 겹쳐 나란히 놓으면 안 된다', () => {
    let p = base();
    p = addSquad(p, draft('삼', '3v3')).profile;
    p = addSquad(p, draft('오', '5v5')).profile;
    assert.equal(squadsOf(p).length, 2);
    assert.deepEqual(squadsOf(p, '3v3').map((s) => s.name), ['삼']);
    assert.deepEqual(squadsOf(p, '5v5').map((s) => s.name), ['오']);
  });
});

// ── 4. 저장된 부대가 `createBattle`을 통과한다 ★ ────────────────
//
// 「`validateRoster`를 통과한 편성은 `createBattle`도 받아들인다」(2026-08-04)의 확장이다.
// 부대는 **저장해 두고 나중에 꺼내는 것**이라 그동안 계정이 변한다 — 그게 이 절의 핵심이다.

describe('저장된 부대는 언제나 룰 엔진을 통과한다', () => {
  const start = (p: PlayerProfile, squad: Squad) => createBattle({
    matchId: 'test', seed: 1, mode: squad.mode,
    rosters: {
      P1: toRosterEntries(p, squad.picks),
      P2: toRosterEntries(p, squad.picks.map((k) => ({ ...k }))),
    },
  });

  it('갓 만든 부대 — 3v3 · 5v5 둘 다', () => {
    for (const mode of ['3v3', '5v5'] as BattleMode[]) {
      const made = addSquad(base(), draft(`부대${mode}`, mode));
      assert.doesNotThrow(() => start(made.profile, made.squad));
    }
  });

  it('레벨을 하향한 부대', () => {
    let p = raise(base(), ID('관우'), 7);
    const made = addSquad(p, draft('하향', '3v3', [3, 1, 1]));
    p = made.profile;
    const entries = toRosterEntries(p, made.squad.picks);
    assert.equal(entries[0]!.level, 3);
    assert.doesNotThrow(() => start(p, made.squad));
  });

  it('**재설계로 보유 레벨이 내려가도** 눌러 담아 통과한다 ★', () => {
    let p = raise(base(), ID('관우'), 7);
    const made = addSquad(p, draft('되감김', '3v3', [7, 1, 1]));
    p = made.profile;

    // 둔갑천서 — 관우가 Lv1로 되감긴다. 부대는 여전히 「Lv7 관우」를 가리킨다
    p = applyRespec({ ...p, gold: 99 }, ID('관우'));
    assert.equal(p.roster[ID('관우')]!.level, 1);

    const squad = squadById(p, made.squad.id)!;
    const entries = toRosterEntries(p, squad.picks);
    assert.equal(entries[0]!.level, 1, '보유 레벨로 눌러 담는다 — 약해지는 방향이라 안전하다');
    assert.equal(entries[0]!.statPicks.length, 0);
    assert.doesNotThrow(() => start(p, squad), '여기서 던지면 화면에는 아무 표시가 없다');
    assert.notEqual(squadPower(p, squad), null);
  });

  it('보유에서 빠진 장수는 **말한다** — 눌러 담을 수 없는 종류라서다', () => {
    const made = addSquad(base(), draft('구멍'));
    const p = made.profile;
    const gone: PlayerProfile = {
      ...p,
      roster: Object.fromEntries(Object.entries(p.roster).filter(([id]) => id !== ID('관우'))),
    };
    const row = squadRow(gone, made.squad);
    assert.equal(row.power, null, '성립하지 않는 부대는 전투력을 내지 않는다(던지지도 않는다)');
    assert.match(row.problem ?? '', /보유하지 않은 장수/);
  });
});

// ── 5. 하향 Lv5 = 진짜 Lv5 ★ (B가 고정한 것을 부대 경로로) ──────

describe('하향한 Lv5가 처음부터 Lv5인 것과 같다', () => {
  it('능력 선택 · 책략 · 능력치 · 전투력 넷 다 같다', () => {
    const officer = ID('관우');
    const high = raise(base(), officer, 8).roster[officer]!;
    const real = raise(base(), officer, 5).roster[officer]!;

    assert.deepEqual(statPicksOf(high, 5), statPicksOf(real));
    assert.deepEqual(tacticsOf(high, 5), tacticsOf(real));
    assert.deepEqual(statsOf(high, 5), statsOf(real));

    // 부대를 지나서도 같아야 한다 — 펴는 자리가 `toRosterEntries()` 하나이기 때문이다
    const madeHigh = addSquad(raise(base(), officer, 8), draft('하향', '3v3', [5, 1, 1]));
    const madeReal = addSquad(raise(base(), officer, 5), draft('진짜', '3v3', [5, 1, 1]));
    for (const mode of ['3v3'] as BattleMode[]) {
      assert.equal(
        battlePower(mode, toRosterEntries(madeHigh.profile, madeHigh.squad.picks)),
        battlePower(mode, toRosterEntries(madeReal.profile, madeReal.squad.picks)),
        '전투력이 갈리면 하향이 매칭을 속인다',
      );
    }
  });

  it('레벨을 내리면 전투력이 반드시 내려간다 — 하향이 값을 하는 근거다', () => {
    const p = raise(base(), ID('관우'), 9);
    const high = addSquad(p, draft('높음', '3v3', [9, 1, 1]));
    const low = addSquad(p, draft('낮음', '3v3', [1, 1, 1]));
    assert.ok(squadPower(high.profile, high.squad)! > squadPower(low.profile, low.squad)!);
  });

  it('`squadRow()`가 실제로 설 레벨과 보유 레벨을 함께 준다 (42쪽의 하향 눈금)', () => {
    const p = raise(base(), ID('관우'), 6);
    const made = addSquad(p, draft('눈금', '3v3', [4, 1, 1]));
    const row = squadRow(made.profile, made.squad);
    assert.equal(row.members[0]!.level, 4);
    assert.equal(row.members[0]!.maxLevel, 6, '하향 눈금의 위 끝이다');
    assert.deepEqual(row.members[0]!.stats, statsOf(p.roster[ID('관우')]!, 4));
  });
});

// ── 6. 배치 프리셋 — 어긋나면 조용히 물러난다 ★ ─────────────────

describe('배치 프리셋', () => {
  const made = () => addSquad(base(), draft('배치시험', '3v3'));

  it('기본 배치는 엔진이 세우는 그 자리다', () => {
    const { profile, squad } = made();
    for (const side of ['P1', 'P2'] as Side[]) {
      const cells = defaultSquadCells(squad.mode, side, squad.picks);
      const zone = deployZone(squad.mode, side);
      for (const c of cells) assert.ok(inZone(zone, { x: c.x, y: c.y }), `${side} ${c.piece}`);
      assert.ok(isDeployable(profile, squad, side, cells));
    }
  });

  it('저장하면 엔진의 `deploy` 의도로 펴진다 — 유닛 id는 `{진영}-{기물}`', () => {
    const { profile, squad } = made();
    const cells = defaultSquadCells(squad.mode, 'P1', squad.picks);
    const saved: Squad = { ...squad, deploy: { P1: cells, P2: null } };
    const placements = squadDeployment(profile, saved, 'P1');
    assert.notEqual(placements, null);
    assert.equal(placements!.length, 3);
    assert.deepEqual(placements!.map((p) => p.unit).sort(), ['P1-Bishop', 'P1-King', 'P1-Rock']);
    assert.equal(squadDeployment(profile, saved, 'P2'), null, '북군은 저장한 적이 없다');
  });

  it('**남군 좌표를 북군에 쓸 수 없다** — 구역이 위아래로 다르다', () => {
    const { profile, squad } = made();
    const cells = defaultSquadCells(squad.mode, 'P1', squad.picks);
    const wrong: Squad = { ...squad, deploy: { P1: null, P2: cells } };
    assert.equal(squadDeployment(profile, wrong, 'P2'), null);
  });

  it('구역 밖 · 칸 겹침 · 인원 부족 — 전부 `null`이고 던지지 않는다', () => {
    const { profile, squad } = made();
    const base3 = defaultSquadCells(squad.mode, 'P1', squad.picks);
    const cases: Record<string, typeof base3> = {
      '구역 밖': base3.map((c, i) => (i === 0 ? { ...c, y: 0 } : c)),
      '칸 겹침': base3.map((c, i) => (i === 0 ? { ...c, x: base3[1]!.x, y: base3[1]!.y } : c)),
      '인원 부족': base3.slice(0, 2),
      '소수 좌표': base3.map((c, i) => (i === 0 ? { ...c, x: c.x + 0.5 } : c)),
    };
    for (const [why, cells] of Object.entries(cases)) {
      const s: Squad = { ...squad, deploy: { P1: cells, P2: null } };
      assert.equal(squadDeployment(profile, s, 'P1'), null, why);
    }
  });

  it('**구성을 고치면 옛 배치가 물러난다** — 위치가 아니라 기물로 짝을 짓는다', () => {
    const { profile, squad } = made();
    const cells = defaultSquadCells(squad.mode, 'P1', squad.picks);
    let p = updateSquad(
      { ...profile, squads: [{ ...squad, deploy: { P1: cells, P2: null } }] },
      squad.id,
      { name: squad.name, mode: squad.mode, picks: [
        { piece: 'King', officer: ID('관우') },
        { piece: 'Queen', officer: ID('장비') },   // Rock → Queen 으로 갈았다
        { piece: 'Bishop', officer: ID('조운') },
      ] },
    );
    assert.equal(squadDeployment(p, squadById(p, squad.id)!, 'P1'), null);
    // 다시 기본 배치를 깔면 살아난다
    const fixed = squadById(p, squad.id)!;
    p = { ...p, squads: [{ ...fixed, deploy: { P1: defaultSquadCells(fixed.mode, 'P1', fixed.picks), P2: null } }] };
    assert.notEqual(squadDeployment(p, squadById(p, squad.id)!, 'P1'), null);
  });
});

// ── 7. 되접기 — 필드가 더해질 뿐이라 버전을 안 올렸다 ────────────

describe('저장 형식 — 부대는 필드 추가뿐이다', () => {
  it('옛 계정(부대 없음)이 빈 배열로 열린다 — 버전은 그대로', () => {
    const old = { ...base(), squads: undefined, squadSeq: undefined };
    const back = migrateProfile(JSON.parse(JSON.stringify(old)))!;
    assert.deepEqual(back.squads, []);
    assert.equal(back.squadSeq, 1);
  });

  it('멱등하다 — 두 번 지나가도 같다', () => {
    const made = addSquad(base(), draft('멱등'));
    const cells = defaultSquadCells('3v3', 'P1', made.squad.picks);
    const p: PlayerProfile = {
      ...made.profile,
      squads: [{ ...made.squad, deploy: { P1: cells, P2: null } }],
    };
    const once = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    const twice = migrateProfile(JSON.parse(JSON.stringify(once)))!;
    assert.deepEqual(twice, once);
    assert.deepEqual(once.squads, p.squads);
  });

  it('되접을 수 없는 **부대만** 빠진다 — 계정은 살아 있다', () => {
    const good = addSquad(base(), draft('멀쩡'));
    const raw = JSON.parse(JSON.stringify(good.profile)) as Record<string, unknown>;
    (raw.squads as unknown[]).push(
      { id: 'sq9', name: '', mode: '3v3', picks: picksOf('3v3') },                 // 이름 없음
      { id: 'sq10', name: '가'.repeat(13), mode: '3v3', picks: picksOf('3v3') },   // 12자 초과
      { id: 'sq11', name: '멀쩡', mode: '3v3', picks: picksOf('3v3') },            // 이름 중복
      { id: 'sq12', name: '없는장수', mode: '3v3', picks: [
        { piece: 'King', officer: '없는-사람' },
        { piece: 'Rock', officer: ID('장비') },
        { piece: 'Bishop', officer: ID('조운') },
      ] },
      { id: 'sq13', name: '왕없음', mode: '3v3', picks: picksOf('3v3').slice(1) }, // King 없음·정원 미달
      { id: 'sq14', name: '모드이상', mode: '9v9', picks: picksOf('3v3') },
    );
    const back = migrateProfile(raw)!;
    assert.deepEqual(back.squads.map((s) => s.name), ['멀쩡']);
    assert.equal(Object.keys(back.roster).length, NAMES.length, '부대가 망가져도 계정은 그대로다');
  });

  it('`squadSeq`는 뒤로 가지 않는다', () => {
    const raw = {
      ...base(), squadSeq: 0,
      squads: [{ id: 'sq7', name: '일곱', mode: '3v3', picks: picksOf('3v3') }],
    };
    const back = migrateProfile(JSON.parse(JSON.stringify(raw)))!;
    assert.equal(back.squadSeq, 8, '다시 쓰면 옛 참조가 엉뚱한 부대를 가리킨다');
  });

  it('망가진 배치 프리셋은 **부대를 죽이지 않는다** — 전투에서 물러날 뿐이다', () => {
    const made = addSquad(base(), draft('배치망가짐'));
    const raw = JSON.parse(JSON.stringify({
      ...made.profile,
      squads: [{ ...made.squad, deploy: { P1: [{ piece: 'King', x: 99, y: 99 }], P2: null } }],
    }));
    const back = migrateProfile(raw)!;
    assert.equal(back.squads.length, 1, '되접기가 미리 지우면 사람이 고칠 기회까지 사라진다');
    assert.equal(squadDeployment(back, back.squads[0]!, 'P1'), null);
  });
});
