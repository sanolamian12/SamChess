/**
 * 도적떼를 말하는 문장 — 농지 화면 · 메인의 [전투하기] · 알림이 **같은 말**을 쓴다 (GDD §5.11).
 *
 * 세 자리가 각자 조립하면 하나가 낡는다(`buildingText.ts`와 같은 이유). 남은 시간은
 * 초 단위로 센다 — 10분짜리 마감이라 병원처럼 분 단위로 올리면 「1분」이 1분 넘게 선다.
 */

import { raidRemainingMs } from '@samchess/meta';
import type { RaidState } from '@samchess/meta';
import { t } from '../i18n/index.ts';

/** `m:ss` — 음수는 0으로 */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 오늘의 도적떼 한 줄. 없으면 「아직 안 왔다」 */
export function raidStatusText(raid: RaidState | undefined, nowMs: number): string {
  if (!raid) return t('raid.today.none');
  switch (raid.status) {
    case 'pending': return t('raid.status.pending', { n: raid.bandits, time: formatCountdown(raidRemainingMs(raid, nowMs)) });
    case 'fighting': return t('raid.status.fighting', { n: raid.bandits });
    case 'won': return t('raid.status.won', { n: raid.bandits });
    case 'lost': return t('raid.status.lost', { loot: raid.loot ?? 0 });
    case 'drawn': return t('raid.status.drawn');
    case 'surrendered': return t('raid.status.surrendered', { loot: raid.loot ?? 0 });
  }
}
