/**
 * 참가비·거절 군량·환불을 `server-api`가 재계산하게 시킨다 (H3b).
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 `room-logic.ts`/`queue-logic.ts`가 아니라 셸(`QueueRoom`·`BattleRoom`)에 있나
 * ────────────────────────────────────────────────────────────────
 *
 * 그 둘은 순수 함수이고 지금 몇 시인지도 인자로만 받는다 — 가짜 시계로 한 판을
 * 통째로 미는 회귀가 그 순수성에 기댄다. 이 호출은 네트워크 I/O라 순수할 수 없다.
 * 판정이 이미 끝난 **뒤에** 그 결정에 반응해서 부르는 부수효과일 뿐이다 —
 * `out` 통을 뿌리는 것과 같은 자리(§5-79·80, "판정은 한 줄도 안 한다").
 *
 * ────────────────────────────────────────────────────────────────
 * 실패해도 판을 막지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * `server-api`가 잠깐 죽어 있다고 대전이 멈추면 안 된다(§5-61과 같은 결 —
 * "서버가 꺼져 있어도 게임은 돈다"). 놓친 군량 정산은 낮은 심각도로 받아들인
 * 알려진 공백이다 — 재시도 큐 같은 내구성 장치는 이 세션의 범위 밖이다.
 */
import type { BattleMode } from '@samchess/rules';
import type { BattleRewards, RosterPick } from '@samchess/meta';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없다 — .env를 확인할 것`);
  return v;
}

const SERVER_API_URL = requireEnv('SERVER_API_URL');
const INTERNAL_API_SECRET = requireEnv('INTERNAL_API_SECRET');

export type GrainAction = 'spend' | 'decline' | 'refund';

export async function chargeGrain(uid: string, mode: BattleMode, action: GrainAction): Promise<void> {
  try {
    const res = await fetch(`${SERVER_API_URL}/internal/grain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_API_SECRET },
      body: JSON.stringify({ uid, mode, action }),
    });
    if (!res.ok) console.error(`[grain] ${action} 실패 — uid=${uid} mode=${mode} status=${res.status}`);
  } catch (err) {
    console.error(`[grain] ${action} 호출 실패 — uid=${uid} mode=${mode}`, err);
  }
}

export interface BattleResultReport {
  uid: string;
  mode: BattleMode;
  result: 'win' | 'lose';
  seed: number;
  picks: RosterPick[];
  kills: Record<string, number>;
  power: { mine: number; theirs: number };
  opponentId: string | null;
  mySquad: string | null;
  theirSquad: string | null;
}

/**
 * 온라인 대전 승/패를 서버가 직접 반영시킨다 (H3d) — `BattleRoom`이 이미 판정을
 * 끝낸 `room.battle`을 갖고 있으므로, `chargeGrain`과 같은 자리에서(§5-79·80,
 * "판정은 한 줄도 안 한다") 그 결과를 통보만 한다. **실패해도 판을 막지 않는다** —
 * `server-api`가 죽어 있으면 그 판의 보상 반영만 놓치고(클라이언트가 예전 방식으로
 * 물러난다), 대전 자체는 그대로 끝난다(§5-61과 같은 결).
 */
export async function settleBattleResult(report: BattleResultReport): Promise<BattleRewards | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/internal/battle-result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_API_SECRET },
      body: JSON.stringify(report),
    });
    if (!res.ok) {
      console.error(`[battle-result] 반영 실패 — uid=${report.uid} mode=${report.mode} status=${res.status}`);
      return null;
    }
    const body = (await res.json()) as { rewards: BattleRewards };
    return body.rewards;
  } catch (err) {
    console.error(`[battle-result] 호출 실패 — uid=${report.uid} mode=${report.mode}`, err);
    return null;
  }
}
