/**
 * 전투 단계의 **실시간** 제한 (GDD §3.9) — 단일 출처.
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 룰 엔진에 있나 — **시계가 아니라 눈금이라서** ★
 * ────────────────────────────────────────────────────────────────
 *
 * 엔진은 시계를 갖지 않는다(`Date.now()` 금지). 절대시간(`time`)은 전투가 시작해야
 * 흐르고, 배치·정찰·제어는 **실시간**이라 재는 주체가 따로 있다 —
 * 지금은 클라이언트, 온라인에서는 **서버**다.
 *
 * 그 「재는 주체」가 둘이 되는 순간, 상수가 두 벌이면 **어긋나도 화면은 아무 말도
 * 하지 않는다**: 카운트다운이 0인데 서버는 아직 안 넘기거나, 서버가 넘겼는데
 * 화면은 아직 15초가 남았다고 적는다. 그래서 값은 여기 하나에 두고
 * **클라이언트도 서버도 다시 적지 않는다** — `ONLINE_SEARCH_MS`(매칭 30초)를
 * `@samchess/meta`에 두고 화면이 다시 안 적게 한 것과 같은 규약이다.
 *
 * **여기 있는 것은 값뿐이고 시계는 없다.** 지금 몇 시인지를 읽는 자리는 여전히
 * 클라의 `App.tsx`와 (앞으로) 서버의 `clock.ts` 하나씩이다.
 *
 * > **`types.ts`의 `BattlePhase` 주석이 낡아 있었다** — 「배치 60초 · 정찰 15초」로
 * > 적혀 있는데 2026-08-04에 **둘 다 30초로** 조정됐다(GDD §3.9). 코드는 처음부터
 * > `playback.ts`의 값을 읽고 있어 **동작은 멀쩡했고 실행으로는 안 잡혔다.**
 * > 숫자를 한 군데로 모아 그 주석이 값을 다시 적을 이유를 없앤다.
 */
import type { BattleState, Side } from './types.ts';

/**
 * 배치 — 진영 안에서 자리를 잡는다. 원안은 60초였다.
 *
 * **배치가 길면 판이 늘어진다** (2026-08-04 기획자 조정). 기물 몇 개를 옮기는 데
 * 1분은 과하고, 오히려 서로를 살펴보는 정찰이 짧았다. 둘을 30초로 맞췄고
 * 전투 이전 단계 전체는 그대로 1분이다.
 */
export const DEPLOY_MS = 30_000;

/**
 * 상대 준비 대기 (GDD §3.9). 초과하면 커넥션 체크 → 끊겼으면 안내 후 종료.
 *
 * **오프라인에서는 한 번도 돌지 않는다** — AI는 곧바로 준비를 마치므로 `waiting`
 * 단계가 엔진에도 화면에도 나타나지 않는다. 사람 둘이 붙는 날 처음 돈다.
 */
export const WAITING_MS = 60_000;

/** 정찰 — 양측 기물을 살펴본다. 원안 15초에서 30초로 (위 `DEPLOY_MS` 참조) */
export const SCOUT_MS = 30_000;

/** 정찰은 끝까지 세되 **마지막 5초만** 카운트다운을 보여준다 (GDD §3.9) */
export const SCOUT_COUNTDOWN_MS = 5_000;

/**
 * 제어 제한시간 (GDD §3.3). 초과하면 **상대 화면에** `[차례 넘기기]`가 노출된다.
 *
 * **서버는 재되 먼저 움직이지 않는다** — 넘기는 것은 상대의 선택이고, 서버는
 * `forceSkipTurn` 의도가 왔을 때 정말 20초가 지났는지 검증한다. 그 판정에 쓰는
 * 기준점이 `BattleState.controlStartedAtMs`이고, **그 값은 서버가 주입한다.**
 *
 * **오프라인에는 이 제한이 없다** — 혼자 두는 판에서 20초를 재면 생각할 시간을
 * 뺏을 뿐 지킬 상대가 없다. `LocalTransport`가 제어 단계에 마감을 두지 않는 이유다.
 */
export const CONTROL_MS = 20_000;

/**
 * 재생 속도 — **실시간 1초 = 절대시간 100** (GDD §3.3).
 *
 * 위의 제한들이 실시간 ms인데 전투의 시계는 절대시간이라, 둘을 견주려면 환산이
 * 필요하다. 그 환산이 여기 있어야 제한들과 **같이** 낡거나 같이 산다.
 */
export const TIME_PER_SECOND = 100;

