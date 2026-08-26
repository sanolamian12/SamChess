/**
 * 부대 편성 · 배치 프리셋 (pptx 42·43쪽 · GDD §5 · §8.6, 2026-08-18)
 *
 * ```
 * 참여인원   편성 명      전투력   구성
 *  3 vs 3    초전박살      843     조조, 관흥, 능통
 *  5 vs 5    후반공격     1102     조조, 능통, …
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 판정을 두 벌 만들지 않는다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * `validateSquad()`는 **`validateRoster()`를 감싼다.** 「King 필수」·「기물 중복
 * 불허」·「보유하지 않은 장수」는 이미 그쪽이 말하고, 그 위에 부대만의 것(이름·모드
 * 일치·레벨 범위)을 보탠다. 편성 검증과 룰 엔진이 갈리면 안 된다는 계약
 * (「`validateRoster`를 통과한 편성은 `createBattle`도 받아들인다」)이 그대로 확장된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 레벨은 「상한」이지 「스냅샷」이 아니다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 부대는 자기 장수를 **일부러 낮춰** 전투력을 내리고 약한 상대와 매칭될 수 있다
 * (§5-1). 낮춘 레벨의 능력치·책략은 새로 정하는 것이 아니라 **성장 스택에서
 * 그대로 꺼낸다** — `growthUpTo(inst, cap)`의 `slice` 한 줄이고, 그래서 하향 Lv5는
 * 처음부터 Lv5로 키운 캐릭터와 **완전히 같다**(회귀가 고정한다).
 *
 * 눌러 담는 자리는 `toRosterEntries()` 하나다. 재설계로 보유 레벨이 내려가도
 * 저장된 부대는 저절로 따라 내려가고 **언제나 `createBattle`을 통과한다.**
 *
 * ────────────────────────────────────────────────────────────────
 * 배치 프리셋은 **어긋나면 조용히 물러난다**
 * ────────────────────────────────────────────────────────────────
 *
 * 배치 구역은 모드마다(참여 수 × 5열) 다르고 진영마다(위 5행 / 아래 5행) 다르다.
 * 구성을 고치면 저장해 둔 좌표가 어긋나는데, 그때 화면을 막을 이유가 없다 —
 * 엔진이 어차피 5×5 중앙에 세우고(`defaultDeployPos`) 사람은 30초 동안 고친다.
 * 그래서 `squadDeployment()`는 던지지 않고 **`null`**을 준다.
 */

import { officerById } from '@samchess/data';
import { defaultDeployPos, deployZone, inZone } from '@samchess/rules';
import type { BattleMode, Grade, OfficerId, PieceType, Side, UnitId, Vec2 } from '@samchess/rules';
import { squadCap } from './city.ts';
import { statsOf } from './profile.ts';
import { pickLevel, teamSize, toRosterEntries, validateRoster } from './roster.ts';
import { battlePower } from './power.ts';
import type {
  MetaResult, PlayerProfile, RosterPick, Squad, SquadCell,
} from './types.ts';

/** 부대 이름의 최대 길이 (§5-7). **단일 출처** — 화면이 `12`를 다시 적지 않는다 */
export const SQUAD_NAME_MAX = 12;

/** 배치 프리셋을 저장하는 두 진영. `P1 = 남군(아래)` · `P2 = 북군(위)` (`deployZone`) */
export const SQUAD_SIDES: readonly Side[] = ['P1', 'P2'];

/** 새 부대·수정에 들어오는 값. `id`는 규칙이 붙인다 */
export interface SquadDraft {
  name: string;
  mode: BattleMode;
  picks: RosterPick[];
  deploy?: Squad['deploy'];
}

const no = (reason: string): MetaResult => ({ ok: false, reason });

/** 이름은 앞뒤 공백을 떼고 본다 — 「조조군 」과 「조조군」이 다른 부대가 되면 안 된다 */
export const normalizeSquadName = (name: string): string => name.trim();

// ── 조회 ───────────────────────────────────────────────────────

export const squadById = (profile: PlayerProfile, id: string): Squad | undefined =>
  profile.squads.find((s) => s.id === id);

