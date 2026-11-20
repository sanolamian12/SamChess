/**
 * 부대 편성 · 배치 프리셋 회귀 (2026-08-18, 작업계획 §3-E · pptx 42·43쪽)
 *
 * **완료 조건 다섯을 그대로 옮긴 것이다.**
 *  1. 부대 칸 — 모드마다 공격대 · 수비대 하나씩, 이름 없음 (2026-11-14 부대 개편, 그전에는 이름 12자 · 중복 불허 · 상한 10)
 *  2. **저장된 부대가 `createBattle`도 통과하는가** ← 편성 검증과 룰 엔진이 갈리면 안 된다
 *  3. **부대는 장수를 가리킬 뿐이다** — 레벨업·재설계가 그 장수가 속한 부대 **전부**에
 *     곧바로 반영되는가 (2026-09-16, 「하향 Lv5 = 진짜 Lv5」를 대체)
 *  4. **어긋난 배치가 화면을 깨지 않고 물러나는가** (`null`, 던지지 않는다)
 *  5. **옛 계정의 부대 여럿이 칸 넷으로 접히는가** (저장 형식 v8)
 *
 * 전부 **화면에 안 뜨는 종류**다. 레벨이 안 따라온 것은 전투에 들어가야 드러나고,
 * 어긋난 배치는 「어라, 기본 배치네」로만 보인다.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { officerByName } from '@samchess/data';
import { createBattle, deployZone, inZone } from '@samchess/rules';
import type { BattleMode, OfficerId, PieceType, Side } from '@samchess/rules';
import {
  PROFILE_VERSION, SQUAD_SLOTS, addCard, addSquad, applyLevelUp, applyRespec, attackSquadOf, battlePower,
  cardsToLevelUp, clearSquad, createProfile, defaultSquadCells, garrisonOf, isDeployable,
  migrateProfile, newInstance, slotOf, squadAt, squadById, squadDeployment, squadLabelKo, squadSlot,
  squadPower, squadRow, squadsOf, statPicksOf, statsOf, tacticsOf, toRosterEntries, recentSquads, remapDeployment,
  saveSquadSlot, squadStateAt, updateSquad, validateSquad,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick, Squad, SquadDraft, SquadRole } from '../src/index.ts';

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

/** 모드에 맞는 정원의 구성 — 기물과 장수의 짝뿐이다 */
function picksOf(mode: BattleMode): RosterPick[] {
  const n = mode === '3v3' ? 3 : 5;
  return NAMES.slice(0, n).map((name, i) => ({ piece: PIECES[i]!, officer: ID(name) }));
}

const draft = (mode: BattleMode = '3v3', role: SquadRole = 'attack'): SquadDraft =>
  ({ mode, role, picks: picksOf(mode) });

/** 한 장수를 Lv까지 정상 성장으로 올린다 */
function raise(profile: PlayerProfile, officer: OfficerId, to: number): PlayerProfile {
  // 장수 상한 = 도시 레벨 (2026-09-14) — 올릴 레벨만큼 도시를 세워 둔다
  let p = { ...profile, cityLevel: Math.max(profile.cityLevel, to) };
  for (let lv = 1; lv < to; lv++) {
    p = addCard(p, officer, cardsToLevelUp(lv)!);
    p = applyLevelUp(p, officer, lv % 2 === 0 ? 'hp' : 'at', lv % 3 === 0 ? 'illusion' : 'support');
  }
  return p;
}

// ── 1. 칸 넷 — 모드마다 공격대 · 수비대 하나씩 (2026-11-14 부대 개편) ──

