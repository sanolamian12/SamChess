/**
 * 전투 아이템 — 사기 · 보관함 · 지급 (2026-09-24, pptx 82~85쪽).
 *
 * ```
 * 구매 가능한 아이템  (4개씩 쪽)       이름 · 타입 · 재고 · 보유   [체크]
 *   → [결제하기] (하나라도 체크했을 때)  → 주문 확인(2단 × 8줄 고정, 이름만)  → 구매 완료(그림 격자)
 * 보관함               (6줄씩 쪽)       한 개에 한 줄: 이름 · 타입 · 구매일 · 지급 · 명령
 *   → [장수 선택] → 장수 고르기(대장간 지급과 같은 팝업) → (이미 들고 있으면) 되묻기
 *   → [아이템 회수] → 확인 → 보관함으로
 * ```
 *
 * **장바구니는 쪽을 넘겨도 남는다** — 이 화면의 상태라 쪽 번호와 따로 산다(82쪽 주석).
 * **체크 하나 = 한 개**다(2026-09-24 기획자 지정 — [−] n [+]가 예쁘지 않아 대장간 지급처럼
 * 체크로 바꿨다). 오늘 매물이 없는 품목은 체크가 잠긴다. 금화·보유 총량처럼 여러 품목에 걸친
 * 한도는 규칙(`canBuyMarketBasket`)이 합쳐서 보고, 주문 확인 판이 그 말을 그대로 띄운다.
 *
 * **사는 것은 한 요청이다**(`POST /market/items`) — 한 개짜리를 여러 번 부르면 가운데서
 * 막혔을 때 반만 산 채로 남아 주문서와 결과가 갈린다.
 *
 * ────────────────────────────────────────────────────────────────
 * 지급은 「병기 또는 아이템 하나」다 — 되묻는 이유
 * ────────────────────────────────────────────────────────────────
 *
 * 장수 한 명은 하나만 든다(GDD §6.5). 이미 병기를 받았거나 다른 아이템을 든 장수에게
 * 주면 **병기는 대장간으로, 아이템은 보관함으로** 돌아간다(85쪽 — 기획자 지정). 조용히
 * 벗기면 「병기가 어디 갔지」가 남으므로 한 번 묻는다(대장간의 교체 확인과 같은 결).
 * `marketCarry`·`forgeOwned`의 지급 칸은 클라이언트 소유라 로컬로 바꾸고 `PUT`으로 올린다
 * (대장간 지급과 같은 길).
 */

import { useState } from 'react';
import { marketItemById } from '@samchess/data';
import type { MarketItemData } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  canBuyMarketBasket, canCarryItem, carryItem, equippedBy, equippedKey,
  marketBasketGold, marketHeldCount, marketItemsOf, marketStockLeft, marketUnits, uncarryItem, unequipOfficer,
} from '@samchess/meta';
import type { MarketBasket, PlayerProfile } from '@samchess/meta';
import { buyMarketItemsOnServer } from '../../meta/city.ts';
import { t } from '../../i18n/index.ts';
import { reasonText } from '../../i18n/reason.ts';
import { pickEquipName, pickMarketItemName, pickMarketItemText, pickOfficerNameById } from '../../i18n/story.ts';
import { formatMade } from '../ForgeScreen.tsx';
import { OfficerPickModal } from '../OfficerListScreen.tsx';
import { Pager } from '../PagerButton.tsx';
import { ConfirmModal, DoneModal, GoldCost, Layer } from './parts.tsx';
import type { ServerCall } from './parts.tsx';

/** 한 쪽에 네 품목 (기획자 지정 2026-09-24) */
const PAGE = 4;

/**
 * 구매 완료 격자의 열 수 — **종류 수**로 정한다 (기획자 지정 2026-09-24).
 *
 * | 종류 | 1 | 2 | 3 | 4 | 5·6 | 7~9 | 10~12 | 13+ |
 * |---|---|---|---|---|---|---|---|---|
 * | 배열 | 1×1 | 2×1 | 3×1 | 2×2 | 3×2 | 3×3 | 4×3 | 4×4 |
 *
 * 판의 크기는 **4×4일 때**로 늘 같다 — 칸 크기는 판 폭 ÷ 열 수라 적을수록 크게 뜬다.
 */
