/**
 * 순욱 「구호탄랑」의 「책략까지」 조종 (2026-11-09 기획자) — 조종당한 적이 이동 · 공격에 더해 명상 · 책략 · 아이템을 쓴다.
 *
 *  - 효과는 **조종하는 쪽의 눈**으로 판정한다 — 「아군」은 순욱 편이고 「적」은 그 장수의 원래 동료다(엔진 `actingAs`)
 *  - MP · 아이템은 **그 장수의 것**이다
 *  - **고유기술 · 일기토 · 설전은 막는다** — 같은 날 「모두」로 열었다가, 조종당한 둘끼리 대결을 걸면 한 사람이 두 장수를 다 두는 등
 *    판이 지나치게 꼬여 좁혔다
 *  - 상대에게 가려 보내는 책략도 「지금 대신 두는 적」 것은 남긴다(그 책략을 골라 써야 하므로)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIQUE_SKILLS } from '@samchess/data';
import { apply, validate } from '../src/battle.ts';
import { challengeTargets, commandsFor } from '../src/commands.ts';
import { toWire } from '../src/wire.ts';
import type { BattleState } from '../src/types.ts';
import { R, T, U, battle, giveControl, learn, place } from './fixtures.ts';

const SUN_UK = U('P1-Rock');
const NO_SUK = U('P2-Bishop');

/** 순욱(P1-Rock)이 P2의 노숙(P2-Bishop)을 「책략까지」 조종하고, 노숙의 차례다. 유비 · 조조가 노숙 곁에 붙어 있다 */
function driven(): BattleState {
  const base = battle(1, {
    P1: [R('yu-bi', 'King'), R('sun-uk', 'Rock'), R('jo-sik', 'Pawn')],
    P2: [R('jo-jo', 'King'), R('no-suk', 'Bishop'), R('jang-ryo', 'Queen')],
  });
  const s = structuredClone(giveControl(place(base, {
    'P1-King': { x: 11, y: 6 }, 'P1-Rock': { x: 10, y: 10 }, 'P1-Pawn': { x: 4, y: 3 },
    'P2-King': { x: 12, y: 5 }, 'P2-Bishop': { x: 12, y: 6 }, 'P2-Queen': { x: 13, y: 6 },
  }), NO_SUK));
  s.units[NO_SUK]!.control = { by: SUN_UK, mode: 'withTactics', uses: 1 };
  return s;
}

test('구호탄랑의 데이터는 「책략까지」 조종 · 한 번이다', () => {
  const skill = UNIQUE_SKILLS.find((k) => k.name === '구호탄랑')!;
  assert.deepEqual(skill.effects, [{ t: 'controlEnemy', target: { kind: 'nextEnemiesInTurnOrder', count: 2 }, mode: 'withTactics', uses: 1 }]);
});

test('책략 — 「아군」은 순욱 편이다(조종당한 노숙의 회복이 유비에게 간다)', () => {
  let s = learn(driven(), NO_SUK, [T('회복')]);
  s.units[NO_SUK]!.mp = s.units[NO_SUK]!.maxMp;
  s.units[U('P1-King')]!.hp = 2;
  s.units[U('P2-King')]!.hp = 2;
  assert.equal(validate(s, 'P2', { t: 'castTactic', tactic: T('회복'), target: U('P2-King') }).ok, false, '원래 주인은 못 둔다');
  assert.equal(validate(s, 'P1', { t: 'castTactic', tactic: T('회복'), target: U('P2-King') }).ok, false, '제 원래 동료는 「적」이다');
  assert.equal(validate(s, 'P1', { t: 'castTactic', tactic: T('회복'), target: U('P1-King') }).ok, true);
  const mp = s.units[NO_SUK]!.mp;
  s = apply(s, 'P1', { t: 'castTactic', tactic: T('회복'), target: U('P1-King') }).state;
  assert.ok(s.units[U('P1-King')]!.hp > 2, '유비가 찼다');
  assert.ok(s.units[NO_SUK]!.mp < mp, 'MP는 노숙 것');
  assert.equal(s.units[NO_SUK]!.side, 'P2', '편은 효과를 거는 동안만 바뀌고 되돌아온다');
});

test('명령 판 — 명상 · 책략은 켜지고, 고유기술 · 일기토 · 설전은 꺼진다', () => {
  const s = learn(driven(), NO_SUK, [T('회복')]);
  s.units[NO_SUK]!.mp = 0;
  s.sp = { P1: 15, P2: 15 };
  const c = commandsFor(s, 'P1')!;
  assert.equal(c.meditate, true);
  assert.equal(c.unique, false, '고유기술은 막는다');
  assert.equal(c.duel, false, '일기토는 막는다');
  assert.equal(c.debate, false, '설전은 막는다');
  assert.match((validate(s, 'P1', { t: 'castUniqueSkill' }) as { reason: string }).reason, /조종당하는 중/);
  assert.match((validate(s, 'P1', { t: 'challenge', kind: 'duel', target: U('P2-King') }) as { reason: string }).reason, /조종당하는 중/);
  assert.match((validate(s, 'P1', { t: 'challenge', kind: 'debate', target: U('P1-King') }) as { reason: string }).reason, /조종당하는 중/);
  assert.equal(commandsFor(s, 'P2'), null);
  // 「이동 + 공격」 조종(초선)은 그대로 명상도 막힌다
  const old = structuredClone(s);
  old.units[NO_SUK]!.control = { by: SUN_UK, mode: 'moveAndAttack', uses: 1 };
  assert.equal(commandsFor(old, 'P1')!.meditate, false);
});

test('조종당한 적에게는 대결을 걸 수 없다 — 내 장수가 걸어도', () => {
  const s = structuredClone(driven());
  s.activeUnit = U('P1-King');
  s.units[NO_SUK]!.pos = { x: 11, y: 7 };
  assert.ok(!challengeTargets(s, 'P1', 'duel').includes(NO_SUK));
});

test('전선 — 지금 대신 두는 적의 책략은 가리지 않는다', () => {
  const s = learn(driven(), NO_SUK, [T('회복')]);
  assert.deepEqual(toWire(s, 'P1').units[NO_SUK]!.tactics, [T('회복')]);
  const free = structuredClone(s);
  delete free.units[NO_SUK]!.control;
  assert.deepEqual(toWire(free, 'P1').units[NO_SUK]!.tactics, [], '조종이 아니면 그대로 가린다');
});
