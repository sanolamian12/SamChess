/**
 * **변화 장부 · 이상 징후의 판정** (2026-11-12, 설계 `history/2026-11-12_이상징후_설계.md`).
 *
 * 계정을 쓰는 길은 전부 서버의 `transact()` 하나를 지난다. 거기서 쓰기 전 · 후의 계정을 이 파일에 넘기면
 *  · `ledgerValues()` — 감시하는 값만 뽑고
 *  · `ledgerDelta()` — 바뀐 만큼을 평평한 표(`{'gold': +300, 'cards.jo-un': +2}`)로 내고
 *  · `unexpectedIncreases()` — 그 길로는 늘 수 없는 값이 늘었는지 본다(① 출처 없는 변화).
 * `profileInvariants()`(② 불변식)과 `creationViolations()`(새 계정이 시작 꾸러미와 다른가)도 여기다.
 *
 * meta에 둔 까닭은 다른 규칙과 같다 — 시계 · DB 없이 `npm test`가 판정을 고정한다. 장부를 적고 점검을 돌리는 것은 서버다.
 */
import { GROWTH, OFFICERS, buildingById, equipmentById, marketItemById, officerById } from '@samchess/data';
import type { BuildingId } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { BUILD_CITY_LEVEL, MAX_CITY_LEVEL, initialBuildings } from './city.ts';
import { gachaDeckBase } from './gacha.ts';
import { createProfile, officerLevelCap } from './profile.ts';
import type { PlayerProfile } from './types.ts';

// ═══════════════════════════════════════════════════════════════
// 1. 감시하는 값
// ═══════════════════════════════════════════════════════════════

/**
 * 감시하는 값의 **묶음** — 「늘릴 수 있는 길」 표가 이 단위로 적힌다.
 *
 * | 묶음 | 칸 |
 * |---|---|
 * | `gold` · `grain` · `materials` · `buildCredits` · `cityLevel` | 같은 이름의 숫자 |
 * | `cards` | `cards.{장수}` — 여분 카드 |
 * | `pool` | `pool.{장수}` — 풀에 있으면 1 |
 * | `level` | `level.{장수}` — 풀에 있는 장수가 **Lv1 위로 올린 수**(새로 든 Lv1 장수는 0 — 풀에 드는 것과 레벨이 오르는 것을 가른다) |
 * | `buildings` | `buildings.{건물}` — 레벨 |
 * | `market` | `market.{아이템}` — 가진 것 + 들고 나간 것(들고 나가는 것은 옮김이라 합으로 본다) |
 * | `forge` | `forge.{병기 키}` — 있으면 1 |
 * | `collection` | `collection.{컬렉션}` — 채운 칸 수 |
 */
export type LedgerGroup =
  | 'gold' | 'grain' | 'materials' | 'buildCredits' | 'cityLevel'
  | 'cards' | 'pool' | 'level' | 'buildings' | 'market' | 'forge' | 'collection';

export const LEDGER_GROUPS: readonly LedgerGroup[] = [
  'gold', 'grain', 'materials', 'buildCredits', 'cityLevel',
  'cards', 'pool', 'level', 'buildings', 'market', 'forge', 'collection',
];

/** 감시하는 값 — 평평한 표. 0인 칸은 없다(없는 것과 0을 같게 본다) */
export type LedgerValues = Readonly<Record<string, number>>;

/** 칸 이름의 묶음 — `cards.jo-un` → `cards` */
export const groupOf = (key: string): LedgerGroup => {
  const dot = key.indexOf('.');
  return (dot < 0 ? key : key.slice(0, dot)) as LedgerGroup;
};

