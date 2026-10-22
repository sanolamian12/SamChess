/**
 * 개발 / 운영 구분 (2026-10-22) — `SAMCHESS_ENV`는 `development`(비우면 이것) 또는 `production`.
 *
 * Supabase 프로젝트는 둘로 갈린다 — **지금 쓰는 것이 개발**이고(저장소의 `.env`), **운영은 배포 직전에 새로 만든다**
 * (`.env.production`, git에 안 들어간다. 절차는 `docs/운영_Supabase.md`). 운영 값이 개발용 설정과 섞이는 것을 **떠 있는 동안
 * 조용히** 두지 않도록, 서버가 뜰 때 여기서 한 번 본다 — 틀리면 이유를 다 적고 뜨지 않는다.
 *
 * 순수 함수다(`env`를 인자로) — 회귀가 가짜 환경으로 갈래를 다 민다(`test/environment.test.ts`).
 */
export type SamchessEnv = 'development' | 'production';

type Env = Record<string, string | undefined>;

/** 비우면 개발. 그 밖의 글자(오타 — `prod` · `Production`)는 개발로 물러나지 않고 문제로 본다 */
export function samchessEnv(env: Env): SamchessEnv | null {
  const v = env['SAMCHESS_ENV'];
  if (v === undefined || v === '' || v === 'development') return 'development';
  return v === 'production' ? 'production' : null;
}

/** 서버의 내부 비밀이 이보다 짧으면 운영에서 거절한다 — `.env.example`의 「아무 문자열」을 그대로 쓰지 않게 */
export const INTERNAL_SECRET_MIN = 32;

/**
 * 게임 API가 이 환경으로 떠도 되는가 — 문제 목록(비면 된다).
 * 운영에서만 보는 것: 개발용 지급이 꺼져 있다 · 클라이언트 주소가 정해져 있다(안 정하면 CORS가 모든 곳에 열린다) · 내부 비밀이 충분히 길다.
 */
export function gameApiProblems(env: Env): string[] {
  const which = samchessEnv(env);
  if (which === null) return [`SAMCHESS_ENV=${env['SAMCHESS_ENV']} — development 또는 production만 된다`];
  if (which === 'development') return [];
  const out: string[] = [];
  if (env['SAMCHESS_DEV_GRANTS'] === '1') out.push('SAMCHESS_DEV_GRANTS=1 — 운영에서 개발용 지급(금화 · 카드를 찍어 내는 길)이 열린다');
  if (!env['SAMCHESS_WEB_ORIGIN']) out.push('SAMCHESS_WEB_ORIGIN이 없다 — CORS가 모든 주소에 열린다(게임 화면의 배포 주소를 적는다)');
  if ((env['INTERNAL_API_SECRET'] ?? '').length < INTERNAL_SECRET_MIN) {
    out.push(`INTERNAL_API_SECRET이 ${INTERNAL_SECRET_MIN}자보다 짧다 — 운영용으로 새로 만든다(예: openssl rand -hex 32)`);
  }
  return out;
}

/** 부팅 자리에서 — 문제가 있으면 전부 적고 던진다 */
export function assertBootable(label: string, problems: string[]): void {
  if (problems.length === 0) return;
  throw new Error(`${label}을(를) 띄우지 않는다 —\n${problems.map((p) => `  · ${p}`).join('\n')}`);
}
