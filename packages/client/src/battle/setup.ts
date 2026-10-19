/**
 * 데모 편성 — 화면 확인용.
 *
 * 편성 화면(GDD §3.9의 「기물 편성」)은 아직 없으므로, 시드에서 결정적으로 뽑아 세운다.
 * 화면을 새로고침해도 같은 판이 나오므로 눈으로 비교하기 쉽다.
 *
 * **전원 Lv9 · 능력은 전부 HP · 책략은 전 레벨 환술** (기획자 지정, 2026-08-03).
 * 이유는 화면 테스트다 — Lv1은 책략이 하나도 없어서 버프·디버프 배지가 아예 생기지 않고,
 * MP를 쓸 데가 없어 「명상」도 의미가 없다. HP 50이면 한두 대에 죽지 않아 상태이상이
 * 화면에 남아 있는 시간도 길어진다. **밸런스 하네스(`tools/balance.ts`)는 여전히 Lv1이다** —
 * 저기까지 바꾸면 5000판 실측치와 비교가 안 된다.
 */

import { COLLECTIONS, OFFICERS, TACTICS, upgradeIdOf } from '@samchess/data';
import { collectionBonusesFor } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { FORMULA, createBattle, hash32, inBounds, legalMovesFor, supplyDepotOf } from '@samchess/rules';
import type {
  BattleMode, BattleState, OfficerId, PieceType, RosterEntry, Side, TacticId, TerrainId, UnitId,
} from '@samchess/rules';

const PIECES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];

/** Lv9까지 8번의 선택 — 전부 HP (10 + 5×8 = 50) */
const STAT_PICKS = Array.from({ length: 8 }, () => 'hp' as const);

/**
 * 레벨 2~9의 환술 8종 — 공포·침묵·함정·탈진·유인·경직·질병·초선.
 * `school`로 거르고 레벨 오름차순으로 세운다 (데이터 순서에 기대지 않는다).
 */
const ILLUSION_TACTICS: TacticId[] = TACTICS
  .filter((t) => t.school === 'illusion')
  .sort((a, b) => a.level - b.level)
  .map((t) => t.id as TacticId);

