/**
 * 우편함 — 운영이 보내는 우편의 모양 · 보내기 검사 · 받기 판정 (2026-10-21)
 *
 * **관리자 화면과의 계약 파일이다.** 보내기 · 목록 · 회수 API와 화면은 관리자 세션이 맡고(`server-api/src/admin/`),
 * 이 파일의 타입을 `import type`으로 읽는다. 모양(`Mail` · `MailDraft` · `MailReward`)을 바꾸면 관리자 쪽에 알린다.
 *
 * 기획 결정 (2026-10-21 기획자):
 *
 * | 항목 | 결정 |
 * |---|---|
 * | 누가 쓰나 | **운영만.** 유저끼리 글을 주고받는 우편은 없다(감시가 필요해서). 유저 사이는 궁성 > 외교 같은 정해진 행동뿐(향후) |
 * | 글의 언어 | **언어별로 쓴다** — `{ ko, en, … }`. 한국어는 꼭 있고 빈 언어는 한국어로 물러난다(`mailText`) |
 * | 공지 | 보상이 없으면 **공지 우편**이다 — 읽기만 한다 |
 * | 기한 | **30일 고정**(`MAIL_TTL_MS`). 지나면 목록에서 사라지고 못 받는다 |
 * | 보상 | **관리자 지급과 같은 종류**(`Adjustment`의 지급 쪽), 양수만. 군량은 **창고 상한까지만** 들어가고 나머지는 버린다 |
 * | 받는 사람 | **전체**(보낸 시각보다 **먼저 가입한** 계정만 — 장애 보상을 나중에 가입한 사람이 못 받게) 또는 **한 사람**(CS) |
 * | 모두 받기 | 이번엔 없다 — 한 통씩 열어 [받기] |
 *
 * **보내는 것은 DB `mail` 표에 한 줄 적기로 끝난다**(`sql/schema.sql`) — 수천 계정을 하나씩 고치지 않아서, 중간에 끊겨도
 * 두 번 지급되는 일이 없다. 받는 것은 플레이어가 [받기]를 누를 때 **그 계정 하나**를 잠근 채 고친다(`mutateProfile`).
 *
 * **「한 번만」의 고리는 계정에 있다** — `PlayerProfile.mailbox`(서버 소유)에 읽은 · 받은 우편 번호를 기한과 함께 적는다.
 * 같은 행을 잠그고 「이미 받았나 → 보상 → 받았다고 적기」를 한 트랜잭션에서 하므로, 두 번 눌러도 두 기기에서 눌러도 한 번이다.
 * 기한이 지난 줄은 쓸 때마다 걷는다(`pruneMailbox`) — 30일보다 오래 쌓이지 않는다.
 *
 * 「이 우편이 이 사람에게 보이는가」(대상 · 가입 시각 · 회수)는 **서버가 쿼리로** 거른다 — 계정에는 가입 시각도 uid도 없다.
 * 여기 판정은 기한 · 회수 · 이미 받음 · 보상 유무만 본다.
 *
 * **순수 함수다** — 시계는 부르는 쪽이 넣는다(`nowMs`).
 */
import { applyAdjustment, parseAdjustment } from './admin.ts';
import type { Adjustment } from './admin.ts';
import { grainCap } from './city.ts';
import type { MailboxEntry, MetaResult, PlayerProfile } from './types.ts';

/** 받을 수 있는 기한 — 보낸 시각부터 30일 (기획자 확정) */
export const MAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 글을 쓸 수 있는 언어 — 게임 화면의 열 언어와 같다(`client/src/i18n`의 `Lang`, 회귀가 맞춰 본다) */
export const MAIL_LANGS = ['ko', 'en', 'es_419', 'it', 'ja', 'mn', 'pt_BR', 'pt_PT', 'zh_Hans', 'zh_Hant'] as const;
export type MailLang = typeof MAIL_LANGS[number];

/** 언어별 글. **한국어는 꼭 있다** — 빈 언어가 물러날 자리다 */
export type MailText = { ko: string } & Partial<Record<Exclude<MailLang, 'ko'>, string>>;

/** 우편에 담는 보상 — 관리자 지급과 같은 모양의 **지급 쪽**만(양수, 회수 없음) */
export type MailReward = Exclude<Adjustment, { kind: 'equipmentRevoke' }>;

export const MAIL_LIMITS = { title: 60, body: 2000, rewards: 10 } as const;