/** 계정에서 감시하는 값만 뽑는다 */
export function ledgerValues(p: PlayerProfile): LedgerValues {
  const out: Record<string, number> = {};
  const put = (key: string, n: number | undefined): void => {
    if (typeof n === 'number' && n !== 0) out[key] = (out[key] ?? 0) + n;
  };
  put('gold', p.gold);
  put('grain', p.grain);
  put('materials', p.materials);
  put('buildCredits', p.buildCredits);
  put('cityLevel', p.cityLevel);
  for (const [id, n] of Object.entries(p.cards ?? {})) put(`cards.${id}`, n);
  for (const [id, inst] of Object.entries(p.roster ?? {})) {
    put(`pool.${id}`, 1);
    put(`level.${id}`, inst.level - 1);
  }
  for (const [id, lv] of Object.entries(p.buildings ?? {})) put(`buildings.${id}`, lv);
  for (const [id, n] of Object.entries(p.marketOwned ?? {})) put(`market.${id}`, n);
  for (const c of p.marketInPlay ?? []) put(`market.${c.item}`, 1);
  for (const key of Object.keys(p.forgeOwned ?? {})) put(`forge.${key}`, 1);
  for (const [id, slots] of Object.entries(p.collection?.slots ?? {})) put(`collection.${id}`, slots.length);
  return out;
}

