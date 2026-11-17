/**
 * 부대 배치 편집 — 판 전체 위에서 (pptx 69·72쪽, 2026-09-17)
 *
 * ```
 * [← 뒤로 가기]        부대 배치 편집
 * ┌ 머리 판 ────────────────────────────────────┐
 * │  🗡                                          │ ← [장수 배치] 차례
 * │ [가후] [서황] [감녕]          [남군|북군]      │ ← 꼬마 + 기물 (탭은 공격대만)
 * │  H18    M18    R18                           │ ← 좌표
 * │      '가후'를 배치해주세요.                    │
 * ├ 본 판 ──────────────────────────────────────┤
 * │ [장수 배치]                     미니 맵        │
 * │ [기본 배치로]                   [  지도  ]     │
 * │ [게임 안내]                                   │
 * │ ┌ 15 × 8 창 (좌표 · 화살표 넷) ──────────┐    │
 * │ └──────────────────────────────────────┘    │
 * ├ 조작 판 ────────────────────────────────────┤
 * │ [배치 완료] / [뒤로 가기]                      │
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
 * 두 진영은 **작업본 둘**을 함께 든다
 * ────────────────────────────────────────────────────────────────
 *
 * [남군]·[북군]을 오가도 각자 고친 것이 남아 있어야 한다(기획자 지정) — 그래서 칸
 * 목록을 진영별로 들고(`cells.P1`·`cells.P2`), 마지막 단추 하나가 **둘 다** 넘긴다.
 * 상대 작업본도 진영별이다 — 남군 화면에서 옮겨 본 상대가 북군 화면으로 따라오면
 * 안 된다(거기서 상대는 반대편에 선다).
 *
 * **저장할 수 있는지는 규칙에 묻는다**(`isDeployable`) — 두 진영 모두 통과해야 단추가
 * 켜진다. 기본 배치와 똑같은 진영은 `null`로 넘긴다 — 「배치 없음」과 「기본 배치를
 * 저장함」이 갈리면 기본 배치 규칙이 바뀐 날 옛 좌표가 조용히 남는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 옮기기는 [장수 배치] 한 길이다 (2026-11-17 기획자)
 * ────────────────────────────────────────────────────────────────
 *
 * 옛 「기물을 누르면 노란 칸 → 한 번 더 눌러 놓기」를 걷었다. [장수 배치]를 누르면 머리 판 왼쪽 장수부터(기물 차례 `PIECE_TYPES`)
 * 머리 위에 단검이 서고 「'○○'를 배치해주세요」가 뜬다. 판의 칸을 누르면 —
 *
 * | 누른 칸 | 결과 |
 * |---|---|
 * | 우리 구역 밖 | 「우리군 영역 안에 배치할 수 있습니다 (파란 영역)」, 차례는 그대로 |
 * | 우리 구역의 빈 칸 | 그 자리에 서고 다음 장수로 |
 * | 다른 우리 장수가 선 칸 | 둘이 자리를 바꾸고 다음 장수로 |
 *
 * 한 바퀴를 돌면 꺼진다. 다시 누르면 도중에 멈춘다. 그 밖에서 기물을 누르면 **움직일 수 있는 칸**만 보인다(`legalMoves`,
 * 다른 기물을 장애물로 — 다시 누르면 끈다). 가상의 상대는 이제 옮기지 않는다 — 기본 배치 자리에 선다.
 * **첫 편성 미션(King ↔ Rock)만 옛 몸짓(누르고 놓기 · 두 번 누르기)을 그대로 쓴다** — 미션의 안내 대사 · 단검 계획
 * (`deployMission.ts`)이 그 몸짓에 묶여 있다. 미션 중에도 [장수 배치]로 바꾸면 미션은 자리만 보고 끝난다.
 *
 * ────────────────────────────────────────────────────────────────
 * 수비대는 북군 한 진영 · 수성전 판이다 (2026-11-17 기획자)
 * ────────────────────────────────────────────────────────────────
 *
 * 수비대가 서는 판은 공성전(수비군 = 북군, `SIEGE_DEFENDER`)과 받은 선전포고(받는 쪽 = 북군)뿐이다 —
 * 남군 배치는 저장해도 아무 판에도 안 선다. 그래서 진영 탭을 없애고(깃발도 안 단다 — 2026-11-17 기획자), 판은
 * **수성전 판 그대로** 그린다: 북군 군량고 자리에 성채 3×3(`siegeCastle()` — 전투와 같은 조각 그림),
 * 북군 군량고는 없음, 남군 군량고만(`supplyDepotOf`에 `scenario: 'siege'`). 남군 배치는 `null`로 넘긴다.
 * 공격대는 온라인 야전에서 어느 쪽에 앉을지 모르므로 두 진영 그대로다.
 *
 * ────────────────────────────────────────────────────────────────
 * 확대 창 + 미니맵 (2026-11-17 기획자)
 * ────────────────────────────────────────────────────────────────
 *
 * 25열을 세로 화면 폭에 다 넣으면 칸이 19px이었다. 큰 판은 **가로 15칸 · 세로 8칸 창**이다(기획자 지정 —
 * 정사각일 필요가 없다). 창의 맨 위 줄 · 맨 왼쪽 줄 칸에 좌표(열 A~Y · 행 1~20, 전투 대화창의 `cellName`)를 적고, 판 위 장수는 꼬마로 선다. 칸은 전투 칸 비율(96×120)이라 창은 3 : 2다. 창은 「초점 칸」 하나로 들고 판 끝에서 멈춘다 —
 * 처음 초점은 제 진영 끝 가운데라 창이 제 구역에 붙는다. 옮기는 길은 둘: 미니맵을 누르거나 끌기, 판 네 옆구리의
 * 화살표(더 갈 데가 없는 쪽은 안 보인다). 사람이 고르는 [판 전체] 보기는 없다 — 첫 편성 미션의 끝 마디
 * (상대 · 군량고를 가리킨다)만 같은 틀 안에 판 전체를 그린다.
 * 창은 칸을 **잘라 그릴 뿐** 좌표는 판 그대로다(`data-x` · `data-y`) — 스모크가 고른 칸이 창 밖이면 안 보일 뿐이다.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { officerById } from '@samchess/data';
import { PIECE_TYPES, defaultSquadCells, isDeployable, pendingGuide } from '@samchess/meta';
import { nextSwapMove, swapDone } from './deployMission.ts';
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
import { gameIconUrl, type GameIconName } from '../ui/gameIcon.ts';

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
interface Held { team: Team; piece: PieceType }

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

  const [side, setSide] = useState<Side>(defense ? SIEGE_DEFENDER : 'P1');
  const [focus, setFocus] = useState<Vec2>(() => homeFocus(defense ? SIEGE_DEFENDER : 'P1'));
  const [help, setHelp] = useState(false);
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
  const [held, setHeld] = useState<Held | null>(null);
  const [range, setRange] = useState<Held | null>(null);
  const [asking, setAsking] = useState(false);
  /** [장수 배치] — 지금 자리를 정하는 장수의 차례(머리 판 왼쪽부터). `null`이면 꺼져 있다 */
  const [placing, setPlacing] = useState<number | null>(null);
  /** 머리 판 안내 한 줄의 덧말 — 우리 구역 밖을 눌렀다(`out`) · 다 돌았다(`done`) */
  const [note, setNote] = useState<'out' | 'done' | null>(null);
  /** 배치 미션 — 바꾼 뒤 King을 두 번 눌러 움직일 칸을 봤나(판 아래 안내 2줄을 해 보는 걸음) */
  const [ranged, setRanged] = useState(false);

  const ours = cells[side];
  const theirs = enemy[side];
  /** 장수 배치의 차례 — 머리 판에 선 차례 그대로(기물 차례 `PIECE_TYPES`, 부대 목록의 줄과 같다) */
  const order: SquadCell[] = PIECE_TYPES.flatMap((p) => ours.filter((c) => c.piece === p));
  const officerOf = (piece: PieceType) => {
    const id = squad.picks.find((p) => p.piece === piece)?.officer;
    return id ? officerById.get(id) : undefined;
  };
  const nameOf = (piece: PieceType): string => { const d = officerOf(piece); return d ? pickOfficerName(d) : piece; };
  const placingCell = placing !== null ? order[placing] ?? null : null;
  const listOf = (team: Team): SquadCell[] => (team === 'ours' ? ours : theirs);
  const zoneOf = (team: Team) => deployZone(mode, team === 'ours' ? side : other(side));

  const occupant = (x: number, y: number): { team: Team; cell: SquadCell } | null => {
    const o = ours.find((c) => c.x === x && c.y === y);
    if (o) return { team: 'ours', cell: o };
    const e = theirs.find((c) => c.x === x && c.y === y);
    return e ? { team: 'enemy', cell: e } : null;
  };

  /* 한 번 누른 기물이 설 수 있는 칸 — 제 진영 구역의 빈 칸 */
  const canGo = (x: number, y: number): boolean =>
    held !== null && inZone(zoneOf(held.team), { x, y }) && occupant(x, y) === null;

  /* 두 번 누른 기물이 움직일 수 있는 칸 — 다른 기물을 장애물로(막힌 칸·가로막힌 길은 빠진다) */
  const rangeCells: Set<string> = (() => {
    if (!range) return new Set();
    const me = listOf(range.team).find((c) => c.piece === range.piece);
    if (!me) return new Set();
    const blocked = (p: Vec2): boolean =>
      !(p.x === me.x && p.y === me.y) && occupant(p.x, p.y) !== null;
    return new Set(legalMoves(range.piece, { x: me.x, y: me.y }, { blocked }).map((p) => `${p.x},${p.y}`));
  })();

  const move = (x: number, y: number): void => {
    if (!held) return;
    const update = (list: SquadCell[]): SquadCell[] =>
      list.map((c) => (c.piece === held.piece ? { ...c, x, y } : c));
    if (held.team === 'ours') {
      setCells((prev) => ({ ...prev, [side]: update(prev[side]) }));
      setTouched((prev) => ({ ...prev, [side]: true }));
    } else {
      setEnemy((prev) => ({ ...prev, [side]: update(prev[side]) }));
    }
    setHeld(null);
  };

  /*
   * [장수 배치] (2026-11-17 기획자) — 머리 판 왼쪽 장수부터 한 명씩 칸을 누르면 그 자리에 선다. 우리 구역 밖이면 안내만 하고 그 장수를
   * 다시 고르게 둔다. 다른 우리 장수가 선 칸이면 둘이 자리를 바꾼다(빈 칸으로만 옮기면 「가운데 둘을 바꾸기」가 세 번 옮김이 된다)
   */
  const startPlacing = (): void => {
    setHeld(null); setRange(null);
    if (placing !== null) { setPlacing(null); setNote(null); return; }
    setPlacing(0); setNote(null);
  };
  const place = (x: number, y: number): void => {
    if (!placingCell || placing === null) return;
    if (!inZone(myZone, { x, y })) { setNote('out'); return; }
    const me = placingCell;
    const other = ours.find((c) => c.x === x && c.y === y && c.piece !== me.piece);
    setCells((prev) => ({
      ...prev,
      [side]: prev[side].map((c) => (c.piece === me.piece ? { ...c, x, y }
        : other && c.piece === other.piece ? { ...c, x: me.x, y: me.y } : c)),
    }));
    setTouched((prev) => ({ ...prev, [side]: true }));
    const next = placing + 1;
    if (next >= order.length) { setPlacing(null); setNote('done'); } else { setPlacing(next); setNote(null); }
  };

  const onCell = (x: number, y: number): void => {
    if (placing !== null) { place(x, y); return; }
    const occ = occupant(x, y);
    // 미션 밖에서는 기물을 누르면 움직일 칸만 보인다(옮기기는 [장수 배치]) — 다시 누르면 끈다
    if (!missionOn) {
      setHeld(null);
      setRange(occ && !(range && range.team === occ.team && range.piece === occ.cell.piece) ? { team: occ.team, piece: occ.cell.piece } : null);
      return;
    }
    setRange(null);
    if (occ) {
      setHeld(held && held.team === occ.team && held.piece === occ.cell.piece
        ? null : { team: occ.team, piece: occ.cell.piece });
      return;
    }
    if (canGo(x, y)) move(x, y);
    else setHeld(null);
  };

  const onDouble = (x: number, y: number): void => {
    if (placing !== null) return;
    const occ = occupant(x, y);
    if (!occ) return;
    setHeld(null);
    setRange({ team: occ.team, piece: occ.cell.piece });
    if (occ.team === 'ours' && occ.cell.piece === 'King' && side === 'P1') setRanged(true);
  };

  const switchSide = (next: Side): void => {
    setSide(next); setHeld(null); setRange(null); setFocus(homeFocus(next)); setPlacing(null); setNote(null);
  };

  const resetSide = (): void => {
    setCells((prev) => ({ ...prev, [side]: defaults(side) }));
    setEnemy((prev) => ({ ...prev, [side]: enemyCells(mode, other(side)) }));
    setTouched((prev) => ({ ...prev, [side]: true }));
    setHeld(null); setRange(null); setPlacing(null); setNote(null);
  };

  // 수비대는 북군만 본다 — 남군은 넘기지 않으니(`result`) 물을 것도 없다
  const ok = defense
    ? isDeployable(profile, squad, SIEGE_DEFENDER, cells[SIEGE_DEFENDER])
    : isDeployable(profile, squad, 'P1', cells.P1) && isDeployable(profile, squad, 'P2', cells.P2);

  /*
   * 첫 편성의 배치 미션 (2026-11-13 기획자) — 기본 배치는 King을 왼쪽에 세운다. King을 가운데로, 가운데 기물(Rock)을 왼쪽으로 바꾸게 한다.
   * 남군(P1) 판에서만. 다음에 누를 곳 하나에 단검(`ui/turn/dagger.png` — 전투의 「내 차례」 표지)을 꽂고 그 칸이 빛난다 — 옮길 기물을
   * 안 집었으면 그 기물, 집었으면 갈 칸. 계획은 `deployMission.ts`가 지금 자리에서 매번 다시 낸다
   */
  const goal: SwapGoal = {
    center: defaultDeployPos(mode, 'P1', 1), left: defaultDeployPos(mode, 'P1', 0),
    other: squad.picks[1]?.piece ?? 'Rock', zone: deployZone(mode, 'P1'),
  };
  const missionOn = mission && mode === '3v3' && side === 'P1';
  const swapped = swapDone(cells.P1, goal);
  const nextMove = missionOn && !swapped ? nextSwapMove(cells.P1, goal) : null;
  // 바꾼 뒤에는 King을 두 번 눌러 보게 한다(판 아래 안내 2줄) — 단검은 King에
  const rangeStep = missionOn && swapped && !ranged;
  const missionAt: Vec2 | null = rangeStep ? cells.P1.find((c) => c.piece === 'King') ?? null
    : !nextMove ? null
      : held?.team === 'ours' && held.piece === nextMove.piece ? nextMove.to
        : cells.P1.find((c) => c.piece === nextMove.piece) ?? null;
  /** 바꾸기 · 두 번 누르기 동안은 남군 쪽을 크게 — 끝 마디(가상의 상대 · 군량고)에서 판 전체로 돌아온다 */
  const zoom = missionOn && !(swapped && ranged);
  const guide = useGuide(profile, onProfile, asking ? null : pendingGuide(profile, 'squadDeploy', {
    squad: mission, swapped, held: held?.team === 'ours', ranged,
  }), 'squadDeploy');

  /** 기본 배치와 같은 진영은 `null` — 「배치 없음」 하나로 둔다(머리말 참조). 수비대의 남군은 언제나 `null` */
  const result = (): Squad['deploy'] => ({
    P1: defense || sameCells(cells.P1, defaults('P1')) ? null : cells.P1,
    P2: sameCells(cells.P2, defaults('P2')) ? null : cells.P2,
  });

  const finish = (): void => {
    // 새 부대를 **한 번도 안 만지고** 끝내면 기본 배치라는 것을 한 번 알린다(72쪽)
    if (isNew && !touched.P1 && !touched.P2) { setAsking(true); return; }
    onSave(result());
  };

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
  const myZone = deployZone(mode, side);
  const foeZone = deployZone(mode, other(side));
  /** 미니맵의 성채 — 아홉 칸을 한 네모로 */
  const castleBox = defense ? {
    x0: SIEGE_CASTLE_CENTER.x - SIEGE_CASTLE_RADIUS, y0: SIEGE_CASTLE_CENTER.y - SIEGE_CASTLE_RADIUS,
    x1: SIEGE_CASTLE_CENTER.x + SIEGE_CASTLE_RADIUS, y1: SIEGE_CASTLE_CENTER.y + SIEGE_CASTLE_RADIUS,
  } : null;

  const guideLines = [
    t('deploy.guide.move'), t('deploy.guide.swap'), t('deploy.guide.range'), t('deploy.guide.enemy'), t('deploy.guide.view'),
    t(defense ? 'deploy.guide.castle' : 'deploy.guide.supply'),
  ];
  /** 머리 판 안내 한 줄 — 구역 밖을 눌렀으면 그 말이 먼저(차례는 그대로 열려 있다) */
  const msgKind = note === 'out' ? 'warn' : placingCell ? 'ask' : note === 'done' ? 'done' : 'idle';
  const msg = msgKind === 'warn' ? t('deploy.place.out')
    : msgKind === 'ask' && placingCell ? (() => { const who = nameOf(placingCell.piece); return t('deploy.place.ask', { who, o: josaOf(who, '을를') }); })()
      : msgKind === 'done' ? t('deploy.place.done') : t('deploy.place.idle');

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-edit scr-squad-deploy"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadDeploy" data-side={side} data-mode={mode} data-role={defense ? 'defense' : 'attack'}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('match.back'))}
        </button>
        <span className="place-nm">{t('deploy.editTitle')}</span>
      </div>

      <div className="place-body">
        {/* 머리 판 — 장수와 좌표 한 쌍씩(최대 다섯, 2026-11-17 기획자). [장수 배치] 중이면 차례인 장수 머리 위에 단검(전투의 「내 차례」 표지) */}
        <section className="place-panel sqe-top sqb-head" data-field="deployHead">
          <div className="sqb-head-row">
            <div className="sqb-roster">
              {order.map((c, i) => {
                const data = officerOf(c.piece);
                return (
                  <span key={c.piece} className="sqb-who" data-field="deployWho" data-piece={c.piece} data-turn={placing === i ? '1' : undefined}>
                    <span className="sqb-who-fig">
                      {placing === i && <img className="sqb-who-turn" src="ui/turn/dagger.png" alt="" draggable={false} />}
                      {data && <OfficerStand officer={data.id} title={pickOfficerName(data)} />}
                      <img className="sqb-who-piece" src={pieceArtUrl(c.piece, side === 'P1')} alt={c.piece} draggable={false} />
                    </span>
                    <span className="sqb-who-at" data-field="at">{cellName(c)}</span>
                  </span>
                );
              })}
            </div>
            {/* 남군 · 북군 — 공격대만(수비대는 북군뿐이라 탭도 깃발도 없다, 2026-11-17 기획자) */}
            {!defense && (
              <div className="sqb-sides" role="tablist">
                {(['P1', 'P2'] as Side[]).map((s) => (
                  <button
                    key={s}
                    role="tab"
                    className={`sqb-side${side === s ? ' on' : ''}`}
                    data-action="deploySide"
                    data-side={s}
                    data-on={side === s ? '1' : '0'}
                    aria-selected={side === s}
                    aria-label={t(s === 'P1' ? 'squad.deploy.p1' : 'squad.deploy.p2')}
                    title={t(s === 'P1' ? 'squad.deploy.p1' : 'squad.deploy.p2')}
                    onClick={() => switchSide(s)}
                  >
                    <img className="sqb-flag" src={s === 'P1' ? 'ui/gi/army-south.png' : 'ui/gi/army-north.png'} alt="" draggable={false} />
                    {side === s && <img className="sqb-flag-on" src="icons/tutorial/next.png" alt="" draggable={false} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="sqb-msg" data-field="deployMsg" data-kind={msgKind}>{msg}</p>
        </section>

        <section className="place-panel sqb-panel">
          <div className="sqb-toolbar">
            {/* 왼쪽 — 단추 셋을 한 기둥으로(2026-11-17 기획자): [장수 배치] · [기본 배치로] · [게임 안내] */}
            <div className="sqb-tools">
              <button
                className={`sqb-chip${placing !== null ? ' on' : ''}`} data-action="deployPlace" data-on={placing !== null ? '1' : '0'}
                aria-pressed={placing !== null} onClick={startPlacing}
              >
                <ChipLabel icon="goal-reach" label={t('deploy.place')} />
              </button>
              <button className="sqb-chip" data-action="deployReset" onClick={resetSide}>
                <ChipLabel icon="cmd-reset" label={t('deploy.reset')} />
              </button>
              <button className="sqb-chip" data-action="deployHelp" onClick={() => setHelp(true)}>
                <ChipLabel icon="guide-info" label={t('deploy.help')} />
              </button>
            </div>

            {/* 미니맵 — 판 전체 · 진영 구역 · 기물 · 지금 보는 창. 누르거나 끌면 큰 판이 그리로 간다 */}
            <div className="sqb-minibox">
              <h3 className="sqb-mini-ttl">{t('deploy.mini.title')}</h3>
              <p className="sqb-mini-hint">{t('deploy.mini.hint')}</p>
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
                  <rect
                    key={`${tm}-${c.piece}`}
                    className={`mpiece ${tm}${held && held.team === tm && held.piece === c.piece ? ' held' : ''}`}
                    x={c.x - 0.15} y={c.y - 0.15} width={1.3} height={1.3}
                  />
                )))}
                {!whole && <rect className="mwin" x={win.x0} y={win.y0} width={win.w} height={win.h} vectorEffect="non-scaling-stroke" />}
              </svg>
            </div>
          </div>

          {/* 판 무대 — 화살표는 판 **바깥**(좌우는 판때기 테, 위는 도구 줄 가운데, 아래는 밑 테)에 선다.
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
            data-held={held ? `${held.team}:${held.piece}` : ''}
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
              const isHeld = occ && held && held.team === occ.team && held.piece === occ.cell.piece;
              const who = occ?.team === 'ours'
                ? squad.picks.find((p) => p.piece === occ.cell.piece)?.officer : undefined;
              const data = who ? officerById.get(who) : undefined;
              return (
                <button
                  key={`${x},${y}`}
                  className={`sqb-cell${canGo(x, y) ? ' can' : ''}${rangeCells.has(`${x},${y}`) ? ' range' : ''}${isHeld ? ' held' : ''}`}
                  data-x={x}
                  data-y={y}
                  data-zone={zone}
                  data-team={occ?.team ?? ''}
                  data-piece={occ?.cell.piece ?? ''}
                  data-depot={depot}
                  data-fort={fort ? '' : undefined}
                  data-mission={missionAt && missionAt.x === x && missionAt.y === y ? '1' : undefined}
                  data-guide-cue={missionAt && missionAt.x === x && missionAt.y === y ? '' : undefined}
                  title={occ ? `${occ.cell.piece}${data ? ` · ${pickOfficerName(data)}` : ''}` : undefined}
                  onClick={() => onCell(x, y)}
                  onDoubleClick={() => onDouble(x, y)}
                >
                  {fort && <img className="sqb-fort" src={terrainUrl(terrainArt(fort))} alt="" draggable={false} />}
                  {depot && (
                    <img
                      className="sqb-depot" src={terrainUrl(SUPPLY_ART)} alt="" draggable={false}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  {occ?.team === 'ours' && data && <OfficerStand officer={data.id} className="sqb-stand" />}
                  {occ?.team === 'ours' && !data && <span className="sqb-letter">{LETTER[occ.cell.piece]}</span>}
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

        {/* 조작 판 — [배치 완료] 위 · [뒤로 가기] 아래 두 줄 (2026-11-17 기획자) */}
        <section className="place-panel sqd-acts sqb-acts">
          <button className="btn primary wide" data-action="deploySave" data-guide-cue={missionOn && swapped && ranged && ok ? '' : undefined} disabled={!ok} onClick={finish}>
            {doneLabel ?? (isNew ? t('deploy.done.new') : t('squad.save.edit'))}
          </button>
          <button className="btn wide" data-action="deployBackBottom" onClick={onBack}>
            {stripBackArrow(t('match.back'))}
          </button>
        </section>
      </div>

      {help && (
        <div className="modal-back" data-modal="deployHelp" onClick={() => setHelp(false)}>
          <div className="modal sqd-modal sqb-confirm sqb-help-modal" onClick={(e) => e.stopPropagation()}>
            <ul className="sqb-guide">
              {guideLines.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
            <div className="sqd-acts">
              <button className="btn primary wide" data-action="deployHelpOk" onClick={() => setHelp(false)}>
                {t('deploy.defaultConfirm.ok')}
              </button>
            </div>
          </div>
        </div>
      )}

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
 * 도구 단추 한 장의 속 — 그림 + 글자. 단추 기둥 폭이 정해져 있어(위 화살표 자리) 긴 번역(몽골어 「Жанжин байрлуулах」)은 글자를 줄여 한 줄에 맞춘다.
 * `useFitText`를 안 쓰는 까닭 — 몽골어에서 셋 중 둘이 잘렸다. 처음 잰 때는 대체 글꼴이라 좁았고, 진짜 글꼴이 그 뒤에 그려졌는데 다시 재는 계기
 * (`fonts.ready` · `loadingdone`)가 안 왔다. 그래서 줄인 뒤 **다시 재어 넘치면 또 줄이고**(글자 폭은 크기에 꼭 비례하지 않는다), 처음 몇 초 동안
 * 몇 번 더 잰다. 크기는 **백분율**로 적어 프레임 배율(rem)이 바뀌어도 맞고, 단추 상자(부모) 크기가 바뀌면 다시 잰다 — 글자를 줄여도 단추 폭은
 * 기둥이 정하므로 다시 재기가 끝없이 돌지 않는다
 */
function ChipLabel({ icon, label }: { icon: GameIconName; label: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = (): void => {
      el.style.fontSize = '';
      let pct = 100;
      for (let i = 0; i < 4 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth; i++) {
        pct *= (el.clientWidth / el.scrollWidth) * 0.98;
        el.style.fontSize = `${pct}%`;
      }
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
      <img src={gameIconUrl(icon)} alt="" draggable={false} />
      <span className="sqb-chip-t" ref={ref}>{label}</span>
    </span>
  );
}
