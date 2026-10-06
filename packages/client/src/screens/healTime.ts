import { t } from '../i18n/index.ts';

const MS_PER_MIN = 60_000;

/**
 * 부상·치료의 남은 시간 — 분 단위 올림(「0분」이 안 나온다), 1분이 안 남으면 「1분 이내」.
 *
 * 병원 화면(`HospitalScreen`)과 장수 카드의 [부상] 라벨(`RankingCommon`)이 함께 쓴다 —
 * 같은 부상을 두 곳이 다르게 반올림하면 「병원에선 3분인데 카드엔 2분」이 된다.
 */
export function formatHealLeft(ms: number): string {
  if (ms < MS_PER_MIN) return t('hospital.time.underMin');
  return t('hospital.time.min', { m: Math.ceil(ms / MS_PER_MIN) });
}