describe('부대 칸', () => {
  it('칸은 넷이고 차례는 3v3 공격 · 수비, 5v5 공격 · 수비 — 목록 판의 차례다', () => {
    assert.deepEqual(SQUAD_SLOTS.map((x) => x.id), ['atk-3v3', 'def-3v3', 'atk-5v5', 'def-5v5']);
    for (const x of SQUAD_SLOTS) {
      assert.equal(squadSlot(x.mode, x.role), x.id);
      assert.deepEqual(slotOf(x.id), { mode: x.mode, role: x.role });
    }
    assert.equal(slotOf('초전박살'), null, '개편 전 이력 줄의 부대 이름은 칸이 아니다');
    assert.equal(squadLabelKo('def-5v5'), '5v5 수비대');
    assert.equal(squadLabelKo('초전박살'), '초전박살');
  });

  it('채우면 id가 칸이고 역할이 붙는다 — 이름은 없다', () => {
    const made = addSquad(base(), draft('5v5', 'defense'));
    assert.equal(made.squad.id, 'def-5v5');
    assert.equal(made.squad.role, 'defense');
    assert.equal('name' in made.squad, false);
    assert.equal(squadAt(made.profile, '5v5', 'defense')?.id, 'def-5v5');
    assert.equal(squadAt(made.profile, '5v5', 'attack'), undefined);
  });

  it('찬 칸은 다시 채울 수 없다 — 고치는 것은 `updateSquad`', () => {
    const p = addSquad(base(), draft()).profile;
    assert.throws(() => addSquad(p, draft()), /이미 찬 칸/);
    assert.equal(addSquad(p, draft('3v3', 'defense')).profile.squads.length, 2, '같은 모드의 다른 칸은 된다');
  });

  it('같은 장수가 공격대와 수비대에 함께 선다 (기획자 확정)', () => {
    let p = addSquad(base(), draft('3v3', 'attack')).profile;
    p = addSquad(p, draft('3v3', 'defense')).profile;
    assert.deepEqual(squadAt(p, '3v3', 'attack')!.picks, squadAt(p, '3v3', 'defense')!.picks);
    assert.ok(squadPower(p, squadAt(p, '3v3', 'defense')!) !== null);
  });

  it('비우면 그 칸만 빈다 — 다시 채우면 새 부대(전적 없음)', () => {
    let p = addSquad(base(), draft()).profile;
    p = { ...p, squads: p.squads.map((s) => ({ ...s, record: { 'siege/3v3': { plays: 1, wins: 1, losses: 0, draws: 0, kills: 0, points: 10 } } })) };
    p = addSquad(p, draft('3v3', 'defense')).profile;
    p = clearSquad(p, 'atk-3v3');
    assert.deepEqual(p.squads.map((s) => s.id), ['def-3v3']);
    const again = addSquad(p, draft()).squad;
    assert.deepEqual(again.record, {});
  });

  it('고쳐도 칸 · 전적 · 방침은 그대로 — 구성만 바뀐다', () => {
    let p = addSquad(base(), draft('3v3', 'defense')).profile;
    p = { ...p, squads: p.squads.map((s) => ({ ...s, policy: { stances: { King: 'hold' } } })) } as PlayerProfile;
    const picks: RosterPick[] = [
      { piece: 'King', officer: ID('위연') }, { piece: 'Rock', officer: ID('장비') }, { piece: 'Bishop', officer: ID('조운') },
    ];
    p = updateSquad(p, 'def-3v3', { mode: '3v3', picks });
    const after = squadById(p, 'def-3v3')!;
    assert.equal(after.role, 'defense');
    assert.deepEqual(after.policy, { stances: { King: 'hold' } });
    assert.equal(after.picks[0]!.officer, ID('위연'));
  });

  it('공격대는 성립할 때만 — 장수가 빠지면 `attackSquadOf`가 `null`', () => {
    const p = addSquad(base(), draft()).profile;
    assert.equal(attackSquadOf(p, '3v3')?.id, 'atk-3v3');
    assert.equal(attackSquadOf(p, '5v5'), null);
    const { [ID('관우')]: _gone, ...roster } = p.roster;
    assert.equal(attackSquadOf({ ...p, roster }, '3v3'), null);
  });
});

// ── 3. CRUD ────────────────────────────────────────────────────

