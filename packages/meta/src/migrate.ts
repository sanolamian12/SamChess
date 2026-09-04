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

import { BUILDINGS, TACTICS, officerById, tacticById, tacticsForLevel } from '@samchess/data';
import type { BuildingId } from '@samchess/data';
import { UNITS_PER_SIDE } from '@samchess/rules';
import type { BattleMode, OfficerId, PieceType, TacticId } from '@samchess/rules';
import { PROFILE_VERSION, checkGrowth } from './profile.ts';
import {
  BUILD_ACTIONS_PER_UPGRADE, MAX_CITY_LEVEL, buildingValue, initialBuildings,
} from './city.ts';
import { BATTLE_MODES, MATCH_LOG_CAP, OPPONENT_KINDS, emptyTally } from './records.ts';
import { PIECE_TYPES } from './roster.ts';
import { SQUAD_NAME_MAX } from './squads.ts';
import type {
  BattleResult, GrowthStep, MatchPick, MatchRow, OfficerInstance, OpponentKind,
  PlayerProfile, RecordTally, RosterPick, Squad, SquadCell, StatPick,
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
    buildCredits: readCredits(raw.buildCredits, cityLv, buildings),
    hospitalBusy: readBusy(raw.hospitalBusy),
    roster: {},
    cards: {},
    // 계정 전적·이력은 v3에서 생겼다. v2 이하는 빈 채로 시작한다
    record: readRecord(raw.record, 2),
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
  };

  const roster = isRecord(raw.roster) ? raw.roster : {};
  for (const [id, value] of Object.entries(roster)) {
    // 데이터에서 사라진 장수는 지운다 — 이름이 정정되면 id가 갈린다(GDD §9 「장요→장료」).
    // 남겨 두면 편성 화면에 이름 없는 칸이 뜬다.
    if (!officerById.has(id)) continue;
    const inst = migrateInstance(id as OfficerId, value);
    if (inst) profile.roster[id as OfficerId] = inst;
  }

  const cards = isRecord(raw.cards) ? raw.cards : {};
  for (const [id, value] of Object.entries(cards)) {
    if (!officerById.has(id)) continue;
    const n = Math.floor(num(value, 0));
    if (n > 0) profile.cards[id as OfficerId] = n;
  }

  // 부대는 **장수를 다 읽은 뒤에** 읽는다 — 계정에서 빠진 장수를 가리키는 부대를
  // 걸러 내려면 `profile.roster`가 이미 채워져 있어야 한다
  profile.squads = readSquads(raw.squads, profile);
  profile.squadSeq = Math.max(
    Math.floor(num(raw.squadSeq, 0)),
    profile.squads.reduce((n, s) => Math.max(n, seqOfSquadId(s.id) + 1), 1),
  );

  profile.matches = readMatches(raw.matches);
  // 줄 번호는 **뒤로 가지 않는다.** 덜어 낸 줄의 번호를 다시 쓰면 이력의 순서가 뒤집힌다
  profile.matchSeq = Math.max(
    Math.floor(num(raw.matchSeq, 0)),
    profile.matches.reduce((n, row) => Math.max(n, row.seq + 1), 1),
  );

  return profile;
}

/** 장수 하나. 되접을 수 없을 만큼 망가졌으면 `null`(그 장수만 빠진다) */
function migrateInstance(officer: OfficerId, value: unknown): OfficerInstance | null {
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
    record: readRecord(raw.record, 3),
  };
}

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
function readRecord(raw: unknown, arity: 2 | 3): Record<string, RecordTally> {
  const out: Record<string, RecordTally> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const parts = key.split('/');
    if (parts.length !== arity) continue;
    if (!isOpponent(parts[0]) || !isMode(parts[1])) continue;
    if (arity === 3 && !isPiece(parts[2])) continue;
    const cell = emptyTally();
    cell.wins = count(value.wins);
    cell.draws = count(value.draws);
    cell.losses = count(value.losses);
    cell.kills = count(value.kills);
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
 * **레벨은 버리지 않고 눌러 담는다.** 재설계로 보유 레벨이 내려간 부대는 살아 있어야
 * 한다 — 실제로 서는 레벨은 `toRosterEntries()`가 정한다.
 *
 * **배치 프리셋은 여기서 검증하지 않는다.** 모드·구성·구역을 함께 봐야 하는데 그
 * 판정은 `squadDeployment()` 하나에 있고, 어긋나면 전투에서 조용히 기본 배치로
 * 물러난다 — 되접기가 미리 지우면 사람이 고칠 기회까지 사라진다.
 */
function readSquads(raw: unknown, profile: PlayerProfile): Squad[] {
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
      const level = Math.floor(num(p.level, 0));
      picks.push(level >= 1
        ? { piece: p.piece, officer: p.officer as OfficerId, level }
        : { piece: p.piece, officer: p.officer as OfficerId });
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
      record: readRecord(value.record, 2),
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
 * 받은 것은 `도시 레벨 × BUILD_ACTIONS_PER_UPGRADE`(Lv1의 몫도 포함), 쓴 것은
 * 지어 놓은 칸 수다. v3 계정은 `readBuildings()`가 「지을 수 있었던 만큼」 지어
 * 두므로 대개 정확히 0이 나온다 — 그래야 되접기가 기회를 공짜로 주지 않는다.
 */
function readCredits(raw: unknown, cityLv: number, built: Record<BuildingId, number>): number {
  const v = num(raw, NaN);
  if (Number.isFinite(v)) return Math.max(0, Math.floor(v));
  const granted = cityLv * BUILD_ACTIONS_PER_UPGRADE;
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

/** `sq12` → 12. 손으로 지은 id면 0이라 `squadSeq`가 뒤로 가지 않는다 */
function seqOfSquadId(id: string): number {
  const n = Number.parseInt(id.replace(/^sq/, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 대전 이력. 되접을 수 없는 줄은 그 줄만 빠진다 — 한 줄 때문에 이력을 통째로 버리지 않는다 */
function readMatches(raw: unknown): MatchRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: MatchRow[] = [];
  for (const value of raw) {
    if (!isRecord(value)) continue;
    if (!isOpponent(value.opponent) || !isMode(value.mode) || !isResult(value.result)) continue;
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
      opponent: value.opponent,
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