function roster(seed: number, salt: number, count: number, held?: string, pick?: OfficerId[]): RosterEntry[] {
  const rest = PIECES.filter((p) => p !== 'King');
  for (let i = rest.length - 1; i > 0; i--) {
    const j = hash32(seed, salt * 7717 + i) % (i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const pieces: PieceType[] = ['King', ...rest.slice(0, count - 1)];
  const used = new Set<string>();
  return pieces.map((piece, i) => {
    let officer = OFFICERS[0]!;
    let n = 0;
    const fixed = pick?.[i];
    if (fixed) officer = OFFICERS.find((o) => o.id === fixed)!;
    else do {
      officer = OFFICERS[hash32(seed, salt * 1000 + i * 37 + n++) % OFFICERS.length]!;
    } while (used.has(officer.id));
    used.add(officer.id);
    return {
      officer: officer.id as OfficerId,
      piece,
      level: 9,
      statPicks: STAT_PICKS,       // HP 50 / MP 5 / AT 2
      tactics: ILLUSION_TACTICS,   // 환술 8종
      ...(held ? { held } : {}),
    };
  });
}

export interface DemoOptions {
  /**
   * 시작 SP (양 진영 동일). `?sp=15` 같은 URL 쿼리로 준다.
   *
   * 고유기술은 SP를 4~7 모아야 쓸 수 있어 판이 시작하고 4~7일이 지나야 시전 단계가 열린다.
   * 그때까지 기다리지 않고 **고유기술 시전과 그 결과(버프·무적·조종 등)를 바로 확인**하려고 둔 통로다.
   * 룰 엔진은 건드리지 않는다 — 만들어진 초기 상태의 SP만 올린다.
   */
  sp?: number;
  /**
   * 판 한가운데에 화계·수계·성지를 하나씩 놓는다. `?terrain=1`로 준다.
   *
   * 지형을 만드는 것은 책략 「화계」와 손권 「수성지주」인데 **데모 편성은
   * 환술 8종뿐**이라(위 참조) 판을 아무리 돌려도 지형이 생기지 않는다. 수계
   * (`water`)는 2026-09-03에 그것을 만들던 책략이 지워져 **이 통로가 유일하게
   * 남은 등장 자리**다 — 엔진의 진입 불가 판정을 눈으로 확인하는 데 쓴다. `?sp=15`와
   * 같은 성격의 확인용 통로다 — 룰 엔진은 건드리지 않고 초기 상태에 칸만 얹는다.
   */
  terrain?: boolean;
  /**
   * **남군 전원에게 시장 아이템 하나를 들린다** — `?items=yeong-gi` (2026-09-23).
   *
   * 액티브 아이템은 **장터에서 사서 출전 준비에서 들려 보내야** 판에 오르므로
   * (`marketCarry` → `toRosterEntries`), 계정을 건너뛰는 데모에서는 커맨드
   * 패널의 [아이템]이 **영원히 안 뜬다** — 「도달할 수 없는 갈래」라 스모크가
   * 한 번도 안 도는 자리가 된다(§5-52). `?sp=`·`?terrain=`과 같은 성격의
   * 흉내 통로이고, 엔진은 건드리지 않는다 — 로스터 한 칸을 채울 뿐이다.
   */
  held?: string;
  /**
   * **배치 단계부터 연다** — `?deploy=1` (2026-10-06, 전투 UI 개편 3단계).
   *
   * 데모는 기본 배치 그대로 곧장 전투로 들어가서, 배치 중에만 서는 화면(전원이 두 열로
   * 서는 순서 판 · 숨는 게임 정보)에 **도달할 수 없다** — 계정·서버를 띄워야 보이던 자리다.
   * 엔진은 건드리지 않는다 — `createBattle()`이 낸 배치 단계를 그대로 둘 뿐이다.
   */
  deploy?: boolean;
  /**
   * **남군 군주에게 버프 하나 · 디버프 하나를 걸어 둔다** — `?status=1` (2026-10-06, 전투 UI 개편 6단계).
   *
   * 장수 팝업의 「상태 배지를 누르면 설명」은 **그 순간 누군가 상태를 들고 있어야** 검사가 돈다.
   * 데모 판에서는 운에 달려 있어(곽가 「유언계책」이 마침 걸려 있을 때만) 개편 전부터 대개 건너뛰었다 —
   * 「안 도는 갈래」다. `?terrain=1`과 같은 성격의 흉내 통로이고, 엔진은 건드리지 않는다 — 초기 상태에 얹을 뿐이다.
   */
  status?: boolean;
  /**
   * **고유기술 시전 중인 장면** — `?cast=1` (2026-10-08, 전투 그래픽 마감 3차).
   *
   * 시전 오라(`cast-S/A/B/E`)는 **SP를 모아 고유기술을 실제로 시전해야** 판에 돌고, 데모 편성은 시드가
   * 장수를 고르므로 등급이 운에 달렸다(seed 3에는 A급이 없다). 그래서 북군을 **등급마다 한 명**
   * (S · A · B · E · C 순, 인원만큼)으로 세우고 고유기술이 있는 장수 **전원**을 시전 중으로 둔다.
   * 북군의 WT는 남군 누구보다 늦게 민다 — 내 첫 차례에 넷이 다 돌고 있도록.
   * 엔진은 건드리지 않는다 — 시전 중인 장수는 제 차례가 오면 평소대로 발동한다.
   */
  cast?: boolean;
  /**
   * **컬렉션 전투 효과가 켜진 판** — `?collections=1` (2026-10-14).
   *
   * 효과는 **계정에서 컬렉션을 완성해야** `toRosterEntries()`가 싣고, 데모 편성은 시드가 장수를 고르므로 조건
   * (함께 참전 · 적진에)이 맞을 일이 거의 없다 — 배지 · 발동 알림이 「도달할 수 없는 갈래」다. 그래서 양쪽을
   * 이야기의 인물로 세운다: 남군 유비 · 관우 · 장비(· 조운 · 마초) — 도원결의 · 삼고초려 SP · 오호대장군(5v5),
   * 북군 조조 · 안량 · 문추(· 원소 · 여포) — 영웅론(적진에 유비) · 하북의 두 기둥. **117개를 다 완성했다고 치고**
   * 붙이는 규칙은 계정과 같은 `collectionBonusesFor()`를 그대로 부른다. 조건 판정은 평소대로 엔진이 한다.
   * 발동 알림은 배치에서 전투로 넘어갈 때 뜨므로 `&deploy=1`과 함께 쓴다.
   * 남군의 책략은 하나 걸러 **태학 개량형**으로 갈아 끼운다 — 책략 목록의 옥색 마름모(`ui/upgradeMark.ts`)도 계정 없이는 닿지 않는 갈래다.
   */
  collections?: boolean;
  /**
   * **군량고 탈취 직전** — `?supply=1`(남군이 북군 군량고 앞) · `?supply=2`(북군이 남군 군량고 앞) (2026-10-19).
   *
   * 탈취 장면(카메라 · 1.4초 머묾 · 군량고 뛰기 · 받침 색)은 **누군가 적 군량고까지 걸어 들어가야** 돈다 —
   * 데모 판에서는 한참 걸리거나 King 격파로 먼저 끝나 「도달할 수 없는 갈래」였다. 그 진영의 King 아닌 장수
   * 하나를 **기물 마스크로 적 군량고에 닿는 빈 칸**에 세우고 판 전체에서 가장 먼저 차례가 오게 WT를 당긴다.
   * 남군이면 사람이 [이동]으로 들어가고, 북군이면 AI가 「지금 이길 수 있으면 이긴다」로 들어간다.
   * 엔진은 건드리지 않는다 — 초기 상태에 얹을 뿐이고 판정은 평소대로 `move`가 한다.
   */
  supply?: Side;
}

/** `?supply=`의 장수가 서는 자리 — 적 군량고에 기물 마스크로 닿는 빈 칸 하나 (가까운 칸부터) */
function standAtSupply(state: BattleState, side: Side): void {
  const depot = supplyDepotOf(state, side === 'P1' ? 'P2' : 'P1');
  if (!depot) return;
  const units = Object.values(state.units);
  const mine = units.filter((u) => u.side === side && u.alive).sort((a, b) => Number(a.piece === 'King') - Number(b.piece === 'King'));
  const taken = (p: { x: number; y: number }): boolean => units.some((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y);
  for (const unit of mine) {
    const home = unit.pos;
    for (let r = 1; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const p = { x: depot.x + dx, y: depot.y + dy };
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !inBounds(p, state.boardSize) || taken(p)) continue;
          unit.pos = p;
          if (legalMovesFor(state, unit.id).some((m) => m.x === depot.x && m.y === depot.y)) {
            unit.wt = Math.max(0, Math.min(...units.map((u) => u.wt)) - 1);
            return;
          }
        }
      }
    }
    unit.pos = home;
  }
}

