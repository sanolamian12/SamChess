/**
 * 대장간 연구 회귀 (2026-11-28 기획자 확정 — `history/2026-11-28d_대장간연구개편_2_연구.md`).
 *
 * 여기서 고정하는 것.
 *  - **몫은 대장간 레벨 수** — Lv1 1 · 2 · 3 · 4 · 5 = 15, Lv5를 다 끝내면 병기 열다섯 전부
 *  - **후보는 해금 레벨 ≤ L이고 아직 안 한 것** — 아래 레벨에서 안 고른 것이 위 레벨에도 남는다
 *  - **차례로** — 앞 레벨을 끝내야 다음, 대장간 레벨이 모자라면 잠긴다
 *  - **동시에 하나 · 1시간 · 취소 가능 · 무료** — 취소하면 그 레벨을 다시 고른다
 *  - **진열은 축하를 본 뒤** — 거두면 `notice`, `applyAckForge`가 비우면 `forgeShelf`에 오른다
 *  - **되접기** — 옛 자루 · 주문은 보관함의 낱개로, 연구 상태는 모양이 어긋난 줄만 버린다, 두 번 지나도 같다
 *  - **`forge`는 서버 소유** — `PUT`으로 「끝났다」를 적어도 서버 값이 남는다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EQUIPMENT } from '@samchess/data';
import {
  FORGE_MAX_LEVEL, FORGE_RESEARCH_MS, applyAckForge, applyCancelForgeResearch, applyStartForgeResearch,
  canStartForgeResearch, collectForgeResearch, createProfile, forgeCandidates, forgeQuota, forgeResearchRemainingMs,
  forgeShelf, guardServerOwned, migrateProfile, nextForgeResearch, researchedWeapons, syncCity,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const T0 = 1_700_000_000_000;
const H = FORGE_RESEARCH_MS;

function smith(forgeLv = 5, over: Partial<PlayerProfile> = {}): PlayerProfile {
  const p = createProfile('대장간성', 3);
  return { ...p, buildings: { ...p.buildings, forge: forgeLv }, ...over };
}

/** 다음 레벨의 후보 앞에서부터 몫만큼 골라 연구하고 끝까지 거둔 뒤 축하를 본다 */
function finishNext(p: PlayerProfile, at: number): PlayerProfile {
  const next = nextForgeResearch(p);
  assert.equal(next.state, 'open');
  const level = (next as { level: number }).level;
  const pick = forgeCandidates(p, level).slice(0, forgeQuota(level)).map((e) => e.id);
  return applyAckForge(collectForgeResearch(applyStartForgeResearch(p, pick, at), at + H));
}

describe('몫과 후보', () => {
  it('몫은 1 · 2 · 3 · 4 · 5 — 합이 병기 수(15)와 같다', () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(forgeQuota), [1, 2, 3, 4, 5]);
    assert.equal([1, 2, 3, 4, 5].reduce((n, l) => n + forgeQuota(l), 0), EQUIPMENT.length);
    assert.equal(FORGE_MAX_LEVEL, 5);
  });

  it('후보 수는 3 · 5 · 6 · 6 · 5 — 앞 레벨에서 안 고른 것이 남는다', () => {
    let p = smith();
    const counts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const level = (nextForgeResearch(p) as { level: number }).level;
      counts.push(forgeCandidates(p, level).length);
      p = finishNext(p, T0 + i * 2 * H);
    }
    assert.deepEqual(counts, [3, 5, 6, 6, 5]);
    assert.equal(researchedWeapons(p).size, 15, 'Lv5까지 끝내면 열다섯 전부');
    assert.equal(nextForgeResearch(p).state, 'allDone');
    assert.equal(forgeShelf(p).length, 15);
  });

  it('고른 수가 몫과 다르거나 겹치거나 후보가 아니면 거부한다', () => {
    const p = smith();
    const [a, b] = forgeCandidates(p, 1);
    const code = (r: ReturnType<typeof canStartForgeResearch>) => (r.ok ? 'ok' : r.code);
    assert.equal(code(canStartForgeResearch(p, [])), 'forge.count');
    assert.equal(code(canStartForgeResearch(p, [a!.id, b!.id])), 'forge.count');
    const lv2 = EQUIPMENT.find((e) => e.unlockLevel === 2)!;
    assert.equal(code(canStartForgeResearch(p, [lv2.id])), 'forge.notCandidate', 'Lv1 몫에 Lv2 병기');
    assert.equal(code(canStartForgeResearch(p, ['no-such'])), 'forge.unknown');
    assert.equal(code(canStartForgeResearch(p, [a!.id])), 'ok');
    const two = finishNext(p, T0);
    const left = forgeCandidates(two, 2).map((e) => e.id);
    assert.equal(code(canStartForgeResearch(two, [left[0]!, left[0]!])), 'forge.count', '겹침');
  });
});