/**
 * 부대 목록. `mode`를 주면 그 모드만.
 *
 * **모드로 갈라 볼 수 있어야 한다** — 3v3과 5v5는 계수가 달라 값 범위가 겹치는데
 * (3v3 209~1304 · 5v5 253~1302) 나란히 놓으면 비교하고 싶어진다(GDD §7.1).
 * 42쪽 목록도 이 함수를 모드마다 불러 **묶음으로 나눠** 그린다.
 */
export const squadsOf = (profile: PlayerProfile, mode?: BattleMode): Squad[] =>
  (mode ? profile.squads.filter((s) => s.mode === mode) : [...profile.squads]);

// ── 검증 ───────────────────────────────────────────────────────

/**
 * 이름이 쓸 수 있는가 — 빈 이름 · 12자 초과 · 중복.
 *
 * `exceptId`는 **수정 중인 자기 자신**이다. 없으면 이름을 그대로 두고 구성만 고치는
 * 것이 「중복」으로 막힌다.
 */
export function validateSquadName(
  profile: PlayerProfile, name: string, exceptId?: string,
): MetaResult {
  const trimmed = normalizeSquadName(name);
  if (!trimmed) return no('부대 이름을 입력해주세요.');
  if ([...trimmed].length > SQUAD_NAME_MAX) {
    return no(`부대 이름은 ${SQUAD_NAME_MAX}자까지다 — 지금 ${[...trimmed].length}자`);
  }
  const clash = profile.squads.some((s) => s.id !== exceptId && s.name === trimmed);
  if (clash) return no(`같은 이름의 부대가 이미 있다 — 「${trimmed}」`);
  return { ok: true };
}

/**
 * 부대가 성립하는가. **`validateRoster()`를 감싼다** — 판정을 두 벌 만들지 않는다.
 *
 * 군량은 보지 않는다(`checkGrain = false`). 부대는 저장해 두는 것이고 참가비는
 * 출전할 때 내기 때문이다 — 편성 도중에 「군량이 모자란다」를 띄우면 방해만 된다.
 */
export function validateSquad(
  profile: PlayerProfile, draft: SquadDraft, exceptId?: string,
): MetaResult {
  const nameCheck = validateSquadName(profile, draft.name, exceptId);
  if (!nameCheck.ok) return nameCheck;

  const rosterCheck = validateRoster(profile, draft.mode, draft.picks, false);
  if (!rosterCheck.ok) return rosterCheck;

  // 레벨은 **1 이상**이면 된다. 보유 레벨보다 크면 `toRosterEntries()`가 눌러 담으므로
  // (약해지는 방향이라 안전하다) 여기서 막지 않는다 — 재설계 뒤 부대가 죽지 않는다.
  for (const pick of draft.picks) {
    if (pick.level !== undefined && (!Number.isInteger(pick.level) || pick.level < 1)) {
      const who = officerById.get(pick.officer)?.name ?? pick.officer;
      return no(`레벨이 이상하다 — ${who} Lv${pick.level}`);
    }
  }
  return { ok: true };
}

/** 부대를 더 만들 수 있는가. **상한은 도시 레벨이 정한다** (`squadCap`) */
export function canAddSquad(profile: PlayerProfile): MetaResult {
  const cap = squadCap(profile);
  if (profile.squads.length >= cap) {
    return no(`부대는 ${cap}개까지다 — 도시를 증축하면 늘어난다`);
  }
  return { ok: true };
}

// ── 만들기 · 고치기 · 지우기 ────────────────────────────────────

/**
 * 부대를 하나 만든다. **id는 `squadSeq`가 준다** — 지운 번호를 다시 쓰지 않는다.
 *
 * 만든 부대를 곧바로 열어야 하므로 프로필과 함께 돌려준다.
 */
