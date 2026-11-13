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
 *
 * **「받았다」의 정본은 `mail_claims` 표다** (2026-11-13). 도시 안의 `mailbox[].claimed`만 보던 때는 도시를 지우고 새로 세우면
 * (`DELETE /profile` — 운영에서도 열려 있다) 기한이 남은 우편을 **다시 받았다** — 보이는가는 가입 시각으로 정해 도시가 바뀌어도 그대로라서.
 * 받기와 같은 트랜잭션에서 표에 넣고(`onWrite`), 이미 있으면 받기 전체를 되감는다. 도시 쪽 기록은 그대로 둔다(화면 · 회귀가 읽는다).
 */
import { claimMail, mailClaimed, mailRead, readMailbox } from '@samchess/meta';
import type { Mail, MailReward, MailText, MailView } from '@samchess/meta';
import type { PoolClient } from 'pg';
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

/** 이 계정이 받은 우편 번호 — 도시를 지워도 남는다 */
async function claimedIds(uid: string): Promise<Set<number>> {
  const r = await pool.query<{ mail_id: string }>('select mail_id from mail_claims where uid = $1', [uid]);
  return new Set(r.rows.map((x) => Number(x.mail_id)));
}

/** 「받음」은 도시 쪽 기록과 표 어느 쪽이든 — 새로 세운 도시는 도시 쪽이 비어 있어도 표가 기억한다 */
const view = (profile: PlayerProfile | null, mail: Mail, claimed: ReadonlySet<number> = new Set()): MailView => ({
  ...mail, read: profile ? mailRead(profile, mail.id) : false,
  claimed: claimed.has(mail.id) || (profile ? mailClaimed(profile, mail.id) : false),
});

export async function listMail(uid: string): Promise<MailView[]> {
  const [mails, profile, claimed] = await Promise.all([visibleMail(uid), getProfile(uid), claimedIds(uid)]);
  return mails.map((m) => view(profile, m, claimed));
}

/** 이미 받은 우편 — 표에 줄이 있었다. 받기 트랜잭션을 되감으려고 던진다 */
class AlreadyClaimed extends Error {}
const ALREADY = { ok: false, status: 409, reason: '이미 받은 우편이다', code: 'mail.claimed' } as const;

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

/**
 * 받기 — 보상을 넣고 「받았다」를 적는다. 군량은 창고 상한까지만(`claimMail`). 표(`mail_claims`)에 먼저 받은 줄이 있으면 409 —
 * 같은 트랜잭션의 넣기가 아무것도 못 넣으면 되감는다. **미리 보지 않는다** — 보이는가(404: 회수 · 기한 지남)가 먼저라서. 미리 보면
 * 받은 뒤 회수된 우편이 「이미 받았다」로 답해 회수를 드러낸다(smoke:admin 「회수된 우편은 못 받는다」).
 */
export async function claimMailAction(uid: string, id: number): Promise<MailActionResult> {
  try {
    return await act(uid, id, (profile, mail, now) => {
      const r = claimMail(profile, mail, now);
      return r.ok ? { profile: r.profile, grainLost: r.grainLost } : r;
    }, async (tx) => {
      const ins = await tx.query('insert into mail_claims (uid, mail_id) values ($1, $2) on conflict do nothing', [uid, id]);
      if (ins.rowCount === 0) throw new AlreadyClaimed();
    });
  } catch (e) {
    if (e instanceof AlreadyClaimed) return { ...ALREADY };
    throw e;
  }
}

async function act(
  uid: string, id: number,
  fn: (profile: PlayerProfile, mail: Mail, now: number) =>
    { profile: PlayerProfile; grainLost: number } | { ok: false; reason: string; code?: string },
  onWrite?: (tx: PoolClient) => Promise<void>,
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
  }, onWrite ? { onWrite: (tx) => onWrite(tx) } : {});
}
