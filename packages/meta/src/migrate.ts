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

import { officerById, tacticById, tacticsForLevel } from '@samchess/data';
import type { BattleMode, OfficerId, PieceType, TacticId } from '@samchess/rules';
import { PROFILE_VERSION, checkGrowth, cityLevel } from './profile.ts';
import { BATTLE_MODES, MATCH_LOG_CAP, OPPONENT_KINDS, emptyTally } from './records.ts';
import { PIECE_TYPES } from './roster.ts';
import type {
  BattleResult, GrowthStep, MatchPick, MatchRow, OfficerInstance, OpponentKind,
  PlayerProfile, RecordTally, StatPick,
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

  const cityLv = clampInt(num(raw.cityLevel, 1), 1, 9);
  const profile: PlayerProfile = {
    version: PROFILE_VERSION,
    cityName: typeof raw.cityName === 'string' && raw.cityName.trim() ? raw.cityName : '무명성',
    cityLevel: cityLv,
    // ── 필드가 더해지는 변경은 **여기 한 줄씩** 붙는다 (C2의 도시, E의 부대) ──
    grain: clampInt(num(raw.grain, 0), 0, cityLevel(cityLv).grainCap),
    gold: Math.max(0, Math.floor(num(raw.gold, 0))),
    materials: Math.max(0, Math.floor(num(raw.materials, 0))),
    roster: {},
    cards: {},
    // 계정 전적·이력은 v3에서 생겼다. v2 이하는 빈 채로 시작한다
    record: readRecord(raw.record, 2),
    matches: [],
    matchSeq: 1,
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
  const flat = (Array.isArray(raw.tactics) ? raw.tactics : [])
    .filter((t): t is TacticId => typeof t === 'string' && tacticById.has(t));

  const steps: GrowthStep[] = [];
  let cursor = 0;
  for (const [i, pick] of picks.entries()) {
    if (!isStatPick(pick)) break;   // 알 수 없는 능력이 나오면 거기서 멈춘다(레벨이 내려간다)
    const lv = i + 2;
    const head = flat[cursor];
    const school = head ? tacticById.get(head)?.school : undefined;
    // 책략이 모자라면 빈 단계를 만들지 않는다 — `checkGrowth`가 거부할 스택이 된다
    if (!school) break;
    const group = tacticsForLevel(lv).filter((t) => t.school === school).map((t) => t.id as TacticId);
    if (group.length === 0) break;
    steps.push({ stat: pick, tactics: group });
    cursor += group.length;
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
      .filter((t): t is TacticId => typeof t === 'string' && tacticById.has(t));
    const school = tactics[0] ? tacticById.get(tactics[0])?.school : undefined;
    if (!school) break;
    const group = tacticsForLevel(lv).filter((t) => t.school === school).map((t) => t.id as TacticId);
    if (group.length === 0) break;
    steps.push({ stat: row.stat, tactics: group });
  }
  return steps;
}

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