/**
 * `[차례 넘기기]`를 **먼저 이만큼 누른 쪽이 이긴다** (GDD §3.3 · §3.9 · §5-67).
 *
 * 「붙어 있는데 아무것도 안 두는」 쪽을 끝내는 장치다. 제어 단계에서는 절대시간이
 * 멈춰 `time 6000` 무승부 상한에 **영원히 못 닿고**, King이 멀리 있으면 잡을 수도
 * 없어 판이 안 끝난다. 한 번 누르려면 상대가 `CONTROL_MS`를 통째로 흘려보내야 하므로
 * **3번은 최소 60초의 무응답**이다 — 「잠깐 딴 데 봤다」가 아니다.
 *
 * **횟수는 누적**이고(한 판 동안 세고 되돌리지 않는다) 화면에 **「(2/3)」로 보인다** —
 * 누르면 승리에 가까워지는 단추가 아무 말도 안 하면 안 된다.
 */
export const SKIP_TO_WIN = 3;

/**
 * 재접속 유예 (§5-69). 이 시간을 넘겨 안 돌아오면 **「사라졌다」**로 판정한다(GDD §3.9).
 *
 * **`SKIP_TO_WIN`이 이 값을 정한다** — 넘기기 3번은 **내 제어 창 세 번**이라
 * `CONTROL_MS × SKIP_TO_WIN = 60초`가 **하한**이고, 그 사이에 상대의 턴들이 끼므로
 * 실제로는 더 길다. 유예를 그 하한과 같게 두면 **돌아온 사람이 언제나 3번에 닿기 전에
 * 도착한다**(제 차례에 1초라도 두면 그 턴은 세어지지 않는다).
 *
 * `WAITING_MS`와 **같은 수인 것이 우연이 아니다** — 「상대가 올 때까지 기다리는 시간」으로
 * 같은 것을 재고 있다.
 */
export const RECONNECT_GRACE_MS = 60_000;

/**
 * 방 유휴 상한 (§5-68). **어느 쪽에서도 의도가 안 오면** 방을 접고 양쪽 환불한다.
 *
 * ⚠ **`RECONNECT_GRACE_MS`보다 길어야 한다.** 짧으면 **돌아오는 중인 사람이 먼저
 * 잘린다** — 끊긴 사람은 유휴한 사람이기도 해서 두 규칙이 겹치는 유일한 자리다.
 *
 * `SKIP_TO_WIN`과는 **겹치지 않는다**: 누르는 사람이 있으면 방은 유휴가 아니고,
 * 아무도 안 누르면 3번에 닿을 일이 없다.
 */
export const ROOM_IDLE_MS = 120_000;

/**
 * 방을 접기 전 마지막으로 기다리는 세 값의 **관계**가 규칙 그 자체다 (§5-67~69).
 * 하나만 고치면 **화면은 아무 말도 하지 않으므로** 여기 적고 회귀가 고정한다.
 *
 * ```
 * WAITING_MS === RECONNECT_GRACE_MS            같은 기다림을 잰다
 * RECONNECT_GRACE_MS <= CONTROL_MS * SKIP_TO_WIN   돌아온 사람은 3번에 닿기 전에 도착한다
 * ROOM_IDLE_MS > RECONNECT_GRACE_MS            돌아오는 중인 사람이 먼저 잘리지 않는다
 * ```
 */
/**
 * 일기토 · 설전 (GDD §3.11, 2026-11-05) — 신청을 받고 답할 시간. 넘기면 **수락하고 AI 대리**로 들어간다(R18).
 * 엔진은 시계를 모른다 — 판정 주체가 이 시간이 지나면 `duelAnswerTimeout`을 넣는다(`forceSkipTurn`의 20초와 같은 결).
 */
export const CHALLENGE_ANSWER_MS = 10_000;
/** 둘째 합부터 한 합의 5 · 4 · 3 · 2 · 1 — 끝나면 판정 주체가 `duelReveal`을 넣는다 (2026-11-11 기획자: 3초 → 5초) */
export const DUEL_COUNT_MS = 5_000;
/** 첫 합의 3 · 2 · 1 — 징 · 「시작!」 바로 뒤라 짧다 (2026-11-11 기획자) */
export const DUEL_FIRST_COUNT_MS = 3_000;
/**
 * 대결이 열리고 첫 카운트 전의 준비 (2026-11-11 기획자, 일기토 · 설전 같은 틀) — 배경음악만 흐르다가
 * 5초에 말발굽 + 건 쪽 그림(7초에 함성), 10초에 말발굽 + 받는 쪽 그림(12초에 함성), 15초에 징과 함께 「시작!」 2초.
 * 첫 합의 마감을 그만큼 미루므로 화면 파일이 아니라 여기 있다(카운트를 재는 주체가 둘이다). 그 사이에도 패는 낼 수 있다.
 * 장면 안의 시각(5 · 7 · 10 · 12초)은 화면만 읽으므로 `ui/duelLayer.ts`의 `INTRO_CUES`에 있다.
 */
