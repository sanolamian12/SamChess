/**
 * 도적떼 — 서버에 시킨다 (GDD §5.11). 시작 · 결과 · 항복 셋.
 *
 * **로컬로 물러나지 않는다.** 도적떼는 서버가 출몰시키고 서버가 정산하는 것이라
 * (`raid`는 서버 소유 필드), 서버에 못 닿으면 애초에 도적떼가 없다. 그래서 다른 도시
 * 행위(`city.ts`)와 달리 폴백이 없고, 못 닿으면 **말하고 멈춘다.**
 *
 * 거절에는 이유 코드가 함께 온다(`raid.noGuards` 등) — 화면은 그 코드로 제 언어의
 * 문장을 고른다(`reasonText`).
 */

import { migrateProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { Intent } from '@samchess/rules';
import { reasonText } from '../i18n/reason.ts';
import { t } from '../i18n/index.ts';
import { authedFetch } from './storage.ts';

/** 서버가 거절했거나 못 닿았다 — 사람에게 보여 줄 말이 들어 있다 */
export class RaidRequestFailed extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = 'RaidRequestFailed'; }
}

async function post(path: string, body: unknown): Promise<PlayerProfile> {
  let res: Response;
  try {
    res = await authedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(`[raid] ${path} 에 못 닿았다`, err);
    throw new RaidRequestFailed(t('raid.unreachable'));
  }
  if (res.status === 404) {
    // 「못 닿음」이 아니다 — 서버가 이 길을 모른다(새 경로를 붙이고 다시 안 띄웠다)
    throw new RaidRequestFailed(`서버가 이 요청(${path})을 모른다 — 계정 서버를 다시 띄워야 한다`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    const code = json.code;
    throw new RaidRequestFailed(reasonText({ reason: json.error ?? `${path} → ${res.status}`, ...(code ? { code } : {}) }), code);
  }
  const profile = migrateProfile(json);
  if (!profile) throw new RaidRequestFailed(`${path} 가 잘못된 프로필을 줬다`);
  return profile;
}

/** [지금 전투] — 서버가 시드를 내고 그날의 도적떼를 써 버린다. 판의 설정은 받은 프로필에서 만든다 */
export const startRaidOnServer = (): Promise<PlayerProfile> => post('/raid/start', {});

/** [항복] */
export const surrenderRaidOnServer = (): Promise<PlayerProfile> => post('/raid/surrender', {});

/**
 * 끝난 판 — 사람이 낸 의도만 보낸다. 서버가 처음부터 다시 돌려 결말을 낸다.
 * 재생이 어긋나면 서버가 **항복으로 정산하고** 거절한다(`raid.replayFailed`) — 그때도
 * 계정은 바뀌었으므로 부르는 쪽은 프로필을 다시 읽어야 한다.
 */
export const settleRaidOnServer = (humanIntents: readonly Intent[]): Promise<PlayerProfile> =>
  post('/raid/result', { humanIntents });

/**
 * 싸우는 동안 낸 의도를 서버에 덧붙인다 — 브라우저가 꺼져도 끊긴 자리에서 이어 두기 위해서다 (2026-10-15).
 *
 * **보내는 것은 언제나 「서버가 가진 것 다음부터」다**(`from` = 서버가 확인해 준 길이). 한 번에 하나만 날리고
 * 앞 요청이 끝나면 그새 쌓인 것을 한꺼번에 보낸다 — 계정 저장의 쓰기 큐와 같은 규칙이다(앞뒤가 뒤바뀌면 서버가
 * 「이어지지 않는다」로 거절한다). 못 닿으면 쌓아 두었다가 다음 수에 함께 보낸다. **판을 막지 않는다** —
 * 끝나면 정산이 전체 기록을 따로 보내므로, 여기서 빠진 것은 「끊겼을 때 되살릴 수 있는 자리」가 조금 앞이 될 뿐이다.
 */
export class RaidIntentUploader {
  private stored: number;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(private readonly log: () => readonly Intent[], stored: number) {
    this.stored = stored;
  }

  /** 새 수가 쌓였다 */
  push(): void {
    if (this.stopped) return;
    if (this.inFlight) { this.again = true; return; }
    this.inFlight = this.send().finally(() => {
      this.inFlight = null;
      if (this.again && !this.stopped) { this.again = false; this.push(); }
    });
  }

  /** 더 보내지 않는다 — 판이 끝났다(정산이 전체 기록을 보낸다) */
  stop(): void { this.stopped = true; }

  private async send(): Promise<void> {
    const all = this.log();
    if (all.length <= this.stored) return;
    const from = this.stored;
    try {
      const res = await authedFetch('/raid/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, intents: all.slice(from) }),
      });
      const json = (await res.json().catch(() => ({}))) as { have?: number; code?: string };
      if (res.ok && typeof json.have === 'number') { this.stored = json.have; return; }
      // 거절 — 판이 이미 정산됐거나(60분) 이어지지 않는다. 더 보내 봐야 같은 답이라 멈춘다
      console.warn(`[raid] 수 덧붙이기 거절 — ${res.status} ${json.code ?? ''}`);
      if (res.status === 409) this.stopped = true;
    } catch (err) {
      console.warn('[raid] 수 덧붙이기에 못 닿았다 — 다음 수에 함께 보낸다', err);
    }
  }
}
