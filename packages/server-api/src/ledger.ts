/**
 * **변화 장부를 적는다** (2026-11-12, 설계 `history/2026-11-12_이상징후_설계.md` · 판정은 `@samchess/meta`의 `ledger.ts`).
 *
 * `profileStore.ts`의 `transact()`가 계정을 **실제로 쓸 때** 같은 트랜잭션 안에서 부른다 — 장부 쓰기가 실패하면 계정 쓰기도 되감긴다
 * (「장부 없이 바뀐 계정」이 없게). 감시하는 값이 안 바뀐 쓰기는 줄을 안 남긴다.
 *
 * 한 번의 쓰기는 두 단계라 두 줄까지 남는다:
 *  · `sync` — 읽는 순간의 서버 시계 정산(`syncAtServer`: 군량 충전 · 제조 완료 · 60분 방치 정산 …). 군량 충전**만**이면 안 남긴다
 *  · `action` — 그 요청이 한 일. 새 계정이면 `create`
 * 둘을 가르지 않으면 「조회했는데 카드가 늘었다」(방치 정산의 보상)가 그 라우트 탓이 된다.
 *
 * 거절(`account_rejects`)도 여기서 적는다 — 정상 클라이언트로는 거의 안 나오는 것만(`REJECT_WATCH`).
 */
import type { PoolClient } from 'pg';
import {
  ACTION_SOURCES, DEV_SOURCES, REJECT_WATCH, creationViolations, ledgerDelta, ledgerValues, outsideDelta, syncAllowed, unexpectedIncreases,
} from '@samchess/meta';
import type { LedgerValues, PlayerProfile } from '@samchess/meta';
import { pool } from './db.ts';
import { samchessEnv } from './environment.ts';
import { currentRef, currentSource, currentUid } from './requestContext.ts';

const PRODUCTION = samchessEnv(process.env) === 'production';

const grainOnly = (delta: Record<string, number>): boolean => Object.keys(delta).every((k) => k === 'grain');

/**
 * 한 줄을 적는다. `unexpected`는 **쓰는 순간의 판정**이다(① 출처 없는 변화) — 그 순간에만 쓰기 전 · 후의 계정이 통째로 있어
 * (예: 읽는 순간 AI 대전이 정산됐나) 점검이 나중에 다시 낼 수 없다. 비었으면 `null`이고, 점검은 `null`이 아닌 줄만 징후로 올린다.
 */
async function insert(
  tx: PoolClient, uid: string, phase: 'sync' | 'action' | 'create' | 'baseline', delta: Record<string, number>, after: LedgerValues,
  unexpected: readonly string[],
): Promise<void> {
  await tx.query(
    'insert into account_ledger (uid, source, phase, delta, after, unexpected, ref) values ($1, $2, $3, $4, $5, $6, $7)',
    [uid, currentSource(), phase, JSON.stringify(delta), JSON.stringify(after), unexpected.length ? [...unexpected] : null,
      phase === 'action' ? currentRef() : null],
  );
}

/** 도시 삭제의 줄에 붙는 것 — 장부의 값은 숫자뿐이라 옛 도시의 이름은 여기 말고 남을 데가 없다 */
export interface DeleteNote { cityName: string | null; cityLevel: number | null }

/**
 * **도시 삭제** (2026-11-13) — 도시를 지우는 그 트랜잭션 안에서 부른다(`profileStore.ts`의 `deleteProfile`). 지운 줄이 없으면 그 계정의 장부는
 * 옛 도시의 마지막 줄 다음에 새 도시의 `create`가 곧장 이어져 「도시가 바뀌었다」를 짐작으로만 읽었다. 바뀐 만큼 = 지운 도시의 값 전부(음수),
 * `after`는 비었다(도시가 없다). 출처는 요청 맥락 그대로(`DELETE /profile`, 도구면 `tool`). 판정(`unexpected`)은 없다 — 줄기만 하는 줄이다.
 */
