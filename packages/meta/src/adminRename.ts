/**
 * 관리자의 도시 이름 강제 변경 (2026-10-22) — 욕설 · 사칭 같은 이름을 운영이 바꾼다.
 *
 * | | 게임의 이름 변경(`applyRenameCity`) | 강제 변경 |
 * |---|---|---|
 * | 새 이름 | 플레이어가 적는다 | **관리자가 적는다** (기획자 확정) |
 * | 금화 | `CITY_RENAME_GOLD` | 안 낸다 |
 * | 3일 대기 | 찍는다 | **비운다** — 플레이어가 곧바로 자기 이름으로 다시 바꿀 수 있게 (기획자 확정) |
 * | 알림 | — | **우편 한 통** — 사유와 함께, 같은 트랜잭션 (기획자 확정) |
 *
 * 이름 꼴(`normalizeCityName` · `CITY_NAME_MAX`)은 게임과 같은 것을 쓴다. **다른 계정과 겹치는지는 여기서 모른다** —
 * 게임과 같이 DB의 고유 인덱스가 거절한다(`profiles_city_name_key`, 대소문자 무시).
 */
import type { MailDraft } from './mail.ts';
import { CITY_NAME_MAX, RENAME_COOLDOWN_MS, normalizeCityName } from './profile.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

export function canForceRenameCity(profile: PlayerProfile, name: string): MetaResult {
  const trimmed = normalizeCityName(name);
  if (!trimmed) return { ok: false, reason: '새 도시 이름이 없다' };
  if (trimmed.length > CITY_NAME_MAX) return { ok: false, reason: `도시 이름은 ${CITY_NAME_MAX}자까지다` };
  if (trimmed === profile.cityName) return { ok: false, reason: '지금과 같은 이름이다' };
  return { ok: true };
}

/** 이름을 바꾸고 3일 대기를 비운다. 금화는 그대로 */
export function applyForceRenameCity(profile: PlayerProfile, name: string): PlayerProfile {
  const check = canForceRenameCity(profile, name);
  if (!check.ok) throw new Error(check.reason);
  const { cityNameChangedAt: _cooldown, ...rest } = profile;
  return { ...rest, cityName: normalizeCityName(name) };
}

/**
 * 알림 우편 — 보상 없는 공지. **사유는 플레이어에게 그대로 보인다**(정지 사유와 같은 결 — 관리자 화면이 그렇게 안내한다).
 * 글은 한국어 · 영어만 적는다 — 다른 언어는 우편 규칙대로 한국어로 물러난다(번역은 별도 세션의 일).
 * 길이는 `MAIL_LIMITS` 안이다(제목 고정, 본문 = 이름 둘 ≤ 24자 + 사유 ≤ 500자 + 틀) — 회귀가 `parseMailDraft`로 본다.
 */
export function forceRenameMail(uid: string, from: string, to: string, reason: string): MailDraft {
  const days = RENAME_COOLDOWN_MS / 86_400_000;
  return {
    targetUid: uid,
    title: { ko: '도시 이름이 바뀌었습니다', en: 'Your city has been renamed' },
    body: {
      ko: `운영 정책에 따라 도시 이름을 「${from}」에서 「${to}」(으)로 바꿨습니다.\n사유: ${reason}\n\n`
        + `${days}일 대기 없이 바로 다른 이름으로 바꿀 수 있습니다(이름 변경 비용은 그대로입니다).`,
      en: `Under our operating policy, your city "${from}" has been renamed to "${to}".\nReason: ${reason}\n\n`
        + `You can rename it again right away, without the ${days}-day wait (the usual renaming cost still applies).`,
    },
    rewards: [],
  };
}
