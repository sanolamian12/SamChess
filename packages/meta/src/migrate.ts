/**
 * 저장된 계정을 지금 형식으로 되접는다 (2026-08-17, 저장 형식 v2).
 *
 * ────────────────────────────────────────────────────────────────
 * 버리기에서 채워 넣기로 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 지금까지 `loadProfile`은 **버전이 다르면 계정을 통째로 버렸다.** 저장된 것이
 * 도시 이름과 장수 다섯뿐일 때는 값싼 처리였지만, 부대(E)와 전적(C1)이 쌓이기
 * 시작하면 형식을 올릴 때마다 사람의 기록이 날아간다. 여기서 방향을 뒤집는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 `client/src/meta/storage.ts`가 아니라 여기인가
 * ────────────────────────────────────────────────────────────────
 *
 * 「계정 규칙은 `@samchess/meta`에 있다」는 이미 굳은 계약이고, 무엇보다
 * **meta에 있어야 `npm test`가 잡는다.** 되접기는 눈으로 볼 수 없는 종류다 —
 * 「Lv7 캐릭터의 책략 아홉 개가 레벨별로 옳게 갈렸는가」는 화면 어디에도 안 뜬다.
 * 정렬을 `officers.ts`로, 시간대를 `backdrop.ts`로 떼어 낸 것과 같은 이유다.
 * `storage.ts`에는 `localStorage`를 읽고 쓰는 일만 남는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 규약 셋
 * ────────────────────────────────────────────────────────────────
 *
 * 1. **멱등하다** — 두 번 지나가도 같다. 다중 탭·재접속에서 실제로 두 번 지난다.
 * 2. **모르는 미래는 버린다** — `version`이 지금보다 크면 `null`이다. 어떻게
 *    되접어야 할지 알 수 없는데 짐작으로 열면 조용히 망가뜨린다.
 * 3. **살릴 수 있는 만큼 살린다** — 없어진 장수만 지우고, 손상된 장수는 레벨을
 *    낮춰서라도 남긴다. 계정 하나를 버리면 도시와 나머지 장수까지 함께 죽는다.
 */

import { BUILDINGS, TACTICS, equipmentById, officerById, tacticById, tacticsForLevel } from '@samchess/data';
import type { BuildingId, Grade } from '@samchess/data';
import { MAX_BANDITS, UNITS_PER_SIDE } from '@samchess/rules';
import type { BattleMode, Intent, OfficerId, PieceType, RosterEntry, TacticId } from '@samchess/rules';
import { MARKET_ITEM_IDS, isCarriedBattle } from './market.ts';
import { PROFILE_VERSION, checkGrowth } from './profile.ts';
import {
  BUILD_ACTIONS_PER_UPGRADE, MAX_CITY_LEVEL, buildingValue, initialBuildings,
} from './city.ts';
import { BATTLE_MODES, MATCH_LOG_CAP, OPPONENT_KINDS, emptyTally } from './records.ts';
import { BASIC_TUTORIALS, isTutorialId } from './tutorial.ts';
import { readGuide } from './guide.ts';
import { PIECE_TYPES } from './roster.ts';
import { SQUAD_NAME_MAX } from './squads.ts';
import { copyNumberOfKey, equipmentIdOfKey, forgeItemKey } from './forge.ts';
import type {
  AcademyDone, AcademyState, AiBattleState, AiBattleStatus, BattleResult, CarriedBattle, CollectionProgress, GrowthStep, InPlayItem, MailboxEntry,
  MatchPick, MatchRow,
  OfficerInstance, OpponentKind,
  PlayerProfile, RaidState, RaidStatus, RecordTally, RosterPick, SiegeDefender, Squad, SquadCell, StatPick, TutorialProgress,
} from './types.ts';

/** v1의 보유 장수 — 평면 배열 둘. `tactics`는 Lv6·7 탓에 `statPicks`보다 길다 */
interface OfficerInstanceV1 {
  officer?: unknown;
  level?: unknown;
  statPicks?: unknown;
  tactics?: unknown;
  record?: unknown;
}

/**
 * 저장된 것을 지금 형식으로. 되접을 수 없으면 `null`(= 새로 시작한다).
 *
 * 입력이 무엇이든 던지지 않는다 — 저장소에는 사람이 손으로 고친 것도, 옛 버전이
 * 쓰다 만 것도 들어 있을 수 있다. 여기서 던지면 게임이 첫 화면에서 멈춘다.
 */
