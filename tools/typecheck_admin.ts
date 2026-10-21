/**
 * 관리자 화면(`../SamChessAdmin`)의 타입 검사를 본체에서 부른다 — `npm run typecheck:admin` (2026-10-22, 관리 일원화).
 *
 * 화면은 `server-api/src/admin/types.ts` · `PlayerProfile` · `meta/src/mail.ts`를 `import type`으로 읽으므로,
 * 그 모양을 바꾼 뒤 **이 검사가 깨지는 것이 「관리자 쪽에 닿는다」의 알림**이다. 화면의 typecheck는 이 폴더의
 * **지금 체크아웃**을 읽는다(`tsconfig.json`의 `paths`).
 *
 * 옆 폴더가 없으면(다른 PC · CI) **실패가 아니라 건너뛴다고 말하고** 0으로 끝난다 — 「없으면 건너뛴다」는
 * 에셋 대조(`extract_data.py`)와 같은 결. 있는데 `node_modules`가 없으면 그건 실패다(검사를 못 했다).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ADMIN = resolve(import.meta.dirname, '..', '..', 'SamChessAdmin');

if (!existsSync(resolve(ADMIN, 'package.json'))) {
  console.log(`- 관리자 화면 typecheck 건너뜀 — ${ADMIN} 이 없다`);
  process.exit(0);
}
if (!existsSync(resolve(ADMIN, 'node_modules'))) {
  console.error(`✗ ${ADMIN}/node_modules 가 없다 — 그 폴더에서 npm install`);
  process.exit(1);
}

const r = spawnSync('npm run typecheck', { cwd: ADMIN, stdio: 'inherit', shell: true });
if (r.status === 0) console.log('✓ 관리자 화면 typecheck 통과');
else console.error('✗ 관리자 화면 typecheck 실패 — 본체의 계약(admin/types.ts · PlayerProfile · mail.ts)이 바뀌었으면 화면을 함께 고친다');
process.exit(r.status ?? 1);
