/**
 * 풀에서 꺼낸 연결로 일을 한다 — **꺼내 쓰는 동안의 끊김에 리스너를 단다** (2026-10-21).
 *
 * ★ `db.ts`의 `pool.on('error')`는 **쉬고 있는** 연결만 받는다. `pool.connect()`로 꺼낸 연결이 트랜잭션 도중
 * DB 쪽에서 끊기면 `pg`는 **그 연결 객체**에 `error`를 내고, 받는 리스너가 없으면 Node가 프로세스를 통째로 내린다.
 * Supabase가 느리던 날(2026-10-20) 관리자 API가 실제로 이렇게 죽었다 — 계정 저장 · 정산이 전부 지나는
 * `mutateProfile()`이 같은 모양이라 게임 API도 같은 날 죽을 수 있었다.
 *
 * 하는 일 셋:
 * - 꺼낸 직후 리스너를 단다 — 실패 자체는 진행 중인 쿼리의 reject로 이미 오므로 **적어 두기만** 한다
 * - 돌려주기 전에 뗀다 — 연결은 풀에서 다시 쓰이므로 안 떼면 리스너가 쌓인다
 * - 끊긴 연결은 **버린다**(`release(err)`) — 그대로 돌려주면 다음 요청이 죽은 연결을 받는다
 *
 * `db.ts`와 따로 둔 까닭: 그 파일은 import하는 순간 환경 변수를 요구해서 회귀가 부를 수 없다.
 */

/** `pg`의 `PoolClient`에서 여기가 쓰는 부분 — 회귀가 가짜 연결을 넣을 수 있게 좁혀 둔다 */
export interface CheckedOut {
  on(event: 'error', cb: (err: Error) => void): unknown;
  off(event: 'error', cb: (err: Error) => void): unknown;
  release(err?: Error | boolean): void;
}

export async function withCheckout<C extends CheckedOut, T>(
  connect: () => Promise<C>, label: string, fn: (client: C) => Promise<T>,
): Promise<T> {
  const client = await connect();
  let broken: Error | undefined;
  const onError = (err: Error): void => {
    broken = err;
    console.error(`[db] ${label} 도중 연결이 끊겼다 — 이 연결은 버린다:`, err.message);
  };
  client.on('error', onError);
  try {
    return await fn(client);
  } finally {
    client.off('error', onError);
    client.release(broken);
  }
}