export function migrateProfile(raw: unknown): PlayerProfile | null {
  if (!isRecord(raw)) return null;
  const version = num(raw.version, 0);
  if (version > PROFILE_VERSION) return null;

  const cityLv = clampInt(num(raw.cityLevel, 1), 1, MAX_CITY_LEVEL);
  const buildings = readBuildings(raw.buildings);
  const forgeOrder = readForgeOrder(raw.forgeOrder);
  const profile: PlayerProfile = {
    version: PROFILE_VERSION,
    cityName: typeof raw.cityName === 'string' && raw.cityName.trim() ? raw.cityName : '무명성',
    cityLevel: cityLv,
    // ── 필드가 더해지는 변경은 **여기 한 줄씩** 붙는다 (C2의 도시, E의 부대) ──
    // 상한은 **병영**이 정한다 (2026-09-04) — 되접은 건물 레벨을 그대로 쓴다
    grain: clampInt(num(raw.grain, 0), 0, buildingValue('barracks', buildings.barracks)),
    // `grainAt`은 C2에서 더해졌다. **없으면 0**이고, 0은 「아직 정산한 적 없다」라
    // 첫 `syncGrain()`이 도장만 찍고 지나간다 — 여기서 「지금」을 찍어 줄 수는 없다
    // (meta는 시계를 안 읽는다). 1970년으로 읽으면 접속하자마자 상한까지 찬다.
    grainAt: Math.max(0, Math.floor(num(raw.grainAt, 0))),
    gold: Math.max(0, Math.floor(num(raw.gold, 0))),
    materials: Math.max(0, Math.floor(num(raw.materials, 0))),
    // 건물·병원은 v4에서 생겼다. v3 이하는 아래 `readBuildings()`가 채운다
    buildings,
    buildCredits: readCredits(raw.buildCredits, version, cityLv, buildings),
    hospitalBusy: readBusy(raw.hospitalBusy),
    roster: {},
    cards: {},
    // 계정 전적·이력은 v3에서 생겼다. v2 이하는 빈 채로 시작한다
    record: readRecord(raw.record, 2, version),
    matches: [],
    matchSeq: 1,
    // 부대는 E에서 더해졌다. **없으면 빈 배열** — 버전을 올릴 일이 아니다(§5-40)
    squads: [],
    squadSeq: 1,
    // 도시 이름 변경 쿨다운(2026-08-25). **없으면 한 번도 안 바꾼 것** —
    // `exactOptionalPropertyTypes`라 값이 없을 때는 키 자체를 안 넣는다(스프레드로).
    ...(typeof raw.cityNameChangedAt === 'number' && Number.isFinite(raw.cityNameChangedAt)
      ? { cityNameChangedAt: Math.max(0, Math.floor(raw.cityNameChangedAt)) }
      : {}),
    forgeOwned: {},
    ...(forgeOrder ? { forgeOrder } : {}),
  };

  const roster = isRecord(raw.roster) ? raw.roster : {};
  for (const [id, value] of Object.entries(roster)) {
    // 데이터에서 사라진 장수는 지운다 — 이름이 정정되면 id가 갈린다(GDD §9 「장요→장료」).
    // 남겨 두면 편성 화면에 이름 없는 칸이 뜬다.
    if (!officerById.has(id)) continue;
    const inst = migrateInstance(id as OfficerId, value, version);
    if (inst) profile.roster[id as OfficerId] = inst;
  }

  const cards = isRecord(raw.cards) ? raw.cards : {};
  for (const [id, value] of Object.entries(cards)) {
    if (!officerById.has(id)) continue;
    const n = Math.floor(num(value, 0));
    if (n > 0) profile.cards[id as OfficerId] = n;
  }

  // 대장간 지급도 **장수를 다 읽은 뒤에** 읽는다 — 계정에서 빠진 장수에게 지급된
  // 채로 남은 기록을 걸러 내려면 `profile.roster`가 이미 채워져 있어야 한다
  profile.forgeOwned = readForgeOwned(raw.forgeOwned, profile);
  // 옛 계정에는 제작일이 없다 — 병기마다 있을 수도 없을 수도 있어 **빈 칸을
  // 지어내지 않는다**(0을 채우면 1970년이 뜬다). 화면이 없는 것을 「—」로 그린다.
  const forgeMadeAt = readForgeMadeAt(raw.forgeMadeAt, profile.forgeOwned);
  if (Object.keys(forgeMadeAt).length > 0) profile.forgeMadeAt = forgeMadeAt;

  // 시장 아이템도 **장수를 다 읽은 뒤에** 읽는다 — 계정에서 빠진 장수가
  // 들고 있던 기록을 걸러 내려면 `profile.roster`가 이미 채워져 있어야 한다.
  // 셋 다 **없으면 키째로 없다**: 빈 표를 지어내면 「아무것도 없다」와
  // 「아직 시장에 안 갔다」가 구별되지 않는다(필드가 더해지기만 하므로 버전은
  // 그대로다 — §5의 「뜻이 바뀔 때만 올린다」).
  const marketOwned = readMarketOwned(raw.marketOwned);
  if (Object.keys(marketOwned).length > 0) profile.marketOwned = marketOwned;
  const marketTaken = readMarketTaken(raw.marketTaken);
  if (marketTaken) profile.marketTaken = marketTaken;
  const marketCarry = readMarketCarry(raw.marketCarry, profile);
  if (Object.keys(marketCarry).length > 0) profile.marketCarry = marketCarry;
  const marketBoughtAt = readMarketBoughtAt(raw.marketBoughtAt, marketOwned);
  if (Object.keys(marketBoughtAt).length > 0) profile.marketBoughtAt = marketBoughtAt;

  // 부대는 **장수를 다 읽은 뒤에** 읽는다 — 계정에서 빠진 장수를 가리키는 부대를
  // 걸러 내려면 `profile.roster`가 이미 채워져 있어야 한다
  profile.squads = readSquads(raw.squads, profile, version);
  profile.squadSeq = Math.max(
    Math.floor(num(raw.squadSeq, 0)),
    profile.squads.reduce((n, s) => Math.max(n, seqOfSquadId(s.id) + 1), 1),
  );

  // 파수꾼도 **장수를 다 읽은 뒤에** — 계정에서 빠진 장수를 거른다. 부대와 겹치거나
  // 칸을 넘친 것은 여기서 지우지 않는다: 읽는 자리(`guardsOf`)가 늘 다시 거른다
  const guards = readGuards(raw.farmGuards, profile);
  if (guards.length > 0) profile.farmGuards = guards;
  // 수비군도 **부대를 읽은 뒤에** — 없는 부대 · 모드가 다른 부대를 가리키는 줄은 버린다(2026-10-27).
  // **여기 없으면 서버가 읽을 때마다 버린다**(CLAUDE.md 「계정에 필드를 더하면 migrateProfile()에도」)
  const garrison = readGarrison(raw.garrison, profile);
  if (garrison) profile.garrison = garrison;
  const raid = readRaid(raw.raid);
  if (raid) profile.raid = raid;
  // AI 대전(2026-10-15) — **여기 없으면 서버가 읽을 때마다 버려 같은 판을 다시 정산할 수 있게 된다**
  const aiBattle = readAiBattle(raw.aiBattle);
  if (aiBattle) profile.aiBattle = aiBattle;
  // 판 도중 빠진 아이템은 **AI 대전 · 도적떼를 읽은 뒤에** — 판 표시가 없는 옛 줄은 도는 판으로 짐작한다
  const marketInPlay = readMarketInPlay(raw.marketInPlay, profile);
  if (marketInPlay.length > 0) profile.marketInPlay = marketInPlay;
  // 우편함(2026-10-21) — 필드가 더해지기만 해서 버전을 안 올린다. **여기 없으면 읽을 때마다 버려져 같은 보상을 다시 받는다**
  const mailbox = readMailbox(raw.mailbox);
  if (mailbox.length > 0) profile.mailbox = mailbox;
  // 태학 연구(2026-09-22) — 필드가 더해지기만 해서 버전을 안 올린다. 없으면 키도 안 만든다
  const academy = readAcademy(raw.academy);
  if (academy) profile.academy = academy;
  // 컬렉션(2026-10-13) — 같은 결로 버전을 안 올린다. **여기 없으면 읽을 때마다 버려진다** —
  // 되접기는 아는 필드만 담는다(화면 확인이 「완성이 안 보인다」로 잡았다)
  const collection = readCollection(raw.collection);
  if (collection) profile.collection = collection;
  // 튜토리얼(2026-10-22) — 같은 결로 버전을 안 올린다. **여기 없으면 읽을 때마다 버려져 [출정하기]가 다시 잠긴다.**
  // 계정 전적을 읽은 뒤에 — 이 필드가 생기기 전에 이미 싸운 계정은 기본 셋을 끝낸 것으로 본다
  const tutorial = readTutorial(raw.tutorial, raw.record);
  if (tutorial) profile.tutorial = tutorial;
  // 안내 내관(2026-10-22) — 같은 결로 버전을 안 올린다. **여기 없으면 읽을 때마다 버려져 같은 안내가 매번 다시 나온다**
  const guide = readGuide(raw.guide);
  if (guide) profile.guide = guide;

  profile.matches = readMatches(raw.matches, version);
  // 줄 번호는 **뒤로 가지 않는다.** 덜어 낸 줄의 번호를 다시 쓰면 이력의 순서가 뒤집힌다
  profile.matchSeq = Math.max(
    Math.floor(num(raw.matchSeq, 0)),
    profile.matches.reduce((n, row) => Math.max(n, row.seq + 1), 1),
  );

  return profile;
}

