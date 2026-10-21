/**
 * 우편함 — 게임 화면이 서버 우편함(`server-api/src/mail.ts`)을 부르는 자리 (2026-10-21).
 *
 * 우편의 모양 · 받기 판정은 `@samchess/meta`의 `mail.ts`(관리자 화면과의 계약)다. 여기는 왕복만 한다:
 * `GET /mail` · `POST /mail/:id/read` · `POST /mail/:id/claim`. 받으면 서버가 고친 계정이 함께 와서 화면이 그것으로 갈아 끼운다
 * — 보상을 화면이 스스로 셈하지 않는다.
 *
 * **유저끼리 글을 주고받는 우편은 없다**(기획자 확정) — 글을 쓰는 것은 운영(관리자)뿐이다.
 *
 * `?mail=demo`면 서버 대신 시험 우편을 띄운다 — 쪽 넘김 · 긴 본문 · 보상 줄 · 군량 손실 확인을 서버 없이 눈으로 보는
 * 통로다(전투의 `?late=1`과 같은 결). 그때 읽음 · 받기는 화면에서만 바뀌고 보상은 안 들어온다.
 */
import { MAIL_TTL_MS, migrateProfile } from '@samchess/meta';
import type { MailView, PlayerProfile } from '@samchess/meta';
import { authedFetch } from './storage.ts';

export type { MailView };

export const mailDemo = (): boolean => new URLSearchParams(location.search).get('mail') === 'demo';

/** 받은 우편 — 최신부터. 못 닿으면 빈 목록(우편함은 없어도 게임이 돈다) */
export async function loadMail(): Promise<MailView[]> {
  if (mailDemo()) return demoMail();
  try {
    const res = await authedFetch('/mail');
    if (!res.ok) return [];
    return ((await res.json()) as { mails: MailView[] }).mails;
  } catch {
    return [];
  }
}

export type MailActionReply =
  | { ok: true; profile: PlayerProfile | null; mail: MailView; grainLost: number }
  | { ok: false; code: 'claimed' | 'gone' | 'other' };

async function act(mail: MailView, what: 'read' | 'claim'): Promise<MailActionReply> {
  if (mailDemo()) {
    return { ok: true, profile: null, grainLost: 0, mail: { ...mail, read: true, claimed: mail.claimed || what === 'claim' } };
  }
  let res: Response;
  try {
    res = await authedFetch(`/mail/${mail.id}/${what}`, { method: 'POST' });
  } catch {
    return { ok: false, code: 'other' };
  }
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { code?: string }).code;
    return { ok: false, code: code === 'mail.claimed' ? 'claimed' : code === 'mail.notFound' || code === 'mail.expired' || code === 'mail.revoked' ? 'gone' : 'other' };
  }
  const body = (await res.json()) as { profile: unknown; mail: MailView; grainLost: number };
  return { ok: true, profile: migrateProfile(body.profile), mail: body.mail, grainLost: body.grainLost };
}

export const readMailOnServer = (mail: MailView): Promise<MailActionReply> => act(mail, 'read');
export const claimMailOnServer = (mail: MailView): Promise<MailActionReply> => act(mail, 'claim');

function demoMail(): MailView[] {
  const day = 86_400_000;
  const now = Date.now();
  const long = Array.from({ length: 14 }, (_, i) =>
    `${i + 1}. 서버 점검 동안 접속하지 못하셨던 시간을 모두 헤아려, 군량과 금화를 함께 보내 드립니다. `
    + '앞으로도 더 안정된 전장을 마련하겠습니다.').join('\n\n');
  return Array.from({ length: 19 }, (_, i) => {
    const sentAt = now - i * day * 1.5;
    return {
      id: i + 1, sentAt, expiresAt: sentAt + MAIL_TTL_MS, targetUid: null, revokedAt: null,
      title: { ko: i === 0 ? '서버 점검이 길어진 것을 사과드립니다 — 보상 안내' : `시험 우편 ${i + 1}`, en: i === 0 ? 'Apologies for the extended maintenance' : `Test letter ${i + 1}` },
      body: { ko: i === 0 ? long : `시험 우편 ${i + 1}의 본문입니다.\n줄바꿈도 그대로 보입니다.` },
      rewards: i === 0
        ? [{ kind: 'gold', delta: 100 }, { kind: 'grain', delta: 500 }, { kind: 'item', item: 'tang-yak', delta: 2 }, { kind: 'cards', officer: 'gwan-u', delta: 3 }]
        : i === 1 ? [{ kind: 'materials', delta: 20 }] : [],
      read: i > 2, claimed: false,
    };
  });
}