export async function writeDeleteLine(tx: PoolClient, uid: string, old: PlayerProfile | null, raw: unknown): Promise<void> {
  // 되접기가 못 읽는 행(형식이 깨짐)이어도 지운 사실은 남긴다 — 값은 비우고 이름만 원본에서
  const delta = (old && ledgerDelta(ledgerValues(old), {})) ?? {};
  const rawName = (raw as { cityName?: unknown } | null)?.cityName;
  const note: DeleteNote = {
    cityName: old?.cityName ?? (typeof rawName === 'string' ? rawName : null),
    cityLevel: typeof old?.cityLevel === 'number' ? old.cityLevel : null,
  };
  await tx.query(
    `insert into account_ledger (uid, source, phase, delta, after, note) values ($1, $2, 'delete', $3, '{}', $4)`,
    [uid, currentSource(), JSON.stringify(delta), JSON.stringify(note)],
  );
}

/**
 * 한 번의 쓰기를 장부에 적는다. `migrated`는 DB에서 읽어 되접은 값(정산 전, 새 계정이면 `null`),
 * `current`는 서버 시계로 정산한 값, `next`는 쓴 값이다.
 */
export async function writeLedger(
  tx: PoolClient, uid: string, migrated: PlayerProfile | null, current: PlayerProfile | null, next: PlayerProfile,
): Promise<void> {
  const after = ledgerValues(next);
  if (!migrated || !current) {
    const delta = ledgerDelta(null, after);
    // 새 계정 — 시작 꾸러미 밖의 것을 들고 왔나(첫 `PUT /profile`은 클라이언트가 만든 계정을 받는다)
    if (delta) await insert(tx, uid, 'create', delta, after, creationViolations(next));
    return;
  }
  const read = ledgerValues(migrated);
  const synced = ledgerValues(current);
  const syncDelta = ledgerDelta(read, synced);
  const recordSync = syncDelta !== null && !grainOnly(syncDelta);
  const actionDelta = ledgerDelta(synced, after);
  if (!recordSync && !actionDelta) return;
  // **장부 밖에서 바뀌었나 — 새 줄을 얹기 전에 본다** (①-b). DB를 직접 고친 뒤 이 쓰기가 새 `after`를 얹으면, 점검이 「마지막 `after` = 지금 값」을
  // 보고 지나친다 — 그 변화는 어느 줄에도 안 남는다. 그래서 읽은 값을 장부의 마지막 `after`와 견주어 다르면 기준 줄에 판정을 달아 남긴다.
  const last = (await tx.query<{ after: LedgerValues }>(
    'select after from account_ledger where uid = $1 order by id desc limit 1', [uid])).rows[0];
  const outside = last ? outsideDelta(last.after, read) : null;
  if (outside) await insert(tx, uid, 'baseline', outside, read, ['outside']);
  if (recordSync) {
    await insert(tx, uid, 'sync', syncDelta!, synced, unexpectedIncreases(syncDelta!, syncAllowed(migrated, current)));
  }
  if (actionDelta) {
    const source = currentSource();
    const unexpected: string[] = unexpectedIncreases(actionDelta, ACTION_SOURCES[source] ?? []);
    // 운영에서 개발용 길이 쓰였다 — 무엇이 늘었든 징후다
    if (PRODUCTION && DEV_SOURCES.includes(source)) unexpected.push('dev');
    await insert(tx, uid, 'action', actionDelta, after, unexpected);
  }
}

/**
 * 서버가 거절한 요청을 적는다 — 지켜보는 코드(`REJECT_WATCH`)만, 인증된 요청만. **실패해도 응답을 막지 않는다**
 * (거절 기록은 감시를 위한 것이라, 그것 때문에 게임이 멈추면 안 된다).
 */
export async function recordReject(code: string | undefined): Promise<void> {
  const uid = currentUid();
  if (!code || !uid || !(code in REJECT_WATCH)) return;
  try {
    await pool.query('insert into account_rejects (uid, source, code) values ($1, $2, $3)', [uid, currentSource(), code]);
  } catch (e) {
    console.error(`[ledger] 거절 기록 실패 — uid=${uid} code=${code}`, e);
  }
}