/** 장수 하나. 되접을 수 없을 만큼 망가졌으면 `null`(그 장수만 빠진다) */
function migrateInstance(officer: OfficerId, value: unknown, version: number): OfficerInstance | null {
  if (!isRecord(value)) return null;
  const raw = value as OfficerInstanceV1;

  const read = Array.isArray((value as { growth?: unknown }).growth)
    ? readGrowth((value as { growth: unknown[] }).growth)   // 이미 v2 — 검산만 한다
    : foldV1(raw);                                          // v1 — 레벨별로 되접는다

  // 저장된 레벨보다 **위로는 올리지 않는다.** 스택이 레벨보다 길면(손상) 남는 쪽이
  // 거짓이다 — 되접기가 계정을 세게 만들어 주는 일은 없어야 한다.
  const stored = Math.floor(num(raw.level, read.length + 1));
  let growth = stored >= 1 ? read.slice(0, stored - 1) : read;

  // 마지막으로 **성립하는 데까지만** 남긴다.
  //
  // > **지금은 여기서 깎이는 일이 없다.** 위 두 함수가 school로 정규화하므로 나오는
  // > 스택은 언제나 성립한다. 이건 **되접기와 검증이 갈리는 순간 잡으라고 둔 그물**이다
  // > — 어긋난 스택을 내보내면 화면은 멀쩡하고 `createBattle`이 전투 직전에 던진다.
  // > 기물 마스크를 추출기와 테스트가 각각 다시 계산해 대조하는 것과 같은 결이다.
  while (growth.length > 0 && checkGrowth(growth, growth.length + 1)) growth = growth.slice(0, -1);

  return {
    officer,
    // ★ 레벨은 스택이 정한다. 이 한 줄이 `growth.length === level - 1`을 보증한다 —
    //   저장된 `level`을 믿고 스택을 맞추는 쪽이면 손상된 입력에서 불변식이 깨진다.
    level: growth.length + 1,
    growth,
    record: readRecord(raw.record, 3, version),
    // 부상 두 필드 (GDD §5.7, 2026-09-04에 더해졌다). **되접기가 이 둘을 빠뜨리고 있었다**
    // (2026-09-17에 잡았다) — 서버는 계정을 읽을 때마다 여기를 지나므로 **다친 장수가
    // 다음 읽기에서 조용히 나았다.** 병영의 「부상」 표시를 시험하려고 부상을 심었는데
    // 화면이 「건강」을 띄워서 드러났다. 낫는 시각이 지났는지는 `isInjured()`가 본다.
    ...(finiteNum((value as { injuredAt?: unknown }).injuredAt) !== null
      ? { injuredAt: finiteNum((value as { injuredAt?: unknown }).injuredAt)! } : {}),
    ...(finiteNum((value as { healingAt?: unknown }).healingAt) !== null
      ? { healingAt: finiteNum((value as { healingAt?: unknown }).healingAt)! } : {}),
    // 컬렉션 치료 감소율 (2026-10-15) — 빠뜨리면 읽을 때마다 버려져 치료가 조용히 1분으로 돌아간다
    ...(finiteNum((value as { healCut?: unknown }).healCut) !== null
      ? { healCut: finiteNum((value as { healCut?: unknown }).healCut)! } : {}),
  };
}

const finiteNum = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ── v3의 전적을 읽는다 (2026-08-18) ─────────────────────────────

/**
 * 전적 칸을 읽는다. **키가 지금 규약이 아니면 버린다.**
 *
 * ────────────────────────────────────────────────────────────────
 * v2의 평평한 전적은 **버린다** ★ (2026-08-18 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * 이 파일의 방침은 「살릴 수 있는 만큼 살린다」이고 여기만 예외다. v2의
 * `{wins, losses, kills}`는 **어느 기물로 어느 모드에서 싸웠는지를 모른다** — 40쪽
 * 표의 어느 칸에도 넣을 수 없어 「기물 미상」 줄을 표에 영구히 하나 더 달아야 한다.
 * 게다가 그때까지 쌓인 값은 전부 AI 대전분인데, 그 시점 정본은 「AI는 전적을 세지
 * 않는다」였다 — **애초에 없었어야 할 기록**이다. 그래서 0에서 시작한다.
 *
 * 값 자체를 지우는 것이라, 되접기가 **거꾸로도 조용하지 않게** 이 주석을 남긴다.
 * (v2 평평한 모양은 값이 `number`라 아래 `isRecord` 검사에서 저절로 걸러진다.)
 *
 * @param arity 키 조각 수 — 계정은 `{상대}/{모드}` 둘, 장수는 기물까지 셋
 */
function readRecord(raw: unknown, arity: 2 | 3, version: number): Record<string, RecordTally> {
  const out: Record<string, RecordTally> = {};
  if (!isRecord(raw)) return out;
  for (const [stored, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const parts = stored.split('/');
    if (parts.length !== arity) continue;
    // v6 이하의 갈래는 v7로 옮긴다 — `ai`는 버리고 `online`은 야전(`opponentOf`)
    const opponent = opponentOf(parts[0], version);
    if (!opponent || !isMode(parts[1])) continue;
    const key = [opponent, ...parts.slice(1)].join('/');
    if (arity === 3 && !isPiece(parts[2])) continue;
    const cell = emptyTally();
    cell.wins = count(value.wins);
    cell.draws = count(value.draws);
    cell.losses = count(value.losses);
    cell.kills = count(value.kills);
    // 승점 — 2026-10-27에 생긴 칸. 옛 기록에는 없어 0이다(배포 전이라 거꾸로 채우지 않는다)
    cell.points = count(value.points);
    // **출전 수는 믿지 않고 다시 센다** — `plays = wins + draws + losses`가 이 형식의
    // 불변식이라, 저장된 값이 어긋나 있으면 표의 세 줄이 서로 안 맞는다
    cell.plays = cell.wins + cell.draws + cell.losses;
    if (cell.plays > 0 || cell.kills > 0) out[key] = cell;
  }
  return out;
}

// ── 부대를 읽는다 (E · 2026-08-18) ─────────────────────────────

/**
 * 저장된 부대. **되접을 수 없는 부대만 빠진다** — 이력·장수와 같은 규약이다.
 *
 * 버리는 것은 셋뿐이고 전부 「남겨 두면 화면이 거짓말을 하는」 것들이다.
 *  1. **이름이 없거나 12자를 넘는다** — 사람이 고칠 길이 화면에 없다
 *  2. **이름이 겹친다** — 뒤엣것을 버린다. 목록에서 구별이 안 되고, 겹치는 입력은
 *     손으로 고쳤을 때만 나온다(`addSquad`가 막는다)
 *  3. **계정에 없는 장수를 가리킨다** — 그 자리를 메울 방법이 없다. 정정으로 id가
 *     갈리면(GDD §9 「장요→장료」) 여기서 걸린다
 *
 * **옛 `level`(부대별 하향 눈금, 2026-08-18 ~ 09-16)은 조용히 버린다.** 부대는 이제
 * 장수를 가리킬 뿐이고 언제나 보유 레벨로 선다. 부대가 죽는 것이 아니라 눈금만
 * 사라지는 것이라 버전을 올리지 않는다 — 되접을 뜻이 없고 읽지 않으면 그만이다.
 *
 * **배치 프리셋은 여기서 검증하지 않는다.** 모드·구성·구역을 함께 봐야 하는데 그
 * 판정은 `squadDeployment()` 하나에 있고, 어긋나면 전투에서 조용히 기본 배치로
 * 물러난다 — 되접기가 미리 지우면 사람이 고칠 기회까지 사라진다.
 */
function readSquads(raw: unknown, profile: PlayerProfile, version: number): Squad[] {
  if (!Array.isArray(raw)) return [];
  const out: Squad[] = [];
  const names = new Set<string>();
  for (const value of raw) {
    if (!isRecord(value)) continue;
    if (!isMode(value.mode)) continue;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || [...name].length > SQUAD_NAME_MAX || names.has(name)) continue;

    const picks: RosterPick[] = [];
    const seen = new Set<PieceType>();
    for (const p of Array.isArray(value.picks) ? value.picks : []) {
      if (!isRecord(p) || !isPiece(p.piece) || seen.has(p.piece)) continue;
      if (typeof p.officer !== 'string' || !profile.roster[p.officer as OfficerId]) continue;
      seen.add(p.piece);
      picks.push({ piece: p.piece, officer: p.officer as OfficerId });
    }
    // 인원이 안 맞으면 버린다 — 「빈 자리」라는 개념이 편성에 없다(King 필수·정원 고정)
    if (picks.length !== UNITS_PER_SIDE[value.mode]) continue;
    if (!picks.some((p) => p.piece === 'King')) continue;

    names.add(name);
    out.push({
      id: typeof value.id === 'string' && value.id ? value.id : `sq${out.length + 1}`,
      name,
      mode: value.mode,
      picks,
      deploy: { P1: readCells(isRecord(value.deploy) ? value.deploy.P1 : null),
                P2: readCells(isRecord(value.deploy) ? value.deploy.P2 : null) },
      // 필드가 새로 더해질 뿐이라(부대 랭킹, 2026-08-26) 저장 형식 버전은 안 올린다 —
      // 없던 계정은 빈 전적으로 시작한다(계정 전적의 `record: {}`와 같은 관용)
      record: readRecord(value.record, 2, version),
      // 2026-09-17에 더해졌다 — 없으면 안 싣는다(`recentSquads()`가 id로 물러난다)
      ...(typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? { createdAt: value.createdAt } : {}),
    });
  }
  return out;
}

