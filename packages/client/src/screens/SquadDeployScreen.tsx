/**
 * 부대 배치 편집 — 판 전체 위에서 (pptx 69·72쪽, 2026-09-17)
 *
 * ```
 * [← 뒤로 가기]        부대 배치 편집           ← 뒤로 가기도 저장하고 돌아간다
 * ┌ 머리 판 ────────────────────────────────────┐
 * │ 장수 배치                                    │ ← 제목 (진영 탭 없음 — 공격대는 남군, 수비대는 북군)
 * │ '가후'를 배치해주세요.                          │ ← 안내 한 줄 (왼쪽 정렬)
 * │ ┌────┐┌────┐┌────┐┌────┐┌────┐               │ ← 장수 카드 다섯 칸 — 위 기물 + 꼬마,
 * │ │♜🧍 ││♚🧍 ││♛🧍 ││ 🔒 ││ 🔒 │               │   아래 띠에 좌표. 3인팀은 남는 칸에
 * │ │H18 ││M18 ││R18 ││자리││자리│               │   「자리 없음」
 * │ └────┘└────┘└────┘└────┘└────┘               │
 * ├ 본 판 ──────────────────────────────────────┤
 * │ ┌ 15 × 8 창 (좌표 · 화살표 넷) ──────────┐    │
 * │ │                              ┌미니맵┐ │    │ ← 창의 오른쪽 아래 4 × 4칸 (남군은 오른쪽 위)
 * │ └──────────────────────────────┴─────┘─┘    │
 * ├ 조작 판 ────────────────────────────────────┤
 * │ [기본 배치로] / [배치 완료]                    │
 * └─────────────────────────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 배치 구역만이 아니라 **판 전체**를 그린다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 예전 편집기는 우리 진영 5행만 그렸다 — 그러면 「상대가 저기 서면 내 Rock이 닿는가」를
 * 볼 수 없다. 69쪽은 실제 전투의 지도 위에 **가상의 상대**를 세워 두고 둘 다 움직여
 * 보게 한다. 상대는 연습용이라 **저장하지 않는다** — 저장되는 것은 우리 편 좌표뿐이다.
 *
 * 가상의 상대는 3v3 `Rock · King · Queen`, 5v5 `Rock · Bishop · King · Queen · Knight`
 * 차례로 **엔진의 기본 배치 자리**(`defaultDeployPos`)에 선다(기획자 지정). 화면이
 * 「5×5의 가운데」를 다시 적지 않는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 한 진영만 편집한다 — 공격대는 남군, 수비대는 북군 (2026-11-18 기획자)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전 공격대는 [남군]·[북군] 탭으로 두 배치를 따로 들었다. 이제 **사람은 언제나 남군 기준으로 둔다** —
 * 북군 자리에 앉으면 판에는 남군 배치를 180° 돌려 깔고(`deployCells`), 전투 화면도 판을 돌려 그려
 * (`battle/layout.ts`의 `BoardView`) 남군에서 둔 모습 그대로 보인다. 그래서 탭이 없고 북군 배치는 저장하지 않는다(`null`).
 *
 * **저장할 수 있는지는 규칙에 묻는다**(`isDeployable`). 기본 배치와 똑같으면 `null`로 넘긴다 — 「배치 없음」과
 * 「기본 배치를 저장함」이 갈리면 기본 배치 규칙이 바뀐 날 옛 좌표가 조용히 남는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 옮기기는 장수 카드 한 길이다 (2026-11-17 기획자 · 2026-11-18 장수마다 카드로)
 * ────────────────────────────────────────────────────────────────
 *
 * 옛 「기물을 누르면 노란 칸 → 한 번 더 눌러 놓기」를 걷었다. 머리 판의 장수 카드를 누르면 카드에 금빛 테가 서고 판의
 * 그 기물이 금빛으로 점멸하며 「'○○'를 배치해주세요」가 뜬다. 판의 칸을 누르면 —
 *
 * | 누른 칸 | 결과 |
 * |---|---|
 * | 우리 구역 밖 | 「우리군 영역 안에 배치할 수 있습니다 (파란 영역)」, 차례는 그대로 |
 * | 우리 구역의 빈 칸 | 그 자리에 서고 차례가 꺼진다 |
 * | 다른 우리 장수가 선 칸 | 둘이 자리를 바꾸고 차례가 꺼진다 |
 *
 * 같은 카드를 다시 누르면 끈다. 그 밖에서 기물을 누르면 **움직일 수 있는 칸**만 보인다(`legalMoves`,
 * 다른 기물을 장애물로 — 다시 누르면 끈다). 가상의 상대는 이제 옮기지 않는다 — 기본 배치 자리에 선다.
 * **첫 편성 미션(King ↔ Rock)도 이 길이다** (2026-11-18 기획자) — 표지가 King의 카드 → 가운데 칸을 가리키고, 누르면
 * 둘이 맞바뀌어 끝난다(`deployMission.ts`). 바꾸면 차례를 끄고 King을 눌러 움직일 칸을 보게 한다.
 * **다만 같은 날 기본 배치가 King 가운데로 바뀌어**(`defaultSquadCells`) 새 부대는 처음부터 바꾼 상태다 — 미션은 곧장
 * 「King을 눌러 보기」에서 시작하고, 바꾸기 마디는 King이 가운데가 아닐 때만 선다.
 *
 * ────────────────────────────────────────────────────────────────
 * 수비대는 북군 한 진영 · 수성전 판이다 (2026-11-17 기획자)
 * ────────────────────────────────────────────────────────────────
 *
 * 수비대가 서는 판은 공성전(수비군 = 북군, `SIEGE_DEFENDER`)과 받은 선전포고(받는 쪽 = 북군)뿐이다 —
 * 남군 배치는 저장해도 아무 판에도 안 선다. 그래서 진영 탭을 없애고(깃발도 안 단다 — 2026-11-17 기획자), 판은
 * **수성전 판 그대로** 그린다: 북군 군량고 자리에 성채 3×3(`siegeCastle()` — 전투와 같은 조각 그림),
 * 북군 군량고는 없음, 남군 군량고만(`supplyDepotOf`에 `scenario: 'siege'`). 남군 배치는 `null`로 넘긴다.
 *
 * ────────────────────────────────────────────────────────────────
 * 확대 창 + 미니맵 (2026-11-17 기획자)
 * ────────────────────────────────────────────────────────────────
 *
 * 25열을 세로 화면 폭에 다 넣으면 칸이 19px이었다. 큰 판은 **가로 15칸 · 세로 8칸 창**이다(기획자 지정 —
 * 정사각일 필요가 없다). 창의 맨 위 줄 · 맨 왼쪽 줄 칸에 좌표(열 A~Y · 행 1~20, 전투 대화창의 `cellName`)를 적고, 판 위 장수는 기물 그림으로 선다(2026-11-18). 칸은 전투 칸 비율(96×120)이라 창은 3 : 2다. 창은 「초점 칸」 하나로 들고 판 끝에서 멈춘다 —
 * 처음 초점은 제 진영 끝 가운데라 창이 제 구역에 붙는다. 옮기는 길은 둘: 미니맵을 누르거나 끌기, 판 네 옆구리의
 * 화살표(더 갈 데가 없는 쪽은 안 보인다). 사람이 고르는 [판 전체] 보기는 없다 — 첫 편성 미션의 끝 마디
 * (상대 · 군량고를 가리킨다)만 같은 틀 안에 판 전체를 그린다.
 * 창은 칸을 **잘라 그릴 뿐** 좌표는 판 그대로다(`data-x` · `data-y`) — 스모크가 고른 칸이 창 밖이면 안 보일 뿐이다.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { officerById } from '@samchess/data';
import { PIECE_TYPES, defaultSquadCells, isDeployable, pendingGuide } from '@samchess/meta';
import { missionTarget, swapDone } from './deployMission.ts';
import type { SwapGoal } from './deployMission.ts';
import { useGuide } from './useGuide.tsx';
import type { PlayerProfile, Squad, SquadCell } from '@samchess/meta';
import { FORMULA, SIEGE_CASTLE_CENTER, SIEGE_CASTLE_RADIUS, SIEGE_DEFENDER, defaultDeployPos, deployZone, inZone, legalMoves, siegeCastle, supplyDepotOf } from '@samchess/rules';
import type { PieceType, Side, TerrainTile, Vec2 } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { BOARD_MAP_URL } from '../ui/art.ts';
import { SUPPLY_ART, terrainArt, terrainUrl } from '../battle/terrain.ts';
import { placeBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { OfficerStand } from './OfficerArt.tsx';
import { cellName, josaOf } from '../ui/eventText.ts';
import { pieceArtUrl } from '../ui/pieceIcon.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { gameIconUrl } from '../ui/gameIcon.ts';
import { BlinkGlow, STAND_GLOW } from './BlinkGlow.tsx';
import { fontFloorPx } from './fontFloor.ts';

/** 가상의 상대가 서는 차례 (69쪽 기획자 지정) */
const ENEMY_ORDER: Record<Squad['mode'], PieceType[]> = {
  '3v3': ['Rock', 'King', 'Queen'],
  '5v5': ['Rock', 'Bishop', 'King', 'Queen', 'Knight'],
};

