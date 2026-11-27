/**
 * 도적떼 실제 플레이 확인 — 진짜 계정으로 로그인해서 출몰 → 파수꾼 → 출정 막힘 → 방어전 →
 * 항복 정산 → 마지막 알림 → 자동 항복까지 끝까지 눌러 본다 (GDD §5.11, 2026-09-21).
 *
 *   npm run server-api   (새 경로 /raid/* 가 있어야 한다 — 낡은 서버면 404로 멈춘다)
 *   npm run dev
 *   node --experimental-strip-types --env-file=.env tools/raid_play.ts
 *
 * 농지 레벨·군량은 **서버에** `saveProfileTrusted()`로 심는다(화면 오버라이드가 아니다).
 * 10분을 기다릴 수는 없으므로 마감 쪽 두 갈래(마지막 알림 · 자동 항복)만 도적떼의 출몰
 * 시각을 서버에 과거로 심어 만든다 — 판정은 여전히 서버의 `syncRaid()`가 한다.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { SORTIE_TUTORIALS, addSquad, garrisonOf, newInstance, raidDay, raidLoot, squadAt } from '../packages/meta/src/index.ts';
import type { OfficerId, PieceType } from '@samchess/rules';
import type { PlayerProfile } from '../packages/meta/src/index.ts';
import { getProfile, saveProfileTrusted } from '../packages/server-api/src/profileStore.ts';
import { pool } from '../packages/server-api/src/db.ts';
import { shotDir } from './shotDir.ts';

const BASE = 'http://localhost:5173';
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SECRET_KEY = process.env['SUPABASE_SECRET_KEY']!;
const SHOTS = process.env['SHOTS'] ?? shotDir('raid_play');   // 안 주면 OS 임시 폴더(저장소 맨 위에 쌓이지 않게)
const MIN = 60_000;

const step = (m: string) => console.log(`\n▶ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
let cleanup: () => Promise<void> = async () => {};
/** 실패 순간의 화면과 콘솔 — 「안 온다」만으로는 왜인지 모른다 */
let onFail: () => Promise<void> = async () => {};
const fail = async (m: string): Promise<never> => {
  console.error(`  ✗ ${m}`);
  await onFail().catch(() => {});
  await cleanup();
  process.exit(1);
};

// ── 진짜 계정 하나 ────────────────────────────────────────────
const email = `raid-play-${randomUUID()}@samchess.test`;
const password = randomUUID();
const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!createRes.ok) await fail(`계정 생성 실패 — ${createRes.status} ${await createRes.text()}`);
const uid = (await createRes.json() as { id: string }).id;
step(`테스트 계정 — ${email}`);

const browser = await chromium.launch();
cleanup = async () => {
  await browser.close().catch(() => {});
  await pool.query('delete from profiles where uid = $1', [uid]).catch(() => {});
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  });
  await pool.end().catch(() => {});
  console.log('\n✓ 테스트 계정 정리');
};