/** 배치 프리셋의 칸들. 모양만 본다 — 구역·구성 검증은 `squadDeployment()`가 한다 */
function readCells(raw: unknown): SquadCell[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SquadCell[] = [];
  for (const c of raw) {
    if (!isRecord(c) || !isPiece(c.piece)) return null;
    const x = Math.floor(num(c.x, -1));
    const y = Math.floor(num(c.y, -1));
    if (x < 0 || y < 0) return null;
    out.push({ piece: c.piece, x, y });
  }
  return out.length > 0 ? out : null;
}

// ── 건물을 읽는다 (v4 · 2026-09-04) ────────────────────────────

/**
 * 건물 레벨. **없으면(v3 이하) 아무것도 안 지은 상태다.**
 *
 * v3까지는 도시 레벨 하나가 상한·풀·생산량을 전부 정했다. v4에서 그것이 건물로
 * 갈렸는데, **무엇을 지을 수 있었는지는 쓴 기회로만 알 수 있고 v3에는 그 기록이
 * 없다** — 그래서 기본 셋만 Lv1로 두고 나머지는 0이다. 되접기가 계정을 세게
 * 만들지 않는 쪽이기도 하다.
 *
 * **v4 이후의 저장은 그대로 읽는다.** 값이 이상하면 그 건물만 0(기본 건물은 1)이다.
 */
function readBuildings(raw: unknown): Record<BuildingId, number> {
  const stored = isRecord(raw) ? raw : null;
  const out = initialBuildings();
  for (const b of BUILDINGS) {
    if (stored) {
      const v = num(stored[b.id], NaN);
      if (Number.isFinite(v)) {
        out[b.id] = clampInt(v, b.kind === 'basic' ? 1 : 0, b.maxLevel);
        continue;
      }
    }
    // 저장에 없다(v3 이하) — **기본 셋만 Lv1로 두고 나머지는 0이다.**
    //
    // 예전에는 해금 표를 거꾸로 읽어 「그때 지을 수 있었던 것을 최대로」 지어
    // 줬는데, 그 표가 조건표가 아니었다(2026-09-04). 이제 지을 수 있었는지는
    // **쓴 기회**로만 알 수 있고 v3에는 그 기록이 없다 — 그래서 **안 지은
    // 것으로 본다.** 되접기가 계정을 세게 만들지 않는 쪽이기도 하다.
    out[b.id] = b.kind === 'basic' ? 1 : 0;
  }
  return out;
}

/**
 * 남은 건설 기회. **없으면 「받은 만큼에서 지은 만큼을 뺀」 값이다.**
 *
 * 받은 것은 `증축 횟수 × BUILD_ACTIONS_PER_UPGRADE` = `(도시 레벨 − 1) × 3`이고,
 * 쓴 것은 지어 놓은 칸 수다. **Lv1의 몫 3회는 v5에서 없어졌다**(`profile.ts`) —
 * Lv1에서는 지을 수가 없어 화면에 숫자만 떠 있었다.
 *
 * ★ **v4 저장은 그 3회를 이미 받아 두었으므로 한 번 덜어 낸다.** 되접기는 멱등해야
 * 하는데 「덜어 내기」는 두 번 지나면 두 번 깎는다 — 그래서 **버전으로 가른다**
 * (v5로 저장된 뒤에는 이 갈래가 안 돈다). 이미 다 쓴 계정은 0에서 멈춘다 —
 * 빚을 지우지 않는다. 그때는 3회를 공짜로 쓴 셈인데, 되접기가 계정을 **약하게**
 * 만들지 않는 쪽을 고른 것이다(레벨을 눌러 담되 버리지 않는 것과 같은 결).
 */
function readCredits(
  raw: unknown, version: number, cityLv: number, built: Record<BuildingId, number>,
): number {
  const v = num(raw, NaN);
  if (Number.isFinite(v)) {
    const legacyGrant = version <= 4 ? BUILD_ACTIONS_PER_UPGRADE : 0;
    return Math.max(0, Math.floor(v) - legacyGrant);
  }
  const granted = Math.max(0, cityLv - 1) * BUILD_ACTIONS_PER_UPGRADE;
  const spent = BUILDINGS.reduce(
    (n, b) => n + Math.max(0, built[b.id] - (b.kind === 'basic' ? 1 : 0)), 0,
  );
  return Math.max(0, granted - spent);
}

/** 바쁜 room의 해제 시각들. **지난 것도 그대로 둔다** — `syncCity()`가 지운다 */
function readBusy(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Math.floor(num(v, 0)))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
}

/**
 * 대장간에서 만든 장비. **모르는 id는 버린다**(장비 목록이 정정되면 `equipmentById`가
 * 갈린다 — 장수 id 정정과 같은 결). 지급 대상이 계정에 없는 장수를 가리키면
 * 「지급 해제」로 되접는다 — 장수가 없어졌다고 장비까지 함께 지울 이유는 없다.
 */
/** 제작일 — 보유 중인 병기의 것만, 양수인 것만 남긴다 */
function readForgeMadeAt(raw: unknown, owned: Record<string, OfficerId | null>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    // 보유 목록과 **같은 키로** 되접는다 — v5의 맨 id는 `#1`이다(아래 `readForgeOwned`)
    const itemKey = forgeItemKey(equipmentIdOfKey(key), copyNumberOfKey(key));
    if (!(itemKey in owned)) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[itemKey] = Math.floor(value);
  }
  return out;
}

