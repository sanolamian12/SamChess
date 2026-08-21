/**
 * AI 대전 **재생 검증** — 실시간 없이, 사람이 낸 의도의 순서만으로 판을 처음부터
 * 끝까지 다시 돌린다.
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 필요한가
 * ────────────────────────────────────────────────────────────────
 *
 * AI 대전은 `LocalTransport`(클라이언트 프로세스)가 판정한다 — 사람 쪽은 물론
 * **AI의 수까지** 클라이언트가 결정한다. 이 파일은 그 판을 **서버가 같은 시드로
 * 다시 재생**할 수 있게 한다 — 결정성 요구(GDD §10 "시드 기반 PRNG를 서버가
 * 소유하고... 리플레이·분쟁 처리를 가능하게 한다")가 예고해 둔 자리다.
 *
 * 사람이 낸 의도만 기록하면 충분하다 — AI의 수(`takeTurn`)도, 시간 진행
 * (`advanceTime`)도, 자동 준비도 전부 **결정적**이라 서버가 처음부터 다시 계산해
 * 낸다. 룰 엔진은 `Date.now()`/`Math.random()`을 쓰지 않으므로(CLAUDE.md) 실시간
 * 마감 없이 그대로 재생할 수 있다 — 로컬 전투에는 애초에 서버가 강제하는 마감이
 * 없다(`LocalTransport`가 마감을 표시만 하고 강제하지 않는다).
 *
 * ────────────────────────────────────────────────────────────────
 * 이 함수가 지어내지 않는 것
 * ────────────────────────────────────────────────────────────────
 *
 * 사람 쪽 로스터·상대 로스터·배치 프리셋은 **밖에서 결정해 넘긴다** — 이 함수는
 * 그 값들을 믿을지 말지 모른다. 부르는 쪽(`server-api`)이 계정에서 직접 로스터를
 * 만들고 시드로 상대를 다시 만들어 넘기는 것이 신뢰 경계다.
 */

import { advanceTime, apply, createBattle, validate } from './battle.ts';
import { takeTurn } from './ai.ts';
import { controllingSide, other } from './state.ts';
import type {
  BattleMode, BattleState, Intent, RosterEntry, Side, UnitId, Vec2,
} from './types.ts';

export interface ReplayInput {
  matchId: string;
  mode: BattleMode;
  seed: number;
  /** 사람 쪽 진영. 언제나 배치 프리셋의 그 진영이다 */
  humanSide: Side;
  rosters: Record<Side, RosterEntry[]>;
  /** 사람 쪽에만 적용한다. 어긋나면(구성이 바뀌었다 등) 조용히 건너뛴다 — `openRoom()`과 같다 */
  deploy: { unit: UnitId; pos: Vec2 }[] | null;
  /** 사람이 낸 의도. 순서 그대로 — 로컬 전투에서 실제로 눌린 순서다 */
  humanIntents: readonly Intent[];
}

export type ReplayResult =
  | { ok: true; state: BattleState }
  | { ok: false; reason: string };

/** 안전장치 — 정상적인 판은 이 안에서 끝난다. 무한 루프가 되면 조작된 로그로 본다 */
const MAX_STEPS = 20_000;

/**
 * `LocalTransport`가 실시간으로 하던 일을 시간 개념 없이 한 번에 끝까지 민다.
 *
 * 사람 차례(제어권이 사람이거나, AI가 이미 준비를 마친 배치 단계)마다 다음
 * `humanIntents`를 하나 꺼내 `validate()` 뒤 `apply()`한다 — 거부되면(조작된
 * 로그) 그 자리에서 실패로 끝낸다. 그 외의 모든 걸음(AI의 수·시간 진행·자동 준비)은
 * 결정적으로 스스로 만든다.
 */
export function replayLocalMatch(input: ReplayInput): ReplayResult {
  const { matchId, mode, seed, humanSide, rosters, deploy, humanIntents } = input;
  const aiSide = other(humanSide);

  let state = createBattle({ matchId, seed, mode, rosters });
  if (deploy && validate(state, humanSide, { t: 'deploy', placements: deploy }).ok) {
    state = apply(state, humanSide, { t: 'deploy', placements: deploy }).state;
  }

  let idx = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (state.phase === 'finished') {
      if (idx !== humanIntents.length) return { ok: false, reason: '쓰지 않은 의도가 남았다' };
      return { ok: true, state };
    }

    if (state.phase === 'deploy' && !state.ready[aiSide]) {
      state = apply(state, aiSide, { t: 'ready' }).state;
      continue;
    }
    if (state.phase === 'scout' || state.phase === 'running') {
      state = advanceTime(state).state;
      continue;
    }
    if (state.phase === 'control') {
      const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
      if (unit && controllingSide(state, unit) !== humanSide) {
        state = takeTurn(state).state;
        continue;
      }
    }

    // 여기 오면 사람 차례다(배치에서 AI가 이미 준비를 마쳤거나, 제어권이 사람이다)
    const intent = humanIntents[idx];
    if (!intent) return { ok: false, reason: '의도가 모자라 판이 안 끝났다' };
    const check = validate(state, humanSide, intent);
    if (!check.ok) return { ok: false, reason: `거부된 의도(${idx}번째, ${intent.t}): ${check.reason}` };
    state = apply(state, humanSide, intent).state;
    idx++;
  }
  return { ok: false, reason: '재생이 끝나지 않았다(무한 루프로 의심된다)' };
}

/**
 * 로그에서 장수별 처치 수를 센다 (GDD §7 랭킹 지표).
 *
 * `unitDied`에는 누가 잡았는지가 없다. 대신 **그 유닛을 겨눈 가장 최근 `attacked`**를
 * 가해자로 본다 — 도트·지형으로 죽으면 아무에게도 세지 않는다. 이벤트에 없는 것을
 * 억지로 만들어 내기보다, 셀 수 있는 것만 세는 편이 낫다.
 *
 * **클라이언트(`battle/boot.ts`)와 서버(`server-api`)가 같은 함수를 써야 한다** —
 * `BattleOutcome.kills`가 여기서 나오므로, 따로 적으면 둘이 언젠가 어긋난다.
 */
export function countKills(state: BattleState, side: Side): Record<string, number> {
  const lastAttacker = new Map<string, string>();
  const kills: Record<string, number> = {};

  for (const ev of state.log) {
    if (ev.e === 'attacked') lastAttacker.set(ev.target, ev.unit);
    else if (ev.e === 'unitDied') {
      const killer = lastAttacker.get(ev.unit) as UnitId | undefined;
      const unit = killer ? state.units[killer] : undefined;
      const victim = state.units[ev.unit];
      // 같은 편을 친 경우(조종당한 유닛 등)는 세지 않는다
      if (!unit || !victim || unit.side !== side || victim.side === side) continue;
      const officer = unit.officer as string;
      kills[officer] = (kills[officer] ?? 0) + 1;
    }
  }
  return kills;
}
