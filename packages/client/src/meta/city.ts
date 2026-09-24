/**
 * 도시 행위 — 증축 · 건설 · 치료를 **서버에 시킨다** (2026-09-04, GDD §5 · §10).
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 `PUT /profile`로는 안 되는가 ★
 * ────────────────────────────────────────────────────────────────
 *
 * `PUT`은 `materials` · `buildings` · `buildCredits` · `hospitalBusy` · 부상을
 * **통째로 버리고 서버 값으로 되쓴다**(H3d가 `grain`에 세운 그대로). 그래서 그 값을
 * 바꾸는 행위를 로컬에서 계산해 `PUT`으로 올리면 **아무 오류 없이 삼켜진다** —
 * 화면에는 「증축했는데 자재만 줄고 레벨은 그대로」로 보인다. 무승부의 군량 택1이
 * `/battle/draw-result`를 새로 만들어야 했던 것과 같은 자리다.
 *
 * 그래서 **보내는 것은 「무엇을」뿐**이고 판정·계산·시각은 전부 서버가 한다.
 * 돌아오는 것은 새 프로필 전체이므로, 화면은 자기가 계산한 값을 정본으로 삼지
 * 않고 **받은 것으로 갈아 끼운다.**
 *
 * ────────────────────────────────────────────────────────────────
 * 실패하면 로컬로 물러난다
 * ────────────────────────────────────────────────────────────────
 *
 * 「서버가 꺼져 있어도 게임은 돈다」(§5-61)가 여기도 선다 — 부르는 쪽이 `null`을
 * 받으면 `@samchess/meta`의 같은 순수 함수를 로컬로 적용하고 `PUT`으로 올린다.
 * **그 순간에만 치팅 표면이 예전 수준으로 돌아간다**(`PUT`이 되쓰므로 실제로는
 * 다음 왕복에서 정정되지만, 화면은 그때까지 자기 값을 보여 준다).
 *
 * **서버가 거부한 이유는 그대로 던진다** — 「왜 안 되는지도 규칙이 말한다」가
 * API를 건너서도 서야 하기 때문이다. 규칙이 거부한 것(400)과 서버에 못 닿은
 * 것(그 외)은 **다른 사건**이라, 앞쪽은 사람에게 보여 주고 뒤쪽만 물러난다.
 */

import { migrateProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { BuildingId } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { authedFetch } from './storage.ts';
import { t } from '../i18n/index.ts';

/** 규칙이 거부했다 — 사람에게 보여 줄 말이 들어 있다. 물러나면 안 되는 실패다 */
export class CityActionRejected extends Error {}

async function post(path: string, body: unknown): Promise<PlayerProfile | null> {
  const raw = await send(path, body);
  if (raw === null) return null;
  const profile = migrateProfile(raw);
  if (!profile) {
    console.warn(`[city] ${path} 가 잘못된 프로필을 줬다 — 로컬로 물러난다`);
    return null;
  }
  return profile;
}

/**
 * 보내고 **몸통 JSON을 그대로** 돌려준다 — 못 닿았으면 `null`, 규칙이 거부했거나 서버가
 * 이 길을 모르면 던진다. 프로필 말고 다른 것도 함께 오는 요청(가챠의 「뽑은 장수」)이
 * 생겨 `post()`에서 떼어 냈다(2026-09-14).
 */
async function send(path: string, body: unknown): Promise<unknown | null> {
  let res: Response;
  try {
    res = await authedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(`[city] ${path} 에 못 닿았다`, err);
    return null;
  }
  if (res.status === 409) {
    // 다른 계정이 이미 쓰는 도시 이름이다 (2026-09-19, `/city/rename`) — 서버의 오류 문자열
    // (`city_name_taken`)은 사람 말이 아니라서 화면 문구로 바꿔 알린다. 금화는 안 나갔다
    throw new CityActionRejected(t('city.nameTaken'));
  }
  if (res.status === 400) {
    // 규칙이 거부했다. 로컬로 물러나 봐야 같은 이유로 거부되므로 그대로 알린다
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new CityActionRejected(body.error ?? '할 수 없는 일이다');
  }
  /*
   * **404는 「못 닿음」이 아니다 ★** (2026-09-04). 서버는 살아 있는데 이 길을
   * 모른다는 뜻이라, 대개 **서버가 낡은 채로 떠 있다**(새 경로를 붙이고 다시 안
   * 띄웠다). 여기서 로컬로 물러나면 **화면에서만 성사되고 서버에는 안 남는다** —
   * 서버 소유 필드(`materials`·`buildings`)는 다음 `PUT`이 되쓰므로 조용히
   * 사라지고, 사람에게는 「자재가 늘었는데 증축이 거부된다」로만 보인다.
   * 그 유령을 만들지 않으려고 **말하고 멈춘다.**
   */
  if (res.status === 404) {
    throw new CityActionRejected(`서버가 이 요청(${path})을 모른다 — 대전·계정 서버를 다시 띄워야 한다`);
  }
  if (!res.ok) {
    console.warn(`[city] ${path} → ${res.status} — 로컬로 물러난다`);
    return null;
  }
  return (await res.json()) as unknown;
}

// ── 계정 거래 — 금화를 쓰거나 받는 수 (2026-09-14, A1) ───────────────────
//
// `gold`·`gachaPool`이 **서버 소유**가 되었다(`meta/authority.ts`). 넷 다 **못 닿으면
// 로컬로 물러나지 않는다** — 물러나 계산해 두면 다음 `PUT`이 금화를 서버 값으로 되써
// **화면에서만 성사된다**(뽑은 카드는 남고 금화는 그대로). 자재 구매와 같은 결이다.
// 부르는 화면은 `null`을 「아무것도 바뀌지 않았다」(`server.offline`)로 알린다.

export interface GachaPulled {
  profile: PlayerProfile;
  drawn: OfficerId[];
  exhausted: boolean;
}

/** 가챠 한 판 — 시드도 서버가 만든다. 뽑은 장수 목록이 프로필과 함께 온다 */
export async function pullGachaOnServer(kind: import('@samchess/meta').GachaPullKind): Promise<GachaPulled | null> {
  const raw = (await send('/market/gacha', { kind })) as { profile?: unknown; drawn?: unknown; exhausted?: unknown } | null;
  if (raw === null) return null;
  const profile = migrateProfile(raw.profile);
  if (!profile || !Array.isArray(raw.drawn)) {
    console.warn('[city] /market/gacha 가 잘못된 몸통을 줬다');
    return null;
  }
  return { profile, drawn: raw.drawn as OfficerId[], exhausted: raw.exhausted === true };
}

/** 도시 이름을 바꾼다 — 금화와 쿨다운 시각은 서버가 정한다 */
export const renameCityOnServer = (name: string): Promise<PlayerProfile | null> => post('/city/rename', { name });

/** 재설계(둔갑천서) — 금화를 내고 쓴 카드를 돌려받는다 */
export const respecOnServer = (officer: OfficerId): Promise<PlayerProfile | null> => post('/officer/respec', { officer });

/**
 * 레벨업 — 능력 하나 · 학파 하나 (2026-09-14, A2). `roster`·`cards`가 서버 소유라 로컬로
 * 올려 `PUT`하면 되돌아간다. 못 닿으면 물러나지 않는다(위 머리말과 같은 이유).
 */
export const levelUpOnServer = (
  officer: OfficerId, stat: import('@samchess/meta').StatPick, school: 'support' | 'illusion',
): Promise<PlayerProfile | null> => post('/officer/levelup', { officer, stat, school });

/** 카드 정리 — 받을 장수와 재료 수 (A2) */
export const recycleOnServer = (
  target: OfficerId, inputs: import('@samchess/meta').RecycleInputs,
): Promise<PlayerProfile | null> => post('/market/recycle', { target, inputs });

/**
 * **개발용 지급** — 서버가 `SAMCHESS_DEV_GRANTS=1`일 때만 받는다(아니면 규칙 거부처럼 이유가 온다).
 * 금화팩 결제가 붙기 전까지 장터의 개발용 단추가 부르는 길이다.
 */
export const devGrantOnServer = (grant: { gold?: number; officer?: OfficerId; cards?: number; injure?: OfficerId[] }): Promise<PlayerProfile | null> =>
  post('/dev/grant', grant);

/**
 * 서버가 개발용 지급을 받는가 — 개발용 단추를 **받을 때만** 그리려고 묻는다(2026-09-18).
 * 못 닿거나 서버가 이 길을 모르면(404, 낡은 서버) 「안 받는다」로 본다 — 단추가 숨을 뿐이다.
 */
export async function devGrantsEnabled(): Promise<boolean> {
  try {
    const res = await authedFetch('/dev/status');
    if (!res.ok) return false;
    return ((await res.json()) as { grants?: unknown }).grants === true;
  } catch {
    return false;
  }
}

/** 도시를 한 단계 올린다. `null`이면 서버에 못 닿았다는 뜻 */
export const upgradeCityOnServer = (): Promise<PlayerProfile | null> => post('/city/upgrade', {});

/** 건물을 짓거나 한 단계 올린다 */
export const buildOnServer = (building: BuildingId): Promise<PlayerProfile | null> =>
  post('/city/build', { building });

/** 부상 장수를 병원 room에 넣는다 */
export const healOnServer = (officer: OfficerId): Promise<PlayerProfile | null> =>
  post('/city/heal', { officer });

/**
 * 금화로 건축 자재 한 묶음을 산다 (장터 「거래」).
 *
 * 화면은 **얼마나 사는지도 안 보낸다** — 묶음 크기와 값은 규칙 상수다
 * (`MATERIAL_PACK` · `materialPackCost()`). 「보내는 것은 무엇을뿐」의 극단이다.
 */
export const buyMaterialsOnServer = (): Promise<PlayerProfile | null> =>
  post('/market/materials', {});

/**
 * 군량 한 묶음을 산다 (2026-09-23). **자재와 같은 결** — `gold`(클라이언트가 보던
 * 값)를 내고 `grain`(서버 소유)을 받는 거래라 **못 닿으면 물러나지 않는다.**
 */
export const buyGrainOnServer = (): Promise<PlayerProfile | null> =>
  post('/market/grain', {});

/**
 * 시장 아이템 한 개를 산다 (2026-09-23, GDD §6.5).
 *
 * `buyMaterials`와 같은 결이다 — **못 닿으면 로컬로 물러나지 않는다.**
 * `gold`도 `marketOwned`도 서버 소유라, 물러나면 화면에서만 사고 다음 `PUT`이
 * 되써 **금화만 사라진다.** 하루 매물도 서버 시계가 재는 값이라 로컬로는 아예
 * 계산할 수도 없다.
 */
export const buyMarketItemOnServer = (item: string): Promise<PlayerProfile | null> =>
  post('/market/item', { item });

/**
 * 시장 아이템 **장바구니** (2026-09-24, pptx 83쪽 [결제하기]) — 한 요청으로 전부 사거나
 * 아무것도 안 산다. 한 개짜리를 여러 번 부르면 가운데서 막혔을 때 반만 산 채로 남는다.
 */
export const buyMarketItemsOnServer = (basket: import('@samchess/meta').MarketBasket): Promise<PlayerProfile | null> =>
  post('/market/items', { basket });

/**
 * 대장간 제조를 시작한다 (2026-09-09). `buyMaterials`와 같은 결 —
 * `gold`(클라이언트 소유)를 내고 `forgeOrder`(서버 소유)를 받는 거래라
 * **못 닿으면 로컬로 물러나지 않는다**(부르는 화면이 `null`을 그렇게 다룬다).
 */
export const startForgeOrderOnServer = (equipmentId: string): Promise<PlayerProfile | null> =>
  post('/forge/order', { equipmentId });

/** 진행 중인 주문을 취소하고 전액 환불받는다 */
export const cancelForgeOrderOnServer = (): Promise<PlayerProfile | null> =>
  post('/forge/cancel', {});

// ── 태학 — 책략 개량 연구 (2026-09-22, GDD §5.12) ─────────────────────
//
// `academy`가 서버 소유라 넷 다 **못 닿으면 로컬로 물러나지 않는다** — 로컬로 연구를
// 시작해 두면 다음 `PUT`이 서버 값으로 되써 「연구 중이었는데 사라졌다」가 된다.
// 부르는 화면은 `null`을 「아무것도 바뀌지 않았다」(`server.offline`)로 알린다.

/** 연구를 시작한다 — 개량형 id 하나. 시각은 서버가 찍는다 */
export const startResearchOnServer = (tactic: string): Promise<PlayerProfile | null> =>
  post('/academy/research', { tactic });

/** 진행 중인 연구를 그만둔다 — 무료라 돌려받을 것이 없다 */
export const cancelResearchOnServer = (): Promise<PlayerProfile | null> => post('/academy/cancel', {});

/** 축하 팝업을 봤다 — 서버의 `notice`를 비운다 */
export const ackResearchOnServer = (): Promise<PlayerProfile | null> => post('/academy/ack', {});

/** 개발용 — 진행 중인 연구를 지금 끝낸다(`/dev/grant`의 `finishResearch`) */
/**
 * 태학 연구 되돌리기 — 금화 10냥 (2026-09-24부터 **장터 [도시 물자]에서 사고 바로 쓴다**, pptx 87쪽).
 * 금화가 서버 소유라 못 닿으면 물러나지 않는다.
 */
export const resetAcademyOnServer = (): Promise<PlayerProfile | null> => post('/academy/reset', {});

export const devFinishResearchOnServer = (): Promise<PlayerProfile | null> =>
  post('/dev/grant', { finishResearch: true });