const other = (side: Side): Side => (side === 'P1' ? 'P2' : 'P1');

/** 판에 적는 한 글자 — **King과 Knight가 둘 다 `K`**라 첫 글자로는 5v5에서 갈리지
    않는다. 체스 기보의 약속대로 Knight는 `N`이다 */
const LETTER: Record<PieceType, string> = {
  King: 'K', Queen: 'Q', Rock: 'R', Bishop: 'B', Knight: 'N', Pawn: 'P',
};

type Team = 'ours' | 'enemy';
/** 움직일 칸을 보고 있는 기물 */
interface Held { team: Team; piece: PieceType }

/** 머리 판 안내의 [이동] 그림(이동 범위) — 카드 차례는 그 장수의 기물 그림을 30° 기울여 둔다(`.sqb-msg-badge`) */
const MOVE_ICON = 'ui/cmd/move.png';
/** 머리 판의 카드 칸 — 5인팀 기준. 3인팀은 남는 두 칸이 「자리 없음」(2026-11-18 기획자) */
const ROSTER_SLOTS = 5;
/** 큰 판의 창 — 가로 15칸(3인팀 배치 구역 폭) · 세로 8칸 (2026-11-17 기획자). 칸 비율 96×120이라 창은 3 : 2(`.sqb-view`) */
const WIN_COLS = 15;
const WIN_ROWS = 8;
/** 화살표 한 번에 옮기는 칸 — 좌우 5칸(판 25열이 창 셋 자리), 위아래 4칸(창 반) */
const PAN_X = 5;
const PAN_Y = 4;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
/** 처음 초점 — 제 진영 끝 가운데. 창이 판 끝에서 멈추므로 제 구역에 붙는다 */
const homeFocus = (side: Side): Vec2 => ({ x: Math.floor(FORMULA.board.cols / 2), y: side === 'P1' ? FORMULA.board.rows - 1 : 0 });
/** 수성전 판의 성채 아홉 칸 — 좌표 → 지형(그림은 전투와 같은 `terrainArt`) */
const CASTLE: ReadonlyMap<string, TerrainTile> = new Map(siegeCastle().map((t) => [`${t.pos.x},${t.pos.y}`, t]));

const sameCells = (a: readonly SquadCell[], b: readonly SquadCell[]): boolean =>
  a.length === b.length && a.every((c) => b.some((d) => d.piece === c.piece && d.x === c.x && d.y === c.y));