/**
 * ★ **v6 — 키가 종류에서 자루로** (2026-09-14). v5까지는 `dae-gam-do` 하나가 곧 「그 병기를
 * 가졌다」였다(계정당 1개). 이제 `dae-gam-do#1`처럼 자루마다 키가 있다. 맨 id는 `#1`로,
 * 이미 자루 키면 그대로 둔다 — **버전으로 가르지 않고 모양으로 가른다**. 그래서 두 번
 * 지나도 같다(되접기는 멱등해야 한다).
 */
/**
 * 시장 아이템 보유 수량 — **모르는 id와 0 이하는 버린다**(GDD §6.5).
 * 0을 남기면 「가졌는데 없다」가 목록에 뜬다.
 */
function readMarketOwned(raw: unknown): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!MARKET_ITEM_IDS.has(id)) continue;
    const n = Math.floor(num(value, 0));
    if (n > 0) out[id] = n;
  }
  return out;
}

/**
 * 오늘 산 수량. **날짜가 없거나 꼴이 아니면 통째로 버린다** — 반쪽만 남기면
 * 「어느 날의 수인지」를 계산하는 쪽이 지어내야 하고, 버려도 잃는 것은
 * 「오늘 이미 샀다」뿐이다(하루가 지나면 어차피 없는 것이 된다).
 */
function readMarketTaken(raw: unknown): PlayerProfile['marketTaken'] {
  if (!isRecord(raw)) return undefined;
  const day = raw.day;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const counts = readMarketOwned(raw.counts);
  return Object.keys(counts).length > 0 ? { day, counts } : undefined;
}

/**
 * 누가 무엇을 들려 나가는가 — **계정에서 빠진 장수와 모르는 아이템은 버린다.**
 * 보유보다 많이 들고 있어도 여기서는 안 자른다: 그 판정은 `canCarryItem()`의
 * 몫이고, 되접기가 세면 같은 규칙이 두 군데가 된다.
 */
function readMarketCarry(raw: unknown, profile: PlayerProfile): Partial<Record<OfficerId, string>> {
  const out: Partial<Record<OfficerId, string>> = {};
  if (!isRecord(raw)) return out;
  for (const [officer, value] of Object.entries(raw)) {
    if (!profile.roster[officer as OfficerId]) continue;
    if (typeof value !== 'string' || !MARKET_ITEM_IDS.has(value)) continue;
    out[officer as OfficerId] = value;
  }
  return out;
}

/**
 * 판이 도는 동안 빠져 있는 것. **계정에서 빠진 장수와 모르는 아이템은 버린다** —
 * 남겨 두면 환불이 없는 장수에게 돌아간다.
 *
 * **판 표시(`battle`)가 없는 옛 줄**(2026-10-21 이전)은 도는 판으로 짐작한다 — AI 대전이 싸우는 중이면 `ai`,
 * 도적떼가 싸우는 중이면 `raid`, 둘 다 아니면 `online`(기획자 확정). 둘 다 돌면 `ai`다. 버전은 안 올린다 —
 * 짐작한 값이 처음 저장될 때 그대로 남는다.
 */
function readMarketInPlay(raw: unknown, profile: PlayerProfile): InPlayItem[] {
  if (!Array.isArray(raw)) return [];
  const guess: CarriedBattle = profile.aiBattle?.status === 'fighting' ? 'ai'
    : profile.raid?.status === 'fighting' ? 'raid'
    : 'online';
  const out: InPlayItem[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const { officer, item, boughtAt, battle } = row;
    if (typeof officer !== 'string' || !profile.roster[officer as OfficerId]) continue;
    if (typeof item !== 'string' || !MARKET_ITEM_IDS.has(item)) continue;
    const at = typeof boughtAt === 'number' && Number.isFinite(boughtAt) && boughtAt > 0 ? boughtAt : undefined;
    out.push({
      officer: officer as OfficerId, item, ...(at === undefined ? {} : { boughtAt: at }),
      battle: isCarriedBattle(battle) ? battle : guess,
    });
  }
  return out;
}

/**
 * 낱개마다의 구매 시각 (2026-09-24). **보유한 품목만**, 시각은 양수·유한만, 오래된 것부터 —
 * 보유보다 많으면 **최근 것**만 남긴다(빠져나가는 것은 오래된 쪽부터다). 모자라도 채우지
 * 않는다 — 화면이 「—」로 그린다(`forgeMadeAt`과 같은 결).
 */
function readMarketBoughtAt(
  raw: unknown, owned: Partial<Record<string, number>>,
): Partial<Record<string, number[]>> {
  const out: Partial<Record<string, number[]>> = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    const n = owned[id] ?? 0;
    if (n <= 0 || !Array.isArray(value)) continue;
    const dates = value
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b)
      .slice(-n);
    if (dates.length > 0) out[id] = dates;
  }
  return out;
}

function readForgeOwned(raw: unknown, profile: PlayerProfile): Record<string, OfficerId | null> {
  const out: Record<string, OfficerId | null> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const id = equipmentIdOfKey(key);
    if (!equipmentById.has(id)) continue;
    const itemKey = forgeItemKey(id, copyNumberOfKey(key));
    if (itemKey in out) continue;
    out[itemKey] = typeof value === 'string' && profile.roster[value as OfficerId] ? (value as OfficerId) : null;
  }
  return out;
}

/**
 * 진행 중인 제조 주문. 알 수 없는 id·시각이면 통째로 버린다(=유휴로 되접는다) —
 * 반쪽만 남기면 「무엇을 얼마나 기다려야 하는지」를 화면이 지어내야 한다.
 */
function readForgeOrder(raw: unknown): PlayerProfile['forgeOrder'] {
  if (!isRecord(raw)) return undefined;
  const id = raw.equipmentId;
  const startedAt = num(raw.startedAt, NaN);
  if (typeof id !== 'string' || !equipmentById.has(id) || !Number.isFinite(startedAt) || startedAt <= 0) {
    return undefined;
  }
  return { equipmentId: id, startedAt: Math.floor(startedAt) };
}

/**
 * 태학 연구. **줄 단위로 거른다** — 개량형 id가 데이터에서 사라졌거나(주제 개편) 그
 * 개량형이 적힌 레벨의 주제가 아니면 그 줄만 버린다. 한 레벨에 둘이 적혀 있으면 앞의
 * 것만 남긴다(`collectResearch()`의 「레벨마다 하나」). 진행 중인 연구가 이미 끝낸
 * 레벨이면 버린다. 남는 것이 하나도 없으면 `undefined` — 키를 안 만든다(빈 값을 적으면
 * 서버가 「되접은 결과가 저장본과 다르다」로 읽을 때마다 되쓴다).
 */
/**
 * 컬렉션 진행 — 모양만 바로잡는다. **모르는 컬렉션 id는 지우지 않는다** — id가 타이틀에서 나오므로
 * 타이틀을 고치면 옛 id가 「모르는 것」이 되는데, 지우면 되살릴 길이 없다. 점수 · 효과는
 * `COLLECTIONS`를 훑어 내므로 모르는 id는 어차피 세지 않는다.
 */
