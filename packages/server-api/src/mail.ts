/**
 * 우편함 — 게임 쪽 세 행위: 목록 · 읽음 · 받기 (2026-10-21, 판정은 `@samchess/meta`의 `mail.ts`)
 *
 * 보내기 · 회수는 관리자 API(`admin/`)의 몫이다. 여기는 **받는 사람**의 길만 있다.
 *
 * **「이 우편이 이 사람에게 보이는가」는 쿼리 하나(`visibleMail`)가 정한다** — 목록과 읽음 · 받기가 같은 쿼리를 지나야
 * 「목록엔 안 보이는데 번호를 알면 받을 수 있다」가 생기지 않는다. 거르는 것:
 *  - 회수되지 않았고 기한 전이다
 *  - 나에게 온 것이거나, 전체 우편이면 **보낸 시각보다 먼저 가입했다**(`auth.users.created_at <= sent_at`) — 장애 보상을
 *    나중에 가입한 사람이 받지 않게(기획자 확정)
 *
 * 받기는 계정 행을 잠근 채(`mutateProfile`) 「이미 받았나 → 보상 → 적기」를 한다 — 우편 줄은 보낸 뒤 바뀌지 않으므로
 * (회수만 있다) 잠그기 전에 읽어도 된다. 회수가 그 사이에 끼면 받아지는데, 그건 회수 전에 누른 것으로 본다.
 */
import { claimMail, mailClaimed, mailRead, readMailbox } from '@samchess/meta';
import type { Mail, MailReward, MailText, MailView } from '@samchess/meta';
import { pool } from './db.ts';
import { getProfile, mutateProfile } from './profileStore.ts';
import type { PlayerProfile } from '@samchess/meta';

/** 한 번에 보여 주는 우편 수 — 30일 기한이라 넘칠 일이 드물다. 넘치면 최신부터 이만큼 */
const LIST_MAX = 100;

interface MailRow {
  id: string; sent_at: Date; expires_at: Date; target_uid: string | null;
  title: MailText; body: MailText; rewards: MailReward[]; revoked_at: Date | null;
}

const toMail = (r: MailRow): Mail => ({
  id: Number(r.id), sentAt: r.sent_at.getTime(), expiresAt: r.expires_at.getTime(), targetUid: r.target_uid,
  title: r.title, body: r.body, rewards: r.rewards, revokedAt: r.revoked_at?.getTime() ?? null,
});

/** 이 사람에게 보이는 우편 — `id`를 주면 그 한 통만 */
async function visibleMail(uid: string, id?: number): Promise<Mail[]> {
  const r = await pool.query<MailRow>(
    `select m.id, m.sent_at, m.expires_at, m.target_uid, m.title, m.body, m.rewards, m.revoked_at
       from mail m
      where m.revoked_at is null and m.expires_at > now()
        and (m.target_uid = $1
             or (m.target_uid is null and m.sent_at >= (select u.created_at from auth.users u where u.id = $1)))
        and ($2::bigint is null or m.id = $2)
      order by m.sent_at desc, m.id desc
      limit $3`,
    [uid, id ?? null, LIST_MAX],
  );
  return r.rows.map(toMail);
}

const view = (profile: PlayerProfile | null, mail: Mail): MailView => ({
  ...mail, read: profile ? mailRead(profile, mail.id) : false, claimed: profile ? mailClaimed(profile, mail.id) : false,
});

export async function listMail(uid: string): Promise<MailView[]> {
  const [mails, profile] = await Promise.all([visibleMail(uid), getProfile(uid)]);
  return mails.map((m) => view(profile, m));
}

export type MailActionResult =
  | { ok: true; profile: PlayerProfile; mail: MailView; grainLost: number }
  | { ok: false; status: number; reason: string; code?: string };

/** 읽음 — 이미 읽었으면 쓰지 않는다 */
export async function readMailAction(uid: string, id: number): Promise<MailActionResult> {
  return act(uid, id, (profile, mail, now) => {
    const r = readMailbox(profile, mail, now);
    return r.ok ? { profile: r.profile, grainLost: 0 } : r;
  });
}

/** 받기 — 보상을 넣고 「받았다」를 적는다. 군량은 창고 상한까지만(`claimMail`) */
export async function claimMailAction(uid: string, id: number): Promise<MailActionResult> {
  return act(uid, id, (profile, mail, now) => {
    const r = claimMail(profile, mail, now);
    return r.ok ? { profile: r.profile, grainLost: r.grainLost } : r;
  });
}

async function act(
  uid: string, id: number,
  fn: (profile: PlayerProfile, mail: Mail, now: number) =>
    { profile: PlayerProfile; grainLost: number } | { ok: false; reason: string; code?: string },
): Promise<MailActionResult> {
  const [mail] = await visibleMail(uid, id);
  // 남의 우편 · 회수 · 기한 지남 · 없는 번호를 가르지 않는다 — 번호를 넣어 보며 남의 우편이 있는지 알아내지 못하게
  if (!mail) return { ok: false, status: 404, reason: '받을 수 있는 우편이 아니다', code: 'mail.notFound' };
  const now = Date.now();
  return mutateProfile<MailActionResult>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    const r = fn(profile, mail, now);
    if ('ok' in r) return { next: null, value: { ok: false, status: 409, reason: r.reason, ...(r.code ? { code: r.code } : {}) } };
    return {
      next: r.profile === profile ? null : r.profile,
      value: { ok: true, profile: r.profile, mail: view(r.profile, mail), grainLost: r.grainLost },
    };
  });
}
