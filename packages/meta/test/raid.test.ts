/**
 * 도적떼 — 계정 쪽 규칙 회귀 (GDD §5.11). 시계는 전부 가짜 시계다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBattle } from '@samchess/rules';
import type { OfficerId, PieceType } from '@samchess/rules';
import {
  RAID_ABANDON_MS, RAID_LAST_CALL_MS, RAID_RESPONSE_MS, addSquad, canStartRaid, createProfile, guardSlots,
  guardsOf, guardsTakenBy, initialBuildings, migrateProfile, newInstance, officerDuty, raidActive,
  raidBattleConfig, raidBlocksSortie, raidDay, raidLastCall, raidLoot, raidRemainingMs, setGuards, settleRaid,
  startRaid, surrenderRaid, syncRaid, updateSquad, validateGuards,
} from '../src/index.ts';
import type { PlayerProfile, RaidState, RosterPick } from '../src/index.ts';

/** 2026-09-21 12:00 KST */
const T0 = Date.UTC(2026, 8, 21, 3, 0, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const O = (id: string): OfficerId => id as OfficerId;
const P = (piece: PieceType, officer: string): RosterPick => ({ piece, officer: O(officer) });
const OWNED = ['yu-bi', 'gwan-u', 'jang-bi', 'jo-un', 'jo-jo', 'jang-hap', 'jo-sik'];

/** 장수 일곱 · 군량 40 · 농지 Lv n. 이미 정산해 둔 계정이다 */
function city(farm: number, over: Partial<PlayerProfile> = {}): PlayerProfile {
  const base = createProfile('농지성', 7);
  const roster = { ...base.roster };
  for (const id of OWNED) roster[O(id)] = newInstance(O(id));
  return {
    ...base, roster, grain: 40, grainAt: T0,
    buildings: { ...initialBuildings(), barracks: 5, farm },
    ...over,
  };
}

const spawned = (farm: number, over: Partial<PlayerProfile> = {}): PlayerProfile =>
  syncRaid(city(farm, over), T0, { spawn: true });

describe('하루 — KST 0시가 경계다', () => {
  it('UTC 14:59는 전날, 15:00은 다음 날', () => {
    assert.equal(raidDay(Date.UTC(2026, 8, 20, 14, 59, 59)), '2026-09-20');
    assert.equal(raidDay(Date.UTC(2026, 8, 20, 15, 0, 0)), '2026-09-21');
    assert.equal(raidDay(T0), '2026-09-21');
  });
});

describe('출몰', () => {
  it('농지가 있으면 오늘 처음 들어올 때 농지 레벨만큼 온다 — 기준 군량은 그때의 값', () => {
    const p = spawned(3);
    assert.deepEqual(p.raid, { day: '2026-09-21', bandits: 3, spawnedAt: T0, grainAtSpawn: 40, status: 'pending' });
    assert.equal(raidActive(p.raid), true);
  });

  it('농지가 없으면 오지 않는다', () => {
    const p = city(0);
    assert.equal(syncRaid(p, T0, { spawn: true }), p, '바뀐 것이 없으면 같은 객체');
  });

  it('출몰의 문이 아니면(spawn: false) 오지 않는다 — 정산만 한다', () => {
    const p = city(2);
    assert.equal(syncRaid(p, T0, { spawn: false }), p);
  });

  it('하루 한 번 — 끝난 뒤 같은 날 다시 들어와도 안 온다. 다음 날에는 다시 온다', () => {
    let p = surrenderRaid(spawned(2), T0 + MIN);
    assert.equal(p.raid!.status, 'surrendered');
    assert.equal(syncRaid(p, T0 + 5 * 60 * MIN, { spawn: true }), p);
    p = syncRaid(p, T0 + DAY, { spawn: true });
    assert.equal(p.raid!.status, 'pending');
    assert.equal(p.raid!.day, '2026-09-22');
  });

  it('살아 있는 도적떼가 있는 동안에는 새로 오지 않는다', () => {
    const p = spawned(2);
    assert.equal(syncRaid(p, T0 + 2 * MIN, { spawn: true }), p);
  });

  it('규모는 출몰 순간에 굳는다 — 10분 사이 농지를 올려도 도적 수는 그대로', () => {
    let p = spawned(2);
    p = { ...p, buildings: { ...p.buildings, farm: 5 } };
    assert.equal(p.raid!.bandits, 2);
    p = setGuards(p, [P('King', 'yu-bi')]);
    p = startRaid(p, T0 + MIN, 9);
    assert.equal(raidBattleConfig(p).rosters.P2.length, 2);
  });
});

describe('10분 — 그 안에 [지금 전투]가 없으면 자동 항복', () => {
  it('9분 59초까지는 기다린다. 10분에 출몰한 수 × 10%를 빼앗긴다', () => {
    const p = spawned(3);
    const before = syncRaid(p, T0 + RAID_RESPONSE_MS - 1, { spawn: true });
    assert.equal(before, p);
    const after = syncRaid(p, T0 + RAID_RESPONSE_MS, { spawn: true });
    assert.equal(after.raid!.status, 'surrendered');
    assert.equal(after.raid!.loot, 12);                  // 40 × 30%
    assert.equal(after.grain, 28);
    assert.equal(after.raid!.settledAt, T0 + RAID_RESPONSE_MS, '정산 시각은 마감 — 늦게 들어와도 같다');
  });

  it('앱을 꺼 두었다가 다음 날 들어오면 — 어제 것을 항복으로 끝내고 오늘 것이 새로 온다', () => {
    const p = spawned(1);
    const next = syncRaid(p, T0 + DAY, { spawn: true });
    assert.equal(next.grain, 36);                        // 어제 몫 10%
    assert.equal(next.raid!.day, '2026-09-22');
    assert.equal(next.raid!.status, 'pending');
    assert.equal(next.raid!.grainAtSpawn, 36);
  });

  it('남은 시간 · 마지막 알림(남은 1분)', () => {
    const r = spawned(1).raid!;
    assert.equal(raidRemainingMs(r, T0), RAID_RESPONSE_MS);
    assert.equal(raidRemainingMs(r, T0 + RAID_RESPONSE_MS + 5), 0);
    assert.equal(raidLastCall(r, T0 + RAID_RESPONSE_MS - RAID_LAST_CALL_MS - 1), false);
    assert.equal(raidLastCall(r, T0 + RAID_RESPONSE_MS - RAID_LAST_CALL_MS), true);
    assert.equal(raidLastCall(r, T0 + RAID_RESPONSE_MS), false);
  });
});

describe('약탈의 기준 — 출몰 순간의 군량', () => {
  const r: RaidState = { day: '2026-09-21', bandits: 5, spawnedAt: T0, grainAtSpawn: 40, status: 'pending' };

  it('참가비로 써 버려도 가진 만큼은 빼앗긴다 — 써 버리기로 피할 수 없다', () => {
    assert.equal(raidLoot(r, 5, 5), 5);
  });

  it('그 사이 더 찬 군량은 안 잃는다', () => {
    assert.equal(raidLoot(r, 90, 5), 20);
  });

  it('항복(출몰한 수)은 언제나 패배(살아 있는 수)보다 크거나 같다 — 지는 판을 끊을 이유가 없다', () => {
    for (let grain = 0; grain <= 100; grain += 7) {
      for (let alive = 0; alive <= 5; alive++) assert.ok(raidLoot(r, grain, 5) >= raidLoot(r, grain, alive));
    }
  });
});

describe('파수꾼', () => {
  it('칸 = 농지 레벨', () => {
    assert.deepEqual([0, 1, 3, 5].map((lv) => guardSlots(city(lv))), [0, 1, 3, 5]);
  });

  it('Lv1은 King 하나. 다 채우지 않아도 된다 · 비우는 것은 언제나 된다', () => {
    assert.equal(validateGuards(city(1), [P('King', 'yu-bi')]).ok, true);
    assert.equal(validateGuards(city(1), [P('Rock', 'yu-bi')]).ok, false);
    assert.equal(validateGuards(city(5), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]).ok, true);
    assert.equal(validateGuards(city(0), []).ok, true);
  });

  it('거절하는 까닭마다 이유 코드가 있다', () => {
    const code = (p: PlayerProfile, picks: RosterPick[]) => {
      const r = validateGuards(p, picks);
      return r.ok ? 'ok' : r.code;
    };
    assert.equal(code(city(0), [P('King', 'yu-bi')]), 'raid.noFarm');
    assert.equal(code(city(1), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]), 'raid.tooMany');
    assert.equal(code(city(3), [P('Rock', 'gwan-u')]), 'raid.needKing');
    assert.equal(code(city(3), [P('King', 'yu-bi'), P('King', 'gwan-u')]), 'raid.dupPiece');
    assert.equal(code(city(3), [P('King', 'yu-bi'), P('Rock', 'yu-bi')]), 'raid.dupOfficer');
    assert.equal(code(city(3), [P('King', 'yu-bi'), P('Rock', 'yeo-po')]), 'raid.notOwned');
  });

  it('부대에 편성된 장수는 파수꾼이 될 수 없다', () => {
    const { profile } = addSquad(city(3), {
      name: '관장조', mode: '3v3', picks: [P('King', 'gwan-u'), P('Rock', 'jang-bi'), P('Pawn', 'jo-un')],
    });
    const r = validateGuards(profile, [P('King', 'gwan-u')]);
    assert.equal(r.ok ? 'ok' : r.code, 'raid.inSquad');
    assert.equal(officerDuty(profile, O('gwan-u')), 'squad');
    assert.equal(officerDuty(profile, O('yu-bi')), null);
  });

  it('병영이 파수꾼을 부대에 넣으면 농지에서 빠진다 — 반대는 없다', () => {
    let p = setGuards(city(3), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]);
    assert.equal(officerDuty(p, O('gwan-u')), 'guard');
    const picks = [P('King', 'gwan-u'), P('Rock', 'jang-bi'), P('Pawn', 'jo-un')];
    assert.deepEqual(guardsTakenBy(p, picks), [O('gwan-u')], '화면이 확인창을 띄울 근거');
    const made = addSquad(p, { name: '관장조', mode: '3v3', picks });
    p = made.profile;
    // **저장된 칸**을 본다 — `guardsOf()`는 부대 장수를 어차피 걸러 내서, 빼 가지 않아도
    // 같은 값이 나온다(그래서 한동안 이 검사는 아무것도 확인하지 않았다)
    assert.deepEqual(p.farmGuards, [P('King', 'yu-bi')]);
    assert.equal(officerDuty(p, O('gwan-u')), 'squad');

    // 고칠 때도 같다
    p = setGuards(p, [P('King', 'yu-bi'), P('Queen', 'jo-jo')]);
    p = updateSquad(p, made.squad.id, { name: '관장조', mode: '3v3', picks: [P('King', 'gwan-u'), P('Rock', 'jang-bi'), P('Pawn', 'jo-jo')] });
    assert.deepEqual(p.farmGuards, [P('King', 'yu-bi')]);
  });

  it('읽는 자리는 거른다 — 칸을 넘친 것 · 부대에 든 것 · 없는 장수', () => {
    const { profile } = addSquad(city(2), {
      name: '관장조', mode: '3v3', picks: [P('King', 'gwan-u'), P('Rock', 'jang-bi'), P('Pawn', 'jo-un')],
    });
    // 저장된 칸을 손으로 어긋나게 둔다(옛 데이터·농지 밖에서 바뀐 것)
    const p: PlayerProfile = {
      ...profile,
      farmGuards: [P('Rock', 'gwan-u'), P('King', 'yu-bi'), P('Queen', 'yeo-po'), P('Bishop', 'jo-jo'), P('Knight', 'jang-hap')],
    };
    assert.deepEqual(guardsOf(p), [P('King', 'yu-bi'), P('Bishop', 'jo-jo')]);
  });
});

