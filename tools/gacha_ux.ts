/**
 * 관리자 「가챠」 탭 눈 확인 (2026-11-13) — **관리자가 본 「다음 한 장」이 게임이 실제로 주는 장인가**를 진짜 가챠로 확인한다.
 *
 *   npm run look:gacha      (= node --env-file=.env tools/gacha_ux.ts [--out 폴더])
 *
 * 떠 있어야 하는 것 — 게임 API(`GAME_API`, 기본 8787) · 관리자 API(8788) · 관리자 화면(5174).
 * 계정 하나에 금화를 넣고: 가챠 전(배열 없음) → 한 장 → 관리자의 다음 칸을 적어 두고 한 장 더 → 같은가 → 묶음 뽑기 → 그 범위와 같은가 →
 * 화면(초록 칸 · 쪽 넘김)을 찍는다. 끝나면 계정을 지운다.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SORTIE_TUTORIALS, createProfile } from '@samchess/meta';
import { pool } from '../packages/server-api/src/db.ts';
import { saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import type { AdminGachaResponse } from '../packages/server-api/src/admin/types.ts';
import { adminSession, cleanupUsers, makeAdmin, makeUser } from './adminLook.ts';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]! : join(tmpdir(), 'samchess-gacha-look');
mkdirSync(OUT, { recursive: true });
const GAME_API = process.env['GAME_API'] ?? 'http://localhost:8787';
const ADMIN_API = process.env['ADMIN_API'] ?? 'http://localhost:8788';
const ADMIN_WEB = process.env['ADMIN_WEB'] ?? 'http://localhost:5174';
const ok = (m: string) => console.log(`✓ ${m}`);

try {
  const admin = await makeAdmin('gacha');
  const u = await makeUser('gacha', 'u');
  await saveProfileTrusted(u.uid, { ...createProfile(`가챠-${randomUUID().slice(0, 4)}`, 3), gold: 100_000, tutorial: { done: [...SORTIE_TUTORIALS] } });

  const peek = async (page?: number): Promise<AdminGachaResponse> => {
    const r = await fetch(`${ADMIN_API}/admin/users/${u.uid}/gacha${page ? `?page=${page}` : ''}`, { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(r.status, 200, `관리자 API ${r.status}`);
    return (await r.json()) as AdminGachaResponse;
  };
  const pull = async (kind: 'single' | 'multi'): Promise<string[]> => {
    const r = await fetch(`${GAME_API}/market/gacha`, {
      method: 'POST', headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }),
    });
    assert.equal(r.status, 200, `가챠 ${r.status} ${await r.clone().text()}`);
    return ((await r.json()) as { drawn: string[] }).drawn;
  };

  const before = await peek();
  assert.equal(before.started, false);
  assert.equal(before.slots.length, 0);
  ok(`가챠 전 — 배열 없음 (전체 ${before.total}칸, ${before.pages}쪽)`);

  const first = await pull('single');
  const p1 = await peek();
  assert.deepEqual([p1.started, p1.drawn, p1.page], [true, 1, 1]);
  assert.equal(p1.slots[0]!.officer, first[0], '첫 칸이 방금 뽑은 장수가 아니다');
  const predicted = p1.slots[1]!.officer;
  const second = await pull('single');
  assert.equal(second[0], predicted, `관리자가 본 다음 한 장(${predicted})과 실제(${second[0]})가 다르다`);
  ok(`다음 한 장 예측 = 실제 — ${predicted}`);

  const p2 = await peek();
  const range = p2.slots.slice(p2.drawn, p2.drawn + p2.multiCount).map((s) => s.officer);
  const multi = await pull('multi');
  assert.deepEqual(multi, range, '묶음 뽑기가 관리자가 본 범위와 다르다');
  const p3 = await peek();
  assert.equal(p3.drawn, 2 + p2.multiCount);
  assert.equal(Object.values(p3.drawnByGrade).reduce((a, b) => a + b, 0), p3.drawn, '등급별 합이 뽑은 수와 다르다');
  ok(`${p2.multiCount}연 = 관리자가 본 범위 · 뽑은 수 ${p3.drawn} · 등급별 합 일치`);

  const last = await peek(p3.pages);
  assert.equal(last.page, p3.pages);
  assert.equal(last.slots.at(-1)!.index, last.total - 1);
  assert.equal((await peek(99_999)).page, 1, '범위 밖 쪽은 다음 칸이 든 쪽으로');
  ok(`쪽 — 마지막 쪽 끝 칸 ${last.total - 1}, 범위 밖은 다음 칸이 든 쪽`);

  // ── 화면 ──
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await adminSession(page, admin);
  await page.goto(`${ADMIN_WEB}/#/users/${u.uid}`);
  await page.click('.tabs button:has-text("가챠")');
  await page.waitForSelector('table.gacha-grid td.next');
  const shown = await page.evaluate(() => ({
    next: document.querySelector('table.gacha-grid td.next')?.getAttribute('data-slot'),
    done: document.querySelectorAll('table.gacha-grid td.done').length,
    cells: document.querySelectorAll('table.gacha-grid td[data-slot]').length,
    rows: document.querySelectorAll('table.gacha-grid tbody tr').length,
    over: (() => { const w = document.querySelector('[data-panel="gacha"] .tablewrap')!; return w.scrollWidth - w.clientWidth; })(),
  }));
  assert.deepEqual([shown.next, shown.done, shown.cells, shown.rows], [String(p3.drawn), p3.drawn, 200, 20]);
  await page.screenshot({ path: join(OUT, 'gacha-1.png'), fullPage: true });
  console.log(`  📷 gacha-1.png (가로 넘침 ${shown.over}px)`);
  await page.click('[data-panel="gacha"] button:has-text("다음 ›")');
  await page.waitForSelector('table.gacha-grid[data-gacha-page="2"]');
  assert.equal(await page.locator('table.gacha-grid td.next').count(), 0);
  await page.click('[data-panel="gacha"] button:has-text("다음 칸이 있는 쪽")');
  await page.waitForSelector('table.gacha-grid[data-gacha-page="1"] td.next');
  await browser.close();
  ok(`화면 — 초록 칸 ${p3.drawn}번 · 흐린 칸 ${p3.drawn} · 200칸 20줄 · 다음 쪽 → 「다음 칸이 있는 쪽」으로 돌아옴 (${OUT})`);
} finally {
  await cleanupUsers();
  await pool.end().catch(() => {});
}