describe('차례 · 진행 · 취소', () => {
  it('대장간이 없으면 notBuilt, 레벨이 모자라면 locked', () => {
    assert.equal(nextForgeResearch(smith(0)).state, 'notBuilt');
    const p = finishNext(smith(1), T0);
    assert.deepEqual(nextForgeResearch(p), { state: 'locked', level: 2 });
    const pick = forgeCandidates(p, 2).slice(0, 2).map((e) => e.id);
    const r = canStartForgeResearch(p, pick);
    assert.equal(r.ok === false && r.code, 'forge.locked');
  });

  it('동시에 하나 — 1시간 뒤 거두고, 그 전에는 같은 객체', () => {
    const p = smith();
    const id = forgeCandidates(p, 1)[0]!.id;
    const going = applyStartForgeResearch(p, [id], T0);
    assert.deepEqual(nextForgeResearch(going), { state: 'researching', level: 1, items: [id] });
    const busy = canStartForgeResearch(going, [id]);
    assert.equal(busy.ok === false && busy.code, 'forge.busy');
    assert.equal(forgeResearchRemainingMs(going, T0 + 1000), H - 1000);
    assert.equal(collectForgeResearch(going, T0 + H - 1), going);
    const done = syncCity(going, T0 + H + 5);
    assert.deepEqual(done.forge, { done: [{ level: 1, items: [id], doneAt: T0 + H }], notice: [id] });
  });

  it('취소는 무료이고 그 레벨을 다시 고른다 — 끝난 연구는 취소가 아니다', () => {
    const p = smith();
    const [a, b] = forgeCandidates(p, 1);
    const going = applyStartForgeResearch(p, [a!.id], T0);
    const back = applyCancelForgeResearch(going, T0 + 10);
    assert.deepEqual(nextForgeResearch(back), { state: 'open', level: 1 });
    assert.equal(back.gold, p.gold);
    assert.equal(canStartForgeResearch(back, [b!.id]).ok, true);
    assert.throws(() => applyCancelForgeResearch(going, T0 + H), /이미 끝난/);
    assert.throws(() => applyCancelForgeResearch(p, T0), /진행 중인 연구가 없/);
  });

  it('고른 순서와 상관없이 진열 순서로 적는다', () => {
    const p = finishNext(smith(), T0);
    const c = forgeCandidates(p, 2).map((e) => e.id);
    const a = applyStartForgeResearch(p, [c[3]!, c[1]!], T0);
    assert.deepEqual(a.forge?.research?.items, [c[1], c[3]]);
  });
});

describe('진열 — 축하를 본 뒤부터', () => {
  it('거둔 병기는 notice에 있고 진열대에 없다. 축하를 보면 오른다', () => {
    const p = smith();
    const id = forgeCandidates(p, 1)[0]!.id;
    const done = collectForgeResearch(applyStartForgeResearch(p, [id], T0), T0 + H);
    assert.ok(researchedWeapons(done).has(id));
    assert.deepEqual(forgeShelf(done), []);
    const seen = applyAckForge(done);
    assert.deepEqual(forgeShelf(seen).map((e) => e.id), [id]);
    assert.equal(applyAckForge(seen), seen, '볼 것이 없으면 같은 객체');
  });
});

describe('되접기 · 서버 소유', () => {
  it('옛 자루 · 진행 중이던 제조는 보관함의 낱개가 되고 두 번 지나도 같다', () => {
    const raw = {
      ...smith(),
      forgeOwned: { 'dae-gam-do#1': 'gwan-u', 'dae-gam-do#2': null, 'su-geuk': null, 'no-such#1': null },
      forgeOrder: { equipmentId: 'du-mu', startedAt: T0 },
      marketOwned: { 'dae-gam-do': 1 },
    };
    const once = migrateProfile(JSON.parse(JSON.stringify(raw)))!;
    assert.deepEqual(once.marketOwned, { 'dae-gam-do': 3, 'su-geuk': 1, 'du-mu': 1 });
    assert.equal('forgeOwned' in once, false);
    assert.equal('forgeOrder' in once, false);
    assert.deepEqual(migrateProfile(JSON.parse(JSON.stringify(once))), once);
  });

  it('연구 상태는 JSON 왕복을 지나도 남고, 모양이 어긋난 줄만 버린다', () => {
    const p = finishNext(finishNext(smith(), T0), T0 + 2 * H);
    const going = applyStartForgeResearch(p, forgeCandidates(p, 3).slice(0, 3).map((e) => e.id), T0 + 4 * H);
    assert.deepEqual(migrateProfile(JSON.parse(JSON.stringify(going)))!.forge, going.forge);

    const lv5 = EQUIPMENT.find((e) => e.unlockLevel === 5)!.id;
    const broken = migrateProfile({
      ...JSON.parse(JSON.stringify(smith())),
      forge: {
        done: [
          { level: 1, items: ['dae-gam-do'], doneAt: T0 },
          { level: 2, items: [lv5, 'su-geuk'], doneAt: T0 },          // Lv2 몫에 Lv5 병기 — 버린다
          { level: 3, items: ['dae-gam-do', 'su-geuk', 'du-mu'], doneAt: T0 },   // 앞 줄과 겹친다 — 버린다
        ],
        notice: ['dae-gam-do', lv5],
      },
    })!;
    assert.deepEqual(broken.forge, { done: [{ level: 1, items: ['dae-gam-do'], doneAt: T0 }], notice: ['dae-gam-do'] });
  });

  it('PUT으로 「끝났다」를 적어도 서버 값이 남는다', () => {
    const current = smith();
    const greedy: PlayerProfile = { ...current, forge: { done: [{ level: 1, items: ['bang-cheon-hwa-geuk'], doneAt: 0 }] } };
    assert.equal(guardServerOwned(greedy, current).forge, undefined);
  });
});