function readCollection(raw: unknown): CollectionProgress | undefined {
  if (!isRecord(raw)) return undefined;
  const slots: Record<string, number[]> = {};
  if (isRecord(raw.slots)) {
    for (const [id, v] of Object.entries(raw.slots)) {
      if (!Array.isArray(v)) continue;
      const ns = [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
      if (ns.length) slots[id] = ns;
    }
  }
  const completedAt: Record<string, number> = {};
  if (isRecord(raw.completedAt)) {
    for (const [id, v] of Object.entries(raw.completedAt)) {
      if (typeof v === 'number' && Number.isFinite(v)) completedAt[id] = v;
    }
  }
  if (!Object.keys(slots).length && !Object.keys(completedAt).length) return undefined;
  return { slots, completedAt };
}

/**
 * 튜토리얼 진행 — 모르는 id는 버리고 겹친 것은 하나로.
 *
 * **필드가 아예 없는데 이미 대전을 한 계정은 기본 셋을 끝낸 것으로 본다** — 튜토리얼이 생기기 전에 만든 계정이
 * 갑자기 [출정하기]가 잠기면 안 된다. 「대전을 했다」는 계정 전적(AI · 온라인)이 한 판이라도 있는가다.
 * 필드가 한 번 생기면 이 갈래는 다시 안 돈다(빈 배열도 「있다」).
 */
function readTutorial(raw: unknown, storedRecord: unknown): TutorialProgress | undefined {
  if (isRecord(raw) && Array.isArray(raw.done)) {
    return { done: [...new Set(raw.done.filter(isTutorialId))] };
  }
  if (raw === undefined && foughtBefore(storedRecord)) return { done: [...BASIC_TUTORIALS] };
  return undefined;
}

/**
 * **저장된** 계정 전적에 한 판이라도 있는가 — 되접은 전적이 아니라 원본을 본다(2026-10-28). v7이 옛 AI 칸을 버리므로
 * 되접은 것으로 재면 AI 대전만 해 온 옛 계정이 「싸운 적 없다」가 되어 기본 튜토리얼에 다시 갇힌다.
 */
function foughtBefore(stored: unknown): boolean {
  if (!isRecord(stored)) return false;
  return Object.values(stored).some((v) => isRecord(v) && count(v.wins) + count(v.draws) + count(v.losses) > 0);
}

/** 우편함 — 번호 · 기한이 양의 정수가 아니면 버린다. 같은 번호가 둘이면 **받은 쪽**을 남긴다(받은 것을 잊으면 다시 받는다) */
function readMailbox(raw: unknown): MailboxEntry[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<number, MailboxEntry>();
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const { id, exp, claimed } = row;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue;
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) continue;
    const entry = { id, exp, claimed: claimed === true };
    if (!byId.get(id)?.claimed) byId.set(id, entry);
  }
  return [...byId.values()];
}

function readAcademy(raw: unknown): AcademyState | undefined {
  if (!isRecord(raw)) return undefined;
  const topicOk = (tactic: unknown, level: number): tactic is TacticId =>
    typeof tactic === 'string' && tacticById.get(tactic)?.academyLevel === level;
  const done: AcademyDone[] = [];
  for (const d of Array.isArray(raw.done) ? raw.done : []) {
    if (!isRecord(d)) continue;
    const level = num(d.level, NaN);
    const doneAt = num(d.doneAt, NaN);
    if (!topicOk(d.tactic, level) || !Number.isFinite(doneAt) || doneAt <= 0) continue;
    if (done.some((x) => x.level === level)) continue;
    done.push({ level, tactic: d.tactic, doneAt: Math.floor(doneAt) });
  }
  const out: AcademyState = { done };
  const r = raw.research;
  if (isRecord(r)) {
    const level = num(r.level, NaN);
    const startedAt = num(r.startedAt, NaN);
    if (topicOk(r.tactic, level) && Number.isFinite(startedAt) && startedAt > 0
      && !done.some((x) => x.level === level)) {
      out.research = { level, tactic: r.tactic, startedAt: Math.floor(startedAt) };
    }
  }
  const notice = (Array.isArray(raw.notice) ? raw.notice : [])
    .filter((t): t is TacticId => typeof t === 'string' && done.some((d) => d.tactic === t));
  if (notice.length > 0) out.notice = [...new Set(notice)];
  const instant = num(raw.instantUntil, 0);
  const academyMax = BUILDINGS.find((b) => b.id === 'academy')?.maxLevel ?? 1;
  if (Number.isInteger(instant) && instant >= 1) out.instantUntil = Math.min(instant, academyMax);
  return done.length > 0 || out.research || out.notice || out.instantUntil ? out : undefined;
}

