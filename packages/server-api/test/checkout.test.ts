/**
 * 꺼낸 연결의 끊김 회귀 (`src/checkout.ts`, 2026-10-21).
 *
 * 가짜 연결은 진짜 `pg`처럼 **EventEmitter**다 — 리스너 없는 `error`는 던진다(= 프로세스가 내려간다).
 * 첫 검사가 그 전제를 확인해야 나머지가 의미가 있다(「검사를 넣었으면 실패하는 상태를 만들어 본다」).
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { withCheckout } from '../src/checkout.ts';

class FakeClient extends EventEmitter {
  released: (Error | boolean | undefined)[] = [];
  release(err?: Error | boolean): void { this.released.push(err); }
}

const quiet = <T>(run: () => Promise<T>): Promise<T> => {
  const orig = console.error;
  console.error = () => {};
  return run().finally(() => { console.error = orig; });
};

test('전제: 리스너가 없으면 연결의 error가 던진다 — 이것이 프로세스를 내리던 것이다', () => {
  assert.throws(() => new FakeClient().emit('error', new Error('Connection terminated unexpectedly')));
});

test('트랜잭션 도중 끊겨도 안 던지고, 끊긴 연결은 버린다', async () => {
  const client = new FakeClient();
  await quiet(() => assert.rejects(withCheckout(async () => client, '시험', async (c) => {
    c.emit('error', new Error('Connection terminated unexpectedly'));
    throw new Error('query failed'); // 진짜 pg는 진행 중인 쿼리가 이렇게 reject된다
  }), /query failed/));
  assert.equal(client.released.length, 1);
  assert.ok(client.released[0] instanceof Error, '끊긴 연결은 release(err)로 버려야 한다');
  assert.equal(client.listenerCount('error'), 0, '리스너를 떼지 않으면 풀에서 다시 쓸 때 쌓인다');
});

test('멀쩡하면 값을 돌려주고 연결을 그대로 돌려준다', async () => {
  const client = new FakeClient();
  const v = await withCheckout(async () => client, '시험', async () => 42);
  assert.equal(v, 42);
  assert.deepEqual(client.released, [undefined]);
  assert.equal(client.listenerCount('error'), 0);
});

test('돌려준 뒤에 난 끊김은 풀의 몫이다 — 여기 리스너가 남아 있지 않다', async () => {
  const client = new FakeClient();
  await withCheckout(async () => client, '시험', async () => null);
  assert.throws(() => client.emit('error', new Error('idle drop')));
});