describe('출정이 막힌다', () => {
  it('도적떼가 살아 있는 동안만', () => {
    assert.equal(raidBlocksSortie(city(2)).ok, true);
    let p = spawned(2);
    const blocked = raidBlocksSortie(p);
    assert.equal(blocked.ok ? 'ok' : blocked.code, 'raid.blocksSortie');
    p = startRaid(setGuards(p, [P('King', 'yu-bi')]), T0 + MIN, 3);
    assert.equal(raidBlocksSortie(p).ok, false, '싸우는 중에도');
    p = surrenderRaid(p, T0 + 2 * MIN);
    assert.equal(raidBlocksSortie(p).ok, true);
  });
});

describe('[지금 전투]', () => {
  it('파수꾼이 없으면 못 싸운다', () => {
    const r = canStartRaid(spawned(2), T0 + MIN);
    assert.equal(r.ok ? 'ok' : r.code, 'raid.noGuards');
  });

  it('마감이 지나면 못 싸운다', () => {
    const p = setGuards(spawned(2), [P('King', 'yu-bi')]);
    const r = canStartRaid(p, T0 + RAID_RESPONSE_MS);
    assert.equal(r.ok ? 'ok' : r.code, 'raid.expired');
  });

  it('시작하면 시드와 파수꾼을 굳히고 두 번 시작할 수 없다', () => {
    let p = setGuards(spawned(3), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]);
    p = startRaid(p, T0 + MIN, 12345);
    assert.equal(p.raid!.status, 'fighting');
    assert.deepEqual(p.raid!.battle, { seed: 12345, startedAt: T0 + MIN, guards: [P('King', 'yu-bi'), P('Rock', 'gwan-u')] });
    const again = canStartRaid(p, T0 + 2 * MIN);
    assert.equal(again.ok ? 'ok' : again.code, 'raid.started');

    // 전투 중에 파수꾼을 바꿔도 판은 시작할 때의 편성이다
    p = setGuards(p, [P('King', 'jo-jo')]);
    const cfg = raidBattleConfig(p);
    assert.deepEqual(cfg.rosters.P1.map((r) => r.officer), [O('yu-bi'), O('gwan-u')]);
    assert.equal(cfg.scenario, 'raid');
    assert.equal(cfg.mode, '3v3');
    assert.equal(cfg.humanSide, 'P1');
    assert.doesNotThrow(() => createBattle(cfg), '계정이 만든 설정은 언제나 판이 된다');
  });

  it('결과 없이 60분이 지나면 항복으로 정산한다', () => {
    let p = startRaid(setGuards(spawned(4), [P('King', 'yu-bi')]), T0 + MIN, 1);
    assert.equal(syncRaid(p, T0 + MIN + RAID_ABANDON_MS - 1, { spawn: false }), p);
    p = syncRaid(p, T0 + MIN + RAID_ABANDON_MS, { spawn: false });
    assert.equal(p.raid!.status, 'surrendered');
    assert.equal(p.raid!.loot, 16);                      // 40 × 40%
  });
});

