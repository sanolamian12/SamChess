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
 * 일치)을 보탠다. 편성 검증과 룰 엔진이 갈리면 안 된다는 계약
 * (「`validateRoster`를 통과한 편성은 `createBattle`도 받아들인다」)이 그대로 확장된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 부대는 장수의 「소속」이지 「스냅샷」이 아니다 ★ (2026-09-16 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * 부대는 기물과 장수의 짝만 저장한다. 한 장수가 여러 부대에 동시에 소속될 수 있고,
 * 어느 부대에서든 **지금 보유 레벨 그대로** 선다 — 레벨·능력 선택·책략은 궁궐
 * (레벨업·둔갑천서)에서만 바뀐다. 레벨업이 모든 부대에 곧바로 반영되고, 재설계로
 * 레벨이 내려가도 저장된 부대는 **언제나 `createBattle`을 통과한다.**
 *
 * 예전의 「하향 눈금」(부대마다 레벨을 낮춰 약한 상대와 붙기)은 걷어 냈다 — 레벨업이
 * 부대에 반영 안 된 것처럼 보이고 부대마다 손으로 올려야 했다.
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
import { teamSize, toRosterEntries, validateRoster } from './roster.ts';
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

  return validateRoster(profile, draft.mode, draft.picks, false);
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
  /** 만든 시각 — **화면이 넣는다**(meta는 시계를 안 읽는다). 없으면 안 적는다 */
  nowMs?: number,
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
    ...(nowMs !== undefined ? { createdAt: nowMs } : {}),
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

/**
 * 저장하는 것은 **기물과 장수 둘뿐이다.** 화면·옛 코드가 다른 키(예: 옛 `level`)를
 * 얹어 보내도 여기서 떨어진다 — 부대에 레벨이 다시 스며들 자리를 막는다.
 */
const normalizePick = (pick: RosterPick): RosterPick =>
  ({ piece: pick.piece, officer: pick.officer });

// ── 42쪽 목록의 한 줄 ──────────────────────────────────────────

/** 목록·수정 화면의 멤버 한 명 */
export interface SquadMember {
  piece: PieceType;
  officer: OfficerId;
  name: string;
  grade: Grade;
  /** 보유 레벨 — 부대는 레벨을 들지 않으므로 언제나 장수의 지금 레벨이다 */
  level: number;
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
    members.push({
      piece: pick.piece,
      officer: pick.officer,
      name: data.name,
      grade: data.grade,
      level: inst.level,
      stats: statsOf(inst),
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

// ── 부대원을 고친 뒤의 배치 (2026-09-17, pptx 68·69쪽) ──────────

/**
 * 부대원을 고친 뒤 **저장된 배치를 줄 차례대로 물려준다.**
 *
 * ```
 * 전: King(3,17) · Rock(8,17)  · Queen(13,17)
 * 후: King       · Knight      · Rock
 *  →  King(3,17) · Knight(8,17) · Rock(13,17)
 * ```
 *
 * i번째 줄의 새 기물이 **i번째 줄 옛 기물의 자리**에 선다(기획자 지정). 기물이 키인
 * 프리셋(`SquadCell.piece`)을 그대로 두면 바뀐 기물의 좌표를 찾을 수 없어 `squadDeployment()`가
 * 통째로 `null`을 주고, 사람이 공들인 배치가 **조용히 기본 배치로** 돌아간다.
 *
 * 편집 화면은 이것을 부르고 **곧바로 배치 편집으로 보낸다** — 옮긴 결과를 사람이
 * 눈으로 확인하고 확정하는 것이 흐름이다(새 부대 만들기와 같은 걸음).
 *
 * **물려줄 수 없으면 그 진영은 `null`이다**(기본 배치). 저장된 배치가 없었거나,
 * 줄 수가 다르거나, 옛 기물의 칸이 프리셋에 없을 때다 — 던지지 않는다.
 */
export function remapDeployment(
  before: readonly RosterPick[], after: readonly RosterPick[], deploy: Squad['deploy'],
): Squad['deploy'] {
  const side = (cells: SquadCell[] | null): SquadCell[] | null => {
    if (!cells || before.length !== after.length) return null;
    const out: SquadCell[] = [];
    for (let i = 0; i < after.length; i += 1) {
      const old = cells.find((c) => c.piece === before[i]!.piece);
      if (!old) return null;
      out.push({ piece: after[i]!.piece, x: old.x, y: old.y });
    }
    return out;
  };
  return { P1: side(deploy.P1), P2: side(deploy.P2) };
}

// ── 병영 현황판의 「최근 부대」 (2026-09-17, pptx 65쪽) ─────────

/**
 * 부대가 마지막으로 **움직인** 시각 — 만든 시각과 마지막 전투 시각 중 늦은 쪽.
 *
 * 전투 시각은 이력(`matches[].at`)에서 읽는다. 이력은 부대를 **이름**으로 적으므로
 * (`mySquad`) 지운 부대와 같은 이름으로 새로 만들면 옛 전투 시각을 물려받는다 —
 * 부대 전적(`rewards.ts`)이 이미 같은 짝짓기를 쓰고 있어 그 결을 따른다.
 * 이력은 200줄에서 꼬리를 덜어 내지만 「최근」을 묻는 데는 꼬리가 필요 없다.
 *
 * **둘 다 없으면 `0`이다** — 옛 부대(`createdAt` 없음)에 전투도 없는 경우.
 */
export function squadLastActive(profile: PlayerProfile, squad: Squad): number {
  let at = squad.createdAt ?? 0;
  for (const row of profile.matches) {
    if (row.mySquad === squad.name && row.at > at) at = row.at;
  }
  return at;
}

/**
 * 최근에 만들었거나 최근에 싸운 부대 `n`개 — 병영 현황판(65쪽)이 셋을 보여 준다.
 *
 * 시각이 같으면(둘 다 0인 옛 부대 등) **부대 번호가 큰 쪽**이 위다 — 번호는
 * `squadSeq`에서 나와 늘기만 하므로 곧 「나중에 만든 것」이다.
 */
export function recentSquads(profile: PlayerProfile, n = 3): Squad[] {
  const seq = (s: Squad): number => Number(s.id.replace(/^\D+/, '')) || 0;
  return profile.squads
    .map((squad) => ({ squad, at: squadLastActive(profile, squad) }))
    .sort((a, b) => b.at - a.at || seq(b.squad) - seq(a.squad))
    .slice(0, n)
    .map((x) => x.squad);
}