const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
const errors: string[] = [];
page.on('dialog', (d) => void d.accept());
page.on('response', (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name: string) => { await page.screenshot({ path: `${SHOTS}/${name}.png` }); ok(`📷 ${name}.png`); };
onFail = async () => {
  await page.screenshot({ path: `${SHOTS}/raid-fail.png` });
  const where = await page.evaluate(() => ({
    screen: (document.querySelector('[data-screen]') as HTMLElement | null)?.dataset['screen'] ?? null,
    frame: document.getElementById('frame')?.className,
    alert: (document.querySelector('[data-modal="raidAlert"]') as HTMLElement | null)?.dataset['kind'] ?? null,
    alertError: document.querySelector('.stw[data-say="error"] [data-field="guideText"]')?.textContent ?? null,
  }));
  console.error(`    화면 ${JSON.stringify(where)}`);
  for (const e of errors) console.error(`    콘솔: ${e}`);
};

/** 서버 행을 **날것으로** 읽는다 — `getProfile()`은 읽으면서 되쓰므로 폴링에 쓰면 경주를 만든다 */
const row = async (): Promise<PlayerProfile> =>
  (await pool.query<{ data: PlayerProfile }>('select data from profiles where uid = $1', [uid])).rows[0]!.data;

async function until<T>(read: () => Promise<T>, good: (v: T) => boolean, label: string, ms = 15_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await read();
    if (good(v)) return v;
    if (Date.now() - t0 > ms) return fail(`${label} — ${ms / 1000}초가 지나도 안 된다 (${JSON.stringify(v)})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * 수비군 둘(3v3 · 5v5)을 세운다 — 없으면 [출정하기]를 막는 것이 수비군이 돼 도적떼 막힘을 못 본다(2026-10-27).
 * 새 계정의 장수 다섯이 5v5에 다 들면 보초병으로 세울 장수가 없으므로(부대 장수는 보초병이 못 된다) **부대 밖에 둘**을 더한다.
 */
function withGarrisons(p: PlayerProfile): PlayerProfile {
  if (garrisonOf(p, '3v3') && garrisonOf(p, '5v5')) return p;
  const pieces: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'];
  const ids = (Object.keys(p.roster) as OfficerId[]).filter((id) => id !== 'heon-je').slice(0, 5);
  let next: PlayerProfile = p;
  for (const size of [3, 5]) {
    const picks = ids.slice(0, size).map((officer, i) => ({ piece: pieces[i]!, officer }));
    // 수비대 칸 — 수비대가 곧 수비군이다(2026-11-14 부대 개편)
    const mode = size === 3 ? '3v3' : '5v5';
    if (!squadAt(next, mode, 'defense')) next = addSquad(next, { mode, role: 'defense', picks }).profile;
  }
  const roster = { ...next.roster };
  for (const id of ['yu-bi', 'gwan-u'] as OfficerId[]) if (!roster[id]) roster[id] = newInstance(id);
  return { ...next, roster };
}

/** 서버 계정을 고쳐 심고 새로고침한다 — 새로고침의 `GET /profile`이 곧 출몰의 문이다 */
async function seed(patch: (p: PlayerProfile) => PlayerProfile): Promise<void> {
  const stored = await getProfile(uid);
  if (!stored) await fail('서버에 프로필이 없다');
  // 기본 튜토리얼은 끝낸 계정으로 둔다 — 안 그러면 [출정하기]를 막는 것이 도적떼인지 튜토리얼인지 갈리지 않는다(G3)
  await saveProfileTrusted(uid, { ...withGarrisons(patch(stored!)), tutorial: { done: [...SORTIE_TUTORIALS] } });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main', { timeout: 20_000 });
}

const alertKind = () => page.evaluate(() =>
  (document.querySelector('[data-modal="raidAlert"]') as HTMLElement | null)?.dataset['kind'] ?? null);

try {
  // ── 로그인 → 새 도시 ────────────────────────────────────────
  step('간판에서 로그인 → 새 도시');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-action="loginOpen"]');
  await page.waitForSelector('[data-modal="login"]', { timeout: 10_000 });
  await page.fill('[data-field="email"]', email);
  await page.fill('[data-field="password"]', password);
  await page.click('[data-action="enter"]');
  await page.waitForSelector('.scr-new, .scr-main', { timeout: 20_000 });
  if (await page.$('.scr-new')) {
    const nameInput = await page.$('.scr-new .newgame-form input');
    if (nameInput) await nameInput.fill(`농지실험-${randomUUID().slice(0, 4)}`);
    await page.click('.scr-new .newgame-form .btn.primary');
    // 가입 오프닝(대사 · 장수 W 대형, 약 14초)을 지나야 메인이다 — 끝의 [성 안으로 들어가기]
    await page.click('[data-action="openingEnter"]', { timeout: 40_000 });
    await page.waitForSelector('#frame:not([data-arrive]) .scr-main', { timeout: 10_000 }); // 메인이 자리 잡는 1초 연출이 끝난 뒤
    await page.waitForSelector('.scr-main', { timeout: 20_000 });
  }
  ok('도시가 섰다');
  if (await alertKind()) await fail('농지가 없는데 도적떼 알림이 떴다');
  ok('농지가 없으면 도적떼도 없다');

  // ── 농지 Lv2를 심는다 → 새로고침이 출몰시킨다 ──────────────────
  step('서버에 농지 Lv2 · 군량 40을 심고 새로고침 (그 GET이 출몰의 문이다)');
  await seed((p) => ({ ...p, cityLevel: 2, grain: 40, buildings: { ...p.buildings, barracks: 2, farm: 2 } }));
  const spawned = await until(row, (p) => p.raid?.status === 'pending', '서버에 도적떼가 출몰');
  if (spawned.raid!.bandits !== 2) await fail(`도적 수가 농지 레벨이 아니다 — ${spawned.raid!.bandits}`);
  if (spawned.raid!.day !== raidDay(Date.now())) await fail(`출몰 날짜가 오늘(KST)이 아니다 — ${spawned.raid!.day}`);
  ok(`서버 — 도적 ${spawned.raid!.bandits}명, 기준 군량 ${spawned.raid!.grainAtSpawn}`);

  await page.waitForSelector('[data-modal="raidAlert"][data-kind="first"]', { timeout: 5_000 })
    .catch(() => fail('메인에 들어왔는데 첫 알림이 안 떴다'));
  const guardsShown = await page.getAttribute('[data-modal="raidAlert"] [data-field="guards"]', 'data-guards');
  if (guardsShown !== '0') await fail(`파수꾼 수 표시가 이상하다 — ${guardsShown}`);
  // 파수꾼이 없으면 [지금 전투]가 빛나며 농지로 이끈다 (2026-11-20 — 옛 [전투 준비]는 [닫기]가 됐다)
  if (!(await page.$('[data-action="raidFightNow"][data-lead="1"]'))) await fail('파수꾼이 없는데 [지금 전투]가 농지로 이끌지 않는다');
  if (!(await page.$('[data-modal="raidAlert"] [data-field="bandits"] .raid-vs-stand'))) await fail('대치 판에 도적 꼬마가 없다');
  if (!(await page.$('[data-action="raidClose"]'))) await fail('[닫기]가 없다');
  await shot('raid-01-alert-first');
  ok('첫 알림 — 파수꾼이 없어 [지금 전투]가 농지로 보낸다');

  // ── 농지 — 파수꾼 둘 ─────────────────────────────────────────
  step('[지금 전투](파수꾼 없음) → 농지의 보초병 배치 판에서 King · Rock을 세운다');
  await page.click('[data-action="raidFightNow"]');
  await page.waitForSelector('.scr-building-farm [data-field="raid"] dd[data-tone="alert"]', { timeout: 10_000 })
    .catch(() => fail('농지 현황판에 「출현」(붉음)이 없다'));
  if (!(await page.$('.scr-building-farm .frm-cmd [data-action="raidFight"]'))) await fail('도적떼가 와 있는데 [도적단 퇴치] 판이 없다');
  // 보초병 배치 판은 들어오자마자 보이고 여기서 다 한다 — 자리는 늘 다섯, 농지 Lv2라 셋은 잠김 (2026-11-16)
  const farm = await page.$eval('.scr-building-farm', (root) => {
    const el = root.querySelector('[data-field="guardList"]');
    const cmd = root.querySelector('.frm-cmd')!.getBoundingClientRect();
    return {
      list: !!el,
      rows: el?.querySelectorAll('.frm-grow:not(.frm-thead)').length ?? 0,
      locked: [...(el?.querySelectorAll('.frm-grow[data-locked="1"]') ?? [])].map((r) => r.textContent?.trim() ?? ''),
      pieces: [...(el?.querySelectorAll('.frm-grow[data-row]') ?? [])].map((r) => (r as HTMLElement).dataset['piece']).join(),
      raidLine: root.querySelector('[data-field="raid"] dt')?.textContent ?? '',
      sizeLine: !!root.querySelector('[data-field="raidSize"]'),
      cmdActs: [...root.querySelectorAll('.frm-cmd [data-action]')].map((b) => (b as HTMLElement).dataset['action']).join(),
      cmdInView: cmd.bottom <= window.innerHeight + 1,
    };
  });
  if (!farm.list) await fail('농지에 들어오자마자 보초병 배치 판이 안 보인다');
  if (farm.rows !== 5) await fail(`보초병 배치 판이 다섯 줄이 아니다 — ${farm.rows}`);
  if (farm.pieces !== 'King,Rock,Bishop,Knight,Pawn') await fail(`기물 차례가 다르다 — [${farm.pieces}]`);
  if (farm.locked.length !== 3 || !/3/.test(farm.locked[0]!)) await fail(`잠긴 자리가 이상하다 — ${JSON.stringify(farm.locked)}`);
  if (!/2/.test(farm.raidLine) || farm.sizeLine) await fail(`「도적단 출현 (2 명)」 한 줄이 아니다 — 「${farm.raidLine}」 · 규모 줄 ${farm.sizeLine}`);
  // 바닥 판 — 도적떼가 와 있으면 [도적단 퇴치]가 [마을로 가기] 위에 선다 (2026-11-20 기획자)
  if (farm.cmdActs !== 'raidFight,toTown') await fail(`바닥 판이 [도적단 퇴치] · [마을로 가기]가 아니다 — [${farm.cmdActs}]`);
  if (!farm.cmdInView) await fail('바닥 판이 화면 밖으로 밀렸다');
  await shot('raid-02a-farm-home');
  const empties = await page.$$eval('.frm-grow[data-empty="1"]', (els) => els.map((e) => (e as HTMLElement).dataset['piece']));
  if (empties.join() !== 'King,Rock') await fail(`빈 줄이 농지 Lv2의 두 자리가 아니다 — [${empties.join()}]`);
  if (await page.$('.frm-grow [data-action="releaseGuard"]')) await fail('줄에 [해제]가 남아 있다 — 장수 카드로 옮겼다');
  /** 빈 자리 「대원 지정 가능」 → 장수 일람 팝업에서 고를 수 있는 장수 줄 → 카드의 [선택하기] */
  const pickFor = async (piece: string, nth = 0): Promise<void> => {
    await page.click(`.frm-grow[data-piece="${piece}"] [data-action="pickGuard"]`);
    await page.waitForSelector('[data-modal="officerPick"]');
    if (await page.$('[data-modal="officerPick"] [data-action="equipPick"]')) await fail('보초병 고르기에 체크 칸이 남아 있다');
    await page.click(`[data-modal="officerPick"] .ofc-row[data-officer]:not([data-blocked]) >> nth=${nth}`);
    await page.click('.ofcard [data-action="cardSelect"]');
    await page.waitForSelector('[data-modal="officerPick"]', { state: 'detached' });
  };
  // King보다 먼저 Rock을 세우면 규칙이 거부하고 이유가 줄 밑에 뜬다
  await pickFor('Rock');
  // 농부가 말한다(2026-11-19) — 상태가 바뀐 다음 렌더에 들어오므로 기다린다
  if (!(await page.waitForSelector('.stw[data-say="error"] [data-field="guideText"]', { timeout: 3_000 }).catch(() => null))) await fail('King 없이 Rock을 세웠는데 이유가 안 뜬다');
  await pickFor('King');
  // 첫 장수는 이미 King이다 — 그를 Rock으로 옮기면 King이 비어 규칙이 거부한다. 다른 장수를 세운다
  await pickFor('Rock', 1);
  const rows = await page.$$eval('.frm-grow[data-officer]', (els) => els.map((e) => (e as HTMLElement).dataset['piece']));
  if (rows.join() !== 'King,Rock') await fail(`보초병 줄이 이상하다 — [${rows.join()}]`);
  // 찬 줄에는 단추가 없다(기물 바꾸기 밖) — [해제하기]는 줄을 눌러 뜬 장수 카드에 있다
  if (await page.$('.frm-grow[data-officer] button:not([data-action="swapPiece"])')) await fail('찬 줄에 단추가 남아 있다');
  // 기물 바꾸기 — Rock 줄을 Queen으로(남는 기물), 저장된 보초병의 기물이 따라 바뀐다. 그리고 되돌린다
  if (await page.$('.frm-grow[data-piece="King"] [data-action="swapPiece"]')) await fail('King 줄의 기물을 바꿀 수 있다');
  await page.click('.frm-grow[data-piece="Rock"] [data-action="swapPiece"]');
  await page.click('[data-modal="swapPiece"] [data-piece="Queen"]');
  await until(row, (p) => (p.farmGuards ?? []).some((g) => g.piece === 'Queen'), '기물 바꾸기(Rock → Queen)가 서버에 저장');
  await page.click('.frm-grow[data-piece="Queen"] [data-action="swapPiece"]');
  await page.click('[data-modal="swapPiece"] [data-piece="Rock"]');
  await until(row, (p) => (p.farmGuards ?? []).some((g) => g.piece === 'Rock'), '기물 되돌리기(Queen → Rock)가 서버에 저장');
  // King은 다른 보초병이 있으면 못 뺀다
  await page.click('.frm-grow[data-piece="King"][data-officer]');
  await page.waitForSelector('.ofcard [data-action="cardRelease"]');
  const kingLocked = await page.$eval('.ofcard [data-action="cardRelease"]', (b) => (b as HTMLButtonElement).disabled);
  if (!kingLocked) await fail('다른 보초병이 있는데 King을 뺄 수 있다');
  await shot('raid-02b-guard-card');
  await page.click('.ofcard [data-action="cardBack"]');
  await page.waitForSelector('.ofcard', { state: 'detached' });
  // Rock은 카드의 [해제하기]로 바로 뺀다 — 그리고 다시 세운다
  await page.click('.frm-grow[data-piece="Rock"][data-officer]');
  await page.click('.ofcard [data-action="cardRelease"]:not([disabled])');
  await page.waitForSelector('.frm-grow[data-piece="Rock"][data-empty="1"]', { timeout: 5_000 }).catch(() => fail('[해제하기] 뒤 Rock 자리가 비지 않았다'));
  await until(row, (p) => (p.farmGuards ?? []).length === 1, '[해제하기]가 서버에 저장');
  await pickFor('Rock', 1);
  await shot('raid-02-farm-guards');
  await until(row, (p) => (p.farmGuards ?? []).length === 2, '보초병 둘이 서버에 저장');
  ok('보초병 King · Rock — 한 화면에서 세우고 · 기물을 바꾸고 · 해제했다, King은 혼자일 때만 뺀다');

  // ── 출정이 막힌다 ────────────────────────────────────────────
  step('병영 [출정하기]가 막혀 있다');
  const guardCount = await page.getAttribute('.scr-building-farm [data-field="guards"]', 'data-count');
  if (guardCount !== '2') await fail(`현황판의 파수꾼 수가 이상하다 — ${guardCount}`);
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main');
  // 산 너머에서 돌아왔다 — 성 안으로 들어간다
  if (!(await page.$('[data-place="barracks"]'))) await page.click('.city-gate rect');
  await page.click('[data-place="barracks"]');
  await page.waitForSelector('[data-action="sortie"]');
  const sortieDisabled = await page.$eval('[data-action="sortie"]', (b) => (b as HTMLButtonElement).disabled);
  if (!sortieDisabled) await fail('도적떼가 살아 있는데 [출정하기]가 눌린다');
  // 막은 쪽이 **도적떼**여야 한다 — 기본 튜토리얼도 같은 단추를 잠그므로 「잠겼다」만 보면 도적떼 없이도 통과한다
  if (!(await page.$('.stw[data-say="sortieBlocked"][data-say-code="raid.blocksSortie"]'))) await fail('막힌 이유(도적떼)가 제 단추 밑에 없다');
  await shot('raid-03-sortie-blocked');
  ok('출정이 막혔고 이유가 적혀 있다');

  // ── 메인의 [전투하기] → 방어전 ──────────────────────────────
  step('메인의 [전투하기] → 25×15 방어전');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main [data-action="raidFight"]', { timeout: 10_000 })
    .catch(() => fail('메인의 도시 이름 옆에 [전투하기]가 없다'));
  await shot('raid-04-main-fight');
  await page.click('.scr-main [data-action="raidFight"]');
  // AI와 싸우는 판은 배치 30초를 건너뛰고 정찰부터 연다 (2026-11-27 기획자)
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'scouting', undefined, { timeout: 20_000 })
    .catch(() => fail('[전투하기]를 눌렀는데 정찰 단계가 안 온다 — 배치를 건너뛰지 않았다'));
  {
    const seen = await page.evaluate(() => {
      const pb = (window as any).__battle.scene.debugPlayback;
      return { sawDeploy: pb.state.log.some((e: any) => e.e === 'phaseChanged' && e.phase === 'deploy'), remain: pb.remainingSec, ready: pb.state.ready };
    });
    if (!seen.ready.P1 || !seen.ready.P2) await fail(`정찰인데 양쪽이 준비를 안 마쳤다 — ${JSON.stringify(seen.ready)}`);
    if (!seen.remain || seen.remain > 31) await fail(`정찰 마감이 이상하다 — ${seen.remain}초`);
    ok(`배치 없이 정찰부터 — 남은 ${seen.remain}초`);
  }
  const board = await page.evaluate(() => {
    const s = (window as any).__battle.scene.debugPlayback.state;
    const units = Object.values(s.units as Record<string, any>);
    return {
      size: s.boardSize, scenario: s.scenario, terrain: s.terrain.length,
      king: units.find((u: any) => u.id === 'P1-King')?.pos,
      bandits: units.filter((u: any) => u.side === 'P2').map((u: any) => u.piece),
    };
  });
  if (board.scenario !== 'raid' || board.size.x !== 25 || board.size.y !== 15) await fail(`판이 도적떼 판이 아니다 — ${JSON.stringify(board)}`);
  if (board.terrain !== 9) await fail(`성채가 3×3이 아니다 — 지형 ${board.terrain}칸`);
  if (board.king?.x !== 12 || board.king?.y !== 12) await fail(`파수꾼 King이 성채 한가운데가 아니다 — ${JSON.stringify(board.king)}`);
  if (board.bandits.join() !== 'King,Queen') await fail(`도적이 이상하다 — ${board.bandits.join()}`);
  const fightingRow = await until(row, (p) => p.raid?.status === 'fighting', '서버가 전투 시작을 굳혔다');
  ok(`판 25×15 · 성채 9칸 · King (12,12) · 도적 [${board.bandits.join()}] · 서버 시드 ${fightingRow.raid!.battle!.seed}`);
  await page.waitForTimeout(800);
  await shot('raid-05-scout');

  // ── [전투 시작] → 내 차례 → 항복 ─────────────────────────────
  step('[전투 시작] → 내 차례에 항복 (판 안의 항복은 패배다 — 살아 있는 도적 수만큼)');
  await page.click('#ctx-prep button.go');
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'awaitingInput', undefined, { timeout: 60_000 })
    .catch(() => fail('60초를 기다려도 내 차례가 오지 않는다'));
  await page.waitForTimeout(600);
  await shot('raid-06-battle');

  // ── 끊긴 판 되살리기 (2026-10-15) ─────────────────────────────
  step('한 수 두고 새로고침 → 메인 [전투 재개] → 끊긴 그 자리에서 이어진다');
  await page.evaluate(() => (window as any).__battle.scene.debugPlayback.submit({ t: 'endTurn' }));
  await page.waitForFunction(() => {
    const pb = (window as any).__battle?.scene?.debugPlayback;
    return pb?.phase === 'awaitingInput' && pb.state.log.some((e: any) => e.e === 'turnEnded');
  }, undefined, { timeout: 60_000 }).catch(() => fail('턴을 넘겼는데 다시 내 차례가 안 온다'));
  // 서버에 수가 쌓였다 — 준비 · 턴 종료 둘
  const savedRow = await until(row, (p) => (p.raid?.battle?.intents?.length ?? 0) >= 2, '서버에 둔 수가 덧붙었다');
  const snap = () => page.evaluate(() => {
    const s = (window as any).__battle.scene.debugPlayback.state;
    return JSON.stringify({
      time: s.time, rng: s.rngCursor, active: s.activeUnit, phase: s.phase,
      units: Object.values(s.units as Record<string, any>).map((u: any) => [u.id, u.pos, u.hp, u.alive]),
    });
  });
  const before = await snap();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main [data-action="raidResume"]', { timeout: 20_000 })
    .catch(() => fail('끊긴 판인데 메인에 [전투 재개]가 없다'));
  if (await page.$('.scr-main [data-action="raidSurrender"]')) await fail('옛 [항복] 단추가 남아 있다');
  const leftText = await page.textContent('.scr-main [data-action="raidResume"] [data-field="raidLeft"]');
  if (!/^(59|60):\d\d$/.test(leftText ?? '')) await fail(`[전투 재개]의 남은 시간이 60분 마감이 아니다 — ${leftText}`);
  await shot('raid-06b-resume');
  await page.click('.scr-main [data-action="raidResume"]');
  await page.waitForFunction(() => (window as any).__battle?.scene?.debugPlayback?.phase === 'awaitingInput', undefined, { timeout: 30_000 })
    .catch(() => fail('[전투 재개]를 눌렀는데 내 차례로 안 돌아온다'));
  const after = await snap();
  if (after !== before) await fail(`되살린 판이 끊기기 전과 다르다
  전 ${before}
  후 ${after}`);
  ok(`서버에 수 ${savedRow.raid!.battle!.intents!.length}개 · 새로고침 뒤 [전투 재개] → 같은 시각 · 같은 난수 자리 · 같은 배치 (남은 ${leftText})`);
  await page.waitForTimeout(600);
  await shot('raid-06c-resumed');
  // [항복]은 게임 정보(위 칸)에 있다 — 전투 UI 개편 3단계(2026-10-06)에 기록 안에서 나왔다
  await page.click('#gameinfo .gi-act[data-action="surrender"]:not([disabled])');
  // 되돌릴 수 없어 한 번 더 묻는다 — 판 위 목판 팝업(2026-10-10). 이 스모크가 그 팝업을 몰라 10-10부터 여기서 떨어지고 있었다(2026-10-12)
  await page.click('[data-modal="surrender"] button[data-action="surrender"]', { timeout: 5_000 })
    .catch(() => fail('[항복] 물음 팝업이 안 뜬다'));
  await page.waitForSelector('[data-screen="raidResult"]', { timeout: 30_000 })
    .catch(() => fail('항복했는데 결과 화면이 안 뜬다'));
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const scr = document.querySelector('[data-screen="raidResult"]') as HTMLElement;
    return {
      raid: scr.dataset['raid'],
      loot: Number(scr.dataset['loot'] ?? -1),
      error: document.querySelector('.stw[data-say="error"] [data-field="guideText"]')?.textContent ?? null,
    };
  });
  if (result.error) await fail(`결과가 서버에 안 남았다 — ${result.error}`);
  if (result.raid !== 'lost') await fail(`판 안의 항복이 패배로 정산되지 않았다 — ${result.raid}`);
  const lostRow = await until(row, (p) => p.raid?.status === 'lost', '서버 정산');
  // 약탈 식을 여기 다시 적지 않는다 — 서버가 정산하는 그 함수다(30% × 살아 있는 2명 / 출몰한 수, 2026-10-15)
  const wantLoot = raidLoot(fightingRow, fightingRow.raid!, Number.MAX_SAFE_INTEGER, 2);
  if (lostRow.raid!.loot !== wantLoot || result.loot !== wantLoot) {
    await fail(`약탈량이 이상하다 — 화면 ${result.loot} · 서버 ${lostRow.raid!.loot} · 기대 ${wantLoot}`);
  }
  await shot('raid-07-result');
  ok(`패배 — 살아 있는 도적 2명 몫 = 군량 ${wantLoot} 약탈 (재생 검증을 지나 서버가 정산)`);

  step('끝나면 출정이 다시 열린다');
  // 나가는 길은 마지막 장의 [농지로] 하나다(2026-10-13). 약탈당한 판은 한 장뿐이다(2026-11-26 — 약탈 줄이 결말 장에 함께 튀어나온다).
  // 줄이 다 서야 단추가 선다 — 누르면 남은 줄이 한꺼번에 선다
  await page.click('[data-screen="raidResult"] [data-action="next"]');
  await page.waitForSelector('[data-screen="raidResult"][data-last="1"] .brs-acts', { timeout: 8_000 })
    .catch(() => fail('결말 장의 줄이 다 서도 [농지로]가 안 선다'));
  if (!(await page.$('[data-screen="raidResult"] .brs-beat:not([data-wait]) [data-field="lootPage"]'))) await fail('결말 장에 약탈 줄이 없다');
  await page.waitForTimeout(900);
  await shot('raid-07b-loot');
  await page.click('[data-screen="raidResult"][data-last="1"] [data-action="farm"]', { timeout: 5_000 })
    .catch(() => fail('결과 마지막 장에 [농지로]가 안 선다'));
  await page.waitForSelector('.scr-building-farm');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main');
  if (await page.$('.scr-main [data-action="raidFight"]')) await fail('끝났는데 [전투하기]가 남아 있다');
  if (!(await page.$('[data-place="barracks"]'))) await page.click('.city-gate rect');
  await page.click('[data-place="barracks"]');
  await page.waitForSelector('[data-action="sortie"]');
  if (await page.$eval('[data-action="sortie"]', (b) => (b as HTMLButtonElement).disabled)) await fail('끝났는데 [출정하기]가 막혀 있다');
  ok('출정이 열렸다 · 메인의 [전투하기]가 사라졌다');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.scr-main');

  // ── 마지막 알림 (남은 1분) ────────────────────────────────────
  step('남은 1분 — 마지막 알림이 [지금 전투]/[항복]을 묻는다 (출몰 시각을 9분 30초 전으로 심는다)');
  const today = raidDay(Date.now());
  await seed((p) => ({
    ...p, grain: 40,
    raid: { day: today, bandits: 2, spawnedAt: Date.now() - 9.5 * MIN, grainAtSpawn: 40, status: 'pending' },
  }));
  await page.waitForSelector('[data-modal="raidAlert"][data-kind="lastCall"]', { timeout: 5_000 })
    .catch(async () => fail(`마지막 알림이 안 떴다 (떠 있는 것: ${await alertKind()})`));
  await shot('raid-08-last-call');
  await page.click('[data-action="raidSurrender"]');
  await page.waitForSelector('[data-modal="raidAlert"][data-kind="settled"]', { timeout: 10_000 })
    .catch(() => fail('[항복]을 눌렀는데 약탈 알림이 안 뜬다'));
  const surrendered = await until(row, (p) => p.raid?.status === 'surrendered', '서버 항복 정산');
  if (surrendered.raid!.loot !== 12) await fail(`항복 약탈이 이상하다 — ${surrendered.raid!.loot} (40 × 30% = 12)`);
  await page.click('[data-action="raidOk"]');
  ok('마지막 알림 → [항복] → 40 × 30% = 12 약탈 (도적 수와 무관)');

  // ── 자동 항복 (10분이 지났다) ─────────────────────────────────
  step('10분이 지났다 — 들어오면 서버가 이미 항복으로 정산해 두었고 화면은 알리기만 한다');
  await seed((p) => ({
    ...p, grain: 40,
    raid: { day: today, bandits: 2, spawnedAt: Date.now() - 11 * MIN, grainAtSpawn: 40, status: 'pending' },
  }));
  await page.waitForSelector('[data-modal="raidAlert"][data-kind="settled"]', { timeout: 5_000 })
    .catch(async () => fail(`자동 항복 알림이 안 떴다 (떠 있는 것: ${await alertKind()})`));
  const auto = await row();
  if (auto.raid?.status !== 'surrendered' || auto.raid.loot !== 12) await fail(`서버 자동 항복이 이상하다 — ${JSON.stringify(auto.raid)}`);
  await shot('raid-09-auto-surrender');
  await page.click('[data-action="raidOk"]');
  // 같은 사건의 알림은 새로고침해도 다시 안 뜬다(브라우저 편의)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scr-main');
  await page.waitForTimeout(1500);
  if (await alertKind()) await fail(`이미 본 자동 항복 알림이 새로고침에 다시 떴다 (${await alertKind()})`);
  ok('자동 항복 — 서버가 정산하고 화면은 한 번만 알린다');

  // ── 끊긴 채 60분 (2026-10-15) — 전에는 아무 알림 없이 지나갔다 ─────────
  step('끊긴 판이 60분을 넘겼다 — 서버가 항복으로 정산하고 화면은 「끊긴 채 끝났다」를 알린다');
  await seed((p) => ({
    ...p, grain: 40,
    raid: {
      day: today, bandits: 2, spawnedAt: Date.now() - 62 * MIN, grainAtSpawn: 40, status: 'fighting',
      battle: { seed: 9, startedAt: Date.now() - 61 * MIN, guards: fightingRow.raid!.battle!.guards, intents: [{ t: 'ready' }] },
    },
  }));
  await page.waitForSelector('[data-modal="raidAlert"][data-kind="settled"] [data-abandoned="1"]', { timeout: 5_000 })
    .catch(async () => fail(`끊긴 판의 자동 항복 알림이 안 떴다 (떠 있는 것: ${await alertKind()})`));
  const abandoned = await row();
  if (abandoned.raid?.status !== 'surrendered' || abandoned.raid.loot !== 12) await fail(`서버 정산이 이상하다 — ${JSON.stringify(abandoned.raid)}`);
  if (await page.$('.scr-main [data-action="raidResume"]')) await fail('정산된 판인데 [전투 재개]가 남아 있다');
  await shot('raid-10-abandoned');
  await page.click('[data-action="raidOk"]');
  ok('끊긴 채 60분 — 항복으로 정산 · 「끊긴 채 끝났다」 알림 · [전투 재개] 없음');

  /*
   * 알고 있는 둘은 빼고 본다 — **도적떼와 무관하고 이 검사로 고칠 것도 아니다.**
   * · 새 계정의 첫 `GET /profile` 404 — 도시를 만들기 전에는 서버에 행이 없다(정상 경로)
   * · `vfx:cast-*` — 시전 링은 `npm run vfx`가 `assets/`에서 굽는다. **파일이 정말 없을 때만** 뺀다
   *   (`smoke_meta`와 같은 규약 — 그림은 2026-10-08에 왔다. 있는 그림이 깨지면 잡혀야 한다)
   */
  const missingVfx = (e: string): boolean => {
    const m = /image vfx:([\w-]+)$/.exec(e);
    return m !== null && !existsSync(`packages/client/public/vfx/${m[1]}.png`);
  };
  const real = errors.filter((e) => !/^404 .*\/profile$/.test(e) && !missingVfx(e));
  if (real.length) await fail(`콘솔 오류 ${real.length}건:\n    ${real.join('\n    ')}`);
  ok(`콘솔 오류 없음 (알려진 것 ${errors.length - real.length}건 제외)`);
  console.log('\n★ 도적떼 확인 완주');
} catch (e) {
  await fail(`예외 — ${e instanceof Error ? e.stack : String(e)}`);
}
await cleanup();