/** 보낸 우편 한 통 — DB `mail` 한 줄을 화면 · 판정이 읽는 꼴로 */
export interface Mail {
  id: number;
  /** 보낸 시각(ms) */
  sentAt: number;
  /** 받을 수 있는 마지막 시각(ms) — `sentAt + MAIL_TTL_MS` */
  expiresAt: number;
  /** `null`이면 전체 */
  targetUid: string | null;
  title: MailText;
  body: MailText;
  /** 비면 공지 우편 */
  rewards: MailReward[];
  /** 회수한 시각 — 있으면 목록에서 빠지고 못 받는다(이미 받은 것은 그대로) */
  revokedAt: number | null;
}

/** 관리자가 보내는 것 — 시각 · 번호는 서버가 붙인다 */
export interface MailDraft {
  targetUid: string | null;
  title: MailText;
  body: MailText;
  rewards: MailReward[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 보내기 요청 본문 → `MailDraft`. 틀리면 사람 말을 돌려준다(관리자 API가 400으로 그대로 돌린다).
 * 보상은 **관리자 지급의 검사(`parseAdjustment`)를 그대로 지나고** 거기에 「양수만 · 회수 없음」을 더한다.
 *
 * ★ **같은 보상은 한 줄만** (2026-10-21, 관리자 세션 검토) — 금화 100,000을 열 줄로 담으면 한 통에 1,000,000이다.
 * 한 줄 상한(`ADJUST_LIMITS`)은 「오타 하나가 경제를 흔들지 않게」인데, 줄을 나누면 한 통 단위로는 지켜지지 않는다.
 */
export function parseMailDraft(raw: unknown): MailDraft | string {
  if (!raw || typeof raw !== 'object') return '본문이 없다';
  const b = raw as Record<string, unknown>;
  const target = b['targetUid'] ?? null;
  if (target !== null && (typeof target !== 'string' || !UUID.test(target))) return 'targetUid는 uid이거나 null(전체)이다';
  const title = parseText(b['title'], MAIL_LIMITS.title, '제목');
  if (typeof title === 'string') return title;
  const body = parseText(b['body'], MAIL_LIMITS.body, '본문');
  if (typeof body === 'string') return body;
  const rawRewards = b['rewards'] ?? [];
  if (!Array.isArray(rawRewards)) return 'rewards는 배열이다';
  if (rawRewards.length > MAIL_LIMITS.rewards) return `보상은 ${MAIL_LIMITS.rewards}개까지`;
  const rewards: MailReward[] = [];
  const seen = new Set<string>();
  for (const r of rawRewards) {
    const adj = parseAdjustment(r);
    if (typeof adj === 'string') return `보상: ${adj}`;
    if (adj.kind === 'equipmentRevoke' || ('delta' in adj && adj.delta <= 0)) return '보상은 주는 것만 담는다(양수 · 회수 없음)';
    const key = rewardKey(adj);
    if (seen.has(key)) return `같은 보상이 두 줄이다(${key}) — 한 줄에 합쳐 적는다`;
    seen.add(key);
    rewards.push(adj);
  }
  return { targetUid: target, title, body, rewards };
}

/** 「같은 보상」의 열쇠 — 종류 + 대상(장수 · 아이템 · 병기) */
const rewardKey = (r: MailReward): string =>
  r.kind === 'cards' ? `cards:${r.officer}` : r.kind === 'item' ? `item:${r.item}`
    : r.kind === 'equipmentGrant' ? `equipment:${r.equipmentId}` : r.kind;

function parseText(raw: unknown, max: number, label: string): MailText | string {
  if (!raw || typeof raw !== 'object') return `${label}이 없다 — { ko, en, … }`;
  const r = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [lang, v] of Object.entries(r)) {
    if (!(MAIL_LANGS as readonly string[]).includes(lang)) return `${label}: 모르는 언어 ${lang}`;
    if (typeof v !== 'string') return `${label}: ${lang}이 글이 아니다`;
    const s = v.trim();
    if (s.length > max) return `${label}: ${lang}이 ${max}자를 넘는다`;
    if (s) out[lang] = s;
  }
  if (!out['ko']) return `${label}: 한국어(ko)는 꼭 있어야 한다`;
  return out as MailText;
}

/** 그 언어의 글 — 비었으면 한국어 */
export const mailText = (text: MailText, lang: string): string =>
  (text as Record<string, string | undefined>)[lang] || text.ko;

// ── 계정 쪽 (`PlayerProfile.mailbox`) ───────────────────────────

/** 기한이 지난 줄을 걷는다 — 비면 키째로 없앤다(빈 표를 지어내지 않는다) */
export function pruneMailbox(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const box = profile.mailbox;
  if (!box) return profile;
  const live = box.filter((e) => e.exp > nowMs);
  if (live.length === box.length) return profile;
  const { mailbox: _drop, ...rest } = profile;
  return live.length > 0 ? { ...rest, mailbox: live } : rest;
}

const entryOf = (profile: PlayerProfile, id: number): MailboxEntry | undefined =>
  profile.mailbox?.find((e) => e.id === id);

export const mailRead = (profile: PlayerProfile, id: number): boolean => entryOf(profile, id) !== undefined;
export const mailClaimed = (profile: PlayerProfile, id: number): boolean => entryOf(profile, id)?.claimed === true;

function withEntry(profile: PlayerProfile, entry: MailboxEntry, nowMs: number): PlayerProfile {
  const pruned = pruneMailbox(profile, nowMs);
  const rest = (pruned.mailbox ?? []).filter((e) => e.id !== entry.id);
  return { ...pruned, mailbox: [...rest, entry] };
}

const live = (mail: Mail, nowMs: number): MetaResult =>
  mail.revokedAt !== null ? { ok: false, reason: '회수된 우편이다', code: 'mail.revoked' }
    : nowMs >= mail.expiresAt ? { ok: false, reason: '기한이 지난 우편이다', code: 'mail.expired' }
    : { ok: true };

/** 읽었다 — 이미 읽었으면 그대로 */
export function readMailbox(profile: PlayerProfile, mail: Mail, nowMs: number):
  { ok: true; profile: PlayerProfile } | Extract<MetaResult, { ok: false }> {
  const gate = live(mail, nowMs);
  if (!gate.ok) return gate;
  if (mailRead(profile, mail.id)) return { ok: true, profile };
  return { ok: true, profile: withEntry(profile, { id: mail.id, exp: mail.expiresAt, claimed: false }, nowMs) };
}

/**
 * 군량 보상 중 **창고 상한을 넘어 버려질 양** — 받기 전 확인창이 보여 준다(화면이 셈을 다시 적지 않는다).
 * 이미 상한을 넘겨 있으면(관리자 지급 등) 들어올 자리가 없어 전부 버려진다.
 */
export function mailGrainLoss(profile: PlayerProfile, mail: Mail): number {
  const add = mail.rewards.reduce((n, r) => n + (r.kind === 'grain' ? r.delta : 0), 0);
  if (add <= 0) return 0;
  const room = Math.max(0, grainCap(profile) - profile.grain);
  return Math.max(0, add - room);
}

/**
 * 받는다 — 보상을 계정에 넣고 「받았다」를 적는다. **`profile`은 서버 시계로 정산된 값이어야 한다**(군량 상한이
 * 정산된 군량 위에서 서야 한다 — `mutateProfile`이 그렇게 넘긴다).
 *
 * 군량은 상한까지만 넣고 나머지는 버린다(기획자 확정 — 관리자 지급은 상한을 넘으면 거절하지만, 우편은 플레이어가
 * 받는 것이라 「창고가 차서 못 받는다」가 되면 안 된다). 나머지 보상은 관리자 지급과 **같은 함수**를 지난다.
 */
export function claimMail(profile: PlayerProfile, mail: Mail, nowMs: number):
  { ok: true; profile: PlayerProfile; grainLost: number } | Extract<MetaResult, { ok: false }> {
  const gate = live(mail, nowMs);
  if (!gate.ok) return gate;
  if (mail.rewards.length === 0) return { ok: false, reason: '받을 것이 없는 공지 우편이다', code: 'mail.noRewards' };
  if (mailClaimed(profile, mail.id)) return { ok: false, reason: '이미 받은 우편이다', code: 'mail.claimed' };

  const grainLost = mailGrainLoss(profile, mail);
  let next = profile;
  try {
    for (const r of mail.rewards) {
      if (r.kind === 'grain') {
        const cap = grainCap(next);
        next = { ...next, grain: Math.max(next.grain, Math.min(next.grain + r.delta, cap)) };
      } else {
        next = applyAdjustment(next, r, nowMs);
      }
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '받을 수 없다', code: 'mail.cannotApply' };
  }
  return { ok: true, profile: withEntry(next, { id: mail.id, exp: mail.expiresAt, claimed: true }, nowMs), grainLost };
}
