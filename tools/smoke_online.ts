/**
 * 온라인 대전 스모크 — **진짜 서버 · 진짜 방 · 진짜 재생기**로 한 판을 끝까지 둔다.
 *
 *   node --experimental-strip-types tools/smoke_online.ts
 *
 * ```
 * [Server + BattleRoom]  ◀── ws ──▶  OnlineTransport × 2  ──▶  Playback × 2
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 브라우저를 안 띄우나 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 여기서 확인할 것은 **화면이 아니라 이음매**다 — 방에 붙는 것 · 진영이 갈리는 것 ·
 * 통이 오가는 것 · 로그가 되만들어지는 것 · 이탈이 판정되는 것. Phaser는 그 어느
 * 것도 안 하고, 브라우저를 띄우면 **왜 깨졌는지가 흐려진다.**
 *
 * `room-logic.test.ts`가 규칙을 가짜 시계로 잡고, 여기서는 **정말 소켓을 지나는지**를
 * 본다 — 겹치지 않는다. 회귀가 잡을 수 없는 것들: Colyseus 버전 짝 · 메시지 이름 ·
 * `enlist`가 둘 다 도착해야 방이 열리는 것 · `onLeave`가 유예를 재는 것.
 *
 * ⚠ **개발 서버(`npm run dev`)는 필요 없다.** 이 스모크가 대전 서버를 제 안에서
 * 띄우고 끝나면 내린다 — 화면을 안 쓰기 때문이다.
 */

import { strict as assert } from 'node:assert';
import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEPLOY_MS, SCOUT_MS } from '@samchess/rules';
import type { BattleMode, BattleState, Side } from '@samchess/rules';
import { makeAiOpponent } from '@samchess/meta';
import { BattleRoom, QueueRoom } from '@samchess/server';
import { connectBattle, connectReservedBattle } from '../packages/client/src/battle/online.ts';
import type { Reservation } from '../packages/client/src/battle/online.ts';
import { Playback } from '../packages/client/src/battle/playback.ts';

const PORT = 2599;
const URL = `ws://localhost:${PORT}`;

