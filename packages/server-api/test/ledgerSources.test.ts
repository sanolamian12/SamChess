/**
 * 「늘릴 수 있는 길」 표(`@samchess/meta`의 `ACTION_SOURCES`)가 **실제 라우트와 같은 목록인가** (2026-11-12, 변화 장부).
 *
 * 표에 없는 쓰기 라우트가 금화를 늘리면 운영에서 「출처 없는 변화」 오탐으로 처음 알게 된다 — 라우트를 더할 때 표도 함께 고치게
 * 여기서 떨어뜨린다. 표에만 있고 라우트가 없는 줄(지운 라우트)도 떨어뜨린다. 라우트 파일을 글자로 읽는다 — 앱을 띄우면 DB가 필요하다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ACTION_SOURCES, DEV_SOURCES } from '@samchess/meta';

const routesIn = (file: string): string[] => {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');
  return [...src.matchAll(/app\.(get|post|put|delete)\('([^']+)'/g)].map((m) => `${m[1]!.toUpperCase()} ${m[2]}`);
};

const ROUTES = [...routesIn('../src/routes.ts'), ...routesIn('../src/admin/routes.ts')];
const WRITES = ROUTES.filter((r) => !r.startsWith('GET '));

describe('늘릴 수 있는 길 — 라우트 목록과 같은가', () => {
  it('라우트를 읽었다(정규식이 빈손이면 이 검사가 아무것도 안 본다)', () => {
    assert.ok(WRITES.length > 40, `쓰기 라우트 ${WRITES.length}개`);
  });

  it('쓰기 라우트는 전부 표에 있다', () => {
    const missing = WRITES.filter((r) => !(r in ACTION_SOURCES));
    assert.deepEqual(missing, [], '새 라우트를 meta/src/ledger.ts의 ACTION_SOURCES에 적는다 — 무엇을 늘릴 수 있는가');
  });

  it('표의 줄은 전부 실제 라우트다', () => {
    const stale = Object.keys(ACTION_SOURCES).filter((r) => !ROUTES.includes(r));
    assert.deepEqual(stale, []);
  });

  it('개발용 길은 표에 있다', () => {
    for (const r of DEV_SOURCES) assert.ok(r in ACTION_SOURCES, r);
  });
});