/** 바뀐 만큼 — `after − before`, 0인 칸은 뺀다. 바뀐 것이 없으면 `null`. `before`가 `null`이면 새 계정이다 */
export function ledgerDelta(before: LedgerValues | null, after: LedgerValues): Record<string, number> | null {
  const out: Record<string, number> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const k of keys) {
    const d = (after[k] ?? 0) - (before?.[k] ?? 0);
    if (d !== 0) out[k] = d;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * **장부 밖에서 바뀐 만큼** — 그 계정 장부의 마지막 `after`와 지금 값의 차이(①-b). 군량은 뺀다 — 군량 충전만의 정산은 장부에 안 적어
 * 마지막 `after`와 늘 어긋난다. 같으면 `null`.
 */
export function outsideDelta(last: LedgerValues, now: LedgerValues): Record<string, number> | null {
  const d = ledgerDelta(last, now);
  if (!d) return null;
  const out = Object.fromEntries(Object.entries(d).filter(([k]) => groupOf(k) !== 'grain'));
  return Object.keys(out).length ? out : null;
}

/** 늘어난 묶음 */
export const increasedGroups = (delta: Readonly<Record<string, number>>): Set<LedgerGroup> =>
  new Set(Object.entries(delta).filter(([, d]) => d > 0).map(([k]) => groupOf(k)));

// ═══════════════════════════════════════════════════════════════
// 2. 늘릴 수 있는 길 — ① 출처 없는 변화
// ═══════════════════════════════════════════════════════════════

/** 전투가 주는 것 — 군량 · 재료 · 카드(처음 받은 장수는 풀에 든다). **금화는 없다** */
const BATTLE: readonly LedgerGroup[] = ['grain', 'materials', 'cards', 'pool'];
/** 아무것이나 — 관리자 지급 · 개발용 지급 · 우편 보상 */
const ANY: readonly LedgerGroup[] = LEDGER_GROUPS;

/**
 * **요청이 한 일(`action`)로 늘 수 있는 묶음** — 열쇠는 라우트(`{메서드} {경로}`, Fastify의 경로 그대로).
 *
 * 여기 없는 라우트로 감시하는 값이 늘면 징후다(GET도 — 읽기는 「요청이 한 일」이 없다. 읽는 순간의 정산은 `sync`다).
 * **모든 쓰기 라우트가 표에 있어야 한다** — 게임 API · 관리자 API의 쓰기 라우트를 훑는 회귀가 지킨다
 * (`server-api/test/ledgerSources.test.ts`). 줄이는 쪽은 안 본다 — 쓰는 길이 많고 해가 없다.
 * 값은 각 라우트가 부르는 meta 함수가 실제로 늘리는 것이고, 대표 함수는 `meta/test/ledger.test.ts`가 대조한다.
 */
export const ACTION_SOURCES: Readonly<Record<string, readonly LedgerGroup[]>> = {
  // 계정 — 저장은 서버 소유 칸을 버린다(`guardServerOwned`). 새 계정은 따로 본다(`creationViolations`)
  'PUT /profile': [],
  'DELETE /profile': [],
  'POST /presence': [],
  // 대전 — 상대 찾기 · 시작은 군량을 낸다, 정산이 보상을 준다
  'POST /battle/ai-match': [],
  'POST /battle/ai-start': [],
  'POST /battle/ai-intents': [],
  'POST /battle/duel-reveal': [],
  'POST /battle/ai-result': BATTLE,
  'POST /siege/match': [],
  'POST /defense/seen': [],
  'POST /war/declare': [],
  'POST /war/:id/reply': [],
  'POST /war/:id/accept': [],
  // 도적떼 — 이기면 보상, 지면 약탈(줄어듦)
  'POST /raid/start': [],
  'POST /raid/surrender': BATTLE,
  'POST /raid/intents': [],
  'POST /raid/result': BATTLE,
  // 우편 — 보상은 관리자가 적은 것이다(`MailReward` = 지급의 종류)
  'POST /mail/:id/read': [],
  'POST /mail/:id/claim': ANY,
  // 도시
  'POST /city/upgrade': ['cityLevel', 'buildCredits'],
  'POST /city/build': ['buildings', 'pool'],
  'POST /city/heal': [],
  'POST /city/rename': [],
  'POST /forge/order': [],
  'POST /collection/register': ['collection'],
  'POST /academy/research': [],
  'POST /academy/cancel': [],
  'POST /academy/ack': [],
  'POST /academy/reset': [],
  'POST /tutorial/complete': BATTLE,
  // 장터 — 금화를 내고 산다
  'POST /market/materials': ['materials'],
  'POST /market/grain': ['grain'],
  'POST /market/item': ['market'],
  'POST /market/items': ['market'],
  'POST /market/gacha': ['cards', 'pool'],
  'POST /market/recycle': ['cards', 'pool'],
  // 장수 — 레벨업은 카드를 쓰고, 재설계는 쓴 카드를 돌려준다
  'POST /officer/levelup': ['level'],
  'POST /officer/respec': ['cards'],
  // 개발용 — 운영에서 이 길로 바뀌면 언제나 징후다(`DEV_SOURCES`)
  'POST /dev/grant': ANY,
  // 서버 사이 — 대전 서버(Colyseus)가 부른다. 환불은 군량 · 들고 나간 아이템을 돌려준다
  'POST /internal/grain': ['grain', 'market'],
  'POST /internal/battle-result': BATTLE,
  'POST /internal/war/:id/open': [],
  // 관리자 — 지급은 무엇이든(감사 로그가 남는다), 정리는 환불 · 방치 패배의 보상
  'POST /admin/users/:uid/adjust': ANY,
  'POST /admin/users/:uid/resolve': [...BATTLE, 'market'],
  'POST /admin/users/:uid/ban': [],
  'POST /admin/users/:uid/unban': [],
  'POST /admin/users/:uid/rename': [],
  'POST /admin/mail': [],
  'POST /admin/mail/:id/revoke': [],
  // 징후를 닫을 뿐 계정을 안 고친다
  'POST /admin/anomalies/:id/resolve': [],
};

/** 운영에서는 쓰이면 안 되는 길 */
export const DEV_SOURCES: readonly string[] = ['POST /dev/grant'];

/**
 * **읽는 순간의 정산(`sync`)으로 늘 수 있는 묶음** — 길이 아니라 **무엇이 정산됐나**로 본다(`syncAtServer`).
 *  · 군량은 시간으로 늘 찬다
 *  · 병기는 제조가 끝나면 들어온다(제조 주문이 있었어야 한다)
 *  · 전투 보상은 AI 대전 · 도적떼가 그 순간 정산됐을 때만(60분 방치 패배 · 도적떼 자동 항복)
 */
export function syncAllowed(before: PlayerProfile, after: PlayerProfile): Set<LedgerGroup> {
  const ok = new Set<LedgerGroup>(['grain']);
  if (before.forgeOrder && !after.forgeOrder) ok.add('forge');
  const aiSettled = before.aiBattle?.status === 'fighting' && after.aiBattle?.status !== 'fighting';
  const raidSettled = JSON.stringify(before.raid ?? null) !== JSON.stringify(after.raid ?? null);
  if (aiSettled || raidSettled) for (const g of [...BATTLE, 'market'] as LedgerGroup[]) ok.add(g);
  return ok;
}

/**
 * **그 길로는 늘 수 없는 묶음** — 비었으면 정상. `action`은 라우트로(`ACTION_SOURCES` — 표에 없는 라우트는 아무것도 못 늘린다),
 * `sync`는 정산된 것으로(`syncAllowed`) 본다.
 */
export function unexpectedIncreases(
  delta: Readonly<Record<string, number>>,
  allowed: ReadonlySet<LedgerGroup> | readonly LedgerGroup[],
): LedgerGroup[] {
  const ok = new Set(allowed);
  return [...increasedGroups(delta)].filter((g) => !ok.has(g));
}

// ═══════════════════════════════════════════════════════════════
// 3. 새 계정 — 시작 꾸러미와 같은가
// ═══════════════════════════════════════════════════════════════

/**
 * **새 계정이 시작 꾸러미 밖의 것을 들고 왔나** — 첫 `PUT /profile`은 클라이언트가 만든 계정을 그대로 받는다(2026-11-12 기준).
 * `createProfile()`이 내는 것과 견주어 다른 칸을 돌려준다(비었으면 정상). 장수는 「등급마다 한 명 · Lv1 · 카드 없음」이면
 * 누구든 된다 — 시드는 클라이언트가 골라서 같은 사람을 다시 만들 수 없다.
 */
export function creationViolations(p: PlayerProfile): string[] {
  const start = ledgerValues(createProfile(p.cityName ?? '', 1));
  const got = ledgerValues(p);
  const bad: string[] = [];
  for (const k of new Set([...Object.keys(start), ...Object.keys(got)])) {
    const g = groupOf(k);
    if (g === 'pool' || g === 'level') continue;
    // 군량은 시작 값 이하면 된다(첫 저장 전에 판을 열어 참가비를 냈을 수 있다)
    if (g === 'grain' ? (got[k] ?? 0) > (start[k] ?? 0) : (got[k] ?? 0) !== (start[k] ?? 0)) bad.push(k);
  }
  const roster = Object.values(p.roster ?? {});
  const grades = roster.map((i) => officerById.get(i.officer)?.grade).sort().join('');
  if (roster.length !== 5 || grades !== 'ABCDS' || roster.some((i) => i.level !== 1)) bad.push('pool');
  return bad;
}

// ═══════════════════════════════════════════════════════════════
// 4. 불변식 — ② 있을 수 없는 상태
// ═══════════════════════════════════════════════════════════════

/** 불변식 위반 한 줄 — `code`가 종류, `key`가 어느 칸 */
/**
 * 불변식의 종류 — 관리자 화면이 이름을 붙인다(`Record<InvariantCode, …>` — 늘면 그 화면의 typecheck가 깨진다).
 * `shape`는 판정 자체가 던진 것(저장된 값이 모양부터 어긋났다 — 서버의 점검이 낸다)
 */
export type InvariantCode =
  | 'negative' | 'cityLevel' | 'unknownId' | 'buildingLevel' | 'rosterSize' | 'level' | 'growth' | 'levelCap' | 'gacha' | 'shape';

export interface InvariantBreak { code: InvariantCode; key: string; detail?: string }

const isCount = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const isAmount = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * **있을 수 없는 상태** — 비었으면 정상. 상한은 숫자를 새로 적지 않고 데이터 · 기존 함수에서 낸다.
 * 군량의 상한은 안 본다 — 시장 구매 · 전투 보상 · 환불 · 지급이 상한을 넘겨 줄 수 있다.
 */
export function profileInvariants(p: PlayerProfile): InvariantBreak[] {
  const out: InvariantBreak[] = [];
  const add = (code: InvariantCode, key: string, detail?: string): void => {
    out.push(detail === undefined ? { code, key } : { code, key, detail });
  };
  // 잔액 — 군량은 시간 충전이 소수를 낼 수 있어(컬렉션 요율) 정수를 안 묻는다
  for (const k of ['gold', 'materials', 'buildCredits'] as const) if (!isCount(p[k])) add('negative', k, String(p[k]));
  if (!isAmount(p.grain)) add('negative', 'grain', String(p.grain));
  // 도시 레벨
  if (!Number.isInteger(p.cityLevel) || p.cityLevel < 1 || p.cityLevel > MAX_CITY_LEVEL) add('cityLevel', 'cityLevel', String(p.cityLevel));
  // 건물 — 최대 레벨, 그리고 도시가 짓는 레벨에 못 닿았으면 처음 그대로
  const initial = initialBuildings();
  for (const [id, lv] of Object.entries(p.buildings ?? {})) {
    const data = buildingById.get(id as BuildingId);
    if (!data) { add('unknownId', `buildings.${id}`); continue; }
    if (!isCount(lv) || lv > data.maxLevel) add('buildingLevel', `buildings.${id}`, `${lv} > ${data.maxLevel}`);
    else if (p.cityLevel < BUILD_CITY_LEVEL && lv !== initial[id as BuildingId]) add('buildingLevel', `buildings.${id}`, `도시 Lv${p.cityLevel}에서 ${lv}`);
  }
  // 장수 — 있는 장수 · 레벨 범위 · 성장 스택의 짝(CLAUDE.md 「`growth.length === level − 1`은 언제나 참」)
  const roster = Object.entries(p.roster ?? {});
  if (roster.length > OFFICERS.length) add('rosterSize', 'pool', `${roster.length} > ${OFFICERS.length}`);
  for (const [id, inst] of roster) {
    if (!officerById.has(id as OfficerId) || inst.officer !== id) { add('unknownId', `pool.${id}`); continue; }
    if (!Number.isInteger(inst.level) || inst.level < 1 || inst.level > GROWTH.maxLevel) add('level', `level.${id}`, String(inst.level));
    else if ((inst.growth?.length ?? 0) !== inst.level - 1) add('growth', `level.${id}`, `Lv${inst.level} · 성장 ${inst.growth?.length ?? 0}`);
    // 도시가 허락하는 레벨을 넘었다 — 레벨업만 레벨을 올리고, 레벨업은 이 상한을 먼저 본다(`canLevelUp`)
    if (Number.isInteger(inst.level) && inst.level > officerLevelCap(p)) add('levelCap', `level.${id}`, `Lv${inst.level} > 도시 Lv${p.cityLevel}의 상한 ${officerLevelCap(p)}`);
  }
  for (const [id, n] of Object.entries(p.cards ?? {})) {
    if (!officerById.has(id as OfficerId)) add('unknownId', `cards.${id}`);
    else if (!isCount(n)) add('negative', `cards.${id}`, String(n));
  }
  // 아이템 · 병기
  for (const [id, n] of Object.entries(p.marketOwned ?? {})) {
    if (!marketItemById.has(id)) add('unknownId', `market.${id}`);
    else if (!isCount(n)) add('negative', `market.${id}`, String(n));
  }
  for (const key of Object.keys(p.forgeOwned ?? {})) {
    if (!equipmentById.has(key.split('#')[0]!)) add('unknownId', `forge.${key}`);
  }
  // 가챠 — 뽑은 수가 덱보다 클 수 없다
  const drawn = p.gachaPool?.drawn ?? 0;
  if (!isCount(drawn) || drawn > gachaDeckBase().length) add('gacha', 'gachaPool', `${drawn} > ${gachaDeckBase().length}`);
  return out;
}


// ═══════════════════════════════════════════════════════════════
// 5. 거절 — ④ 수상한 시도
// ═══════════════════════════════════════════════════════════════

/**
 * **지켜보는 거절과 문턱** — 같은 계정에서 1시간 안에 이만큼 나면 징후다(기획자 확정 2026-11-12).
 * 정상 클라이언트로는 거의 안 나오는 것만 둔다 — 참가비 모자람 같은 평범한 거절은 안 센다.
 */
export const REJECT_WATCH: Readonly<Record<string, number>> = {
  // 대결의 공개를 사람이 적었다 — 정상 클라이언트는 절대 안 보낸다(GDD §3.11 R16)
  'ai.revealByServer': 1,
  // 재생이 결말과 안 맞는다 — 버전이 엇갈린 판 하나는 있을 수 있다
  'ai.replayFailed': 2,
  'raid.replayFailed': 2,
  // 수 덧붙이기 거절 — 네트워크 재전송으로 가끔 난다
  'ai.intentsRejected': 5,
  'ai.intentsGap': 5,
  'raid.intentsRejected': 5,
  'raid.intentsGap': 5,
};
