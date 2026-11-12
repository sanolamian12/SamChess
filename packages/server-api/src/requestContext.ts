/**
 * **요청마다의 맥락** — 어느 라우트로 왔고 누가 보냈나 (2026-11-12, 변화 장부 · `ledger.ts`).
 *
 * 계정을 쓰는 자리(`profileStore.ts`의 `transact()`)는 라우트를 모른다 — 함수 수십 곳에 「출처」 인자를 더하면 하나만 빠뜨려도
 * 그 길이 「출처 없음」으로 보인다. 그래서 Fastify 훅이 요청마다 `AsyncLocalStorage`에 라우트를 넣고, 장부가 거기서 읽는다.
 * 요청 밖(도구 · 점검 타이머)에서 쓰면 맥락이 없다 — 그때 출처는 `tool`이다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';

interface RequestContext {
  /** `{메서드} {경로 틀}` — `POST /mail/:id/claim`처럼 Fastify의 경로 그대로(`ACTION_SOURCES`의 열쇠) */
  source: string;
  /** 인증된 계정 — `verifyToken()`이 채운다. 거절을 계정에 붙일 때 쓴다 */
  uid?: string;
  /** 이 요청이 무엇의 짝인가 — 우편 받기면 `mail:{id}`(2026-11-12, 지급 대조). 장부 줄 · 아이템 낱개에 함께 적는다 */
  ref?: string;
}

const store = new AsyncLocalStorage<RequestContext>();

/** 앱에 훅을 건다 — 게임 API · 관리자 API가 라우트를 붙이기 **전에** 부른다 */
export function attachRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', (req, _reply, done) => {
    const source = `${req.method} ${req.routeOptions.url ?? req.url}`;
    const id = (req.params as { id?: unknown } | undefined)?.id;
    store.run({ source, ...(source === 'POST /mail/:id/claim' && typeof id === 'string' ? { ref: `mail:${id}` } : {}) }, done);
  });
}

/** 지금 요청의 라우트 — 요청 밖이면 `tool` */
export const currentSource = (): string => store.getStore()?.source ?? 'tool';

/** 지금 요청이 무엇의 짝인가 — 없으면 `null`. 관리자 지급의 짝(`audit:{id}`)은 감사 로그를 적는 자리가 나중에 붙인다(`linkAudit`) */
export const currentRef = (): string | null => store.getStore()?.ref ?? null;

/** 지금 요청의 계정 */
export const currentUid = (): string | undefined => store.getStore()?.uid;

/** 인증이 끝난 계정을 맥락에 적는다 */
export function setContextUid(uid: string): void {
  const ctx = store.getStore();
  if (ctx) ctx.uid = uid;
}