export function doneGridCols(kinds: number): number {
  if (kinds <= 3) return Math.max(1, kinds);
  if (kinds === 4) return 2;
  if (kinds <= 9) return 3;
  return 4;
}

const itemsOf = (basket: MarketBasket): [MarketItemData, number][] =>
  Object.entries(basket)
    .map(([id, n]) => [marketItemById.get(id), n ?? 0] as const)
    .filter((e): e is [MarketItemData, number] => !!e[0] && e[1] > 0)
    .map(([item, n]) => [item, n]);

/** 아이템 그림 — 검정 바탕 위에 원래 크기 그대로, 금빛 밧줄 액자(`ui/frame-gold-2.png`)를 씌운다 */
function ItemArt({ item }: { item: MarketItemData }): React.JSX.Element {
  return (
    <span className="c-art">
      <img src={`market-items/${item.id}.png`} alt="" />
    </span>
  );
}

/**
 * [구매] 단추의 글자 — 「구매 (🪙 × 4)」 (2026-09-24 지정). 괄호·어순은 언어마다 문구 표가
 * 정하고(`market.order.buyFor`의 `{cost}`), 그 자리에 금화 닢 그림을 끼운다
 */
function BuyLabel({ gold }: { gold: number }): React.JSX.Element {
  const [before, after = ''] = t('market.order.buyFor', { cost: '\u0000' }).split('\u0000');
  return <span className="mkt-buy-lbl">{before}<GoldCost gold={gold} times />{after}</span>;
}

/** 타입 칩 — 사용(액티브) / 지속(패시브). 금빛 두루마리 판 위에 글자색으로 가른다 */
function KindChip({ item }: { item: MarketItemData }): React.JSX.Element {
  return (
    <span className="mkt-item-kind" data-kind={item.kind}>
      {t(item.kind === 'active' ? 'market.items.active' : 'market.items.passive')}
    </span>
  );
}

