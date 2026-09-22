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

/**
 * 농지 현황판의 「도적단 출현 :」 한 칸 — 짧은 상태말 + 색 (2026-09-21 기획자 지정).
 *
 * 색은 셋이다 — 출현(붉음) · 약탈(짙은 회색) · 퇴치 완료(파랑). 규칙의 결말은 여섯이라
 * 접는다: 대기·전투 중 → 출현, 패배·항복 → 약탈, 승리 → 퇴치. **무승부는 약탈이 없어**
 * 약탈로 접으면 「군량 감소 0」이 되므로 퇴치 쪽 색에 제 글자(「물러감」)를 단다.
 * 남은 시간은 `mm:ss`(지정 표기 「09:31」) — 메인 단추의 `m:ss`와는 자리가 달라 따로 둔다.
 */
export type RaidTone = 'none' | 'alert' | 'looted' | 'cleared';

export function raidStateText(raid: RaidState | undefined, nowMs: number): { tone: RaidTone; text: string } {
  if (!raid) return { tone: 'none', text: t('farm.raid.none') };
  switch (raid.status) {
    case 'pending': {
      const [m = '0', s = '00'] = formatCountdown(raidRemainingMs(raid, nowMs)).split(':');
      return { tone: 'alert', text: t('farm.raid.pending', { time: `${m.padStart(2, '0')}:${s}` }) };
    }
    case 'fighting': return { tone: 'alert', text: t('farm.raid.fighting') };
    case 'won': return { tone: 'cleared', text: t('farm.raid.won') };
    case 'drawn': return { tone: 'cleared', text: t('farm.raid.drawn') };
    case 'lost':
    case 'surrendered': return { tone: 'looted', text: t('farm.raid.looted', { loot: raid.loot ?? 0 }) };
  }
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
