/**
 * 방어 기록의 리플레이 (2026-10-28, GDD §8.8 단계 5) — **기록을 같은 엔진으로 다시 두는 판정 주체.**
 *
 * 기록에는 시드 · 두 명단 · 두 배치 · **공격자(남군)의 수**만 있다. 북군(수비군)은 그때도 AI(`takeTurn`)였고 엔진이 결정적이라
 * 같은 수를 넣으면 같은 판이 나온다 — 서버의 재생 검증(`replayLocalMatch`)과 같은 걸음을, 이번에는 **연출을 붙여** 한 걸음씩 민다.
 * 규칙이 바뀐 뒤의 기록은 여기 오지 않는다 — 목록이 `replayable`(`REPLAY_VERSION`)로 거른다.
 *
 * `LocalTransport`와 같은 결이다(즉시 답하고, 재생기의 `ready()`를 기다려 다음을 만든다). 다른 것 셋.
 *  - **사람이 없다**(`humanSide = null`) — 단추가 안 선다. 남군의 차례에는 기록에서 다음 수를 꺼낸다.
 *  - **보는 쪽은 방어자**(`viewSide = 'P2'`) — 제 수비군이 아군 색이다.
 *  - **마감이 짧다** — 배치는 열자마자 기록대로 마치고, 정찰은 판을 한 번 보여 줄 만큼(`REPLAY_SCOUT_MS`)만 서 있다.
 *    재생기는 정찰을 「마감이 0이 되거나 [전투 시작]」으로만 넘기므로 마감을 비워 보내면 영원히 선다(defense_ux가 잡았다).
 * 기록이 끝났는데 판이 안 끝났으면(공격자가 60분 방치) 거기서 멈추고 `onExhausted`를 부른다 — 「둔 데까지」(기획자 확정).
 */

import { advanceTime, apply, controllingSide, openReplay, takeTurn, toWire, validate } from '@samchess/rules';
import type {
  BattleEvent, BattleMode, BattleState, DefensePolicy, Intent, RosterEntry, ServerMsg, Side, UnitId, Vec2,
} from '@samchess/rules';
import type { BattleTransport } from './transport.ts';

/** 방어 기록 한 판 — 서버의 `defense_log.replay` + 시드 · 모드 */
export interface DefenseReplay {
  seed: number;
  mode: BattleMode;
  entries: Record<Side, RosterEntry[]>;
  deploy: Record<Side, { unit: UnitId; pos: Vec2 }[] | null>;
  intents: Intent[];
  /** 수성전 판(단계 6)이면 그 판의 종류와 수비군 방침 — 없으면 옛 야전 판 */
  scenario?: 'siege';
  policy?: DefensePolicy;
}

/** 기록의 공격자 진영 — 공성전은 언제나 남군이 친다 */
const ATTACKER: Side = 'P1';

/** 리플레이의 정찰이 서 있는 시간 — 양쪽 배치를 한 번 보여 주고 넘어간다 */
export const REPLAY_SCOUT_MS = 2_000;

export class ReplayTransport implements BattleTransport {
  readonly initial: BattleState;
  readonly humanSide = null;
  readonly viewSide: Side = 'P2';

  private state: BattleState;
  private inbox: ((msg: ServerMsg) => void) | null = null;
  private readonly intents: readonly Intent[];
  private next = 0;
  private stopped = false;
  private readonly onExhausted: () => void;
  private readonly now: () => number;
  /** 정찰이 시작된 실시간 — 통마다 새로 재면 마감이 되살아난다(`LocalTransport`와 같은 규약) */
  private scoutAt: number | null = null;

  constructor(rec: DefenseReplay, onExhausted: () => void = () => {}, now: () => number = Date.now) {
    this.onExhausted = onExhausted;
    this.now = now;
    this.intents = rec.intents;
    // 판의 이름은 서버가 그 공성전을 연 이름과 같다(`meta`의 `aiBattleState`)
    this.initial = openReplay({
      matchId: `siege-${rec.seed}`, mode: rec.mode, seed: rec.seed, humanSide: ATTACKER,
      rosters: rec.entries, deploy: rec.deploy.P1, aiDeploy: rec.deploy.P2,
      ...(rec.scenario ? { scenario: rec.scenario } : {}), ...(rec.policy ? { aiPolicy: rec.policy } : {}),
    });
    this.state = this.initial;
  }

  /** 지금 상태 — 스모크가 「기록의 끝까지 갔다」를 서버 재생과 견준다 */
  get current(): BattleState { return this.state; }
  /** 기록을 다 썼는가 */
  get exhausted(): boolean { return this.stopped; }

  open(inbox: (msg: ServerMsg) => void): void {
    this.inbox = inbox;
    this.emit([]);
    // 배치 — 수비군(AI)이 먼저 준비하고, 공격자는 기록대로 자리를 고친 뒤 준비한다(재생 검증과 같은 순서)
    if (this.state.phase === 'deploy') this.run(() => apply(this.state, other(ATTACKER), { t: 'ready' }));
    while (this.state.phase === 'deploy' && !this.stopped) this.playRecorded();
  }

  send(): void { /* 사람이 없다 */ }

  ready(): void {
    if (!this.inbox || this.stopped) return;
    if (this.state.phase === 'control') {
      const unit = this.state.activeUnit ? this.state.units[this.state.activeUnit] : undefined;
      if (!unit) return;
      if (controllingSide(this.state, unit) === ATTACKER) this.playRecorded();
      else this.run(() => takeTurn(this.state));
      return;
    }
    if (this.state.phase === 'running' || this.state.phase === 'scout') this.run(() => advanceTime(this.state));
  }

  close(): void { this.inbox = null; }

  /** 공격자의 다음 수 — 없거나 지금 엔진이 안 받으면 거기서 멈춘다 */
  private playRecorded(): void {
    const intent = this.intents[this.next];
    if (!intent || !validate(this.state, ATTACKER, intent).ok) {
      this.stopped = true;
      this.onExhausted();
      return;
    }
    this.next += 1;
    this.run(() => apply(this.state, ATTACKER, intent));
  }

  private run(step: () => { state: BattleState; events: BattleEvent[] }): void {
    const r = step();
    this.state = r.state;
    this.emit(r.events);
  }

  private emit(events: BattleEvent[]): void {
    let deadlineInMs: number | null = null;
    if (this.state.phase === 'scout') {
      this.scoutAt ??= this.now();
      deadlineInMs = Math.max(0, REPLAY_SCOUT_MS - (this.now() - this.scoutAt));
    }
    this.inbox?.({ t: 'sync', state: toWire(this.state, null), events, deadlineInMs });
  }
}

const other = (s: Side): Side => (s === 'P1' ? 'P2' : 'P1');