export function ItemShop({ profile, busy, run, onStorage, onBack }: {
  profile: PlayerProfile;
  busy: boolean;
  run: ServerCall;
  onStorage: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const [basket, setBasket] = useState<MarketBasket>({});
  const [ordering, setOrdering] = useState(false);
  const [bought, setBought] = useState<MarketBasket | null>(null);
  const now = Date.now();
  const items = marketItemsOf(profile);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE));
  const cur = Math.min(page, pageCount - 1);
  const rows = items.slice(cur * PAGE, cur * PAGE + PAGE);
  const picked = itemsOf(basket);

  /** 체크 = 한 개 (기획자 지정 2026-09-24 — 수량 조절은 없다. 더 사려면 다시 산다) */
  const toggle = (item: string): void => {
    setBasket((b) => {
      const next = { ...b };
      if (next[item]) delete next[item];
      else if (marketStockLeft(profile, item, now) > 0) next[item] = 1;
      return next;
    });
  };

  const can = canBuyMarketBasket(profile, basket, now);
  const pay = (): void => {
    const order = basket;
    run(() => buyMarketItemsOnServer(order), () => {
      setOrdering(false);
      setBasket({});
      setBought(order);
    });
  };

  return (
    <>
      <section className="place-panel mkt-list" data-field="itemShop">
        <h2 className="cap">{t('market.items.buyable')}</h2>
        {items.length === 0 ? (
          <p className="hint" data-field="itemsLocked">{t('market.items.locked')}</p>
        ) : (
          <>
            <div className="mkt-irow mkt-ihead pick">
              <span className="c-nm">{t('market.col.name')}</span>
              <span className="c-kd">{t('market.col.kind')}</span>
              <span className="c-n c-n1">{t('market.col.stock')}</span>
              <span className="c-n c-n2">{t('market.col.held')}</span>
              <span className="c-q">{t('squad.pick')}</span>
            </div>
            <div className="mkt-irows">
              {rows.map((item) => {
                const stock = marketStockLeft(profile, item.id, now);
                const on = !!basket[item.id];
                const soldOut = stock <= 0 && !on;
                return (
                  <div
                    className="mkt-irow pick"
                    key={item.id}
                    data-item={item.id}
                    data-kind={item.kind}
                    data-picked={on ? '1' : '0'}
                    data-soldout={soldOut ? '1' : '0'}
                    onClick={() => { if (!soldOut) toggle(item.id); }}
                  >
                    <ItemArt item={item} />
                    <span className="c-nm">{pickMarketItemName(item)}</span>
                    <span className="c-kd"><KindChip item={item} /></span>
                    <span className="c-n c-n1" data-field="stock">{stock}</span>
                    <span className="c-n c-n2" data-field="held">{marketHeldCount(profile, item.id)}</span>
                    {/* 이름 · 값 · 효과 세 줄 (2026-09-24 지정 — 도시 물자 줄과 같은 꼴) */}
                    <span className="c-price" data-field="price"><GoldCost gold={item.gold} /></span>
                    <span className="c-q">
                      <button
                        className="lv-check mkt-check"
                        data-action="pickItem"
                        aria-pressed={on}
                        disabled={soldOut}
                        onClick={(e) => { e.stopPropagation(); toggle(item.id); }}
                      >
                        <img className="lv-check-icon" src="icons/confirm.png" alt="" />
                      </button>
                    </span>
                    <span className="c-fx">{pickMarketItemText(item)}</span>
                  </div>
                );
              })}
            </div>
            <Pager page={cur} pageCount={pageCount} onPage={setPage} field="itemPager" />
            <button
              className="btn primary wide"
              data-action="checkout"
              disabled={picked.length === 0}
              onClick={() => setOrdering(true)}
            >
              {t('market.items.checkout')}
            </button>
          </>
        )}
      </section>

      <section className="place-panel mkt-cmds">
        <div className="frg-buttons">
          <button className="btn wide" data-action="openStorage" onClick={onStorage}>
            <span className="lbl">{t('market.items.storage')}</span>
            <span className="sub">{t('market.items.storage.sub')}</span>
          </button>
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {/* 주문 확인 (83쪽 가운데) — 품목이 열여섯이라 **두 단 × 여덟 줄을 미리 잡아 둔다**(판이
          주문마다 들쭉날쭉하지 않게). 한 품목에 하나씩이라 이름만 적는다 — 값은 [구매] 단추에.
          규칙이 막으면 그 말을 판 안에 적고 [구매]를 잠근다 */}
      {ordering && (
        <ConfirmModal
          title={t('market.order.title')}
          field="order"
          className="mkt-order"
          okLabel={<BuyLabel gold={marketBasketGold(basket)} />}
          disabled={busy || !can.ok}
          onConfirm={pay}
          onClose={() => setOrdering(false)}
        >
          <ul className="mkt-order-lines" data-count={picked.length}>
            {picked.map(([item]) => (
              <li key={item.id} data-item={item.id}>{pickMarketItemName(item)}</li>
            ))}
          </ul>
          {!can.ok && <p className="note" data-field="orderWhy">{reasonText(can)}</p>}
        </ConfirmModal>
      )}

      {bought && (
        <DoneModal
          title={t('market.bought.title')}
          field="bought"
          onClose={() => setBought(null)}
          actions={(
            <>
              <button className="btn wide" data-action="boughtStorage" onClick={() => { setBought(null); onStorage(); }}>
                {t('market.items.storage')}
              </button>
              <button className="btn wide" data-action="boughtClose" onClick={() => setBought(null)}>{t('market.close')}</button>
            </>
          )}
        >
          <BoughtGrid basket={bought} />
        </DoneModal>
      )}
    </>
  );
}