function enemyCells(mode: Squad['mode'], enemySide: Side): SquadCell[] {
  return ENEMY_ORDER[mode].map((piece, i) => ({ piece, ...defaultDeployPos(mode, enemySide, i) }));
}

export function SquadDeployScreen({ profile, onProfile, mission = false, squad, initial, isNew, doneLabel, onBack, onSave }: {
  profile: PlayerProfile;
  /** 안내 무관의 「들었다」를 적는다 */
  onProfile: (next: PlayerProfile) => void;
  /** 첫 편성의 배치 미션(King ↔ Rock)을 띄우는가 — 부대원 화면이 정한다(새 3인팀 · 3인팀 없음 · 안내 켬) */
  mission?: boolean;
  /** 부대원이 다 찬 부대 — 배치는 `initial`로 따로 받는다 */
  squad: Squad;
  /** 진영별 시작 배치. `null`인 진영은 기본 배치로 시작한다 */
  initial: Squad['deploy'];
  /** 새 부대인가 — 마지막 단추 글자와 「기본 배치로 설정됩니다」 팝업이 갈린다 */
  isNew: boolean;
  /** 마지막 단추 글자 — 부대 편집은 「배치 완료」(저장은 [부대 저장]이 한다, 2026-11-17). 없으면 옛 「편성 완료」 · 「수정 완료」 */
  doneLabel?: string;
  onBack: () => void;
  onSave: (deploy: Squad['deploy']) => void;
}): React.JSX.Element {
  useLang();
  const mode = squad.mode;
  const defaults = (s: Side): SquadCell[] => defaultSquadCells(mode, s, squad.picks);
  /** 수비대 — 북군 한 진영 · 수성전 판(머리말) */
  const defense = squad.role === 'defense';

  /** 편집하는 진영 — 공격대는 남군, 수비대는 북군(머리말) */
  const side: Side = defense ? SIEGE_DEFENDER : 'P1';
  const [focus, setFocus] = useState<Vec2>(() => homeFocus(side));
  const [cells, setCells] = useState<Record<Side, SquadCell[]>>(() => ({
    P1: initial.P1 ?? defaults('P1'),
    P2: initial.P2 ?? defaults('P2'),
  }));
  /** 우리 편 진영을 기준으로 든 상대 작업본 — 남군 화면의 상대는 북군 구역에 선다 */
  const [enemy, setEnemy] = useState<Record<Side, SquadCell[]>>(() => ({
    P1: enemyCells(mode, 'P2'),
    P2: enemyCells(mode, 'P1'),
  }));
  const [touched, setTouched] = useState<Record<Side, boolean>>({ P1: false, P2: false });
  const [range, setRange] = useState<Held | null>(null);
  const [asking, setAsking] = useState(false);
  /** [배치] — 지금 자리를 정하는 장수(머리 판의 몇 번째). `null`이면 꺼져 있다 */
  const [placing, setPlacing] = useState<number | null>(null);
  /** 머리 판 안내 한 줄의 덧말 — 우리 구역 밖을 눌렀다 */
  const [note, setNote] = useState<'out' | null>(null);
  /** 배치 미션 — 바꾼 뒤 King을 눌러 움직일 칸을 봤나 */
  const [ranged, setRanged] = useState(false);

  const ours = cells[side];
  const theirs = enemy[side];
  /** 머리 판의 차례 — 기물 차례 `PIECE_TYPES`(부대 목록의 줄과 같다) */
  const order: SquadCell[] = PIECE_TYPES.flatMap((p) => ours.filter((c) => c.piece === p));
  const officerOf = (piece: PieceType) => {
    const id = squad.picks.find((p) => p.piece === piece)?.officer;
    return id ? officerById.get(id) : undefined;
  };
  const nameOf = (piece: PieceType): string => { const d = officerOf(piece); return d ? pickOfficerName(d) : piece; };
  const placingCell = placing !== null ? order[placing] ?? null : null;
  const listOf = (team: Team): SquadCell[] => (team === 'ours' ? ours : theirs);

  const occupant = (x: number, y: number): { team: Team; cell: SquadCell } | null => {
    const o = ours.find((c) => c.x === x && c.y === y);
    if (o) return { team: 'ours', cell: o };
    const e = theirs.find((c) => c.x === x && c.y === y);
    return e ? { team: 'enemy', cell: e } : null;
  };

  /* 누른 기물이 움직일 수 있는 칸 — 다른 기물을 장애물로(막힌 칸·가로막힌 길은 빠진다) */
  const rangeCells: Set<string> = (() => {
    if (!range) return new Set();
    const me = listOf(range.team).find((c) => c.piece === range.piece);
    if (!me) return new Set();
    const blocked = (p: Vec2): boolean =>
      !(p.x === me.x && p.y === me.y) && occupant(p.x, p.y) !== null;
    return new Set(legalMoves(range.piece, { x: me.x, y: me.y }, { blocked }).map((p) => `${p.x},${p.y}`));
  })();

  /*
   * 장수 카드 (2026-11-18 기획자 — 장수마다 하나, 한 명씩) — 카드를 누르고 칸을 누르면 그 자리에 서고 차례가 꺼진다.
   * 우리 구역 밖이면 안내만 하고 차례는 그대로. 다른 우리 장수가 선 칸이면 둘이 자리를 바꾼다(빈 칸으로만 옮기면 「가운데 둘을 바꾸기」가
   * 세 번 옮김이 된다). 같은 카드를 다시 누르면 끈다
   */
  const startPlacing = (i: number): void => {
    setRange(null); setNote(null);
    setPlacing(placing === i ? null : i);
  };
  const place = (x: number, y: number): void => {
    if (!placingCell || placing === null) return;
    if (!inZone(myZone, { x, y })) { setNote('out'); return; }
    const me = placingCell;
    const other = ours.find((c) => c.x === x && c.y === y && c.piece !== me.piece);
    const nextCells = ours.map((c) => (c.piece === me.piece ? { ...c, x, y }
      : other && c.piece === other.piece ? { ...c, x: me.x, y: me.y } : c));
    setCells((prev) => ({ ...prev, [side]: nextCells }));
    setTouched((prev) => ({ ...prev, [side]: true }));
    setPlacing(null); setNote(null);
  };

  const onCell = (x: number, y: number): void => {
    if (placing !== null) { place(x, y); return; }
    const occ = occupant(x, y);
    // 기물을 누르면 움직일 칸만 보인다(옮기기는 [배치]) — 다시 누르면 끈다
    const show = occ && !(range && range.team === occ.team && range.piece === occ.cell.piece);
    setRange(show ? { team: occ.team, piece: occ.cell.piece } : null);
    // 첫 편성 미션 — 바꾼 뒤 King을 눌러 봤다
    if (show && occ.team === 'ours' && occ.cell.piece === 'King' && side === 'P1') setRanged(true);
  };

  const resetSide = (): void => {
    setCells((prev) => ({ ...prev, [side]: defaults(side) }));
    setEnemy((prev) => ({ ...prev, [side]: enemyCells(mode, other(side)) }));
    setTouched((prev) => ({ ...prev, [side]: true }));
    setRange(null); setPlacing(null); setNote(null);
  };

  // 편집하는 한 진영만 본다 — 다른 진영은 넘기지 않으니(`result`) 물을 것도 없다
  const ok = isDeployable(profile, squad, side, cells[side]);

  /*
   * 첫 편성의 배치 미션 (2026-11-13 기획자) — King을 가운데로, 가운데 기물(Rock)을 왼쪽으로 바꾸게 한다. 2026-11-18부터 기본 배치가 King 가운데라
   * 새 부대에서는 이미 끝난 상태로 열린다(머리말).
   * 남군(P1) 판에서만. 다음에 누를 곳 하나에 표지 — 차례가 꺼져 있으면 그 장수(King부터)의 카드가 빛나고, 켜져 있으면 그 장수가 설 칸에
   * 단검(`ui/turn/dagger.png` — 전투의 「내 차례」 표지). 계획은 `deployMission.ts`가 지금 자리 · 차례에서 매번 다시 낸다(2026-11-18)
   */
  const goal: SwapGoal = {
    center: defaultDeployPos(mode, 'P1', 1), left: defaultDeployPos(mode, 'P1', 0),
    other: squad.picks[1]?.piece ?? 'Rock',
  };
  const missionOn = mission && mode === '3v3' && side === 'P1';
  const swapped = swapDone(cells.P1, goal);
  const target = missionOn && !swapped ? missionTarget(cells.P1, goal, placingCell?.piece ?? null) : null;
  // 바꾼 뒤에는 King을 눌러 움직일 칸을 보게 한다 — 단검은 King에
  const rangeStep = missionOn && swapped && !ranged;
  const missionAt: Vec2 | null = rangeStep ? cells.P1.find((c) => c.piece === 'King') ?? null
    : target?.kind === 'cell' ? target.at : null;
  const missionBtn: PieceType | null = target?.kind === 'button' ? target.piece : null;
  /** 바꾸기 · 움직일 칸 보기 동안은 남군 쪽 창 — 끝 마디(가상의 상대 · 군량고)에서 판 전체로 돌아온다 */
  const zoom = missionOn && !(swapped && ranged);
  const guide = useGuide(profile, onProfile, asking ? null : pendingGuide(profile, 'squadDeploy', {
    squad: mission, swapped, placing: placing !== null, ranged,
  }), 'squadDeploy');

  /** 기본 배치와 같으면 `null` — 「배치 없음」 하나로 둔다(머리말 참조). 편집하지 않는 진영은 언제나 `null` */
  const result = (): Squad['deploy'] => {
    const mine = sameCells(cells[side], defaults(side)) ? null : cells[side];
    return side === 'P1' ? { P1: mine, P2: null } : { P1: null, P2: mine };
  };

  const finish = (): void => {
    // 새 부대를 **한 번도 안 만지고** 끝내면 기본 배치라는 것을 한 번 알린다(72쪽). 첫 편성 미션은 무관이 이미 말했다 —
    // 기본 배치가 King 가운데라(2026-11-18) 미션은 아무것도 안 옮기고 끝난다
    if (isNew && !touched[side] && !missionOn) { setAsking(true); return; }
    onSave(result());
  };
  /** 머리 막대의 [뒤로 가기]도 배치를 저장하고 돌아간다(2026-11-18 기획자 — [배치 완료]가 뒤로 가기를 겸한다). 저장할 수 없는 배치면 그냥 돌아간다 */
  const leave = (): void => { if (ok) finish(); else onBack(); };

  const rows = FORMULA.board.rows;
  const cols = FORMULA.board.cols;
  /** 이 판의 군량고 자리 — 수비대는 수성전 판이라 북군 군량고가 없다 */
  const board = { boardSize: { x: cols, y: rows }, ...(defense ? { scenario: 'siege' as const } : {}) };
  /** 이 칸이 군량고면 누구 것인가 — 지금 고치는 진영(`side`) 기준으로 `ours` · `enemy` */
  const depotOf = (x: number, y: number): 'ours' | 'enemy' | undefined => {
    const at = (s: Side): boolean => { const d = supplyDepotOf(board, s); return d !== null && d.x === x && d.y === y; };
    return at(side) ? 'ours' : at(other(side)) ? 'enemy' : undefined;
  };
  const fortAt = (x: number, y: number): TerrainTile | undefined => (defense ? CASTLE.get(`${x},${y}`) : undefined);

  /*
   * 보이는 창 — 15 × 8, 초점을 가운데에 두되 판 끝에서 멈춘다. 첫 편성 미션의 끝 마디만 같은 틀에 판 전체(머리말)
   */
  const whole = missionOn && !zoom;
  const win = whole
    ? { x0: 0, y0: 0, w: cols, h: rows }
    : {
        x0: clamp(focus.x - Math.floor(WIN_COLS / 2), 0, cols - WIN_COLS),
        y0: clamp(focus.y - Math.floor(WIN_ROWS / 2), 0, rows - WIN_ROWS),
        w: WIN_COLS, h: WIN_ROWS,
      };
  // 판 그림도 창만큼 잘라 깐다 — 그림 한 장을 판 크기로 키우고 창의 왼쪽 위로 민다
  const bgPos = (start: number, span: number, all: number): string => (all === span ? '0%' : `${(start / (all - span)) * 100}%`);

  /*
   * 화살표 넷 — 그쪽으로 더 갈 데가 있을 때만 선다(기획자). 창 밖 그쪽에 선 우리 편 수(`off`)는 그리지 않고(기획자 — 설명 없이
   * 숫자만 떠서 뜻을 몰랐다) `data-off`로만 남긴다 — `deploy_ux`가 「창 안 + 창 밖 = 부대원」을 본다
   */
  const pan = (dx: number, dy: number): void => {
    const x0 = clamp(win.x0 + dx * PAN_X, 0, cols - win.w);
    const y0 = clamp(win.y0 + dy * PAN_Y, 0, rows - win.h);
    setFocus({ x: x0 + Math.floor(win.w / 2), y: y0 + Math.floor(win.h / 2) });
  };
  const arrows = whole ? [] : ([
    { dir: 'up', dx: 0, dy: -1, open: win.y0 > 0, off: ours.filter((c) => c.y < win.y0).length },
    { dir: 'down', dx: 0, dy: 1, open: win.y0 + win.h < rows, off: ours.filter((c) => c.y >= win.y0 + win.h).length },
    { dir: 'left', dx: -1, dy: 0, open: win.x0 > 0, off: ours.filter((c) => c.x < win.x0).length },
    { dir: 'right', dx: 1, dy: 0, open: win.x0 + win.w < cols, off: ours.filter((c) => c.x >= win.x0 + win.w).length },
  ] as const).filter((a) => a.open);

  /** 미니맵을 누르거나 끈 자리로 초점을 옮긴다 */
  const miniRef = useRef<SVGSVGElement>(null);
  const aimMini = (e: React.PointerEvent<SVGSVGElement>): void => {
    const r = miniRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setFocus({
      x: clamp(Math.floor(((e.clientX - r.left) / r.width) * cols), 0, cols - 1),
      y: clamp(Math.floor(((e.clientY - r.top) / r.height) * rows), 0, rows - 1),
    });
  };
  /**
   * 미니맵은 큰 판 위에 얹는다 — 창의 오른쪽 아래 4 × 4칸 자리(2026-11-18 기획자). 창이 판의 오른쪽 아래 구석(K13 ~ Y20)을 비출 때만
   * 오른쪽 위 4 × 4칸(V13 ~ Y16)으로 올린다. **남군은 언제나 오른쪽 위** — 남군 구역은 판 아래라 아래에 두면 우리 장수(기본 배치의 R18)를
   * 덮는다(2026-11-18 기획자). 판 전체를 그리는 미션 끝 마디에는 안 얹는다
   */
  const miniAt: 'bottom' | 'top' = side === 'P1' || (win.x0 + win.w === cols && win.y0 + win.h === rows) ? 'top' : 'bottom';
  const myZone = deployZone(mode, side);
  const foeZone = deployZone(mode, other(side));
  /** 미니맵의 성채 — 아홉 칸을 한 네모로 */
  const castleBox = defense ? {
    x0: SIEGE_CASTLE_CENTER.x - SIEGE_CASTLE_RADIUS, y0: SIEGE_CASTLE_CENTER.y - SIEGE_CASTLE_RADIUS,
    x1: SIEGE_CASTLE_CENTER.x + SIEGE_CASTLE_RADIUS, y1: SIEGE_CASTLE_CENTER.y + SIEGE_CASTLE_RADIUS,
  } : null;

  /**
   * 머리 판 안내(두루마리) — 구역 밖을 눌렀으면 그 말이 먼저(차례는 그대로 열려 있다). 카드를 골랐으면 그 장수의 기물 그림을 30° 기울여
   * (결과 화면의 `ic_out_king`의 비스듬한 기물처럼 — 그림은 새로 그리지 않고 기물 그림을 CSS로 돌린다) +
   * 「○○를 배치합니다」, 기물을 눌러 움직일 칸이 깜빡이면 [이동] 그림 + 「○○의 이동 범위를 봅니다」 (2026-11-18 기획자)
   */
  const msgKind = note === 'out' ? 'warn' : placingCell ? 'ask' : range ? 'range' : 'idle';
  const askText = (piece: PieceType): string => { const who = nameOf(piece); return t('deploy.place.ask', { who, o: josaOf(who, '을를') }); };
  const rangeText = (team: Team, piece: PieceType): string =>
    t('deploy.range.see', { who: team === 'ours' ? nameOf(piece) : t('deploy.range.foe', { piece }) });
  const msg = msgKind === 'warn' ? t('deploy.place.out')
    : msgKind === 'ask' && placingCell ? askText(placingCell.piece)
      : msgKind === 'range' && range ? rangeText(range.team, range.piece)
        : t('deploy.place.idle');
  /** 이 화면이 띄울 수 있는 안내 전부 — 가장 긴 말이 두루마리에 들도록 글자 크기를 한 번 정한다(`useSteadyMsg`) */
  const msgAll = [
    t('deploy.place.idle'), t('deploy.place.out'),
    ...ours.flatMap((c) => [askText(c.piece), rangeText('ours', c.piece)]),
    ...theirs.map((c) => rangeText('enemy', c.piece)),
  ];
  const msgBox = useSteadyMsg(msgAll);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-edit scr-squad-deploy"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadDeploy" data-side={side} data-mode={mode} data-role={defense ? 'defense' : 'attack'}>
        <button className="btn ghost sm" data-action="back" onClick={leave}>
          {stripBackArrow(t('match.back'))}
        </button>
        <span className="place-nm">{t('deploy.editTitle')}</span>
      </div>

      <div className="place-body">
        {/* 머리 판 — 왼쪽 위 제목 「장수 배치」, 그 밑에 안내 한 줄(왼쪽 정렬), 장수 카드 다섯 칸 (2026-11-18 기획자) */}
        <section className="place-panel sqe-top sqb-head" data-field="deployHead">
          <div className="sqb-head-top">
            <h3 className="sqb-head-ttl">{t('deploy.place')}</h3>
          </div>
          <p className="sqb-msg" data-field="deployMsg" data-kind={msgKind} ref={msgBox.box}>
            <span className="sqb-msg-in">
              {/* 카드 차례 — 그 장수의 기물 그림을 30° 기울여(기물 그림은 카드 · 판이 이미 받아 두었다) */}
              {msgKind === 'ask' && placingCell && (
                <span className="sqb-msg-ico sqb-msg-badge" data-piece={placingCell.piece}>
                  <img src={pieceArtUrl(placingCell.piece, side === 'P1')} alt="" draggable={false} />
                </span>
              )}
              {/* [이동]은 처음부터 그려 두고 이동 범위일 때만 보인다 — 처음 누를 때 받아 오느라 잠깐 비던 것(2026-11-18) */}
              <img className="sqb-msg-ico" src={MOVE_ICON} alt="" draggable={false} hidden={msgKind !== 'range'} />
              <span className="sqb-msg-t">{msg}</span>
              <span className="sqb-msg-t sqb-msg-probe" ref={msgBox.probe} aria-hidden="true" />
            </span>
          </p>
          {/* 장수 카드 다섯 칸 — 3인팀은 남는 두 칸에 「자리 없음」(자물쇠). 카드를 누르면 그 장수의 차례(판의 그 기물이 금빛으로 점멸),
              다시 누르면 끈다. 카드 = 위 기물 + 꼬마 · 아래 좁은 띠에 좌표(`ui/slot-empty.png`) */}
          <div className="sqb-roster">
            {Array.from({ length: ROSTER_SLOTS }, (_, i) => {
              const c = order[i];
              if (!c) {
                return (
                  <div key={`none-${i}`} className="sqb-card" data-locked="">
                    <span className="sqb-card-art"><img className="sqb-card-lock" src={gameIconUrl('mk-lock')} alt="" draggable={false} /></span>
                    <span className="sqb-card-at"><ChipLabel label={t('deploy.slot.none')} /></span>
                  </div>
                );
              }
              const data = officerOf(c.piece);
              const cue = missionBtn === c.piece;
              const on = placing === i;
              return (
                <button
                  key={c.piece} className="sqb-card" data-field="deployWho" data-action="deployPlace" data-piece={c.piece} data-grade={data?.grade}
                  data-turn={on ? '1' : undefined} data-on={on ? '1' : '0'} aria-pressed={on}
                  title={data ? pickOfficerName(data) : c.piece}
                  data-mission={cue ? '1' : undefined} data-guide-cue={cue ? '' : undefined}
                  onClick={() => startPlacing(i)}
                >
                  <span className="sqb-card-art">
                    <img className="sqb-card-piece" src={pieceArtUrl(c.piece, side === 'P1')} alt={c.piece} draggable={false} />
                    {/* 꼬마 뒤 후광 — S급 자주 · A급 흰 별빛 · E급 금(부대 관리 · 부대원 · 농지와 같은 표, 2026-11-18 기획자) */}
                    {data && (
                      <span className="sqb-card-fig">
                        {STAND_GLOW[data.grade] && <BlinkGlow tone={STAND_GLOW[data.grade]!} className="sqb-stand-glow" />}
                        <OfficerStand officer={data.id} title={pickOfficerName(data)} />
                      </span>
                    )}
                  </span>
                  <span className="sqb-card-at" data-field="at">{cellName(c)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 본 판 — 지도뿐(2026-11-18 기획자 — 단추를 다 걷었다). 미니맵은 지도 위 4 × 4칸 자리에 얹는다 */}
        <section className="place-panel sqb-panel">
          {/* 판 무대 — 화살표는 판 **바깥**(좌우는 판때기 테, 위아래는 판때기 위 · 밑 테)에 선다.
              판 위에 얹으면 가장자리 칸을 덮어 그 칸을 못 누른다(2026-11-17 — squad_ux가 잡았다) */}
          <div className="sqb-stage">
          <div className="sqb-view" data-zoom={zoom ? '1' : '0'} data-view={whole ? 'full' : 'near'}>
          <div
            className="sqb-board"
            style={{
              // 행·열을 **둘 다** 등분한다 — 칸 안의 그림은 절대 배치라 줄 높이를 밀지 않는다(`.sqb-cell > *`)
              gridTemplateColumns: `repeat(${win.w}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${win.h}, minmax(0, 1fr))`,
              backgroundImage: `url(${BOARD_MAP_URL})`,
              backgroundSize: `${(cols / win.w) * 100}% ${(rows / win.h) * 100}%`,
              backgroundPosition: `${bgPos(win.x0, win.w, cols)} ${bgPos(win.y0, win.h, rows)}`,
            }}
            data-placing={placingCell ? placingCell.piece : undefined}
            data-range={range ? `${range.team}:${range.piece}` : ''}
          >
            {Array.from({ length: win.h }, (_, j) => Array.from({ length: win.w }, (_, i) => {
              const x = win.x0 + i;
              const y = win.y0 + j;
              const occ = occupant(x, y);
              // 군량고 (GDD §3.9) — 자리는 엔진이 정한다. 제 군량고에 장수를 세워 지킬 수 있다
              const depot = depotOf(x, y);
              const fort = fortAt(x, y);
              const zone = inZone(myZone, { x, y }) ? 'ours' : inZone(foeZone, { x, y }) ? 'enemy' : '';
              const who = occ?.team === 'ours'
                ? squad.picks.find((p) => p.piece === occ.cell.piece)?.officer : undefined;
              const data = who ? officerById.get(who) : undefined;
              return (
                <button
                  key={`${x},${y}`}
                  className={`sqb-cell${rangeCells.has(`${x},${y}`) ? ' range' : ''}`}
                  data-x={x}
                  data-y={y}
                  data-zone={zone}
                  data-team={occ?.team ?? ''}
                  data-piece={occ?.cell.piece ?? ''}
                  data-turn={occ?.team === 'ours' && placingCell?.piece === occ.cell.piece ? '1' : undefined}
                  data-depot={depot}
                  data-fort={fort ? '' : undefined}
                  data-mission={missionAt && missionAt.x === x && missionAt.y === y ? '1' : undefined}
                  data-guide-cue={missionAt && missionAt.x === x && missionAt.y === y ? '' : undefined}
                  title={occ ? `${occ.cell.piece}${data ? ` · ${pickOfficerName(data)}` : ''}` : undefined}
                  onClick={() => onCell(x, y)}
                >
                  {fort && <img className="sqb-fort" src={terrainUrl(terrainArt(fort))} alt="" draggable={false} />}
                  {depot && (
                    <img
                      className="sqb-depot" src={terrainUrl(SUPPLY_ART)} alt="" draggable={false}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  {/* 판 위 우리 장수는 기물 그림(2026-11-18 기획자 — 꼬마는 칸에서 잘 안 보였다). 누구인지는 머리 판 · 칸 제목이 말한다 */}
                  {occ?.team === 'ours' && (
                    <img className="sqb-piece" src={pieceArtUrl(occ.cell.piece, side === 'P1')} alt={occ.cell.piece} draggable={false} />
                  )}
                  {occ?.team === 'enemy' && <span className="sqb-letter enemy">{LETTER[occ.cell.piece]}</span>}
                  {/* 좌표 — 창의 맨 위 줄엔 열(A~Y), 맨 왼쪽 줄엔 행(1~20). 전투 대화창의 칸 이름(`cellName`)과 같은 규약 */}
                  {j === 0 && <span className="sqb-coord col" data-field="colLabel">{cellName({ x, y }).replace(/\d+$/, '')}</span>}
                  {i === 0 && <span className="sqb-coord row" data-field="rowLabel">{y + 1}</span>}
                  {missionAt && missionAt.x === x && missionAt.y === y && (
                    <img className="sqb-dagger" src="ui/turn/dagger.png" alt="" draggable={false} />
                  )}
                </button>
              );
            }))}
          </div>
          {/* 미니맵 — 판 전체 · 진영 구역 · 기물 · 지금 보는 창. 누르거나 끌면 큰 판이 그리로 간다. 붉은 옻칠 판(`dialog-line`)을 정사각으로 */}
          {!whole && (
            <div className="sqb-minibox" data-at={miniAt}>
              <svg
                ref={miniRef}
                className="sqb-mini"
                data-field="minimap"
                viewBox={`0 0 ${cols} ${rows}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={t('deploy.mini.title')}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); aimMini(e); }}
                onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) aimMini(e); }}
              >
                <image href={BOARD_MAP_URL} x={0} y={0} width={cols} height={rows} preserveAspectRatio="none" opacity={0.55} />
                <rect className="mz ours" x={myZone.x0} y={myZone.y0} width={myZone.x1 - myZone.x0 + 1} height={myZone.y1 - myZone.y0 + 1} />
                <rect className="mz enemy" x={foeZone.x0} y={foeZone.y0} width={foeZone.x1 - foeZone.x0 + 1} height={foeZone.y1 - foeZone.y0 + 1} />
                {castleBox && (
                  <rect className="mfort" x={castleBox.x0} y={castleBox.y0} width={castleBox.x1 - castleBox.x0 + 1} height={castleBox.y1 - castleBox.y0 + 1} />
                )}
                {(['ours', 'enemy'] as const).flatMap((tm) => {
                  const d = supplyDepotOf(board, tm === 'ours' ? side : other(side));
                  return d ? [<rect key={`d-${tm}`} className={`mdepot ${tm}`} x={d.x + 0.1} y={d.y + 0.1} width={0.8} height={0.8} />] : [];
                })}
                {[...rangeCells].map((k) => {
                  const [x, y] = k.split(',').map(Number) as [number, number];
                  return <rect key={`r-${k}`} className="mrange" x={x} y={y} width={1} height={1} />;
                })}
                {(['enemy', 'ours'] as const).flatMap((tm) => listOf(tm).map((c) => (
                  <rect key={`${tm}-${c.piece}`} className={`mpiece ${tm}`} x={c.x - 0.15} y={c.y - 0.15} width={1.3} height={1.3} />
                )))}
                <rect className="mwin" x={win.x0} y={win.y0} width={win.w} height={win.h} vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          )}
          </div>
          {arrows.map((a) => (
            <button
              key={a.dir}
              className="sqb-pan"
              data-action="deployPan"
              data-dir={a.dir}
              data-off={a.off}
              aria-label={t(a.dir === 'left' || a.dir === 'up' ? 'officers.pager.prev' : 'officers.pager.next')}
              onClick={() => pan(a.dx, a.dy)}
            />
          ))}
          </div>
        </section>

        {/* 조작 판 — [기본 배치로] 위 · [배치 완료] 아래 (2026-11-18 기획자 — [뒤로 가기]를 걷고 [배치 완료]가 저장하고 돌아간다) */}
        <section className="place-panel cmd-panel sqd-acts sqb-acts">
          <button className="btn wide" data-action="deployReset" onClick={resetSide}>
            {t('deploy.reset')}
          </button>
          <button className="btn primary wide" data-action="deploySave" data-guide-cue={missionOn && swapped && ranged && ok ? '' : undefined} disabled={!ok} onClick={finish}>
            {doneLabel ?? (isNew ? t('deploy.done.new') : t('squad.save.edit'))}
          </button>
        </section>
      </div>

      {asking && (
        <div className="modal-back" data-modal="deployDefault" onClick={() => setAsking(false)}>
          <div className="modal sqd-modal sqb-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="row" data-field="what">{t('deploy.defaultConfirm.body')}</p>
            <div className="sqd-acts">
              <button
                className="btn primary wide"
                data-action="deployDefaultOk"
                onClick={() => { setAsking(false); onSave(result()); }}
              >
                {t('deploy.defaultConfirm.ok')}
              </button>
              <button className="btn wide" data-action="deployDefaultCancel" onClick={() => setAsking(false)}>
                {t('deploy.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      {guide.node}
    </ScreenChrome>
  );
}

/**
 * 머리 판 안내(두루마리)의 글자 크기 — 이 화면이 띄울 수 있는 말 **전부**를 숨은 탐침에 하나씩 넣어 재고, 가장 긴 말이 두루마리 안(두 줄 자리)에
 * 들도록 크기 하나를 정한다(2026-11-18 기획자 — 버튼을 누르거나 언어를 바꿔도 틀 · 글자가 들쭉날쭉하지 않게). 두루마리는 그림 비율 그대로라
 * 높이가 폭에서 나오고, 글자만 `--msg-scale`로 줄어든다. 탐침은 그림 자리(아이콘)를 뺀 폭이라 그림이 붙는 말도 같은 잣대다.
 * 말 목록이 바뀌면(언어 · 진영 · 부대) · 상자 크기가 바뀌면 · 글꼴이 늦게 오면 다시 잰다 — `ChipLabel`과 같은 까닭(대체 글꼴로 먼저 잰다)
 */
function useSteadyMsg(texts: string[]): { box: React.RefObject<HTMLParagraphElement | null>; probe: React.RefObject<HTMLSpanElement | null> } {
  const box = useRef<HTMLParagraphElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const key = texts.join('\u0001');
  useLayoutEffect(() => {
    const el = box.current;
    const pr = probe.current;
    const room = pr?.parentElement;
    if (!el || !pr || !room) return;
    const fit = (): void => {
      let scale = 1;
      // 하한(0.8rem) — 배율이 그 밑으로 안 간다(2026-11-18). 기준 글자가 이미 하한이면 줄이지 않는다
      el.style.setProperty('--msg-scale', '1');
      const minScale = Math.min(1, fontFloorPx() / (parseFloat(getComputedStyle(el).fontSize) || 16));
      for (let i = 0; i < 8; i++) {
        el.style.setProperty('--msg-scale', String(scale));
        const limit = room.clientHeight;
        if (limit <= 0) return;
        let tall = 0;
        for (const s of texts) { pr.textContent = s; tall = Math.max(tall, pr.scrollHeight); }
        pr.textContent = '';
        if (tall <= limit + 0.5) break;
        if (scale <= minScale) break;
        scale = Math.max(minScale, scale * Math.max(0.6, (limit / tall) * 0.97));
      }
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => { /* 못 재도 첫 값으로 돈다 */ });
    document.fonts?.addEventListener('loadingdone', fit);
    const later = [250, 1000].map((ms) => window.setTimeout(fit, ms));
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => { ro.disconnect(); later.forEach((id) => window.clearTimeout(id)); document.fonts?.removeEventListener('loadingdone', fit); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 말 목록은 `key`(원시값)로 본다
  }, [key]);
  return { box, probe };
}

/**
 * 좁은 칸의 글자 한 줄(카드 띠의 「자리 없음」) — 칸 폭이 카드 폭이라 긴 번역(몽골어)은 글자를 줄여 한 줄에 맞춘다.
 * `useFitText`를 안 쓰는 까닭 — 몽골어에서 셋 중 둘이 잘렸다. 처음 잰 때는 대체 글꼴이라 좁았고, 진짜 글꼴이 그 뒤에 그려졌는데 다시 재는 계기
 * (`fonts.ready` · `loadingdone`)가 안 왔다. 그래서 줄인 뒤 **다시 재어 넘치면 또 줄이고**(글자 폭은 크기에 꼭 비례하지 않는다), 처음 몇 초 동안
 * 몇 번 더 잰다. 크기는 **백분율**로 적어 프레임 배율(rem)이 바뀌어도 맞고, 단추 상자(부모) 크기가 바뀌면 다시 잰다 — 글자를 줄여도 단추 폭은
 * 기둥이 정하므로 다시 재기가 끝없이 돌지 않는다
 */
function ChipLabel({ label }: { label: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = (): void => {
      el.style.fontSize = '';
      el.style.whiteSpace = '';
      // 하한(0.8rem) — 백분율로도 그 밑으로는 안 간다. 닿으면 접는다(2026-11-18)
      const minPct = Math.min(100, (fontFloorPx() / (parseFloat(getComputedStyle(el).fontSize) || 16)) * 100);
      let pct = 100;
      for (let i = 0; i < 4 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth && pct > minPct; i++) {
        pct = Math.max(minPct, pct * (el.clientWidth / el.scrollWidth) * 0.98);
        el.style.fontSize = `${pct}%`;
      }
      if (pct <= minPct && el.scrollWidth > el.clientWidth) el.style.whiteSpace = 'normal';
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => { /* 못 재도 첫 값으로 돈다 */ });
    document.fonts?.addEventListener('loadingdone', fit);
    const later = [250, 1000, 2500].map((ms) => window.setTimeout(fit, ms));
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => { ro.disconnect(); later.forEach((id) => window.clearTimeout(id)); document.fonts?.removeEventListener('loadingdone', fit); };
  }, [label]);
  return (
    <span className="sqb-chip-in">
      <span className="sqb-chip-t" ref={ref}>{label}</span>
    </span>
  );
}