const COLLECTION_LINEUP: Record<1 | 2, OfficerId[]> = {
  1: ['yu-bi', 'gwan-u', 'jang-bi', 'jo-un', 'ma-cho'] as OfficerId[],
  2: ['jo-jo', 'an-ryang', 'mun-chu', 'won-so', 'yeo-po'] as OfficerId[],
};
/** 117개를 다 완성한 계정 — `collectionBonusesFor()`는 `collection`만 읽는다 */
const ALL_DONE = { collection: { slots: {}, completedAt: Object.fromEntries(COLLECTIONS.map((c) => [c.id, 0])) } } as unknown as PlayerProfile;
const withCollections = (entries: RosterEntry[], upgraded = false): RosterEntry[] => entries.map((e) => {
  const bonuses = collectionBonusesFor(ALL_DONE, e.officer, 0);
  // 하나 걸러 갈아 끼운다 — 개량형만 마름모가 서는지(원본에는 안 서는지)를 한 목록에서 함께 본다
  const tactics = upgraded ? e.tactics.map((id, i) => (i % 2 === 0 ? upgradeIdOf.get(id) ?? id : id) as TacticId) : e.tactics;
  return { ...e, tactics, ...(bonuses.length ? { bonuses } : {}) };
});

/** `?cast=1`의 북군 — 등급마다 맨 앞 장수 하나. 고유기술이 없는 C는 맨 뒤(5v5에서만 선다) */
const CAST_GRADES = ['S', 'A', 'B', 'E', 'C'] as const;
const castLineup = (): OfficerId[] =>
  CAST_GRADES.map((g) => OFFICERS.find((o) => o.grade === g)!.id as OfficerId);

