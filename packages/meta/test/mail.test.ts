/**
 * 우편함 판정 (2026-10-21, `src/mail.ts`).
 *
 * 여기서 고정하는 것.
 *  - **한 번만 받는다** — 받은 기록(`mailbox`)이 되접기 · JSON 왕복을 지나도 남는다(안 남으면 같은 보상을 다시 받는다)
 *  - 기한 · 회수 · 공지(보상 없음)는 못 받는다
 *  - 군량은 **창고 상한까지만** 들어가고 버려지는 양은 `mailGrainLoss`가 미리 말한다
 *  - 나머지 보상은 관리자 지급과 같은 함수를 지난다
 *  - 보내기 검사 — 한국어 필수 · 모르는 언어 · 길이 · 보상은 양수만 · 대상은 uid 또는 전체
 *  - 기한이 지난 줄은 걷힌다
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAIL_LIMITS, MAIL_TTL_MS, SERVER_OWNED_FIELDS, claimMail, createProfile, grainCap, mailClaimed, mailGrainLoss, mailRead,
  mailText, marketHeldCount, migrateProfile, parseMailDraft, pruneMailbox, readMailbox,
} from '../src/index.ts';
import type { Mail, PlayerProfile } from '../src/index.ts';

const T0 = Date.UTC(2026, 9, 21, 3, 0, 0);
const DAY = 86_400_000;

function city(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return { ...createProfile('우편성', 7), grain: 10, grainAt: T0, gold: 5, ...over };
}

function mail(over: Partial<Mail> = {}): Mail {
  return {
    id: 1, sentAt: T0, expiresAt: T0 + MAIL_TTL_MS, targetUid: null,
    title: { ko: '점검 보상', en: 'Maintenance' }, body: { ko: '죄송합니다' },
    rewards: [{ kind: 'gold', delta: 100 }, { kind: 'item', item: 'tang-yak', delta: 2 }],
    revokedAt: null, ...over,
  };
}

describe('받기 — 한 번만', () => {
  it('★ 보상이 들어오고 받았다고 적힌다 — 두 번째는 거절', () => {
    const r = claimMail(city(), mail(), T0 + DAY);
    assert.ok(r.ok);
    const p = r.ok ? r.profile : city();
    assert.equal(p.gold, 105);
    assert.equal(marketHeldCount(p, 'tang-yak'), 2, '아이템은 관리자 지급과 같은 함수를 지난다');
    assert.equal(mailClaimed(p, 1), true);
    assert.equal(mailRead(p, 1), true, '받으면 읽은 것이다');
    const again = claimMail(p, mail(), T0 + DAY);
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.code, 'mail.claimed');
  });

  it('★ 받은 기록이 JSON 왕복 · 되접기를 지나도 남는다 — 안 남으면 같은 보상을 다시 받는다', () => {
    const r = claimMail(city(), mail(), T0 + DAY);
    assert.ok(r.ok);
    const back = migrateProfile(JSON.parse(JSON.stringify(r.ok ? r.profile : null)))!;
    assert.deepEqual(back.mailbox, [{ id: 1, exp: T0 + MAIL_TTL_MS, claimed: true }]);
    assert.equal(claimMail(back, mail(), T0 + DAY).ok, false);
  });

  it('받은 기록은 서버 소유다 — 클라이언트가 지워 올려도 서버 값이 남는다', () => {
    assert.ok((SERVER_OWNED_FIELDS as readonly string[]).includes('mailbox'));
  });

  it('기한 · 회수 · 공지는 못 받는다', () => {
    const at = (m: Mail, now: number): string | undefined => { const r = claimMail(city(), m, now); return r.ok ? undefined : r.code; };
    assert.equal(at(mail(), T0 + MAIL_TTL_MS), 'mail.expired', '기한 그 시각부터 못 받는다');
    assert.equal(at(mail({ revokedAt: T0 + 1 }), T0 + DAY), 'mail.revoked');
    assert.equal(at(mail({ rewards: [] }), T0 + DAY), 'mail.noRewards');
    assert.equal(at(mail(), T0 + MAIL_TTL_MS - 1), undefined, '기한 직전은 받는다');
  });
});

describe('군량 — 창고 상한까지만', () => {
  it('★ 넘는 만큼은 버려지고, 버려질 양을 미리 말한다', () => {
    const p = city();
    const cap = grainCap(p);
    const m = mail({ rewards: [{ kind: 'grain', delta: cap }] });
    const lost = mailGrainLoss(p, m);
    assert.equal(lost, p.grain, '상한까지 남은 자리만큼 들어오고 나머지가 버려진다');
    const r = claimMail(p, m, T0 + DAY);
    assert.ok(r.ok);
    assert.equal(r.ok && r.profile.grain, cap);
    assert.equal(r.ok && r.grainLost, lost, '확인창의 숫자와 실제가 같다');
  });

  it('자리가 넉넉하면 버려지는 것이 없다', () => {
    const m = mail({ rewards: [{ kind: 'grain', delta: 1 }] });
    assert.equal(mailGrainLoss(city(), m), 0);
    const r = claimMail(city(), m, T0 + DAY);
    assert.equal(r.ok && r.profile.grain, 11);
  });

  it('이미 상한을 넘겨 있으면 전부 버려지고 군량은 줄지 않는다', () => {
    const p = city();
    const over = { ...p, grain: grainCap(p) + 5 };
    const m = mail({ rewards: [{ kind: 'grain', delta: 7 }] });
    assert.equal(mailGrainLoss(over, m), 7);
    const r = claimMail(over, m, T0 + DAY);
    assert.equal(r.ok && r.profile.grain, over.grain);
  });
});

describe('읽음 · 걷기', () => {
  it('읽으면 줄이 생기고, 공지도 읽을 수 있다', () => {
    const r = readMailbox(city(), mail({ rewards: [] }), T0 + DAY);
    assert.ok(r.ok);
    assert.equal(r.ok && mailRead(r.profile, 1), true);
    assert.equal(r.ok && mailClaimed(r.profile, 1), false);
  });

  it('이미 읽었으면 그대로(쓰지 않는다)', () => {
    const r = readMailbox(city(), mail(), T0 + DAY);
    const p = r.ok ? r.profile : city();
    const again = readMailbox(p, mail(), T0 + DAY);
    assert.equal(again.ok && again.profile, p);
  });

  it('★ 기한이 지난 줄은 쓸 때 걷힌다 — 30일보다 오래 쌓이지 않는다', () => {
    const old = { ...city(), mailbox: [{ id: 9, exp: T0 + DAY, claimed: true }] };
    const r = claimMail(old, mail(), T0 + 2 * DAY);
    assert.deepEqual(r.ok && r.profile.mailbox?.map((e) => e.id), [1]);
    assert.equal(pruneMailbox(old, T0 + 2 * DAY).mailbox, undefined, '다 걷히면 키째로 없앤다');
  });

  it('되접기 — 모양이 틀린 줄은 버리고, 같은 번호가 둘이면 받은 쪽을 남긴다', () => {
    const raw = { ...city(), mailbox: [{ id: 3, exp: T0, claimed: false }, { id: 3, exp: T0, claimed: true }, { id: -1, exp: T0 }, { id: 4 }, '쓰레기'] };
    assert.deepEqual(migrateProfile(raw)!.mailbox, [{ id: 3, exp: T0, claimed: true }]);
  });
});

describe('보내기 검사 (관리자 API가 부른다)', () => {
  const ok = { targetUid: null, title: { ko: '제목', en: 'Title' }, body: { ko: '본문' }, rewards: [{ kind: 'gold', delta: 10 }] };

  it('맞는 것은 그대로 — 빈 언어는 빼고 앞뒤 공백은 걷는다', () => {
    assert.deepEqual(parseMailDraft({ ...ok, title: { ko: ' 제목 ', en: '' } }), { ...ok, title: { ko: '제목' } });
    assert.deepEqual(parseMailDraft({ ...ok, rewards: [] }), { ...ok, rewards: [] }, '보상이 없으면 공지 우편');
  });

  it('한국어 필수 · 모르는 언어 · 길이', () => {
    assert.match(String(parseMailDraft({ ...ok, title: { en: 'x' } })), /한국어/);
    assert.match(String(parseMailDraft({ ...ok, body: { ko: 'x', fr: 'y' } })), /모르는 언어/);
    assert.match(String(parseMailDraft({ ...ok, title: { ko: 'x'.repeat(MAIL_LIMITS.title + 1) } })), /넘는다/);
  });

  it('★ 보상은 주는 것만 — 음수 · 회수 · 모르는 종류는 거절', () => {
    assert.match(String(parseMailDraft({ ...ok, rewards: [{ kind: 'gold', delta: -10 }] })), /주는 것만/);
    assert.match(String(parseMailDraft({ ...ok, rewards: [{ kind: 'equipmentRevoke', key: 'x#1' }] })), /주는 것만/);
    assert.match(String(parseMailDraft({ ...ok, rewards: [{ kind: 'gold', delta: 10_000_000 }] })), /보상:/, '관리자 지급의 상한을 그대로 지난다');
    assert.match(String(parseMailDraft({ ...ok, rewards: Array(MAIL_LIMITS.rewards + 1).fill({ kind: 'gold', delta: 1 }) })), /까지/);
  });

  it('대상은 uid이거나 전체(null)', () => {
    assert.match(String(parseMailDraft({ ...ok, targetUid: '관우' })), /targetUid/);
    const uid = '0b9d6f8e-1c2a-4f3b-9a7d-2e4c6b8a0f13';
    assert.equal((parseMailDraft({ ...ok, targetUid: uid }) as { targetUid: string }).targetUid, uid);
  });

  it('그 언어가 비면 한국어로 물러난다', () => {
    assert.equal(mailText({ ko: '제목', en: 'Title' }, 'en'), 'Title');
    assert.equal(mailText({ ko: '제목' }, 'mn'), '제목');
  });
});