export const DUEL_INTRO_MS = 17_000;
/** 준비의 끝 몫 — 징과 함께 「시작!」이 떠 있는 시간. 화면만 읽는다 */
export const DUEL_INTRO_START_MS = 2_000;
/**
 * 공개 연출 — 이 동안 다음 합의 카운트를 안 연다. **연출 길이가 마감을 미루는 자리라 화면 파일이 아니라 여기 있다**
 * (컬렉션 발동 장면과 같은 교훈). AI 대전은 서버 왕복(AI 패)이 이 앞머리에 숨는다.
 */
export const DUEL_REVEAL_MS = 1_500;
/**
 * 끝 장면 — 승패 · 보상 한 줄과 승패 그림을 보여 주는 시간(2026-11-06 기획자: 「끝이 딱 끊긴다」 → 1.8초에서 늘렸다).
 * 2026-11-07 기획자: 끝 말풍선이 2초 남짓 보이다 걷혀 짧다 → 3.7초에서 늘려 말풍선이 4초쯤 머문다(앞 0.25초 · 끝의 걷힘 0.7초를 뺀 몫).
 * 대결이 끝나면 판정 주체는 곧장 제어로 돌아가므로, **서버는 마지막 공개 + 끝 장면(`DUEL_OUTRO_MS`)만큼 늦게 그 장수의 20초를 센다** —
 * 안 그러면 화면이 끝 장면을 보여 주는 동안 다음 사람의 제한 시간이 깎인다.
 */
export const DUEL_END_MS = 5_000;
/** 대결이 끝나고 제어로 돌아오기까지의 연출 — 마지막 공개 + 끝 장면 */
export const DUEL_OUTRO_MS = DUEL_REVEAL_MS + DUEL_END_MS;
/** 한 대결의 최대 합 수 — `FORMULA.duelRounds`와 같은 값이어야 한다(엔진이 세고, 시계는 이 값으로 잰다 — 회귀가 고정한다) */
export const DUEL_ROUNDS = 10;
/**
 * 한 대결의 실시간 상한 — 응답 + 준비 + 첫 카운트 + 나머지 합 × 카운트 + **합 사이의** 공개 = 88.5초. 마지막 합의 공개는 대결이 끝난 뒤의
 * 연출이라 판정에는 안 든다(엔진은 열자마자 끝낸다).
 *
 * **재접속 유예(60초)보다 길다** (2026-11-11 기획자 확정) — 예전에는 「대결 하나는 유예 안에 든다」를 불변식으로 지켰는데, 준비 17초 ·
 * 합 5초로 늘리며 뺐다. 대결 도중 끊겨 유예 안에 안 돌아온 사람은 **대결 도중이라도** 그 판을 항복한다(다른 단계와 같다 —
 * 엔진은 어느 단계에서든 `surrender`를 받는다). `room-logic.test`의 「대결 도중 유예를 넘기면 항복」이 고정한다.
 */
export const DUEL_MAX_MS = CHALLENGE_ANSWER_MS + DUEL_INTRO_MS + DUEL_FIRST_COUNT_MS
  + (DUEL_ROUNDS - 1) * DUEL_COUNT_MS + (DUEL_ROUNDS - 1) * DUEL_REVEAL_MS;

export const TIMING_INVARIANTS = [
  ['매칭 대기와 재접속 유예는 같은 기다림이다', WAITING_MS === RECONNECT_GRACE_MS],
  ['유예는 넘기기 3번의 하한을 넘지 않는다', RECONNECT_GRACE_MS <= CONTROL_MS * SKIP_TO_WIN],
  ['유휴 상한은 재접속 유예보다 길다', ROOM_IDLE_MS > RECONNECT_GRACE_MS],
  // 「대결 하나는 재접속 유예보다 짧다」는 2026-11-11에 뺐다 — 대결이 88.5초로 길어졌고, 유예를 넘기면 대결 도중이라도 항복한다(`DUEL_MAX_MS`)
] as const;

