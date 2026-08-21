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