/** 파수꾼 칸 — 기물·장수가 알아볼 수 있고 계정에 있는 것만. 겹친 기물은 앞의 것만 남긴다 */
/** 수비군으로 고른 부대 — 모드마다 그 모드의 부대 id만 남긴다. 남는 것이 없으면 `undefined` */
function readGarrison(raw: unknown, profile: PlayerProfile): PlayerProfile['garrison'] {
  if (!isRecord(raw)) return undefined;
  const out: NonNullable<PlayerProfile['garrison']> = {};
  for (const mode of BATTLE_MODES) {
    const id = raw[mode];
    if (typeof id === 'string' && profile.squads.some((s) => s.id === id && s.mode === mode)) out[mode] = id;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readGuards(raw: unknown, profile: PlayerProfile): RosterPick[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RosterPick[] = [];
  for (const g of raw) {
    if (!isRecord(g) || !isPiece(g.piece) || typeof g.officer !== 'string') continue;
    if (!profile.roster[g.officer as OfficerId] || seen.has(g.piece)) continue;
    seen.add(g.piece);
    out.push({ piece: g.piece, officer: g.officer as OfficerId });
  }
  return out;
}

const AI_STATUSES: readonly AiBattleStatus[] = ['matched', 'fighting', 'abandoned'];

/**
 * 서버가 굳힌 AI 대전 — 모양만 거른다. 명단 · 상대의 장수 하나하나가 맞는지는 엔진이 판을 만들 때 본다(`createBattle`).
 * 싸우는 중인데 명단이 없으면 재생할 수 없다 — 통째로 버린다(도적떼와 같다).
 */
function readAiBattle(raw: unknown): AiBattleState | undefined {
  if (!isRecord(raw) || !AI_STATUSES.includes(raw.status as AiBattleStatus)) return undefined;
  if (!(BATTLE_MODES as readonly unknown[]).includes(raw.mode)) return undefined;
  const seed = num(raw.seed, NaN);
  const foe = raw.foe;
  if (!Number.isFinite(seed) || !isRecord(foe) || !Array.isArray(foe.entries) || !Array.isArray(raw.picks)) return undefined;
  const entries = (list: unknown[]): RosterEntry[] =>
    list.filter((e): e is Record<string, unknown> => isRecord(e) && typeof e.officer === 'string' && isPiece(e.piece)) as unknown as RosterEntry[];
  const out: AiBattleState = {
    status: raw.status as AiBattleStatus, mode: raw.mode as BattleMode, seed: Math.floor(seed) >>> 0,
    picks: raw.picks
      .filter((p): p is Record<string, unknown> => isRecord(p) && isPiece(p.piece) && typeof p.officer === 'string')
      .map((p) => ({ piece: p.piece as PieceType, officer: p.officer as OfficerId })),
    squadId: typeof raw.squadId === 'string' ? raw.squadId : null,
    foe: { entries: entries(foe.entries), power: num(foe.power, 0) },
  };
  if (raw.startedAt !== undefined) out.startedAt = Math.floor(num(raw.startedAt, 0));
  if (Array.isArray(raw.entries)) out.entries = entries(raw.entries);
  if (Array.isArray(raw.deploy)) out.deploy = raw.deploy as NonNullable<AiBattleState['deploy']>;
  else if (raw.deploy === null) out.deploy = null;
  if (Array.isArray(raw.intents)) out.intents = raw.intents.filter((i): i is Intent => isRecord(i) && typeof i.t === 'string') as Intent[];
  if (raw.settledAt !== undefined) out.settledAt = Math.floor(num(raw.settledAt, 0));
  // 공성전(2026-10-27) — **여기 없으면 읽을 때마다 버려져** 판이 평범한 AI 대전으로 정산된다(방어 기록도 안 남는다)
  const d = raw.defender;
  if (isRecord(d) && typeof d.uid === 'string' && typeof d.cityName === 'string' && typeof d.squadName === 'string') {
    out.defender = {
      uid: d.uid, cityName: d.cityName, cityLevel: Math.floor(num(d.cityLevel, 1)), squadName: d.squadName,
      deploy: Array.isArray(d.deploy) ? d.deploy as SiegeDefender['deploy'] : null,
    };
  }
  if (out.status === 'fighting' && (!out.entries?.length || out.startedAt === undefined)) return undefined;
  return out;
}

const RAID_STATUSES: readonly RaidStatus[] = ['pending', 'fighting', 'won', 'lost', 'drawn', 'surrendered'];

/**
 * 오늘의 도적떼. 알아볼 수 없으면 **통째로 버린다**(`readForgeOrder`와 같은 규약) —
 * 반쪽만 남기면 마감이나 약탈 기준을 화면이 지어내야 한다. 버려지면 그날은 다시
 * 출몰할 수 있다(서버 소유라 이 길은 수동 SQL 같은 사고에서만 탄다).
 */
function readRaid(raw: unknown): RaidState | undefined {
  if (!isRecord(raw)) return undefined;
  const { day, status } = raw;
  const bandits = num(raw.bandits, NaN);
  const spawnedAt = num(raw.spawnedAt, NaN);
  const grainAtSpawn = num(raw.grainAtSpawn, NaN);
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  if (!RAID_STATUSES.includes(status as RaidStatus)) return undefined;
  if (!Number.isInteger(bandits) || bandits < 1 || bandits > MAX_BANDITS) return undefined;
  if (!Number.isFinite(spawnedAt) || spawnedAt <= 0 || !Number.isFinite(grainAtSpawn) || grainAtSpawn < 0) return undefined;
  const out: RaidState = {
    day, bandits, spawnedAt: Math.floor(spawnedAt), grainAtSpawn: Math.floor(grainAtSpawn), status: status as RaidStatus,
  };
  const b = raw.battle;
  if (isRecord(b) && Array.isArray(b.guards)) {
    const seed = num(b.seed, NaN);
    const startedAt = num(b.startedAt, NaN);
    const guards = b.guards
      .filter((g): g is Record<string, unknown> => isRecord(g) && isPiece(g.piece) && typeof g.officer === 'string')
      .map((g) => ({ piece: g.piece as PieceType, officer: g.officer as OfficerId }));
    if (Number.isFinite(seed) && Number.isFinite(startedAt) && guards.length > 0) {
      out.battle = { seed: Math.floor(seed) >>> 0, startedAt: Math.floor(startedAt), guards };
      // 덧붙여 둔 의도 — **여기서 안 담으면 서버가 읽을 때마다 조용히 버린다**(CLAUDE.md, 컬렉션이 밟았다).
      // 모양만 거른다(`t`가 있는 것). 맞는 수인지는 재생(`replayPrefix`)이 본다
      if (Array.isArray(b.intents)) {
        out.battle.intents = b.intents.filter((i): i is Intent => isRecord(i) && typeof i.t === 'string') as Intent[];
      }
    }
  }
  // 싸우는 중인데 판의 설정이 없으면 재생할 수 없다 — 통째로 버린다
  if (out.status === 'fighting' && !out.battle) return undefined;
  if (raw.loot !== undefined) out.loot = Math.max(0, Math.floor(num(raw.loot, 0)));
  if (raw.settledAt !== undefined) out.settledAt = Math.max(0, Math.floor(num(raw.settledAt, 0)));
  if (isRecord(raw.rewards)) {
    const r = raw.rewards;
    out.rewards = {
      grain: Math.max(0, Math.floor(num(r.grain, 0))),
      materials: Math.max(0, Math.floor(num(r.materials, 0))),
      cards: (Array.isArray(r.cards) ? r.cards : [])
        .filter((c): c is Record<string, unknown> => isRecord(c) && typeof c.officer === 'string' && officerById.has(c.officer))
        .map((c) => ({ officer: c.officer as OfficerId, grade: officerById.get(c.officer as string)!.grade as Grade })),
    };
  }
  return out;
}

/** `sq12` → 12. 손으로 지은 id면 0이라 `squadSeq`가 뒤로 가지 않는다 */
function seqOfSquadId(id: string): number {
  const n = Number.parseInt(id.replace(/^sq/, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 대전 이력. 되접을 수 없는 줄은 그 줄만 빠진다 — 한 줄 때문에 이력을 통째로 버리지 않는다 */
function readMatches(raw: unknown, version: number): MatchRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: MatchRow[] = [];
  for (const value of raw) {
    if (!isRecord(value)) continue;
    // v6 이하의 AI 대전 줄은 버린다 — 이제 이력에 안 남는 판이다
    const opponent = opponentOf(value.opponent, version);
    if (!opponent || !isMode(value.mode) || !isResult(value.result)) continue;
    const picks: MatchPick[] = (Array.isArray(value.picks) ? value.picks : [])
      .filter((p): p is Record<string, unknown> => isRecord(p))
      .filter((p) => isPiece(p.piece) && typeof p.officer === 'string' && officerById.has(p.officer))
      .map((p) => ({
        piece: p.piece as PieceType, officer: p.officer as OfficerId, kills: count(p.kills),
      }));
    rows.push({
      seq: Math.max(0, Math.floor(num(value.seq, 0))),
      at: Math.max(0, Math.floor(num(value.at, 0))),
      mode: value.mode,
      opponent,
      opponentId: typeof value.opponentId === 'string' ? value.opponentId : null,
      mySquad: typeof value.mySquad === 'string' ? value.mySquad : null,
      theirSquad: typeof value.theirSquad === 'string' ? value.theirSquad : null,
      myPower: Math.max(0, num(value.myPower, 0)),
      theirPower: Math.max(0, num(value.theirPower, 0)),
      chance: Math.min(1, Math.max(0, num(value.chance, 0))),
      result: value.result,
      picks,
    });
  }
  // 저장된 차례를 믿지 않고 다시 세운다. 꼬리는 상한만큼만 남긴다(브라우저 저장 동안)
  rows.sort((a, b) => a.seq - b.seq);
  return rows.slice(-MATCH_LOG_CAP);
}

/**
 * v1의 평면 배열 둘을 레벨별로 되접는다 ★ 이 세션의 핵심이다.
 *
 * ```
 * v1   statPicks ['hp','hp','at','hp','mp','at','hp','hp']            길이 8 = Lv9
 *      tactics   ['공포','반감','회복','결계','화계','진화','수계','매립','선공','초선']  길이 10
 *
 * v2   growth[4] = { stat:'mp', tactics:['화계','진화'] }   ← Lv6의 지원은 한 쌍이다
 * ```
 *
 * **어디까지가 Lv6분인지는 책략 자신이 알려 준다.** 남은 것의 첫 id로 school을
 * 알아내고, 그 레벨의 같은 school 전부를 한 묶음으로 가져간다 — `applyLevelUp`이
 * 짝을 나란히 push했으므로 순서가 보존되어 정확히 갈린다.
 *
 * > **레벨 수를 `statPicks` 쪽으로 센다.** v1 주석에도 「세는 기준은 `statPicks`」라고
 * > 적혀 있고, 무엇보다 능력 선택은 한 레벨에 정확히 하나다. 저장된 `level`이
 * > 그보다 크면(손상) **레벨이 내려간다** — 그런 계정은 지금도 `createBattle`이
 * > 던져 전투에 못 들어가므로 이미 죽어 있다. 버리는 대신 되살릴 수 있는 만큼 되살린다.
 */
function foldV1(raw: OfficerInstanceV1): GrowthStep[] {
  const picks = Array.isArray(raw.statPicks) ? raw.statPicks : [];
  // **모르는 id도 버리지 않는다** — 없어진 책략(수계·매립)이 저장에 남아 있고,
  // 그것을 지워 버리면 커서가 밀려 뒤쪽 레벨이 통째로 어긋난다(`STORED_LAYOUT` 참조).
  const flat = (Array.isArray(raw.tactics) ? raw.tactics : [])
    .filter((t): t is TacticId => typeof t === 'string');

  const steps: GrowthStep[] = [];
  let cursor = 0;
  for (const [i, pick] of picks.entries()) {
    if (!isStatPick(pick)) break;   // 알 수 없는 능력이 나오면 거기서 멈춘다(레벨이 내려간다)
    const lv = i + 2;
    const head = flat[cursor];
    const school = head ? storedSchoolOf(head) : undefined;
    // 책략이 모자라면 빈 단계를 만들지 않는다 — `checkGrowth`가 거부할 스택이 된다
    if (!school) break;
    const group = tacticsForLevel(lv).filter((t) => t.school === school).map((t) => t.id as TacticId);
    if (group.length === 0) break;
    steps.push({ stat: pick, tactics: group });
    // **지금 데이터의 개수(`group.length`)로 건너뛰지 않는다.** 저장된 배열은 저장될
    // 당시의 개수로 채워져 있다 — Lv6·7이 둘씩이던 시절의 저장을 하나씩 건너뛰면
    // 그 뒤가 전부 한 칸씩 밀린다. 「저장 당시의 레벨·계열」로 먹는다.
    while (cursor < flat.length) {
      const meta = STORED_LAYOUT[flat[cursor]!];
      if (!meta || meta.level !== lv || meta.school !== school) break;
      cursor += 1;
    }
  }
  return steps;
}

/** 이미 v2인 스택을 다시 읽는다 — 멱등을 위해 되접기와 **같은 검산**을 지난다 */
function readGrowth(rows: readonly unknown[]): GrowthStep[] {
  const steps: GrowthStep[] = [];
  for (const [i, row] of rows.entries()) {
    if (!isRecord(row) || !isStatPick(row.stat)) break;
    const lv = i + 2;
    const tactics = (Array.isArray(row.tactics) ? row.tactics : [])
      .filter((t): t is TacticId => typeof t === 'string');
    // 없어진 책략(수계·매립)만 남은 단계도 **계열은 안다** — `storedSchoolOf`가
    // 그것을 알려 주므로 그 레벨의 지금 책략으로 갈아 끼운다. 여기서 멈추면
    // Lv7에 수계를 찍었던 계정이 Lv6으로 내려앉는다.
    const school = tactics[0] ? storedSchoolOf(tactics[0]) : undefined;
    if (!school) break;
    const group = tacticsForLevel(lv).filter((t) => t.school === school).map((t) => t.id as TacticId);
    if (group.length === 0) break;
    steps.push({ stat: row.stat, tactics: group });
  }
  return steps;
}

/**
 * **저장된 적이 있는** 책략의 계열·레벨 (2026-09-03).
 *
 * 지금 데이터(`tactics.json`)에 없거나 자리가 옮겨진 것만 적는다 — 나머지는
 * 데이터가 곧 정본이다. 2026-09-03에 「수계·매립」을 지우고(진입 불가 지형이
 * 판을 막아 결착이 안 나는 판을 만들 수 있었다) 「진화」를 Lv6에서 Lv7로 옮겼다.
 *
 * **되접기에만 쓴다.** 게임 규칙은 지금 데이터만 본다 — 여기 적힌 것은
 * 「옛 저장이 무엇을 뜻했는가」이지 「지금 무엇을 할 수 있는가」가 아니다.
 */
const STORED_LAYOUT: Record<string, { school: 'support' | 'illusion'; level: number }> = {
  ...Object.fromEntries(TACTICS.map((t) => [t.id, { school: t.school, level: t.level }])),
  'jin-hwa': { school: 'support', level: 6 },   // 지금은 Lv7
  'su-gye': { school: 'support', level: 7 },    // 삭제됨
  'mae-rip': { school: 'support', level: 7 },   // 삭제됨
};

/** 저장에 남은 id의 계열. 지금 데이터에 없어도 안다(위 표) */
const storedSchoolOf = (id: string): 'support' | 'illusion' | undefined =>
  tacticById.get(id)?.school ?? STORED_LAYOUT[id]?.school;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStatPick = (v: unknown): v is StatPick => v === 'hp' || v === 'mp' || v === 'at';

const isOpponent = (v: unknown): v is OpponentKind =>
  typeof v === 'string' && (OPPONENT_KINDS as readonly string[]).includes(v);

/**
 * 저장된 전적 갈래를 지금 것으로 (v7, 2026-10-28 기획자 확정). v6 이하의 `online`은 **야전**이 되고 `ai`는 버린다 —
 * 순수 AI 대전은 이제 안 센다. 단계 2(2026-10-27)부터 공성전도 `online`으로 적혔지만 갈라낼 표시가 없어 야전에 남는다(배포 전 개발 데이터뿐).
 */
function opponentOf(v: unknown, version: number): OpponentKind | null {
  if (version >= 7) return isOpponent(v) ? v : null;
  return v === 'online' ? 'field' : null;
}

const isMode = (v: unknown): v is BattleMode =>
  typeof v === 'string' && (BATTLE_MODES as readonly string[]).includes(v);

const isPiece = (v: unknown): v is PieceType =>
  typeof v === 'string' && (PIECE_TYPES as readonly string[]).includes(v);

const isResult = (v: unknown): v is BattleResult =>
  v === 'win' || v === 'draw' || v === 'lose';

/** 셀 수 있는 값으로. 음수·소수·쓰레기는 0이다 */
const count = (v: unknown): number => Math.max(0, Math.floor(num(v, 0)));

const num = (v: unknown, fallback: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.floor(v)));