describe('부대 CRUD', () => {
  it('고칠 때 참여 인원은 못 바꾼다 — 배치도 구성도 뜻이 없어진다', () => {
    const made = addSquad(base(), draft());
    assert.throws(
      () => updateSquad(made.profile, made.squad.id, draft('5v5')),
      /참여 인원은 바꾸실 수 없습니다/,
    );
  });

  it('덜 찬 부대는 저장되지만 판에 안 선다 — 겹치는 장수는 저장도 안 된다 (2026-11-17)', () => {
    const p = base();
    const noKing: SquadDraft = { mode: '3v3', role: 'attack', picks: picksOf('3v3').slice(1) };
    assert.equal(validateSquad(p, noKing).ok, false);
    const saved = addSquad(p, noKing).profile;
    assert.equal(squadStateAt(saved, '3v3', 'attack'), 'partial');
    assert.equal(attackSquadOf(saved, '3v3'), null, '덜 찬 공격대는 출정 · 매칭에 안 선다');
    assert.equal(squadPower(saved, saved.squads[0]!), null);
    assert.equal(squadStateAt(addSquad(p, draft()).profile, '3v3', 'attack'), 'done');
    assert.equal(squadStateAt(p, '3v3', 'attack'), 'empty');
    assert.throws(() => addSquad(p, { mode: '3v3', role: 'attack', picks: [] }), /한 명도/);
    assert.throws(() => addSquad(p, { mode: '3v3', role: 'attack', picks: picksOf('5v5') }), /3명까지/);

    const dupe: SquadDraft = {
      mode: '3v3', role: 'attack',
      picks: [
        { piece: 'King', officer: ID('관우') },
        { piece: 'Rock', officer: ID('관우') },
        { piece: 'Bishop', officer: ID('장비') },
      ],
    };
    const said = validateSquad(p, dupe);
    assert.equal(said.ok, false);
    assert.match(said.ok ? '' : said.reason, /같은 장수/);
    assert.throws(() => addSquad(p, dupe), /두 자리/);
  });

  it('`saveSquadSlot` — 빈 칸은 채우고 찬 칸은 갈고 부대원이 없으면 비운다 · 방침은 수비대만 (2026-11-17)', () => {
    let p = base();
    p = saveSquadSlot(p, { mode: '3v3', role: 'defense', picks: picksOf('3v3').slice(0, 2) }, 5);
    assert.equal(squadStateAt(p, '3v3', 'defense'), 'partial');
    assert.equal(p.squads[0]!.createdAt, 5);
    const policy = { stances: { King: 'hold' } } as unknown as NonNullable<Squad['policy']>;
    p = saveSquadSlot(p, { mode: '3v3', role: 'defense', picks: picksOf('3v3'), policy });
    assert.equal(squadStateAt(p, '3v3', 'defense'), 'done');
    assert.deepEqual(p.squads[0]!.policy, policy);
    assert.equal(p.squads[0]!.createdAt, 5, '갈아 끼워도 만든 시각은 남는다');
    p = saveSquadSlot(p, { mode: '3v3', role: 'attack', picks: picksOf('3v3'), policy });
    assert.equal(squadAt(p, '3v3', 'attack')!.policy, undefined, '공격대는 방침을 안 든다');
    p = saveSquadSlot(p, { mode: '3v3', role: 'defense', picks: [] });
    assert.equal(squadStateAt(p, '3v3', 'defense'), 'empty');
  });

  it('목록은 모드로 갈라 볼 수 있다 — 값 범위가 겹쳐 나란히 놓으면 안 된다', () => {
    let p = base();
    p = addSquad(p, draft('5v5', 'defense')).profile;
    p = addSquad(p, draft('3v3')).profile;
    assert.deepEqual(squadsOf(p).map((s) => s.id), ['atk-3v3', 'def-5v5'], '칸 차례로');
    assert.deepEqual(squadsOf(p, '3v3').map((s) => s.id), ['atk-3v3']);
    assert.deepEqual(squadsOf(p, '5v5').map((s) => s.id), ['def-5v5']);
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
      const made = addSquad(base(), draft(mode));
      assert.doesNotThrow(() => start(made.profile, made.squad));
    }
  });

  it('키운 장수가 든 부대', () => {
    let p = raise(base(), ID('관우'), 7);
    const made = addSquad(p, draft('3v3'));
    p = made.profile;
    const entries = toRosterEntries(p, made.squad.picks);
    assert.equal(entries[0]!.level, 7);
    assert.doesNotThrow(() => start(p, made.squad));
  });

  it('**재설계로 보유 레벨이 내려가도** 그대로 통과한다 ★', () => {
    let p = raise(base(), ID('관우'), 7);
    const made = addSquad(p, draft('3v3'));
    p = made.profile;

    // 둔갑천서 — 관우가 Lv1로 되감긴다. 부대는 장수를 가리킬 뿐이라 따라 내려간다
    p = applyRespec({ ...p, gold: 99 }, ID('관우'));
    assert.equal(p.roster[ID('관우')]!.level, 1);

    const squad = squadById(p, made.squad.id)!;
    const entries = toRosterEntries(p, squad.picks);
    assert.equal(entries[0]!.level, 1);
    assert.equal(entries[0]!.statPicks.length, 0);
    assert.doesNotThrow(() => start(p, squad), '여기서 던지면 화면에는 아무 표시가 없다');
    assert.notEqual(squadPower(p, squad), null);
  });

  it('보유에서 빠진 장수는 **말한다** — 눌러 담을 수 없는 종류라서다', () => {
    const made = addSquad(base(), draft());
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

// ── 5. 부대는 장수를 가리킬 뿐이다 ★ (2026-09-16 기획자 확정) ──────
//
// 예전에는 부대마다 레벨을 낮춰 두는 「하향 눈금」이 있었고, 그래서 **레벨업을 해도
// 부대에는 옛 눈금이 남았다.** 여기서 지키는 것은 그 반대 — 궁궐에서 키우면
// 그 장수가 속한 부대 **전부**가 손대지 않아도 따라온다.

describe('레벨업·재설계는 장수가 속한 모든 부대에 곧바로 반영된다', () => {
  it('한 장수가 두 부대에 소속되고, 레벨업이 **둘 다에** 반영된다 ★', () => {
    const officer = ID('관우');
    let p = base();
    const a = addSquad(p, draft('3v3'));
    const b = addSquad(a.profile, draft('5v5'));
    p = b.profile;
    const before = [squadPower(p, a.squad)!, squadPower(p, b.squad)!];

    // 부대를 한 줄도 안 고치고 궁궐에서만 키운다
    p = raise(p, officer, 6);
    for (const id of [a.squad.id, b.squad.id]) {
      const row = squadRow(p, squadById(p, id)!);
      const member = row.members.find((m) => m.officer === officer)!;
      assert.equal(member.level, 6, `${row.squad.id} — 부대가 레벨을 따로 들면 여기서 1이 남는다`);
      assert.deepEqual(member.stats, statsOf(p.roster[officer]!));
      assert.equal(toRosterEntries(p, row.squad.picks)[0]!.level, 6);
    }
    assert.ok(squadPower(p, squadById(p, a.squad.id)!)! > before[0]!, '3v3 전투력이 따라 오른다');
    assert.ok(squadPower(p, squadById(p, b.squad.id)!)! > before[1]!, '5v5 전투력이 따라 오른다');
  });

  it('전투에 실리는 능력 선택·책략이 장수의 성장 스택 그대로다', () => {
    const officer = ID('관우');
    const made = addSquad(raise(base(), officer, 5), draft());
    const inst = made.profile.roster[officer]!;
    const entry = toRosterEntries(made.profile, made.squad.picks)[0]!;
    assert.deepEqual(entry.statPicks, statPicksOf(inst));
    assert.deepEqual(entry.tactics, tacticsOf(inst));
  });

  it('**편성에 `level`이 섞여 와도 읽지 않고 저장하지도 않는다** — 레벨을 자칭할 길이 없다', () => {
    const p = raise(base(), ID('관우'), 6);
    const sneaky = picksOf('3v3').map((k) => ({ ...k, level: 1 })) as RosterPick[];
    assert.equal(toRosterEntries(p, sneaky)[0]!.level, 6, '서버의 AI 재생 검증도 이 길을 지난다');
    const made = addSquad(p, { mode: '3v3', role: 'attack', picks: sneaky });
    assert.equal(made.squad.picks.some((k) => 'level' in k), false);
  });
});

// ── 6. 배치 프리셋 — 어긋나면 조용히 물러난다 ★ ─────────────────

describe('배치 프리셋', () => {
  const made = () => addSquad(base(), draft('3v3'));

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
    // 공격대의 북군은 남군 배치를 180° 돌린 것이다 (2026-11-18 기획자 — 사람은 언제나 남군 기준으로 둔다)
    const north = squadDeployment(profile, saved, 'P2');
    assert.deepEqual(north, cells.map((c) => ({ unit: `P2-${c.piece}`, pos: { x: 24 - c.x, y: 19 - c.y } })), '북군이 남군을 돌린 것이 아니다');
  });

  it('**공격대의 북군은 남군 배치를 돌린 것** — 옮긴 남군 배치가 그대로 따라오고, 저장된 북군 배치는 안 읽는다', () => {
    const { profile, squad } = made();
    // 기본 배치와 다른 남군 배치 — 기본값과 같은 값을 보면 아무것도 확인하지 않는다
    const south = defaultSquadCells(squad.mode, 'P1', squad.picks).map((c, i) => ({ ...c, y: 15 + i }));
    const stale = defaultSquadCells(squad.mode, 'P2', squad.picks);
    const saved: Squad = { ...squad, deploy: { P1: south, P2: stale } };
    const north = squadDeployment(profile, saved, 'P2')!;
    for (const c of south) {
      assert.deepEqual(north.find((p) => p.unit === `P2-${c.piece}`)!.pos, { x: 24 - c.x, y: 19 - c.y }, c.piece);
    }
    // 수비대는 수성전의 북군 자리를 그대로 편집한다 — 저장된 북군 배치를 쓴다
    const def: Squad = { ...saved, id: squadSlot('3v3', 'defense'), role: 'defense' };
    assert.deepEqual(squadDeployment(profile, def, 'P2')!.map((p) => p.pos), stale.map((c) => ({ x: c.x, y: c.y })));
  });

  it('되접기는 공격대의 옛 북군 배치를 버린다 — 수비대 것은 남긴다', () => {
    const { profile } = made();
    const south = defaultSquadCells('3v3', 'P1', picksOf('3v3'));
    const north = defaultSquadCells('3v3', 'P2', picksOf('3v3'));
    const two = saveSquadSlot(saveSquadSlot(profile, { ...draft('3v3'), deploy: { P1: south, P2: north } }),
      { ...draft('3v3', 'defense'), deploy: { P1: null, P2: north } });
    const back = migrateProfile(JSON.parse(JSON.stringify(two)))!;
    assert.equal(squadAt(back, '3v3', 'attack')!.deploy.P2, null);
    assert.deepEqual(squadAt(back, '3v3', 'attack')!.deploy.P1, south);
    assert.deepEqual(squadAt(back, '3v3', 'defense')!.deploy.P2, north);
  });

  it('기본 배치 — King이 가운데, 나머지는 고른 차례대로 왼쪽 · 오른쪽 · 더 왼쪽 · 더 오른쪽 (2026-11-18 기획자)', () => {
    const col = (x: number) => String.fromCharCode(65 + x);
    const pk = (piece: PieceType) => ({ piece, officer: 'x' as OfficerId });
    // King이 첫째가 아니어도 가운데 — 나머지 차례는 고른 차례
    const three = defaultSquadCells('3v3', 'P2', [pk('Rock'), pk('King'), pk('Queen')]);
    assert.deepEqual(three.map((c) => `${c.piece}@${col(c.x)}${c.y + 1}`), ['King@M3', 'Rock@H3', 'Queen@R3']);
    const five = defaultSquadCells('5v5', 'P2', [pk('King'), pk('Rock'), pk('Queen'), pk('Bishop'), pk('Knight')]);
    assert.deepEqual(five.map((c) => `${c.piece}@${col(c.x)}${c.y + 1}`), ['King@M3', 'Rock@H3', 'Queen@R3', 'Bishop@C3', 'Knight@W3']);
    const south = defaultSquadCells('3v3', 'P1', [pk('King'), pk('Rock'), pk('Queen')]);
    assert.deepEqual(south.map((c) => `${col(c.x)}${c.y + 1}`), ['M18', 'H18', 'R18']);
  });

  it('**남군 좌표를 북군에 쓸 수 없다** — 구역이 위아래로 다르다(수비대 — 북군 자리를 그대로 편집한다)', () => {
    const { profile, squad: atk } = made();
    const squad: Squad = { ...atk, id: squadSlot('3v3', 'defense'), role: 'defense' };
    const cells = defaultSquadCells(squad.mode, 'P1', squad.picks);
    const wrong: Squad = { ...squad, deploy: { P1: defaultSquadCells(squad.mode, 'P1', squad.picks), P2: cells } };
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
      { mode: squad.mode, picks: [
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

// ── 7. 되접기 — v8 칸 넷 · v7 이하 접기 (2026-11-14) ─────────────

/** 개편 전(v7) 부대 한 줄 */
const oldSquad = (id: string, name: string, mode: BattleMode, picks: RosterPick[], extra: Record<string, unknown> = {}) =>
  ({ id, name, mode, picks, deploy: { P1: null, P2: null }, record: {}, ...extra });

/** 개편 전 계정 — 저장 형식 v7 */
const v7 = (p: PlayerProfile, extra: Record<string, unknown>): unknown =>
  JSON.parse(JSON.stringify({ ...p, version: 7, ...extra }));

const fought = (seq: number, at: number, mySquad: string) =>
  ({ seq, at, mode: '3v3', opponent: 'siege', opponentId: null, mySquad, theirSquad: null, myPower: 0, theirPower: 0, chance: 0.5, result: 'win', picks: [] });

describe('저장 형식 v8 — 칸 넷', () => {
  it('옛 계정(부대 없음)이 빈 배열로 열린다', () => {
    const old = { ...base(), squads: undefined };
    const back = migrateProfile(JSON.parse(JSON.stringify(old)))!;
    assert.deepEqual(back.squads, []);
    assert.equal(back.version, PROFILE_VERSION);
  });

  it('멱등하다 — 두 번 지나가도 같다', () => {
    const made = addSquad(base(), draft());
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

  it('칸이 아닌 id · 같은 칸 둘 · 모드가 어긋난 칸 · 망가진 부대만 빠진다 — 계정은 살아 있다', () => {
    const good = addSquad(base(), draft());
    const raw = JSON.parse(JSON.stringify(good.profile)) as Record<string, unknown>;
    (raw.squads as unknown[]).push(
      { id: 'sq9', role: 'attack', mode: '3v3', picks: picksOf('3v3') },          // 칸 id가 아니다
      { id: 'atk-3v3', role: 'attack', mode: '3v3', picks: picksOf('3v3') },      // 같은 칸이 또
      { id: 'def-5v5', role: 'defense', mode: '3v3', picks: picksOf('3v3') },     // 칸과 모드가 어긋난다
      { id: 'def-3v3', role: 'attack', mode: '3v3', picks: [                       // 없는 장수
        { piece: 'King', officer: '없는-사람' },
        { piece: 'Rock', officer: ID('장비') },
        { piece: 'Bishop', officer: ID('조운') },
      ] },
      { id: 'atk-5v5', role: 'attack', mode: '5v5', picks: picksOf('3v3') },      // 정원 미달 — 덜 찬 부대로 남는다 (2026-11-17)
      { id: 'def-5v5', role: 'defense', mode: '5v5', picks: [] },                  // 부대원이 없다
    );
    const back = migrateProfile(raw)!;
    // 없는 장수는 그 자리만 빠지고 덜 찬 부대로 남는다 — 덜 찬 부대도 저장되므로 (2026-11-17)
    assert.deepEqual(back.squads.map((s) => s.id), ['atk-3v3', 'def-3v3', 'atk-5v5']);
    assert.equal(squadAt(back, '3v3', 'defense')!.picks.length, 2);
    assert.equal(squadStateAt(back, '5v5', 'attack'), 'partial');
    assert.equal(Object.keys(back.roster).length, NAMES.length, '부대가 망가져도 계정은 그대로다');
  });

  it('역할은 저장된 값이 아니라 칸 id에서 낸다 — 둘이 갈릴 자리가 없다', () => {
    const raw = JSON.parse(JSON.stringify(addSquad(base(), draft('3v3', 'defense')).profile)) as { squads: { role: string }[] };
    raw.squads[0]!.role = 'attack';
    assert.equal(migrateProfile(raw)!.squads[0]!.role, 'defense');
  });

  it('망가진 배치 프리셋은 **부대를 죽이지 않는다** — 전투에서 물러날 뿐이다', () => {
    const made = addSquad(base(), draft());
    const raw = JSON.parse(JSON.stringify({
      ...made.profile,
      squads: [{ ...made.squad, deploy: { P1: [{ piece: 'King', x: 99, y: 99 }], P2: null } }],
    }));
    const back = migrateProfile(raw)!;
    assert.equal(back.squads.length, 1, '되접기가 미리 지우면 사람이 고칠 기회까지 사라진다');
    assert.equal(squadDeployment(back, back.squads[0]!, 'P1'), null);
  });

  it('수비대의 방침은 남고, 공격대에 방침이 적혀 와도 버린다', () => {
    let p = addSquad(base(), draft('3v3', 'defense')).profile;
    p = addSquad(p, draft('3v3', 'attack')).profile;
    const policy = { stances: { King: 'hold' } };
    const raw = JSON.parse(JSON.stringify({ ...p, squads: p.squads.map((s) => ({ ...s, policy })) }));
    const back = migrateProfile(raw)!;
    assert.deepEqual(squadAt(back, '3v3', 'defense')!.policy, policy);
    assert.equal(squadAt(back, '3v3', 'attack')!.policy, undefined);
  });
});

describe('저장 형식 v7 → v8 — 옛 부대 여럿을 칸 넷으로 접는다 (기획자 확정)', () => {
  const k = ID('관우'); const r = ID('장비'); const b = ID('조운'); const kn = ID('황충'); const q = ID('마초'); const w = ID('위연');
  const three = (a: OfficerId, c: OfficerId, d: OfficerId): RosterPick[] =>
    [{ piece: 'King', officer: a }, { piece: 'Rock', officer: c }, { piece: 'Bishop', officer: d }];

  it('수비대 = 고른 수비군 · 공격대 = 나머지 중 가장 최근에 싸운 부대 · 나머지는 버린다', () => {
    const raw = v7(base(), {
      squads: [
        oldSquad('sq1', '첫째', '3v3', three(k, r, b)),
        oldSquad('sq2', '둘째', '3v3', three(r, b, kn), { record: { 'siege/3v3': { wins: 2, losses: 1, draws: 0, kills: 3, points: 40 } } }),
        oldSquad('sq3', '셋째', '3v3', three(b, kn, q)),
        oldSquad('sq4', '넷째', '3v3', three(kn, q, w), { policy: { stances: { King: 'hold' } } }),
      ],
      garrison: { '3v3': 'sq4' },
      squadSeq: 5,
      matches: [fought(1, 1000, '셋째'), fought(2, 2000, '둘째'), fought(3, 1500, '첫째')],
    });
    const back = migrateProfile(raw)!;
    assert.equal(back.version, PROFILE_VERSION);
    assert.deepEqual(back.squads.map((s) => s.id), ['atk-3v3', 'def-3v3']);
    assert.deepEqual(garrisonOf(back, '3v3')!.picks, three(kn, q, w), '고른 수비군(넷째)이 수비대');
    assert.deepEqual(squadAt(back, '3v3', 'defense')!.policy, { stances: { King: 'hold' } });
    const atk = squadAt(back, '3v3', 'attack')!;
    assert.deepEqual(atk.picks, three(r, b, kn), '가장 최근(2000)에 싸운 둘째가 공격대');
    assert.equal(atk.record['siege/3v3']?.wins, 2, '공격대가 된 부대의 전적은 따라온다');
    assert.equal('squadSeq' in back, false);
    assert.equal('garrison' in back, false);
    // 이력의 부대 이름이 칸 id로 — 버려진 부대의 줄은 옛 이름 그대로
    assert.deepEqual(back.matches.map((m) => m.mySquad), ['셋째', 'atk-3v3', '첫째']);
  });

  it('수비군을 안 골랐으면 첫 부대가 수비대 · 싸운 적이 없으면 전투력이 가장 높은 부대가 공격대', () => {
    let p = base();
    p = raise(p, w, 6);   // 위연을 키워 셋째 부대를 가장 세게
    const raw = v7(p, {
      squads: [
        oldSquad('sq1', '첫째', '3v3', three(k, r, b)),
        oldSquad('sq2', '둘째', '3v3', three(r, b, kn)),
        oldSquad('sq3', '셋째', '3v3', three(w, q, kn)),
      ],
    });
    const back = migrateProfile(raw)!;
    assert.deepEqual(squadAt(back, '3v3', 'defense')!.picks, three(k, r, b));
    assert.deepEqual(squadAt(back, '3v3', 'attack')!.picks, three(w, q, kn));
  });

  it('부대가 하나뿐이면 수비대가 되고 공격대는 그 복사 — 전적 · 방침 · 만든 시각은 수비대 몫', () => {
    const raw = v7(base(), {
      squads: [oldSquad('sq1', '하나', '5v5', picksOf('5v5'), {
        record: { 'siege/5v5': { wins: 1, losses: 0, draws: 0, kills: 0, points: 10 } }, createdAt: 77, policy: { stances: { King: 'hold' } },
      })],
    });
    const back = migrateProfile(raw)!;
    const def = squadAt(back, '5v5', 'defense')!;
    const atk = squadAt(back, '5v5', 'attack')!;
    assert.deepEqual(atk.picks, def.picks);
    assert.equal(def.record['siege/5v5']?.wins, 1);
    assert.deepEqual(atk.record, {});
    assert.equal(atk.policy, undefined);
    assert.equal(atk.createdAt, undefined);
    assert.equal(def.createdAt, 77);
  });

  it('성립하지 않는 고른 수비군은 건너뛰고, 모드마다 따로 접는다', () => {
    const raw = v7(base(), {
      squads: [
        oldSquad('sq1', '셋', '3v3', three(k, r, b)),
        oldSquad('sq2', '다섯', '5v5', picksOf('5v5')),
        oldSquad('sq3', '중복장수', '3v3', three(k, k, b)),   // 같은 장수 둘 — 성립 안 함
      ],
      garrison: { '3v3': 'sq3', '5v5': 'sq2' },
    });
    const back = migrateProfile(raw)!;
    assert.deepEqual(back.squads.map((s) => s.id), ['atk-3v3', 'def-3v3', 'atk-5v5', 'def-5v5']);
    assert.deepEqual(squadAt(back, '3v3', 'defense')!.picks, three(k, r, b));
  });

  it('접힌 부대로 싸우던 AI 대전은 새 칸을 가리키고, 버려진 부대면 부대 없이 나간 판이다', () => {
    const squads = [oldSquad('sq1', '하나', '3v3', three(k, r, b)), oldSquad('sq2', '둘', '3v3', three(r, b, kn)), oldSquad('sq3', '셋', '3v3', three(b, kn, q))];
    const ai = (squadId: string) => ({
      status: 'matched', mode: '3v3', seed: 1, picks: three(k, r, b), squadId, foe: { entries: [], power: 100 },
    });
    // sq1 = 수비대, 셋 다 안 싸웠으니 전투력으로 공격대 — 버려지는 부대를 하나 만든다
    const kept = migrateProfile(v7(base(), { squads, aiBattle: ai('sq1') }))!;
    assert.equal(kept.aiBattle?.squadId, 'def-3v3');
    const atkPicks = squadAt(kept, '3v3', 'attack')!.picks;
    const dropped = squads.find((s) => JSON.stringify(s.picks) !== JSON.stringify(atkPicks) && s.id !== 'sq1')!;
    assert.equal(migrateProfile(v7(base(), { squads, aiBattle: ai(dropped.id) }))!.aiBattle?.squadId, null);
  });

  it('옛 부대의 `level`(하향 눈금)은 **부대를 살린 채** 조용히 버린다', () => {
    const p = raise(base(), k, 5);
    const back = migrateProfile(v7(p, {
      squads: [oldSquad('sq1', '옛눈금', '3v3', picksOf('3v3').map((x) => ({ ...x, level: 1 })) as RosterPick[])],
    }))!;
    const def = squadAt(back, '3v3', 'defense')!;
    assert.equal(def.picks.some((x) => 'level' in x), false);
    assert.equal(squadRow(back, def).members[0]!.level, 5, '옛 눈금 1이 아니라 보유 레벨');
  });
});

describe('부대원을 고친 뒤의 배치 — 줄 차례대로 물려준다 (2026-09-17, 68·69쪽)', () => {
  const k = ID('관우'); const r = ID('장비'); const q = ID('조운');
  it('King·Rock·Queen → King·Knight·Rock이면 Knight가 옛 Rock, Rock이 옛 Queen 자리에 선다', () => {
    const before: RosterPick[] = [{ piece: 'King', officer: k }, { piece: 'Rock', officer: r }, { piece: 'Queen', officer: q }];
    const after: RosterPick[] = [{ piece: 'King', officer: k }, { piece: 'Knight', officer: r }, { piece: 'Rock', officer: q }];
    const P1 = [{ piece: 'Rock' as const, x: 8, y: 17 }, { piece: 'King' as const, x: 3, y: 17 }, { piece: 'Queen' as const, x: 13, y: 18 }];
    const out = remapDeployment(before, after, { P1, P2: null });
    assert.deepEqual(out.P1, [
      { piece: 'King', x: 3, y: 17 }, { piece: 'Knight', x: 8, y: 17 }, { piece: 'Rock', x: 13, y: 18 },
    ]);
    assert.equal(out.P2, null);
  });

  it('옮긴 배치는 그대로 저장할 수 있다 — 물려준 것이 엔진 검사를 통과한다', () => {
    const p = base();
    const before: RosterPick[] = [{ piece: 'King', officer: k }, { piece: 'Rock', officer: r }, { piece: 'Queen', officer: q }];
    const after: RosterPick[] = [{ piece: 'King', officer: k }, { piece: 'Knight', officer: q }, { piece: 'Rock', officer: r }];
    const deploy = { P1: defaultSquadCells('3v3', 'P1', before), P2: defaultSquadCells('3v3', 'P2', before) };
    const out = remapDeployment(before, after, deploy);
    const squad: Squad = { id: 'atk-3v3', role: 'attack', mode: '3v3', picks: after, deploy: out, record: {} };
    assert.ok(isDeployable(p, squad, 'P1', out.P1!));
    assert.ok(isDeployable(p, squad, 'P2', out.P2!));
  });

  it('물려줄 수 없으면 그 진영만 기본 배치(null)로 — 던지지 않는다', () => {
    const before: RosterPick[] = [{ piece: 'King', officer: k }, { piece: 'Rock', officer: r }];
    const after: RosterPick[] = [{ piece: 'King', officer: k }, { piece: 'Pawn', officer: r }];
    const out = remapDeployment(before, after, { P1: [{ piece: 'King', x: 1, y: 1 }], P2: null });
    assert.deepEqual(out, { P1: null, P2: null });
  });
});

describe('병영 현황판의 최근 부대 셋 (2026-09-17, 65쪽)', () => {
  const picks = (): RosterPick[] => [
    { piece: 'King', officer: ID('관우') }, { piece: 'Rock', officer: ID('장비') }, { piece: 'Queen', officer: ID('조운') },
  ];
  it('만든 시각과 마지막 전투 시각 중 늦은 쪽으로 줄 세운다 — 이력은 칸 id로 짝짓는다', () => {
    let p = base();
    p = addSquad(p, { mode: '3v3', role: 'attack', picks: picks() }, 1000).profile;
    p = addSquad(p, { mode: '3v3', role: 'defense', picks: picks() }, 2000).profile;
    p = addSquad(p, { mode: '5v5', role: 'attack', picks: picksOf('5v5') }, 3000).profile;
    p = addSquad(p, { mode: '5v5', role: 'defense', picks: picksOf('5v5') }, 4000).profile;
    assert.deepEqual(recentSquads(p).map((s) => s.id), ['def-5v5', 'atk-5v5', 'def-3v3']);
    // 가장 오래된 3v3 공격대가 싸우면 맨 위로 올라온다
    p = { ...p, matches: [fought(1, 5000, 'atk-3v3') as PlayerProfile['matches'][number]] };
    assert.deepEqual(recentSquads(p).map((s) => s.id), ['atk-3v3', 'def-5v5', 'atk-5v5']);
  });

  it('시각이 없는 옛 부대는 칸 차례', () => {
    let p = base();
    p = addSquad(p, { mode: '3v3', role: 'defense', picks: picks() }).profile;
    p = addSquad(p, { mode: '3v3', role: 'attack', picks: picks() }).profile;
    assert.equal(p.squads[0]!.createdAt, undefined);
    assert.deepEqual(recentSquads(p).map((s) => s.id), ['atk-3v3', 'def-3v3']);
  });

  it('만든 시각은 저장을 지나도 남는다 (migrateProfile)', () => {
    const p = addSquad(base(), { mode: '3v3', role: 'attack', picks: picks() }, 1234).profile;
    const back = migrateProfile(JSON.parse(JSON.stringify(p)));
    assert.equal(back?.squads[0]?.createdAt, 1234);
  });
});
