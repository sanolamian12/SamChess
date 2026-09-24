/**
 * 전투 아이템 — 사기 · 보관함 · 지급 (2026-09-24, pptx 82~85쪽).
 *
 * ```
 * 구매 가능한 아이템  (4개씩 쪽)       이름 · 타입 · 재고 · 보유   [−] n [+]
 *   → [결제하기] (하나라도 1 이상일 때)  → 주문 확인(16줄 고정)  → 구매 완료(그림 격자)
 * 보관함 보기          (4개씩 쪽)       이름 · 타입 · 보유 · 지급   [체크]
 *   → [아이템 지급] → 장수 고르기(대장간 지급과 같은 팝업) → (이미 들고 있으면) 되묻기
 * ```
 *
 * **장바구니는 쪽을 넘겨도 남는다** — 이 화면의 상태라 쪽 번호와 따로 산다(82쪽 주석).
 * [+]의 끝은 그 품목의 **오늘 남은 매물**이다. 금화·보유 총량처럼 여러 품목에 걸친
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
  canBuyMarketBasket, canCarryItem, carriedCount, carryItem, equippedBy, equippedKey,
  marketBasketGold, marketHeldCount, marketItemsOf, marketStockLeft, unequipOfficer,
} from '@samchess/meta';
import type { MarketBasket, PlayerProfile } from '@samchess/meta';
import { buyMarketItemsOnServer } from '../../meta/city.ts';
import { t } from '../../i18n/index.ts';
import { reasonText } from '../../i18n/reason.ts';
import { pickEquipName, pickMarketItemName, pickMarketItemText, pickOfficerNameById } from '../../i18n/story.ts';
import { OfficerPickModal } from '../OfficerListScreen.tsx';
import { Pager } from '../PagerButton.tsx';
import { ConfirmModal, DoneModal, Layer } from './parts.tsx';
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

/** 타입 칩 — 사용(액티브) / 지속(패시브) */
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

  const bump = (item: string, d: number): void => {
    const max = marketStockLeft(profile, item, now);
    setBasket((b) => {
      const n = Math.max(0, Math.min(max, (b[item] ?? 0) + d));
      const next = { ...b };
      if (n > 0) next[item] = n; else delete next[item];
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
            <div className="mkt-irow mkt-ihead">
              <span className="c-nm">{t('market.col.name')}</span>
              <span className="c-kd">{t('market.col.kind')}</span>
              <span className="c-n c-n1">{t('market.col.stock')}</span>
              <span className="c-n c-n2">{t('market.col.held')}</span>
              <span className="c-q" />
            </div>
            <div className="mkt-irows">
              {rows.map((item) => {
                const stock = marketStockLeft(profile, item.id, now);
                const n = basket[item.id] ?? 0;
                return (
                  <div className="mkt-irow" key={item.id} data-item={item.id} data-kind={item.kind} data-n={n}>
                    <img className="c-art" src={`market-items/${item.id}.png`} alt="" />
                    <span className="c-nm">{pickMarketItemName(item)}</span>
                    <span className="c-kd"><KindChip item={item} /></span>
                    <span className="c-n c-n1" data-field="stock">{stock}</span>
                    <span className="c-n c-n2" data-field="held">{marketHeldCount(profile, item.id)}</span>
                    <span className="c-q mkt-stepper">
                      <button className="btn ghost sm mkt-step" data-action="less" disabled={n <= 0} onClick={() => bump(item.id, -1)}>−</button>
                      <b className="mkt-step-n" data-field="qty">{n}</b>
                      <button className="btn ghost sm mkt-step" data-action="more" disabled={n >= stock} onClick={() => bump(item.id, 1)}>+</button>
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
          </button>
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {/* 주문 확인 (83쪽 가운데) — 품목이 열여섯이라 **열여섯 줄을 미리 잡아 둔다**(판이
          주문마다 들쭉날쭉하지 않게). 규칙이 막으면 그 말을 판 안에 적고 [구매]를 잠근다 */}
      {ordering && (
        <ConfirmModal
          title={t('market.order.title')}
          field="order"
          className="mkt-order"
          okLabel={t('market.order.buy', { gold: marketBasketGold(basket) })}
          disabled={busy || !can.ok}
          onConfirm={pay}
          onClose={() => setOrdering(false)}
        >
          <ul className="mkt-order-lines" data-count={picked.length}>
            {picked.map(([item, n]) => (
              <li key={item.id} data-item={item.id}>
                <span className="nm">{pickMarketItemName(item)}</span>
                <span className="x">×{n}</span>
                <span className="g">{t('market.pull.cost', { gold: item.gold * n })}</span>
              </li>
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

/**
 * 보관함 (84쪽) — 가진 아이템만, 넷씩. **보유 = 보관함 + 장수에게 준 것**, **지급 = 장수에게
 * 준 것**(84쪽 주석 — `marketHeldCount`·`carriedCount`). 오른쪽 나무판을 체크하면 아래
 * [아이템 지급]이 켜진다.
 */
export function ItemStorage({ profile, onChange, onBack }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [giving, setGiving] = useState(false);
  const [swap, setSwap] = useState<OfficerId | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const owned = [...marketItemById.values()].filter((it) => marketHeldCount(profile, it.id) > 0);
  const pageCount = Math.max(1, Math.ceil(owned.length / PAGE));
  const cur = Math.min(page, pageCount - 1);
  const rows = owned.slice(cur * PAGE, cur * PAGE + PAGE);
  const pickedItem = picked ? marketItemById.get(picked) : undefined;
  const spare = picked ? marketHeldCount(profile, picked) - carriedCount(profile, picked) : 0;

  /** 실제로 준다 — 들고 있던 병기는 대장간으로(지급 해제), 아이템은 갈아 끼우면 저절로 보관함으로 */
  const give = (officer: OfficerId): void => {
    if (!picked) return;
    const can = canCarryItem(profile, officer, picked);
    if (!can.ok) { setNote(reasonText(can)); setGiving(false); setSwap(null); return; }
    const key = equippedKey(profile, officer);
    const next = carryItem(key ? unequipOfficer(profile, key) : profile, officer, picked);
    onChange(next);
    setNote(t('market.storage.given', { officer: pickOfficerNameById(officer, officer), item: pickMarketItemName(pickedItem!) }));
    setGiving(false);
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

  return (
    <>
      <section className="place-panel mkt-list" data-field="storage">
        <h2 className="cap">{t('market.items.storage')}</h2>
        {owned.length === 0 ? (
          <p className="hint" data-field="storageEmpty">{t('market.storage.empty')}</p>
        ) : (
          <>
            <div className="mkt-irow mkt-ihead pick">
              <span className="c-nm">{t('market.col.name')}</span>
              <span className="c-kd">{t('market.col.kind')}</span>
              <span className="c-n c-n1">{t('market.col.held')}</span>
              <span className="c-n c-n2">{t('market.col.given')}</span>
              <span className="c-q">{t('squad.pick')}</span>
            </div>
            <div className="mkt-irows">
              {rows.map((item) => (
                <div
                  className="mkt-irow pick"
                  key={item.id}
                  data-item={item.id}
                  data-picked={picked === item.id ? '1' : '0'}
                  onClick={() => setPicked(item.id)}
                >
                  <img className="c-art" src={`market-items/${item.id}.png`} alt="" />
                  <span className="c-nm">{pickMarketItemName(item)}</span>
                  <span className="c-kd"><KindChip item={item} /></span>
                  <span className="c-n c-n1" data-field="held">{marketHeldCount(profile, item.id)}</span>
                  <span className="c-n c-n2" data-field="given">{carriedCount(profile, item.id)}</span>
                  <span className="c-q">
                    <button
                      className="lv-check mkt-check"
                      data-action="pickItem"
                      aria-pressed={picked === item.id}
                      onClick={(e) => { e.stopPropagation(); setPicked(item.id); setNote(null); }}
                    >
                      <img className="lv-check-icon" src="icons/confirm.png" alt="" />
                    </button>
                  </span>
                  <span className="c-fx">{pickMarketItemText(item)}</span>
                </div>
              ))}
            </div>
            <Pager page={cur} pageCount={pageCount} onPage={setPage} field="storagePager" />
          </>
        )}
        {note && <p className="note" data-field="storageNote">{note}</p>}
      </section>

      <section className="place-panel mkt-cmds">
        <div className="frg-buttons">
          <button
            className="btn primary wide"
            data-action="giveItem"
            disabled={!picked || spare <= 0}
            onClick={() => setGiving(true)}
          >
            <span className="lbl">{t('market.storage.give')}</span>
          </button>
          {/* 다 나눠 준 품목을 골랐으면 **왜 안 켜지는지** 적는다 */}
          {picked && spare <= 0 && <p className="hint" data-field="giveWhy">{t('market.storage.allGiven')}</p>}
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {giving && pickedItem && (
        <Layer>
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('market.storage.pickTitle', { item: pickMarketItemName(pickedItem) })}
          onPick={pickOfficer}
          onClose={() => setGiving(false)}
        />
        </Layer>
      )}

      {swap && (
        <ConfirmModal
          title={t('market.storage.swapTitle')}
          field="giveSwap"
          onConfirm={() => give(swap)}
          onClose={() => setSwap(null)}
        >
          <p className="mkt-confirm-lead">{t('market.storage.swapHas', { officer: pickOfficerNameById(swap, swap), what: swapWhat })}</p>
          <p>{t('market.storage.swapWhere')}</p>
          <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
        </ConfirmModal>
      )}
    </>
  );
}