export function addSquad(
  profile: PlayerProfile, draft: SquadDraft,
): { profile: PlayerProfile; squad: Squad } {
  const room = canAddSquad(profile);
  if (!room.ok) throw new Error(room.reason);
  const check = validateSquad(profile, draft);
  if (!check.ok) throw new Error(`부대를 만들 수 없다: ${check.reason}`);

  const squad: Squad = {
    id: `sq${profile.squadSeq}`,
    name: normalizeSquadName(draft.name),
    mode: draft.mode,
    picks: draft.picks.map(normalizePick),
    deploy: draft.deploy ?? { P1: null, P2: null },
    record: {},
  };
  return {
    profile: { ...profile, squads: [...profile.squads, squad], squadSeq: profile.squadSeq + 1 },
    squad,
  };
}

/** 부대를 갈아 끼운다. **id·모드는 안 바뀐다** — 모드가 바뀌면 배치도 구성도 뜻이 없어진다 */
export function updateSquad(profile: PlayerProfile, id: string, draft: SquadDraft): PlayerProfile {
  const before = squadById(profile, id);
  if (!before) throw new Error(`없는 부대다: ${id}`);
  if (before.mode !== draft.mode) throw new Error('부대의 참여 인원은 바꿀 수 없다 — 새로 만든다');
  const check = validateSquad(profile, draft, id);
  if (!check.ok) throw new Error(`부대를 고칠 수 없다: ${check.reason}`);

  const next: Squad = {
    ...before,
    name: normalizeSquadName(draft.name),
    picks: draft.picks.map(normalizePick),
    deploy: draft.deploy ?? before.deploy,
  };
  return { ...profile, squads: profile.squads.map((s) => (s.id === id ? next : s)) };
}

export function removeSquad(profile: PlayerProfile, id: string): PlayerProfile {
  return { ...profile, squads: profile.squads.filter((s) => s.id !== id) };
}

const normalizePick = (pick: RosterPick): RosterPick =>
  (pick.level === undefined
    ? { piece: pick.piece, officer: pick.officer }
    : { piece: pick.piece, officer: pick.officer, level: pick.level });

// ── 42쪽 목록의 한 줄 ──────────────────────────────────────────

/** 목록·수정 화면의 멤버 한 명 */
export interface SquadMember {
  piece: PieceType;
  officer: OfficerId;
  name: string;
  grade: Grade;
  /** **실제로 설 레벨** — 보유 레벨로 눌러 담은 값이다 */
  level: number;
  /** 이 장수의 보유 레벨. 하향 눈금의 위 끝이다 */
  maxLevel: number;
  stats: { hp: number; mp: number; at: number };
}

/**
 * 42쪽 목록의 한 줄 — 「참여인원 · 편성 명 · 전투력 · 구성」.
 *
 * **화면은 고르기만 하고 숫자를 만들지 않는다.** 전투력은 `battlePower()`가 내고
 * (`power.ts`의 실측 계수), 「구성」은 여기서 편 멤버를 화면이 이어 쓴다.
 */
export interface SquadRow {
  squad: Squad;
  members: SquadMember[];
  /** **성립하지 않는 부대는 `null`이다** — 화면이 `battlePower`의 예외를 막지 않아도 된다 */
  power: number | null;
  /** 성립하지 않는 이유. 성립하면 `null` */
  problem: string | null;
}

export function squadRow(profile: PlayerProfile, squad: Squad): SquadRow {
  const members: SquadMember[] = [];
  for (const pick of squad.picks) {
    const inst = profile.roster[pick.officer];
    const data = officerById.get(pick.officer);
    if (!inst || !data) continue;   // 계정에서 빠진 장수 — 아래 `problem`이 말한다
    const level = pickLevel(inst, pick.level);
    members.push({
      piece: pick.piece,
      officer: pick.officer,
      name: data.name,
      grade: data.grade,
      level,
      maxLevel: inst.level,
      stats: statsOf(inst, level),
    });
  }

  const check = validateSquad(profile, squad, squad.id);
  return {
    squad,
    members,
    power: check.ok ? squadPower(profile, squad) : null,
    problem: check.ok ? null : check.reason,
  };
}

/**
 * 부대 전투력. **성립하지 않으면 `null`.**
 *
 * `battlePower()`는 인원이 안 맞으면 던진다(3v3과 5v5를 같은 자로 재는 사고를 막는
 * 계약이다). 목록은 망가진 부대도 그려야 하므로 여기서 한 번 걸러 준다 —
 * 화면마다 `try`를 두게 하면 언젠가 한 곳이 빠진다.
 */