/** 구매 완료 격자 — 그림 오른쪽 아래에 ×n. 판은 4×4 크기로 고정, 열 수는 `doneGridCols` */
function BoughtGrid({ basket }: { basket: MarketBasket }): React.JSX.Element {
  const list = itemsOf(basket);
  const cols = doneGridCols(list.length);
  return (
    <div className="mkt-bought" data-count={list.length} data-cols={cols} style={{ '--cols': cols } as React.CSSProperties}>
      {list.map(([item, n]) => (
        <span className="mkt-bought-cell" key={item.id} data-item={item.id} title={pickMarketItemName(item)}>
          <img src={`market-items/${item.id}.png`} alt={pickMarketItemName(item)} />
          <b className="mkt-bought-n">×{n}</b>
        </span>
      ))}
    </div>
  );
}

/** 보관함 한 쪽의 줄 수 — 여섯 (2026-09-24 지정, 스크롤 없이 든다) */
const STORAGE_PAGE = 6;

/**
 * 보관함 (84쪽) — **한 개에 한 줄**이다 (2026-09-24 기획자 지정, 대장간 지급 관리와 같은 꼴).
 *
 * 예전엔 품목마다 한 줄에 「보유 · 지급」 수를 적고 체크한 뒤 아래 [아이템 지급]을 눌렀는데,
 * 그 틀에서는 **한 번 준 것을 되돌릴 길이 없었다** — 줄이 「품목」이라 「누구에게 간 그
 * 하나」를 가리킬 수 없어서다. 이제 줄이 낱개라 줄마다 구매일과 지급(장수 이름 또는
 * 「미지급」)이 있고, 명령 칸이 **[장수 선택]**(미지급) · **[아이템 회수]**(지급)로 갈린다.
 * 다른 장수에게 옮기려면 회수한 뒤 다시 준다 — 대장간과 같은 두 걸음이다.
 *
 * 줄을 펴는 것은 규칙(`marketUnits()`)이다 — 같은 품목의 낱개는 서로 구별되지 않아
 * 「어느 줄이 지급된 것인가」를 화면이 지으면 소모될 때 빠지는 구매일과 어긋난다.
 */
