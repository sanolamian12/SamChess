/**
 * **이상 징후 점검을 지금 한 번** (2026-11-12, `packages/server-api/src/anomaly.ts`). 게임 API가 1시간마다 돌리는 것과 같다.
 *
 *   npm run anomaly:scan        (개발 DB)
 *   npm run anomaly:scan:prod   (운영 DB — 읽고 징후 · 기준 줄을 적는다. 계정은 안 고친다)
 */
import { pool } from '../packages/server-api/src/db.ts';
import { scanAnomalies } from '../packages/server-api/src/anomaly.ts';

try {
  const r = await scanAnomalies();
  if (!r) console.log('· 다른 점검이 돌고 있다 — 건너뜀');
  else console.log(`✓ 점검 #${r.scanId} — 계정 ${r.accounts} · 새 징후 ${r.opened} · 다시 걸림 ${r.bumped} (장부 ~#${r.ledgerTo} · 거절 ~#${r.rejectsTo})`);
  const open = (await pool.query<{ kind: string; n: string }>(
    "select kind, count(*) as n from anomalies where status = 'open' group by kind order by kind")).rows;
  console.log(`  열린 징후: ${open.length ? open.map((o) => `${o.kind} ${o.n}`).join(' · ') : '없음'}`);
} finally {
  await pool.end();
}