/**
 * 컬렉션 발동 장면 (2026-10-16 기획자, pptx 106~112쪽) — **배치가 열리자마자** 켜진 컬렉션 라벨이 진영의 덱(판 오른쪽 위 북군 ·
 * 오른쪽 아래 남군)에서 나와 판 가운데에서 0.7초 빛나고 돌아간다(1초에서 줄였다, 2026-10-16). **북군을 다 보이고 남군.**
 *
 * **배치 30초는 이 장면이 끝난 뒤부터 센다** — 그래서 길이가 화면이 아니라 여기에 있다. 배치 마감을 재는 주체가 클라(AI)와
 * 서버(온라인) 둘이라, 화면만 늦게 세면 서버는 장면 길이만큼 먼저 배치를 닫는다. 길이는 엔진이 판을 만들 때 남긴
 * `UnitState.bonuses`에서만 나온다 — 양쪽이 같은 판을 들고 있으므로 같은 값이 나온다.
 *
 * 진영마다 한 마디(segment): 「북군 컬렉션」 제목이 징 소리와 함께 펼쳐졌다 사라지고(`TITLE`, 2026-10-16 기획자) → 첫 장이 덱에서
 * 나오고(`IN`, 뒤에 셋까지 함께 나와 쌓인다) → 머묾(`HOLD`, 빛) → 앞 장이 돌아가는 동안 뒤의 장이 앞으로 나선다(`SWAP`, 덱에서 새 장이
 * 쌓임의 맨 뒤로) → … → 마지막 장이 돌아감(`OUT`). 북군 마디 다음 남군 마디. 켜진 것이 없는 진영은 마디가 없다(제목도 안 뜬다).
 */
export const COLLECTION_TITLE_MS = 1_400;
export const COLLECTION_IN_MS = 500;
export const COLLECTION_HOLD_MS = 700;
export const COLLECTION_SWAP_MS = 400;
export const COLLECTION_OUT_MS = 500;

/** 장면에 서는 한 장 — 진영마다 컬렉션 하나(진영 SP처럼 여러 장수에게 붙어도 한 장) */
export interface FiredCollection {
  side: Side;
  source: string;
}

/** 장면에 서는 순서 그대로 — 북군(P2) 먼저, 진영 안에서는 유닛 id 순 · 엔진이 실은 순 */
export function firedCollections(state: Pick<BattleState, 'units'>): FiredCollection[] {
  const seen = new Set<string>();
  const out: FiredCollection[] = [];
  const units = Object.values(state.units)
    .sort((a, b) => Number(b.side === 'P2') - Number(a.side === 'P2') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const u of units) {
    for (const b of u.bonuses ?? []) {
      const key = `${u.side}|${b.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ side: u.side, source: b.source });
    }
  }
  return out;
}

/** 장면 전체 길이. 켜진 것이 없으면 0 — 배치가 곧장 센다 */
export function collectionIntroMs(state: Pick<BattleState, 'units'>): number {
  const fired = firedCollections(state);
  return collectionSegmentMs(fired.filter((f) => f.side === 'P2').length)
    + collectionSegmentMs(fired.filter((f) => f.side === 'P1').length);
}

/** 진영 한 마디의 길이 — 제목 + 그 진영의 장들. 장면을 그리는 화면도 이것으로 마디를 나눈다 */
export function collectionSegmentMs(n: number): number {
  return n === 0 ? 0
    : COLLECTION_TITLE_MS + COLLECTION_IN_MS + n * COLLECTION_HOLD_MS + (n - 1) * COLLECTION_SWAP_MS + COLLECTION_OUT_MS;
}

/** 배치 단계의 실시간 제한 — 장면 + `DEPLOY_MS`. 배치 마감을 재는 자리(로컬 · 서버)는 이것만 읽는다 */
export function deployLimitMs(state: Pick<BattleState, 'units'>): number {
  return DEPLOY_MS + collectionIntroMs(state);
}

/**
 * 대결 단계의 지금 걸음에 남은 실시간 — 응답(`offer`)이면 `CHALLENGE_ANSWER_MS`, 합(`round`)이면 카운트.
 * 첫 합은 **준비 뒤**(`DUEL_INTRO_MS` + 첫 카운트 3초), 둘째 합부터는 **앞 합의 공개 연출을 기다린 뒤** 센다(`DUEL_REVEAL_MS` + 카운트) — 연출이 마감을 미루는 자리다.
 * 판정 주체 둘(로컬 · 방)이 이것 하나를 읽는다. 대결이 아니면 `undefined`.
 */
export function duelStepMs(state: Pick<BattleState, 'phase' | 'duel'>): number | undefined {
  const d = state.duel;
  if (state.phase !== 'duel' || !d) return undefined;
  if (d.step === 'offer') return CHALLENGE_ANSWER_MS;
  return d.history.length > 0 ? DUEL_REVEAL_MS + DUEL_COUNT_MS : DUEL_INTRO_MS + DUEL_FIRST_COUNT_MS;
}

/** 대결 단계의 「걸음」 열쇠 — 바뀌면 마감을 다시 잰다(같은 `duel` 단계 안에서 응답 → 합마다) */
export function duelStepKey(state: Pick<BattleState, 'phase' | 'duel'>): string | null {
  const d = state.duel;
  return state.phase === 'duel' && d ? `${d.step}:${d.round}` : null;
}