export function ItemStorage({ profile, onChange, onBack }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  /** 지금 장수를 고르는 중인 품목 — [장수 선택]을 누른 줄의 것 */
  const [picked, setPicked] = useState<string | null>(null);
  const [swap, setSwap] = useState<OfficerId | null>(null);
  /** [아이템 회수] 확인 중인 장수 */
  const [revoking, setRevoking] = useState<OfficerId | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const units = marketUnits(profile);
  const pageCount = Math.max(1, Math.ceil(units.length / STORAGE_PAGE));
  const cur = Math.min(page, pageCount - 1);
  const rows = units.slice(cur * STORAGE_PAGE, cur * STORAGE_PAGE + STORAGE_PAGE);
  const pickedItem = picked ? marketItemById.get(picked) : undefined;

  /** 실제로 준다 — 들고 있던 병기는 대장간으로(지급 해제), 아이템은 갈아 끼우면 저절로 보관함으로 */
  const give = (officer: OfficerId): void => {
    if (!picked) return;
    const can = canCarryItem(profile, officer, picked);
    if (!can.ok) { setNote(reasonText(can)); setPicked(null); setSwap(null); return; }
    const key = equippedKey(profile, officer);
    const next = carryItem(key ? unequipOfficer(profile, key) : profile, officer, picked);
    onChange(next);
    setNote(t('market.storage.given', { officer: pickOfficerNameById(officer, officer), item: pickMarketItemName(pickedItem!) }));
    setSwap(null);
    setPicked(null);
  };

  const pickOfficer = (officer: OfficerId): void => {
    const hasWeapon = !!equippedBy(profile, officer);
    const carrying = profile.marketCarry?.[officer];
    // 들고 있는 것이 없거나 **바로 그 아이템**이면 안 묻는다 — 잃는 것이 없다
    if (!hasWeapon && (!carrying || carrying === picked)) { give(officer); return; }
    setSwap(officer);
  };

  const swapWhat = swap ? (() => {
    const weapon = equippedBy(profile, swap);
    const item = profile.marketCarry?.[swap];
    const itemData = item ? marketItemById.get(item) : undefined;
    return weapon ? pickEquipName(weapon) : itemData ? pickMarketItemName(itemData) : '';
  })() : '';

  const revokingItem = revoking ? marketItemById.get(profile.marketCarry?.[revoking] ?? '') : undefined;

  return (
    <>
      <section className="place-panel mkt-list" data-field="storage">
        <h2 className="cap">{t('market.items.storage')}</h2>
        {units.length === 0 ? (
          <p className="hint" data-field="storageEmpty">{t('market.storage.empty')}</p>
        ) : (
          <>
            <div className="mkt-irow mkt-ihead mkt-srow">
              <span className="c-nm">{t('market.col.name')}</span>
              <span className="c-kd">{t('market.col.kind')}</span>
              <span className="c-made">{t('market.storage.col.bought')}</span>
              <span className="c-hold">{t('forge.assign.col.holder')}</span>
              <span className="c-q">{t('forge.assign.col.cmd')}</span>
            </div>
            <div className="mkt-irows">
              {rows.map((u, i) => {
                const item = marketItemById.get(u.item)!;
                return (
                  <div
                    className="mkt-irow mkt-srow"
                    key={`${u.item}#${cur * STORAGE_PAGE + i}`}
                    data-item={u.item}
                    data-assigned={u.holder ? '1' : '0'}
                    data-holder={u.holder ?? undefined}
                  >
                    <ItemArt item={item} />
                    <span className="c-nm">{pickMarketItemName(item)}</span>
                    <span className="c-kd"><KindChip item={item} /></span>
                    <span className="c-made" data-field="bought">{formatMade(u.boughtAt)}</span>
                    <span className="c-hold" data-field="holder" data-state={u.holder ? 'assigned' : 'idle'}>
                      {u.holder ? pickOfficerNameById(u.holder, u.holder) : t('forge.assign.unassigned')}
                    </span>
                    <span className="c-q">
                      {u.holder ? (
                        <button className="btn ghost sm mkt-revoke" data-action="revokeItem" onClick={() => { setNote(null); setRevoking(u.holder); }}>
                          {t('market.storage.revoke')}
                        </button>
                      ) : (
                        <button className="btn primary sm" data-action="giveItem" onClick={() => { setNote(null); setPicked(u.item); }}>
                          {t('market.storage.giveBtn')}
                        </button>
                      )}
                    </span>
                    <span className="c-fx">{pickMarketItemText(item)}</span>
                  </div>
                );
              })}
            </div>
            <Pager page={cur} pageCount={pageCount} onPage={setPage} field="storagePager" />
          </>
        )}
        {note && <p className="note" data-field="storageNote">{note}</p>}
      </section>

      <section className="place-panel mkt-cmds">
        <div className="frg-buttons">
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {pickedItem && !swap && (
        <Layer>
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('market.storage.pickTitle', { item: pickMarketItemName(pickedItem) })}
          onPick={pickOfficer}
          onClose={() => setPicked(null)}
          pageSize={6}
          health
          className="mkt-pick-back"
        />
        </Layer>
      )}

      {swap && (
        <ConfirmModal
          title={t('market.storage.swapTitle')}
          field="giveSwap"
          onConfirm={() => give(swap)}
          onClose={() => { setSwap(null); setPicked(null); }}
        >
          <p className="mkt-confirm-lead">{t('market.storage.swapHas', { officer: pickOfficerNameById(swap, swap), what: swapWhat })}</p>
          <p>{t('market.storage.swapWhere')}</p>
          <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
        </ConfirmModal>
      )}

      {/* [아이템 회수] — 대장간의 [장비 회수]처럼 한 번 묻는다 */}
      {revoking && (
        <ConfirmModal
          title={t('market.storage.revokeTitle')}
          field="revokeItem"
          onConfirm={() => { onChange(uncarryItem(profile, revoking)); setRevoking(null); }}
          onClose={() => setRevoking(null)}
        >
          <p className="mkt-confirm-lead">
            {t('market.storage.revokeAsk', {
              officer: pickOfficerNameById(revoking, revoking),
              item: revokingItem ? pickMarketItemName(revokingItem) : '',
            })}
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
