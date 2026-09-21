/**
 * 도적떼 방어전 — 전용 판 · 성채 · 도적 편성 (GDD §5.11, 2026-09-21)
 *
 * ```
 *  y  0 ┬───────────────────────┐  북쪽 진영 25×5 — 도적 (P2)
 *     5 ┤                       │  중립 25×5
 *    10 ┤                       │  남쪽 진영 25×5 — 파수꾼 (P1)
 *    11 ┤         ┌───┐         │  성채 x 11–13 · y 11–13
 *    12 ┤         │ K │         │  파수꾼 King (12, 12) 고정
 *    13 ┤         └───┘         │
 *    14 ┴───────────────────────┘
 * ```
 *
 * **대전과 갈리는 것은 전부 여기 모인다** — 판 크기 · 배치 구역 · 기본 자리 · 처음부터
 * 서 있는 지형 · King 고정. 엔진(`battle.ts`·`state.ts`)은 `state.scenario`를 보고 이
 * 파일의 함수를 부를 뿐이고 좌표를 다시 적지 않는다.
 *
 * 이 파일은 `battle.ts`·`state.ts`를 **값으로** import하지 않는다(순환 참조 방지 —
 * `state.ts`가 이쪽을 부른다).
 */

import { GROWTH, RAID } from '@samchess/data';
import type { DeployZone } from './state.ts';
import type { BattleMode, OfficerId, PieceType, RosterEntry, Side, TerrainTile, Vec2 } from './types.ts';

/** 25열 × 15행 */
export const RAID_BOARD: Readonly<Vec2> = { x: 25, y: 15 };
export const RAID_CAMP_DEPTH = 5;

/** 파수꾼은 남쪽(아래) — 대전의 P1과 같은 쪽이다 */
export const GUARD_SIDE: Side = 'P1';
export const BANDIT_SIDE: Side = 'P2';

/** 성채 3×3의 중심 = 파수꾼 King의 고정 자리. 기획자 표기로는 남쪽 진영 `[13, 3]` */
export const RAID_CASTLE_CENTER: Readonly<Vec2> = { x: 12, y: 12 };
export const RAID_CASTLE_RADIUS = 1;

/** 진영 = 판 전체 폭 × 5행. 인원(1~5)과 무관하다 — 대전의 `인원 × 5` 폭과 다른 점이다 */
export function raidZone(side: Side): DeployZone {
  const x1 = RAID_BOARD.x - 1;
  return side === GUARD_SIDE
    ? { x0: 0, x1, y0: RAID_BOARD.y - RAID_CAMP_DEPTH, y1: RAID_BOARD.y - 1 }
    : { x0: 0, x1, y0: 0, y1: RAID_CAMP_DEPTH - 1 };
}

/**
 * 기본 자리 — 진영을 5칸 폭 다섯 필드로 나누고 **King이 가운데**, 나머지가 편성 순서대로
 * 안쪽부터 바깥으로 선다. 세로는 진영의 가운데 줄이다. 파수꾼 King의 자리가 곧 성채의
 * 중심이라, 이 식이 성채 좌표와 어긋나면 회귀가 잡는다.
 */
const FIELD_X = [12, 7, 17, 2, 22] as const;

export function raidDefaultPositions(side: Side, pieces: readonly PieceType[]): Vec2[] {
  const zone = raidZone(side);
  const y = zone.y0 + Math.floor(RAID_CAMP_DEPTH / 2);
  let next = 1;
  return pieces.map((piece) => ({ x: piece === 'King' ? FIELD_X[0] : FIELD_X[next++]!, y }));
}

/**
 * 처음부터 서 있는 성채 — 손권 「수성지주」와 **같은 지형**(성지)이고 같은 조각 정보를 싣는다.
 * 그래서 새 그림도 새 판정도 없다. 사라지지 않는다(성지에는 원래 지속시간이 없다).
 */
export function raidCastle(): TerrainTile[] {
  const out: TerrainTile[] = [];
  const c = RAID_CASTLE_CENTER;
  for (let dy = -RAID_CASTLE_RADIUS; dy <= RAID_CASTLE_RADIUS; dy++) {
    for (let dx = -RAID_CASTLE_RADIUS; dx <= RAID_CASTLE_RADIUS; dx++) {
      out.push({
        pos: { x: c.x + dx, y: c.y + dy },
        terrain: 'holy',
        lastTickedAt: 0,
        fort: { side: GUARD_SIDE, dx, dy },
      });
    }
  }
  return out;
}

/** 농지 최대 레벨 = 도적 최대 수 (추출기가 둘을 맞춰 둔다) */
export const MAX_BANDITS = RAID.banditPieces.length;

export const banditOfficerId = (piece: PieceType): OfficerId => `bandit-${piece}` as OfficerId;

/**
 * 도적 편성 — 농지 레벨 n이면 `King · Queen · Rock · Bishop · Knight`의 앞 n개,
 * 레벨도 n이고 레벨업마다 HP → AT → HP … 번갈아 찍는다. 책략은 없다.
 *
 * **서버와 클라이언트가 같은 함수로 만든다** — 재생 검증(`replayLocalMatch`)이
 * 클라이언트가 보낸 도적을 믿지 않고 농지 레벨에서 다시 만드는 것이 신뢰 경계다.
 */
export function banditRoster(farmLevel: number): RosterEntry[] {
  if (!Number.isInteger(farmLevel) || farmLevel < 1 || farmLevel > MAX_BANDITS) {
    throw new Error(`농지 레벨 범위 밖: ${farmLevel}`);
  }
  if (farmLevel > GROWTH.maxLevel) throw new Error(`도적 레벨 ${farmLevel}이 최대 레벨을 넘는다`);
  const growth = RAID.bandit.growth;
  const statPicks = Array.from({ length: farmLevel - 1 }, (_, i) => growth[i % growth.length]!);
  return RAID.banditPieces.slice(0, farmLevel).map((piece) => ({
    officer: banditOfficerId(piece),
    piece,
    level: farmLevel,
    statPicks,
    tactics: [],
  }));
}

/**
 * 도적떼 판의 `mode` — **인원이 아니라 보상 등급이다.** 파수꾼 3명 이하면 `3v3`, 4명
 * 이상이면 `5v5`의 승리 보상을 받는다(GDD §5.11).
 *
 * `BattleMode`에 `'raid'`를 더하지 않은 이유: 이 타입이 전투력 계수·보상·전적 칸의
 * 열쇠로 수십 곳에 퍼져 있어, 값 하나를 더하면 그 표 전부가 「도적떼 칸」을 가져야
 * 한다. 판이 도적떼인지는 `BattleState.scenario`가 말한다.
 */
export const raidMode = (guards: number): BattleMode => (guards <= 3 ? '3v3' : '5v5');
