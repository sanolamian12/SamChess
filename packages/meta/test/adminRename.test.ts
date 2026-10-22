/**
 * 관리자의 도시 이름 강제 변경 회귀 (2026-10-22, `src/adminRename.ts`).
 *
 * 여기서 고정하는 것.
 *  - 금화는 그대로, **3일 대기는 비운다** — 강제로 바뀐 사람은 곧바로 게임의 이름 변경을 할 수 있다
 *  - 이름 꼴은 게임과 같다(NFC · 앞뒤 공백 · `CITY_NAME_MAX`) · 같은 이름 · 빈 이름은 거절
 *  - 알림 우편은 **가장 긴 입력에서도** 우편 검사(`parseMailDraft`)를 통과하는 보상 없는 공지다
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CITY_NAME_MAX, MAIL_LIMITS, applyForceRenameCity, applyRenameCity, canForceRenameCity, canRenameCity, createProfile,
  forceRenameMail, parseMailDraft,
} from '../src/index.ts';

const T0 = Date.UTC(2026, 9, 22, 3, 0, 0);
const UID = '00000000-0000-4000-8000-000000000001';

describe('도시 이름 강제 변경', () => {
  it('금화는 그대로, 3일 대기는 비워서 곧바로 게임의 이름 변경을 할 수 있다', () => {
    const renamed = applyRenameCity({ ...createProfile('처음성', 1), gold: 1_000 }, '두번째성', T0);
    assert.equal(canRenameCity(renamed, '세번째성', T0 + 1).ok, false, '게임에서 바꾼 직후는 대기 중');
    const forced = applyForceRenameCity(renamed, '  운영성  ');
    assert.equal(forced.cityName, '운영성');
    assert.equal(forced.gold, renamed.gold);
    assert.equal(forced.cityNameChangedAt, undefined);
    assert.equal('cityNameChangedAt' in forced, false, '칸째 지운다 — undefined로 남기면 JSON에서 사라져 diff만 흔들린다');
    assert.equal(canRenameCity(forced, '세번째성', T0 + 1).ok, true, '강제 변경 뒤에는 바로 바꿀 수 있다');
  });

  it('이름 꼴은 게임과 같다 — NFC로 모은 뒤 같은 이름이면 거절, 빈 이름 · 너무 긴 이름 거절', () => {
    const p = createProfile('한성', 1);
    assert.equal(canForceRenameCity(p, '한성'.normalize('NFD')).ok, false, '조합형으로 적어도 같은 이름');
    assert.equal(canForceRenameCity(p, '   ').ok, false);
    assert.equal(canForceRenameCity(p, '가'.repeat(CITY_NAME_MAX + 1)).ok, false);
    assert.equal(canForceRenameCity(p, '가'.repeat(CITY_NAME_MAX)).ok, true);
    assert.throws(() => applyForceRenameCity(p, '한성'), /같은 이름/);
  });

  it('알림 우편 — 가장 긴 이름 · 사유(500자)에서도 우편 검사를 통과하는 공지, 사유가 본문에 그대로', () => {
    const reason = '사'.repeat(500);
    const draft = forceRenameMail(UID, '가'.repeat(CITY_NAME_MAX), '나'.repeat(CITY_NAME_MAX), reason);
    const parsed = parseMailDraft(draft);
    assert.notEqual(typeof parsed, 'string', String(parsed));
    assert.deepEqual(parsed, draft, '검사를 지나도 그대로');
    assert.equal(draft.targetUid, UID);
    assert.deepEqual(draft.rewards, []);
    assert.ok(draft.body.ko.includes(reason) && draft.body.en!.includes(reason));
    assert.ok(draft.body.ko.length <= MAIL_LIMITS.body);
  });
});