export function squadPower(profile: PlayerProfile, squad: Squad): number | null {
  if (!validateSquad(profile, squad, squad.id).ok) return null;
  return battlePower(squad.mode, toRosterEntries(profile, squad.picks));
}

// ── 배치 프리셋 ────────────────────────────────────────────────

/**
 * 부대의 기본 배치 — **엔진이 세우는 바로 그 자리다**(`defaultDeployPos`).
 *
 * 편집기의 「기본 배치로」가 이걸 부른다. 화면이 `5×5의 중앙`을 다시 적으면
 * 배치 구역 규칙이 바뀌었을 때 **미리보기만** 조용히 어긋난다.
 */
export function defaultSquadCells(mode: BattleMode, side: Side, picks: readonly RosterPick[]): SquadCell[] {
  return picks.map((pick, i) => {
    const { x, y } = defaultDeployPos(mode, side, i);
    return { piece: pick.piece, x, y };
  });
}

/**
 * 저장된 배치를 엔진의 `deploy` 의도로 편다. **어긋나면 `null`.**
 *
 * 보는 것 넷 — ① 지금 구성의 기물과 정확히 짝이 맞는가 ② 인원이 맞는가
 * ③ 배치 구역 안인가 ④ 두 유닛이 같은 칸에 있지 않은가. 하나라도 어긋나면
 * **아무 말 없이 물러난다**(엔진의 기본 배치가 깔린다).
 *
 * `deploy` 의도는 **전원의 자리를 한 번에** 받으므로 부분 프리셋이라는 것이 없다.
 */
export function squadDeployment(
  profile: PlayerProfile, squad: Squad, side: Side,
): { unit: UnitId; pos: Vec2 }[] | null {
  const cells = squad.deploy[side];
  if (!cells || cells.length !== teamSize(squad.mode)) return null;
  if (!validateSquad(profile, squad, squad.id).ok) return null;

  const want = new Set(squad.picks.map((p) => p.piece));
  const zone = deployZone(squad.mode, side);
  const seenPiece = new Set<PieceType>();
  const seenCell = new Set<string>();
  const out: { unit: UnitId; pos: Vec2 }[] = [];

  for (const cell of cells) {
    if (!want.has(cell.piece) || seenPiece.has(cell.piece)) return null;
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) return null;
    const pos = { x: cell.x, y: cell.y };
    if (!inZone(zone, pos)) return null;
    const key = `${pos.x},${pos.y}`;
    if (seenCell.has(key)) return null;
    seenPiece.add(cell.piece);
    seenCell.add(key);
    // 유닛 id는 `${진영}-${기물}` — 엔진이 그렇게 짓는다. 위치 배열이 아니라
    // 기물을 키로 든 것이 여기서 값을 한다(구성을 고쳐도 짝이 안 어긋난다)
    out.push({ unit: `${side}-${cell.piece}` as UnitId, pos });
  }
  return seenPiece.size === want.size ? out : null;
}

/** 배치 프리셋을 갈아 끼운다. `null`을 주면 「저장 안 함」(= 기본 배치) */
export function withDeployment(squad: Squad, side: Side, cells: SquadCell[] | null): Squad {
  return { ...squad, deploy: { ...squad.deploy, [side]: cells ? cells.map((c) => ({ ...c })) : null } };
}

/**
 * 저장할 수 있는 배치인가 — 편집기가 [저장]을 켤지 정할 때 쓴다.
 *
 * `squadDeployment()`와 **같은 검사**를 지나야 한다. 여기서만 통과하고 저쪽에서
 * 걸리면 「저장은 됐는데 전투에서는 기본 배치」가 되어 아무도 못 찾는다.
 */
export function isDeployable(
  profile: PlayerProfile, squad: Squad, side: Side, cells: SquadCell[],
): boolean {
  return squadDeployment(profile, withDeployment(squad, side, cells), side) !== null;
}