const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg: string): void => console.log(`✓ ${msg}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const server = new Server({ transport: new WebSocketTransport() });
server.define('battle', BattleRoom);
server.define('queue', QueueRoom);
await server.listen(PORT);
ok(`대전 서버 — ${URL}`);

// ── 두 사람이 방에 붙는다 ─────────────────────────────────────
const a = makeAiOpponent('3v3', 800, 11);
const b = makeAiOpponent('3v3', 800, 22, a.entries.map((e) => e.officer));

/**
 * 두 사람이 **동시에** 붙어야 방이 열린다 — 한쪽만으로는 `opened`가 안 온다.
 * 그 자체가 검사다: 먼저 온 사람이 기다리지 않으면 판이 절반만 만들어진다.
 */
const [one, two] = await Promise.all([
  connectBattle('dev', {
    playerId: 'alice', entries: a.entries, squadName: '알리스군', power: a.power,
    deploy: null, mode: '3v3',
  }, URL),
  connectBattle('dev', {
    playerId: 'bob', entries: b.entries, squadName: '보브군', power: b.power,
    deploy: null, mode: '3v3',
  }, URL),
]);
ok('방이 열렸다 — 둘의 `enlist`가 다 와야 열린다');

if (one.transport.humanSide === two.transport.humanSide) fail('두 사람이 같은 진영이다');
if (one.opponent.squadName !== '보브군' || two.opponent.squadName !== '알리스군') {
  fail(`상대를 값으로 못 받았다: ${one.opponent.squadName} / ${two.opponent.squadName}`);
}
if (one.opponent.kind !== 'online') fail('상대가 온라인으로 안 찍혔다');
ok(`진영이 갈렸다 (${one.transport.humanSide} / ${two.transport.humanSide}) · 상대가 값으로 왔다`);

// ── 재생기 둘을 붙인다 — 화면이 하던 일 그대로 ─────────────────
interface Seat { name: string; play: Playback; side: Side; changes: number }

const seat = (name: string, t: typeof one.transport): Seat => {
  const s = { name, side: t.humanSide, changes: 0 } as Seat;
  s.play = new Playback(t, {
    onChange: () => { s.changes += 1; },
    onTick: () => {},
  });
  s.play.start();
  return s;
};
const seats: Seat[] = [seat('A', one.transport), seat('B', two.transport)];

/** 실제 프레임처럼 재생기를 민다. 통은 그 사이에 소켓으로 들어온다 */
async function pump(ms: number, stepMs = 40): Promise<void> {
  for (let t = 0; t < ms; t += stepMs) {
    for (const s of seats) s.play.update(stepMs);
    await sleep(5);
  }
}

await pump(400);
if (seats.some((s) => s.changes === 0)) fail('첫 통이 안 왔다');
if (seats.some((s) => s.play.phase !== 'deploying')) {
  fail(`배치 단계가 아니다: ${seats.map((s) => s.play.phase).join(' / ')}`);
}
ok('첫 통이 왔다 — 양쪽 다 배치 단계');

// ── `waiting`이 **처음으로 돈다** (AI 상대에게는 없던 단계) ─────
seats[0]!.play.submitReady();
await pump(400);
if (seats[0]!.play.phase !== 'aiThinking') {
  fail(`준비를 마친 쪽이 기다리지 않는다: ${seats[0]!.play.phase}`);
}
if (seats[1]!.play.phase !== 'deploying') {
  fail(`아직 배치 중인 쪽이 끌려갔다: ${seats[1]!.play.phase}`);
}
if (seats[0]!.play.state.phase !== 'waiting') {
  fail(`전선의 phase가 관점을 안 실었다: ${seats[0]!.play.state.phase}`);
}
if (seats[1]!.play.state.phase !== 'deploy') fail('아직 배치 중인 쪽에 waiting이 갔다');
ok('`waiting`이 처음으로 돌았다 — 전선의 phase는 받는 사람의 걸음이다');

// 마감도 갈린다 — 준비를 마친 쪽은 매칭 대기, 아닌 쪽은 배치 잔여
const leftReady = seats[0]!.play.remainingSec ?? 0;
const leftDeploy = seats[1]!.play.remainingSec ?? 0;
if (leftReady <= DEPLOY_MS / 1000) fail(`준비를 마친 쪽의 마감이 배치 잔여다: ${leftReady}초`);
if (leftDeploy > DEPLOY_MS / 1000) fail(`배치 중인 쪽의 마감이 이상하다: ${leftDeploy}초`);
ok(`마감이 진영마다 다르다 — 대기 ${leftReady}초 / 배치 ${leftDeploy}초`);

seats[1]!.play.submitReady();
await pump(600);
if (seats.some((s) => s.play.phase !== 'scouting')) {
  fail(`정찰로 안 넘어갔다: ${seats.map((s) => s.play.phase).join(' / ')}`);
}
ok('둘 다 준비를 마쳐 정찰로 넘어갔다');

// ── 정찰 마감은 **서버가 잰다** — 클라가 건너뛰라고 해도 서버 시계다 ──
const scoutStart = Date.now();
while (seats.some((s) => s.play.phase === 'scouting') && Date.now() - scoutStart < SCOUT_MS + 5_000) {
  await pump(500);
}
if (seats.some((s) => s.play.phase === 'scouting')) fail('정찰이 안 끝났다');
const scoutTook = Date.now() - scoutStart;
if (scoutTook < SCOUT_MS - 2_000) fail(`정찰이 너무 빨리 끝났다: ${scoutTook}ms — 서버가 안 쟀다`);
ok(`정찰 ${Math.round(scoutTook / 1000)}초를 서버가 쟀다`);

// ── 한 판을 끝까지 둔다 — 제 차례에 [대기]로 넘긴다 ──────────────
const turnOwner = (state: BattleState): Side | null => {
  const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
  if (!unit) return null;
  return unit.control ? state.units[unit.control.by]?.side ?? unit.side : unit.side;
};

let turns = 0;
const started = Date.now();
while (seats.some((s) => s.play.phase !== 'finished') && Date.now() - started < 120_000) {
  for (const s of seats) {
    if (s.play.phase !== 'awaitingInput') continue;
    if (turnOwner(s.play.state) !== s.side) continue;
    if (s.play.submit({ t: 'endTurn' })) turns += 1;
  }
  await pump(120);
  if (turns > 600) break;
}
if (seats.some((s) => s.play.phase !== 'finished')) {
  fail(`판이 안 끝났다 (${turns}턴): ${seats.map((s) => s.play.phase).join(' / ')}`);
}
ok(`한 판을 끝까지 뒀다 — ${turns}턴`);

// ── 양쪽이 **정확히 같은 것**을 봤는가 ──────────────────────────
const [x, y] = seats as [Seat, Seat];
if (x.play.state.winner !== y.play.state.winner) fail('승자가 서로 다르다');
if (x.play.state.time !== y.play.state.time) fail('절대시각이 서로 다르다');
if (x.play.state.rngCursor !== y.play.state.rngCursor) fail('난수 소비가 서로 다르다');
if (x.play.state.log.length !== y.play.state.log.length) {
  fail(`로그 길이가 다르다: ${x.play.state.log.length} vs ${y.play.state.log.length}`);
}
assert.deepEqual(x.play.state.log, y.play.state.log, '이어 붙인 로그가 서로 다르다');
ok(`양쪽이 같은 판을 봤다 — 승자 ${x.play.state.winner} · rngCursor ${x.play.state.rngCursor}`);

for (const s of seats) s.play.state.log.length > 0 || fail(`${s.name}의 로그가 비었다`);
ok('로그가 이벤트로 되만들어졌다 (전선에는 안 실렸다)');

one.transport.close();
two.transport.close();

// ═══════════════════════════════════════════════════════════════
// 대기열 (H2b) — **진짜 소켓**으로 짝짓기·확인·거절·좌석 예약을 지난다
// ═══════════════════════════════════════════════════════════════

/*
 * 순수 규칙(`queue-logic.test.ts`)이 매칭·거절 기억·우선권을 가짜 시계로 이미
 * 고정하고 있다 — 여기서 볼 것은 **`QueueRoom`이 `matchMaker`로 진짜 `BattleRoom`
 * 좌석을 예약하고, 그 예약을 클라가 `consumeSeatReservation()`으로 실제로
 * 소화하는가**다. `room-logic.test.ts`와 겹치지 않게 가른 것과 같은 결이다.
 */
/**
 * 메시지 하나를 기다린다. **호출 시점이 아니라 「듣기 시작한 시점」이 중요하다** —
 * 매칭은 상대가 도착하는 순간 곧바로 오므로, 리스너를 늦게 걸면 통을 놓치고
 * 영원히 기다린다(`OnlineTransport`가 `early` 큐로 피하던 바로 그 경주).
 */
function once<T>(room: Room, type: string): Promise<T> {
  return new Promise((resolve) => room.onMessage(type, (msg: T) => resolve(msg)));
}

interface QueueBot {
  room: Room;
  enlist: { playerId: string; entries: ReturnType<typeof makeAiOpponent>['entries']; squadName: string; power: number; deploy: null };
  /** 다음 `matched` — **`search`를 보내기 전에 걸어 둔 리스너**라 놓치지 않는다 */
  matched: Promise<{ matchId: string; opponent: { squadName: string | null } }>;
}

/** 대기열에 붙어 검색하는 가짜 상대 — `matchmaking.ts`가 브라우저에서 하는 일의 서버 쪽 절반 */
async function queueUp(id: string, mode: BattleMode, power: number, seed: number): Promise<QueueBot> {
  const opp = makeAiOpponent(mode, power, seed);
  const enlist = { playerId: id, entries: opp.entries, squadName: `${id}부대`, power, deploy: null };
  const client = new Client(URL);
  const room = await client.joinOrCreate('queue', { playerId: id });
  // **listen 먼저, send 나중** — 매칭이 같은 틱에 올 수 있다
  const matched = once<{ matchId: string; opponent: { squadName: string | null } }>(room, 'matched');
  room.send('search', { search: { mode, power, enlist } });
  return { room, enlist, matched };
}

// ── 짝짓기 → 확인 → 좌석 예약 → 대전 방 ────────────────────────
{
  const [carol, dave] = await Promise.all([
    queueUp('q-carol', '3v3', 800, 303),
    queueUp('q-dave', '3v3', 800, 404),
  ]);
  const [carolMatch, daveMatch] = await Promise.all([carol.matched, dave.matched]);
  if (carolMatch.matchId !== daveMatch.matchId) fail('둘이 같은 매칭을 못 봤다');
  if (carolMatch.opponent.squadName !== 'q-dave부대') fail(`carol이 본 상대가 이상하다 — ${carolMatch.opponent.squadName}`);
  ok('대기열 — 인접 전투력 둘이 매칭됐다');

  const carolRes = once<{ reservation: Reservation }>(carol.room, 'reservation');
  const daveRes = once<{ reservation: Reservation }>(dave.room, 'reservation');
  carol.room.send('confirm', { matchId: carolMatch.matchId });
  dave.room.send('confirm', { matchId: daveMatch.matchId });
  const [{ reservation: rC }, { reservation: rD }] = await Promise.all([carolRes, daveRes]);
  ok('대기열 — 둘 다 확인하니 좌석이 예약됐다');

  const [landedC, landedD] = await Promise.all([
    connectReservedBattle(rC, { ...carol.enlist, mode: '3v3' }, URL),
    connectReservedBattle(rD, { ...dave.enlist, mode: '3v3' }, URL),
  ]);
  if (landedC.transport.humanSide === landedD.transport.humanSide) fail('예약으로 붙었는데 같은 진영이다');
  if (landedC.opponent.squadName !== 'q-dave부대') fail(`예약 경로 상대가 이상하다 — ${landedC.opponent.squadName}`);
  ok(`대기열 — 좌석 예약으로 진짜 대전 방에 붙었다 (${landedC.transport.humanSide} / ${landedD.transport.humanSide})`);
  landedC.transport.close();
  landedD.transport.close();
  void carol.room.leave(); void dave.room.leave();
}

// ── 거절 — 거절당한 쪽은 패널티 없이, 셋째 사람과 곧바로 다시 붙는다 ──
{
  const [erin, frank] = await Promise.all([
    queueUp('q-erin', '3v3', 800, 505),
    queueUp('q-frank', '3v3', 800, 606),
  ]);
  const [erinMatch, frankMatch] = await Promise.all([erin.matched, frank.matched]);
  if (erinMatch.matchId !== frankMatch.matchId) fail('거절 표본이 서로 다른 매칭을 봤다');

  const frankDeclined = once<Record<string, never>>(frank.room, 'declined');
  // frank의 **다음** matched(재매칭)도 놓치지 않게 지금 걸어 둔다 — grace가 도착하면 곧바로 온다
  const frankRematch = once<{ matchId: string; opponent: { squadName: string | null } }>(frank.room, 'matched');
  erin.room.send('decline', { matchId: erinMatch.matchId });
  await frankDeclined;
  ok('대기열 — 거절당한 쪽이 「declined」를 받았다');

  // 셋째 사람 — frank와 곧바로 다시 매칭돼야 한다(erin은 frank를 피한다)
  const grace = await queueUp('q-grace', '3v3', 800, 707);
  const [graceMatch, frankMatch2] = await Promise.all([grace.matched, frankRematch]);
  if (frankMatch2.matchId !== graceMatch.matchId) fail('frank가 grace와 다시 붙지 않았다');
  if (frankMatch2.opponent.squadName !== 'q-grace부대') fail(`frank의 새 상대가 이상하다 — ${frankMatch2.opponent.squadName}`);
  ok('대기열 — 거절당한 쪽이 패널티 없이 새 상대와 곧바로 붙었다');

  void erin.room.leave(); void frank.room.leave(); void grace.room.leave();
}

// ═══════════════════════════════════════════════════════════════
// 이탈 — **한쪽이 정말로 사라진다**
// ═══════════════════════════════════════════════════════════════

/*
 * 유예(60초)를 다 기다릴 수는 없으므로 **여기서 보는 것은 「끊긴 것이 서버에
 * 닿는가」**까지다. 「닿은 뒤에 무엇이 되는가」는 `room-logic.test.ts`가 가짜
 * 시계로 네 줄 전부 잡는다 — **겹치지 않게 가른 자리**다.
 */
const [c, d] = await Promise.all([
  connectBattle('dev2', {
    playerId: 'carol', entries: a.entries, squadName: '캐롤군', power: a.power,
    deploy: null, mode: '3v3',
  }, URL),
  connectBattle('dev2', {
    playerId: 'dave', entries: b.entries, squadName: '데이브군', power: b.power,
    deploy: null, mode: '3v3',
  }, URL),
]);
const left: BattleState[] = [];
const survivor = new Playback(d.transport, { onChange: (s) => { left.push(s); }, onTick: () => {} });
survivor.start();
await sleep(200);
c.transport.close();                     // 한 사람이 사라진다
await sleep(600);
survivor.update(16);
if (survivor.close) fail('유예도 안 지났는데 방이 접혔다 — 잠깐 끊긴 것은 이탈이 아니다');
ok('한쪽이 끊겨도 유예 안에는 방이 그대로다 (판정은 회귀가 본다)');
d.transport.close();

await server.gracefullyShutdown(false);
console.log('\n온라인 스모크 통과 — 방 · 진영 · waiting · 마감 · 한 판 · 로그 동일성 · 이탈 유예');
process.exit(0);