describe('결말', () => {
  const fighting = (guards: RosterPick[], farm = 3): PlayerProfile =>
    startRaid(setGuards(spawned(farm), guards), T0 + MIN, 77);

  it('승리 — AI 대전 승리와 같은 보상, 전적·이력에는 안 센다', () => {
    const p = fighting([P('King', 'yu-bi')]);
    const next = settleRaid(p, { winner: 'P1', banditsAlive: 1, fallen: [] }, T0 + 5 * MIN);
    assert.equal(next.raid!.status, 'won');
    assert.equal(next.raid!.loot, 0);
    assert.equal(next.materials, p.materials + 1);
    assert.equal(next.grain, p.grain + 1, '파수꾼 3명 이하 = 3v3의 군량');
    assert.ok((next.raid!.rewards?.cards.length ?? 0) >= 1);
    assert.deepEqual(next.record, p.record);
    assert.deepEqual(next.matches, p.matches);
    assert.equal(next.matchSeq, p.matchSeq);
  });

  it('승리 — 파수꾼 4명 이상이면 5v5의 군량', () => {
    const p = fighting([P('King', 'yu-bi'), P('Rock', 'gwan-u'), P('Queen', 'jo-jo'), P('Pawn', 'jo-sik')], 4);
    const next = settleRaid(p, { winner: 'P1', banditsAlive: 0, fallen: [] }, T0 + 5 * MIN);
    assert.equal(next.grain, p.grain + 2);
  });

  it('패배 — 살아 있는 도적 × 10%, 쓰러진 파수꾼은 부상', () => {
    const p = fighting([P('King', 'yu-bi'), P('Rock', 'gwan-u')]);
    const next = settleRaid(p, { winner: 'P2', banditsAlive: 2, fallen: [O('yu-bi')] }, T0 + 5 * MIN);
    assert.equal(next.raid!.status, 'lost');
    assert.equal(next.raid!.loot, 8);                    // 40 × 20%
    assert.equal(next.grain, 32);
    assert.equal(next.roster[O('yu-bi')]!.injuredAt, T0 + 5 * MIN);
    assert.equal(next.roster[O('gwan-u')]!.injuredAt, undefined);
    assert.equal(next.raid!.rewards, undefined, '패배 카드는 없다');
  });

  it('무승부 — 약탈도 보상도 없다', () => {
    const p = fighting([P('King', 'yu-bi')]);
    const next = settleRaid(p, { winner: null, banditsAlive: 3, fallen: [] }, T0 + 5 * MIN);
    assert.equal(next.raid!.status, 'drawn');
    assert.equal(next.grain, p.grain);
  });

  it('싸우는 중이 아니면 정산하지 않는다 — 두 번 정산이 없다', () => {
    const p = settleRaid(fighting([P('King', 'yu-bi')]), { winner: 'P1', banditsAlive: 0, fallen: [] }, T0 + 5 * MIN);
    assert.throws(() => settleRaid(p, { winner: 'P1', banditsAlive: 0, fallen: [] }, T0 + 6 * MIN));
  });
});

describe('저장 형식', () => {
  it('파수꾼과 도적떼는 되접어도 그대로다', () => {
    const p = startRaid(setGuards(spawned(3), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]), T0 + MIN, 5);
    const back = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    assert.deepEqual(back.farmGuards, p.farmGuards);
    assert.deepEqual(back.raid, p.raid);
  });

  it('알아볼 수 없는 도적떼는 통째로 버린다 — 싸우는 중인데 판의 설정이 없으면 재생할 수 없다', () => {
    const p = spawned(3);
    const broken = { ...JSON.parse(JSON.stringify(p)), raid: { ...p.raid, status: 'fighting' } };
    assert.equal(migrateProfile(broken)!.raid, undefined);
    const junk = { ...JSON.parse(JSON.stringify(p)), raid: { day: 'yesterday', bandits: 9 } };
    assert.equal(migrateProfile(junk)!.raid, undefined);
  });

  it('없는 장수의 파수꾼 칸은 되접으며 지운다', () => {
    const p = { ...city(3), farmGuards: [P('King', 'yu-bi'), P('Rock', 'no-such-officer')] };
    assert.deepEqual(migrateProfile(JSON.parse(JSON.stringify(p)))!.farmGuards, [P('King', 'yu-bi')]);
  });
});
