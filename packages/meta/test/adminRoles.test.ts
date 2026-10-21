/**
 * 관리자 역할 나누기 회귀 (2026-10-21c, `src/admin.ts`의 역할 절).
 *
 * 여기서 고정하는 것.
 *  - **권한 표** — 관리자는 전부, CS는 보기 · 정리 · 지급 · 한 사람 우편 · 7일 이하 정지만
 *  - **같은 조정이 본문으로 갈린다** — 양수 · 병기 지급은 `grant`, 음수 · `equipmentRevoke`는 `revoke`
 *  - **정지 일수** — 7일까지 `ban`, 8일 · 영구(36500)는 `ban.long`
 *  - **CS 한 번 상한은 `ADJUST_LIMITS`의 1/10** — 정확히 상한은 통과, 상한 + 1은 거절
 *  - **하루 합계는 한 번 × 5이고 지급과 우편 보상이 함께 쓴다** — 감사 로그 줄에서 센다
 *  - **우편 한 통의 같은 종류 줄들은 합쳐서 잰다** — 장수를 바꿔 줄을 나눠도 한 번 상한을 못 넘는다
 *  - **하루 경계는 KST 자정**(`raidDay`와 같다)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADJUST_LIMITS, ADMIN_PERMISSIONS, CS_BAN_DAYS_MAX, CS_DAILY_FACTOR, CS_DAILY_LIMITS, CS_LIMITS, ROLE_PERMISSIONS,
  adjustPermission, banPermission, csCheck, csDayStartMs, csUsageFromAudit, grantUsage, hasPermission, isAdminRole,
  mailPermission, raidDay,
} from '../src/index.ts';
import type { Adjustment, CsUsage } from '../src/index.ts';

const none: CsUsage = { gold: 0, grain: 0, materials: 0, cards: 0, item: 0, equipment: 0 };
const used = (u: Partial<CsUsage>): CsUsage => ({ ...none, ...u });

describe('권한 표', () => {
  it('관리자는 전부다', () => {
    assert.deepEqual([...ROLE_PERMISSIONS.admin].sort(), [...ADMIN_PERMISSIONS].sort());
  });

  it('CS는 보기 · 정리 · 지급 · 한 사람 우편 · 짧은 정지만', () => {
    assert.deepEqual([...ROLE_PERMISSIONS.cs].sort(), ['ban', 'grant', 'mail.one', 'resolve', 'view']);
    for (const p of ['revoke', 'mail.all', 'mail.revoke', 'ban.long', 'unban'] as const) assert.equal(hasPermission('cs', p), false, p);
  });

  it('역할은 admin · cs뿐이다', () => {
    assert.ok(isAdminRole('admin') && isAdminRole('cs'));
    for (const v of ['Admin', 'superuser', '', null, undefined, 1]) assert.equal(isAdminRole(v), false, String(v));
  });
});

describe('본문을 보고 권한을 정한다', () => {
  it('조정 — 주는 쪽은 grant, 거두는 쪽은 revoke', () => {
    const cases: [Adjustment, string][] = [
      [{ kind: 'gold', delta: 1 }, 'grant'], [{ kind: 'gold', delta: -1 }, 'revoke'],
      [{ kind: 'cards', officer: 'gwan-u', delta: 3 }, 'grant'], [{ kind: 'cards', officer: 'gwan-u', delta: -3 }, 'revoke'],
      [{ kind: 'item', item: 'tang-yak', delta: -1 }, 'revoke'],
      [{ kind: 'equipmentGrant', equipmentId: 'x', count: 1 }, 'grant'], [{ kind: 'equipmentRevoke', key: 'x#1' }, 'revoke'],
    ];
    for (const [adj, perm] of cases) assert.equal(adjustPermission(adj), perm, JSON.stringify(adj));
  });

  it('정지 — 7일까지 ban, 8일 · 영구는 ban.long', () => {
    assert.equal(banPermission(1), 'ban');
    assert.equal(banPermission(CS_BAN_DAYS_MAX), 'ban');
    assert.equal(banPermission(CS_BAN_DAYS_MAX + 1), 'ban.long');
    assert.equal(banPermission(36_500), 'ban.long');
  });

  it('우편 — 받는 사람이 없으면 전체', () => {
    assert.equal(mailPermission({ targetUid: null }), 'mail.all');
    assert.equal(mailPermission({ targetUid: '00000000-0000-0000-0000-000000000000' }), 'mail.one');
  });
});

describe('CS 상한', () => {
  it('한 번 상한은 관리자의 1/10(내림, 최소 1), 하루는 × 5 — 기획 표 그대로', () => {
    assert.deepEqual(CS_LIMITS, { gold: 10_000, grain: 10_000, materials: 1_000, cards: 10, item: 9, equipment: 1 });
    assert.deepEqual(CS_DAILY_LIMITS, { gold: 50_000, grain: 50_000, materials: 5_000, cards: 50, item: 45, equipment: 5 });
    for (const k of Object.keys(ADJUST_LIMITS) as (keyof CsUsage)[]) assert.equal(CS_DAILY_LIMITS[k], CS_LIMITS[k] * CS_DAILY_FACTOR);
  });

  it('정확히 한 번 상한은 통과, 상한 + 1은 once로 거절', () => {
    assert.deepEqual(csCheck([{ kind: 'gold', delta: 10_000 }], none), { ok: true });
    const r = csCheck([{ kind: 'gold', delta: 10_001 }], none);
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.deepEqual([r.kind, r.scope, r.limit, r.amount], ['gold', 'once', 10_000, 10_001]);
    assert.match(r.message, /한 번에 10,000까지/);
    assert.deepEqual(csCheck([{ kind: 'equipmentGrant', equipmentId: 'x', count: 1 }], none), { ok: true });
    assert.equal(csCheck([{ kind: 'equipmentGrant', equipmentId: 'x', count: 2 }], none).ok, false);
    assert.deepEqual(csCheck([{ kind: 'item', item: 'tang-yak', delta: 9 }], none), { ok: true });
    assert.equal(csCheck([{ kind: 'item', item: 'tang-yak', delta: 10 }], none).ok, false);
  });

  it('하루 합계 — 정확히 닿으면 통과, 하나 넘으면 daily로 거절(남은 양을 말한다)', () => {
    assert.deepEqual(csCheck([{ kind: 'gold', delta: 10_000 }], used({ gold: 40_000 })), { ok: true });
    const r = csCheck([{ kind: 'gold', delta: 1 }], used({ gold: 50_000 }));
    assert.ok(!r.ok);
    assert.deepEqual([r.kind, r.scope, r.limit, r.used, r.amount], ['gold', 'daily', 50_000, 50_000, 1]);
    const r2 = csCheck([{ kind: 'gold', delta: 10_000 }], used({ gold: 40_001 }));
    assert.ok(!r2.ok);
    assert.match(r2.message, /남은 9,999/);
  });

  it('종류마다 따로 센다 — 금화를 다 써도 군량은 준다', () => {
    assert.deepEqual(csCheck([{ kind: 'grain', delta: 10_000 }], used({ gold: 50_000 })), { ok: true });
  });

  it('거두는 쪽은 상한에 안 들어간다', () => {
    assert.deepEqual(grantUsage([{ kind: 'gold', delta: -100_000 }, { kind: 'equipmentRevoke', key: 'x#1' }]), none);
  });

  it('한 요청 안의 같은 종류는 합쳐서 잰다 — 장수를 바꿔 줄을 나눠도 한 번 상한을 못 넘는다', () => {
    const split: Adjustment[] = [{ kind: 'cards', officer: 'gwan-u', delta: 6 }, { kind: 'cards', officer: 'jang-bi', delta: 5 }];
    const r = csCheck(split, none);
    assert.ok(!r.ok);
    assert.deepEqual([r.kind, r.scope, r.amount], ['cards', 'once', 11]);
    assert.deepEqual(csCheck([split[0]!, { kind: 'cards', officer: 'jang-bi', delta: 4 }], none), { ok: true });
  });
});

describe('하루 합계는 감사 로그에서 — 지급과 우편 보상이 함께', () => {
  const rows = [
    { action: 'adjust.gold', params: { kind: 'gold', delta: 10_000 } },
    { action: 'adjust.gold', params: { kind: 'gold', delta: -500 } }, // 거둔 것은 안 센다
    { action: 'adjust.cards', params: { kind: 'cards', officer: 'gwan-u', delta: 4 } },
    { action: 'mail.send', params: { mailId: 7, targetUid: null, rewards: [{ kind: 'gold', delta: 30_000 }, { kind: 'cards', officer: 'jang-bi', delta: 2 }] } },
    { action: 'mail.send', params: { mailId: 8, rewards: [] } },
    { action: 'resolve.raid', params: { kind: 'raid' } },
    { action: 'ban', params: { days: 3 } },
    { action: 'adjust.gold', params: { kind: 'gold', delta: 'many' } }, // 모양이 틀린 줄은 넘긴다
  ];

  it('주는 쪽만 종류별로 더한다', () => {
    assert.deepEqual(csUsageFromAudit(rows), used({ gold: 40_000, cards: 6 }));
  });

  it('지급 40,000 + 우편 10,000이면 하루 금화가 찬다 — 둘이 같은 합계를 쓴다', () => {
    const today = csUsageFromAudit(rows);
    assert.deepEqual(csCheck([{ kind: 'gold', delta: 10_000 }], today), { ok: true });
    const full = csUsageFromAudit([...rows, { action: 'mail.send', params: { rewards: [{ kind: 'gold', delta: 10_000 }] } }]);
    assert.equal(full.gold, 50_000);
    const r = csCheck([{ kind: 'gold', delta: 1 }], full);
    assert.ok(!r.ok);
    assert.equal(r.scope, 'daily');
  });
});

describe('CS 하루의 경계는 KST 자정', () => {
  it('raidDay와 같은 날의 00:00 KST(= 전날 15:00Z)', () => {
    const at = Date.parse('2026-10-21T14:59:59Z'); // KST 23:59:59
    assert.equal(raidDay(at), '2026-10-21');
    assert.equal(csDayStartMs(at), Date.parse('2026-10-20T15:00:00Z'));
    const next = Date.parse('2026-10-21T15:00:00Z'); // KST 다음 날 00:00
    assert.equal(csDayStartMs(next), next);
  });
});
