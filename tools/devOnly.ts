/**
 * 개발 DB에서만 도는 도구의 문 (2026-10-22) — 계정을 만들고 지우거나 **전체 우편**을 보내는 스모크가 운영(`SAMCHESS_ENV=production`)
 * 값을 읽고 있으면 시작하기 전에 멈춘다. 운영에서는 스모크를 돌리지 않는다(`docs/운영_Supabase.md`).
 *
 * 스모크 · 도구는 전부 `--env-file=.env`(개발)를 읽고 운영 값은 `.env.production`에만 두므로 평소에는 닿을 일이 없다 —
 * 이것은 누가 운영 값을 `.env`에 붙여 넣었을 때를 위한 두 번째 문이다.
 */
import { samchessEnv } from '../packages/server-api/src/environment.ts';

export function refuseProduction(tool: string): void {
  const which = samchessEnv(process.env);
  if (which === 'development') return;
  console.error(`✗ ${tool}은(는) 개발 DB에서만 돈다 — SAMCHESS_ENV=${process.env['SAMCHESS_ENV']}. 읽은 env 파일을 확인할 것`);
  process.exit(1);
}
