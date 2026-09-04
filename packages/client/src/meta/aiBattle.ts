/**
 * AI 대전 결과를 서버로 보내 재생 검증받는다 (§5-96). `BattleScreen`이 판이 끝난
 * 뒤 딱 한 번 부른다 — 사람이 낸 의도(`LocalTransport.getIntentLog()`)만 싣는다.
 *
 * **실패하면 `null`을 준다** — 부르는 쪽이 지금 방식(로컬 `applyBattleResult` +
 * `PUT /profile`)으로 물러난다. "서버가 꺼져 있어도 게임은 돈다"(§5-61)가 AI 대전
 * 결과 반영에도 선다 — 다만 그 순간에만 치팅 표면이 예전 수준으로 돌아간다.
 */
import type { BattleMode, Intent, OfficerId } from '@samchess/rules';
import type { BattleRewards, PlayerProfile, RosterPick } from '@samchess/meta';
import { authedFetch } from './storage.ts';
import { migrateProfile } from '@samchess/meta';

export interface AiBattleRequest {
  mode: BattleMode;
  seed: number;
  targetPower: number;
  exclude: readonly OfficerId[];
  picks: readonly RosterPick[];
  squadId: string | null;
  humanIntents: readonly Intent[];
  /** 판이 시작된 시각(epoch ms). 서버가 **그때의 부상 상태**로 로스터를 되만든다 */
  startedAt: number;
}

export async function settleAiBattle(
  req: AiBattleRequest,
): Promise<{ profile: PlayerProfile; rewards: BattleRewards } | null> {
  try {
    const res = await authedFetch('/battle/ai-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`POST /battle/ai-result → ${res.status}`);
    const body = (await res.json()) as { profile: unknown; rewards: BattleRewards };
    const profile = migrateProfile(body.profile);
    if (!profile) throw new Error('서버가 잘못된 프로필을 줬다');
    return { profile, rewards: body.rewards };
  } catch (err) {
    console.warn('[ai-battle] 재생 검증에 실패했다 — 로컬 반영으로 물러난다', err);
    return null;
  }
}