export function createDemoBattle(
  seed: number,
  mode: BattleMode = '3v3',
  options: DemoOptions = {},
): BattleState {
  const count = { '3v3': 3, '5v5': 5 }[mode];
  const state = createBattle({
    matchId: `demo-${seed}`,
    seed,
    mode,
    rosters: {
      P1: options.collections
        ? withCollections(roster(seed, 1, count, options.held, COLLECTION_LINEUP[1]), true)
        : roster(seed, 1, count, options.held),
      P2: options.collections
        ? withCollections(roster(seed, 2, count, undefined, COLLECTION_LINEUP[2]))
        : roster(seed, 2, count, undefined, options.cast ? castLineup() : undefined),
    },
  });
  // 배치 화면을 건너뛰고 기본 배치 그대로 시작한다 (`deploy`면 배치 단계부터)
  const started: BattleState = options.deploy ? { ...state }
    : { ...state, phase: 'running', ready: { P1: true, P2: true } };
  if (options.sp !== undefined) {
    const sp = Math.max(0, options.sp);
    started.sp = { P1: Math.min(sp, started.spCap.P1), P2: Math.min(sp, started.spCap.P2) };
  }
  if (options.terrain) {
    // 배치 구역(위아래 5행)을 피해 판 한가운데에 나란히 놓는다. 유닛이 서 있는
    // 칸에 수계를 놓으면 「들어갈 수 없는 칸에 유닛이 있는」 상태가 되어 버린다.
    const mid = { x: Math.floor(FORMULA.board.cols / 2), y: Math.floor(FORMULA.board.rows / 2) };
    started.terrain = (['fire', 'water', 'holy'] as TerrainId[]).map((terrain, i) => ({
      pos: { x: mid.x - 1 + i, y: mid.y },
      terrain,
      lastTickedAt: started.time,
    }));
    /*
     * 성채 3×3도 함께 놓는다 (2026-09-10) — 손권 「수성지주」가 만드는 아홉 조각은
     * **SP를 모아 실제로 시전해야** 나타난다. 조각 하나가 빠지거나 방위가 뒤집힌
     * 것은 아홉 칸을 한꺼번에 봐야 알아채는 종류라, 눈으로 볼 통로를 여기 둔다.
     * 위 홑칸 `holy`는 그대로 남긴다 — **조각 정보가 없는 성지**(옛 판)가 옛 그림
     * 한 장으로 뜨는 갈래도 같은 화면에서 보인다.
     */
    const keep = { x: mid.x + 5, y: mid.y };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        started.terrain.push({
          pos: { x: keep.x + dx, y: keep.y + dy },
          terrain: 'holy',
          lastTickedAt: started.time,
          fort: { side: 'P1', dx, dy },
        });
      }
    }
  }
  if (options.status) {
    const king = started.units['P1-King' as UnitId];
    if (king) {
      // 판이 몇 일 흘러도 남아 있게 넉넉히 (지속시간 단위 = 1/100일)
      const until = started.time + 2000;
      king.statuses = [
        ...king.statuses,
        { status: 'counterattack', expiresAt: until },
        { status: 'outgoingDamageHalf', expiresAt: until },
      ];
    }
  }
  if (options.cast) {
    // 북군의 시전은 내 첫 차례 뒤까지 돌게 둔다 — 남군 누구보다 늦게 차례가 오도록 WT를 민다(안 밀면 대개 먼저 발동해 사라진다)
    const units = Object.values(started.units);
    const last = Math.max(...units.filter((u) => u.side === 'P1').map((u) => u.wt));
    for (const unit of units) {
      const skill = OFFICERS.find((o) => o.id === unit.officer)?.uniqueSkill;
      if (!skill) continue;
      unit.casting = skill as NonNullable<typeof unit.casting>;
      if (unit.side === 'P2') unit.wt = last + 200;
    }
  }
  if (options.supply) standAtSupply(started, options.supply);
  return started;
}

export const officerIdsOf = (state: BattleState): string[] =>
  [...new Set(Object.values(state.units).map((u) => u.officer as string))];
