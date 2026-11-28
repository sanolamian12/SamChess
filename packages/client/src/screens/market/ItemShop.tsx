/**
 * 전투 아이템 — 사기 · 보관함 · 지급 (2026-09-24, pptx 82~85쪽 · 2026-11-27 용병 시장 꼴로 다시 짬).
 *
 * ```
 * 머리 판   [금화] n                 [보관함 n/최대]   ← `ItemsStatus` — 보관함 칸이 곧 단추(옛 바닥 [보관함])
 * 목록     종이 카드 다섯 장씩 쪽     그림 | 이름 · 타입 / 효과 | 가격 띠 · 재고 · 보유
 *   → 카드를 누르면 곧장 「구매할까요?」 [구매 (🪙 × n)] → 구매 완료(그림 격자)
 * 바닥     [뒤로 가기]
 * 보관함               (6줄씩 쪽)       한 개에 한 줄: 이름 · 타입 · 구매일 · 지급 · 명령
 *   → [장수 선택] → 장수 고르기(대장간 지급과 같은 팝업) → (이미 들고 있으면) 되묻기
 *   → [아이템 회수] → 확인 → 보관함으로
 * ```
 *
 * **체크 · 장바구니 · [결제하기]는 걷었다**(2026-11-27 기획자) — 한 번에 한 개를 산다. 못 사는 카드(매진 · 금화 ·
 * 보관함 가득)는 잿빛이고, 눌러도 판이 안 뜨고 내관이 까닭을 말한다(도시 물자와 같은 몸짓). 판정은 규칙(`canBuyMarketBasket`)이다.
 *
 * **사는 것은 한 요청이다**(`POST /market/items`) — 장바구니가 한 칸일 뿐 길은 같다.
 *
 * ────────────────────────────────────────────────────────────────
 * 진열대는 장터 품목 + 대장간이 연구한 병기다 — 되묻는 이유
 * ────────────────────────────────────────────────────────────────
 *
 * 진열대는 `shelfOf()`(장터 레벨이 여는 품목 + 연구하고 축하까지 본 병기, 2026-11-28). 사고 나면 둘 다 보관함의 1회용 낱개다.
 * 장수 한 명은 하나만 든다(GDD §6.5). 이미 다른 것을 든 장수에게 주면 든 것은 보관함으로 돌아간다 — 조용히
 * 바꾸면 「어디 갔지」가 남으므로 한 번 묻는다. `marketCarry`는 클라이언트 소유라 로컬로 바꾸고 `PUT`으로 올린다.
 */

import { useRef, useState } from 'react';
import { itemById } from '@samchess/data';
import type { ItemData } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  canBuyMarketBasket, canCarryItem, carryItem,
  marketCapacity, marketOwnedCount, marketUnits, shelfOf, uncarryItem,
} from '@samchess/meta';
import type { MarketBasket, PlayerProfile } from '@samchess/meta';
import { Say } from '../Steward.tsx';
import { buyMarketItemsOnServer } from '../../meta/city.ts';
import { t } from '../../i18n/index.ts';
import { reasonText } from '../../i18n/reason.ts';
import { pickOfficerNameById } from '../../i18n/story.ts';
import { formatMade, isForged, itemImage, itemName, itemText } from '../itemText.ts';
import { OfficerPickModal } from '../OfficerListScreen.tsx';
import { Pager } from '../PagerButton.tsx';
import { PageArrow } from '../PageArrow.tsx';
import { useSteadyPage } from '../useSteadyPage.ts';
import { useAllLangLayout } from '../useAllLangLayout.ts';
import { ConfirmModal, GoldCost, Layer } from './parts.tsx';
import { Celebrate } from '../Celebrate.tsx';
import { BlinkGlow, equipBlink, itemBlink } from '../BlinkGlow.tsx';
import type { ServerCall } from './parts.tsx';
import { GameIcon } from '../GameIcon.tsx';

/** 한 쪽에 세 품목 (2026-11-27 기획자 — 도시 물자의 긴 칸 꼴) */
const PAGE = 3;

/** 아이템 그림 — 검정 바탕 위에 원래 크기 그대로, 금빛 밧줄 액자(`ui/frame-gold-2.png`)를 씌운다 */
function ItemArt({ item }: { item: ItemData }): React.JSX.Element {
  return (
    <span className="c-art">
      {/* 섬광 — 최고 레벨 금 · 그 아래 자주 · 나머지 흰 별빛 (2026-10-23). 병기는 대장간의 섬광 */}
      <BlinkGlow tone={isForged(item) ? equipBlink(item.unlockLevel) : itemBlink(item.unlockLevel)} className="mkt-item-glow" />
      <img src={itemImage(item)} alt="" />
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
function KindChip({ item }: { item: ItemData }): React.JSX.Element {
  return (
    <span className="mkt-item-kind" data-kind={item.kind}>
      {/* 좁은 칩 — 아이콘이 글자를 대신한다(사용 = 폭약, 지속 = 부적. 이름은 올리면) */}
      <GameIcon name={item.kind === 'active' ? 'item-active' : 'item-passive'}
        label={t(item.kind === 'active' ? 'market.items.active' : 'market.items.passive')} />
    </span>
  );
}

/**
 * 머리 판 — 금화 · 보관함(보유/최대) (2026-11-27 기획자 — 용병 시장 · 도시 물자 머리 판과 같은 자리 · 같은 높이).
 * 보관함은 그림을 크게, 글자 없이 수만. **가득이면 붉은 글자**(`data-full`). 보관함으로 가는 단추는 목록 판 밑에 따로 있다.
 * `MarketScreen`이 `.place-body` 밖에 그린다
 */
export function ItemsStatus({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  const owned = marketOwnedCount(profile);
  const cap = marketCapacity(profile);
  return (
    <section className="place-panel mkt-status mkt-merc-status mkt-items-status" data-field="itemsStatus">
      <span className="mkt-cur" data-currency="gold" data-field="gold" data-gold={profile.gold}>
        <img src="market/gold.png" alt={t('market.gold')} title={t('market.gold')} data-tip={t('market.gold')} />
        <b className="v">{profile.gold.toLocaleString('en-US')}</b>
      </span>
      <span className="mkt-cur mkt-store-now" data-field="items" data-owned={owned} data-cap={cap} data-full={owned >= cap ? '1' : '0'}>
        <GameIcon name="mk-storage" label={t('market.items.storage')} />
        <b className="v">{owned}/{cap}</b>
      </span>
    </section>
  );
}

/**
 * 가격 띠의 붓 획 색 — 값의 층마다(2 · 4 · 8 · 16냥 → 옥색 · 쪽빛 · 짙은 자주 · 금). 타입(사용/지속)으로는 가르지 않는다
 * (2026-11-27 기획자 — 타입 구분을 걷었다). 용병 시장과 같은 그림(`.mkt-pack-price[data-stroke]`)
 */
const strokeOf = (gold: number): number => (gold >= 16 ? 8 : gold >= 8 ? 6 : gold >= 4 ? 7 : 5);

/**
 * 아이템 카드 한 장 — 도시 물자의 긴 칸(연구 초기화 · 초심의 서)과 같은 종이. 그림은 왼쪽 두 줄 높이, 첫 줄은 이름과 가격 띠가
 * 나란히, 그 밑 효과는 그림 오른쪽 종이 폭 전부를 쓴다 (2026-11-27 기획자 — 가격 띠가 오른쪽 칸을 따로 먹던 것을 걷었다)
 */
function ItemCard({ item, locked, busy, onClick, measure }: {
  item: ItemData; locked: boolean; busy: boolean; onClick?: () => void;
  /** 다국어 높이를 재는 숨은 사본 — 누를 수 없고 검사 · 안내가 고르지 않게 `data-action`을 안 단다 */
  measure?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="mkt-pack mkt-item-card"
      data-action={measure ? undefined : 'buyItem'}
      data-item={measure ? undefined : item.id}
      data-locked={locked ? true : undefined}
      disabled={busy || measure}
      tabIndex={measure ? -1 : undefined}
      onClick={onClick}
    >
      <ItemArt item={item} />
      <span className="mkt-item-nm">{itemName(item)}</span>
      <span className="mkt-pack-price" data-stroke={strokeOf(item.gold)} data-field="price"><GoldCost gold={item.gold} times /></span>
      <span className="mkt-item-fx">{itemText(item)}</span>
    </button>
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
  /** 누른 카드 — 곧장 「구매할까요?」 판이 뜬다(2026-11-27 기획자 — 체크 · [결제하기]를 걷었다) */
  const [asking, setAsking] = useState<ItemData | null>(null);
  /** 막힌 카드를 눌렀을 때 내관이 하는 말 — 누를 때마다 다시 선다(용병 시장 · 도시 물자와 같은 몸짓) */
  const [why, setWhy] = useState<{ text: string; code: string } | null>(null);
  /** 막 산 아이템 — 금화 분수 → 금테 메달 무대(`ItemBoughtDone`, 2026-11-27 기획자) */
  const [bought, setBought] = useState<ItemData | null>(null);
  const now = Date.now();
  const items = shelfOf(profile);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE));
  const cur = Math.min(page, pageCount - 1);
  const rows = items.slice(cur * PAGE, cur * PAGE + PAGE);
  /*
   * 판 크기는 언어 · 쪽과 무관하게 하나 (2026-11-27 기획자). 판 안에 **팔 수 있는 아이템 전부의 숨은 사본**을 두고, 열 언어로 그려 보며
   * 그 가운데 가장 높은 카드를 `--row-h`로 건다(`useAllLangLayout`). 보이는 카드 셋은 그 높이로 서고, 카드 자리(`.mkt-item-cards`)는
   * 늘 세 칸 높이라 마지막 쪽이 덜 차도 판이 안 준다. 사본은 판의 흐름 밖(절대 위치)이라 판 높이에 안 든다
   */
  const listRef = useRef<HTMLElement>(null);
  /** [보관함으로]의 붓 획 폭도 열 언어 가운데 가장 긴 글에 맞춘다(`--row-w`) */
  const storeRef = useRef<HTMLDivElement>(null);
  useAllLangLayout([
    { box: listRef, rows: ':scope .mkt-item-measure > .mkt-item-card', panel: false },
    { box: storeRef, rows: ':scope > .mkt-to-storage', panel: false, width: true },
  ], items.map((i) => i.id).join());
  /** 보관함이 비면 [보관함으로]를 막는다 (2026-11-27 기획자) */
  const storeEmpty = marketOwnedCount(profile) === 0;

  /** 한 개짜리 주문 — 사는 길은 그대로 한 요청(`POST /market/items`)이고 장바구니가 한 칸일 뿐이다 */
  const one = (item: ItemData): MarketBasket => ({ [item.id]: 1 });

  const ask = (item: ItemData): void => {
    if (busy) return;
    const can = canBuyMarketBasket(profile, one(item), now);
    if (!can.ok) { setWhy({ text: reasonText(can), code: can.code ?? 'refused' }); return; }
    setWhy(null);
    setAsking(item);
  };

  const pay = (item: ItemData): void => {
    const order = one(item);
    run(() => buyMarketItemsOnServer(order), () => {
      setAsking(null);
      setBought(item);
    });
  };
  const askCan = asking ? canBuyMarketBasket(profile, one(asking), now) : null;

  return (
    <>
      <section ref={listRef} className="place-panel mkt-list mkt-charge mkt-merc-shop mkt-items" data-field="itemShop">
        {items.length === 0 ? (
          <p className="hint" data-field="itemsLocked">{t('market.items.locked')}</p>
        ) : (
          <>
            {/* 쪽 넘김 — 판 가운데 위(이전) · 아래(다음)에 크게, 쪽 번호는 없다 (2026-11-27 기획자). 그림은 내 차례 표의 겹 갈매기
                (`ui/turn/chevron.png`, 아래를 향한 그림) — 위 것은 뒤집는다. 갈 수 있는 쪽 화살은 위아래로 살짝 오르내리고,
                끝 쪽에서는 흐려지고 안 눌린다(자리는 남아 판이 안 흔들린다). 쪽이 하나면 둘 다 안 그린다 */}
            <PageArrow dir="prev" show={pageCount > 1} disabled={cur <= 0} onClick={() => setPage(cur - 1)} />
            <div className="mkt-item-cards" data-page={cur}>
              {rows.map((item) => (
                <ItemCard key={item.id} item={item} busy={busy}
                  locked={!canBuyMarketBasket(profile, one(item), now).ok} onClick={() => ask(item)} />
              ))}
            </div>
            <PageArrow dir="next" show={pageCount > 1} disabled={cur >= pageCount - 1} onClick={() => setPage(cur + 1)} />
            <div className="mkt-item-measure" aria-hidden="true">
              {items.map((item) => <ItemCard key={item.id} item={item} busy={busy} locked={false} measure />)}
            </div>
          </>
        )}
      </section>
      {/* 보관함으로 — 목록 판 바로 밑 왼쪽, 쪽빛 붓 획 위에 보관함 그림(좌우로 까딱) + 「보관함으로」 (2026-11-27 기획자).
          보관함이 비면 막는다 */}
      <div ref={storeRef} className="mkt-to-storage-row">
        <button type="button" className="mkt-to-storage" data-action="openStorage" disabled={storeEmpty}
          data-empty={storeEmpty ? '1' : undefined} onClick={onStorage}>
          <GameIcon name="mk-storage" label={t('market.items.storage')} />
          <span className="mkt-to-storage-t">{t('market.items.toStorage')}</span>
        </button>
      </div>
      <Say text={why?.text ?? null} level={profile.cityLevel} name="itemsWhy" code={why?.code} repeat />

      <section className="place-panel cmd-panel mkt-cmds">
        <div className="frg-buttons">
          <button className="btn wide" data-action="backHome" onClick={onBack}>
            <span className="lbl">{t('market.backHome')}</span>
          </button>
        </div>
      </section>

      {/* 「구매할까요?」 — 그림 · 이름 · 효과, 값은 [구매 (🪙 × n)] 단추 안에 (도시 물자의 확인 판과 같은 짜임) */}
      {asking && (
        <ConfirmModal
          title={itemName(asking)}
          field="itemAsk"
          className="mkt-item-ask"
          okLabel={<BuyLabel gold={asking.gold} />}
          disabled={busy || !askCan?.ok}
          onConfirm={() => pay(asking)}
          onClose={() => setAsking(null)}
        >
          <span className="mkt-item-ask-art"><ItemArt item={asking} /></span>
          <p className="mkt-confirm-lead" data-field="itemAskWhat">{itemText(asking)}</p>
          <p className="mkt-confirm-ask">{t('market.confirm.ask')}</p>
          <Say text={askCan && !askCan.ok ? reasonText(askCan) : null} level={profile.cityLevel} name="itemAskWhy" />
        </ConfirmModal>
      )}

      {/* 「아이템 구매 완료」 — key: 같은 아이템을 거듭 사도 다시 처음부터 */}
      {bought && <Layer><ItemBoughtDone key={`${bought.id}-${profile.gold}`} item={bought} onClose={() => setBought(null)} /></Layer>}
    </>
  );
}

/**
 * 아이템 구매 완료 (2026-11-27 기획자) — 공용 축하 화면(`Celebrate`)의 금화 분수 도입부(`coins`, 1.8초): 화면이 어두워지고 바닥에서 금화가
 * 「짤그랑」 하며 약한 분수처럼 터져 오른다 → 대장간 제작 완료처럼 무대가 열린다. 뒤는 물자 상자(`ui/cel-stock.png` ← 장터 [재고] 아이콘,
 * 모루와 같은 자리), 앞에 산 아이템의 **금테 메달**(`market-items/medal-{id}.png` ← `build_market_items.py`)이 튀어나오고, 붓 획 한 줄에
 * 작은 메달 + 이름(획의 색은 해금 레벨). 단추 없이 아무 데나 누르면 닫힌다 — 보관함은 판 밑 [보관함으로]가 맡는다.
 * 검사가 거는 이름 — `data-modal="bought"` · 줄 `data-field="doneItem"` · 누름 칸 `data-action="boughtClose"`.
 */
function ItemBoughtDone({ item, onClose }: { item: ItemData; onClose: () => void }): React.JSX.Element {
  return (
    <Celebrate modal="bought" intro="coins" tier="small" className="itm-done" title={t('market.bought.title')}
      art={<img className="cel-art-img" src="ui/cel-stock.png" alt="" />}
      badge={<img className="itm-cel-medal" src={`market-items/medal-${item.id}.png`} alt="" />}
      tone={itemBlink(item.unlockLevel)} okAction="boughtClose" onClose={onClose}>
      <p className="lvd-row itm-done-row" data-field="doneItem" data-item={item.id} data-level={item.unlockLevel}>
        <img className="frg-done-medal" src={`market-items/medal-${item.id}.png`} alt="" />
        <b>{itemName(item)}</b>
      </p>
      <p className="row dim">{t('market.bought.hint')}</p>
    </Celebrate>
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
  // 판 높이는 쪽을 넘겨도 그대로 — 가장 긴 쪽에 맞춘다(`useSteadyPage`, 2026-11-13 기획자)
  const listRef = useRef<HTMLElement>(null);
  const cur = Math.min(page, pageCount - 1);
  const shown = useSteadyPage(listRef, cur, pageCount, [JSON.stringify(units)]);
  const rows = units.slice(shown * STORAGE_PAGE, shown * STORAGE_PAGE + STORAGE_PAGE);
  const pickedItem = picked ? itemById.get(picked) : undefined;

  /** 실제로 준다 — 들고 있던 것은 갈아 끼우면 저절로 보관함으로 */
  const give = (officer: OfficerId): void => {
    if (!picked) return;
    const can = canCarryItem(profile, officer, picked);
    if (!can.ok) { setNote(reasonText(can)); setPicked(null); setSwap(null); return; }
    onChange(carryItem(profile, officer, picked));
    setNote(t('market.storage.given', { officer: pickOfficerNameById(officer, officer), item: itemName(pickedItem!) }));
    setSwap(null);
    setPicked(null);
  };

  const pickOfficer = (officer: OfficerId): void => {
    const carrying = profile.marketCarry?.[officer];
    // 들고 있는 것이 없거나 **바로 그 아이템**이면 안 묻는다 — 잃는 것이 없다
    if (!carrying || carrying === picked) { give(officer); return; }
    setSwap(officer);
  };

  const swapWhat = swap ? (() => {
    const item = profile.marketCarry?.[swap];
    const itemData = item ? itemById.get(item) : undefined;
    return itemData ? itemName(itemData) : '';
  })() : '';

  const revokingItem = revoking ? itemById.get(profile.marketCarry?.[revoking] ?? '') : undefined;

  return (
    <>
      <section ref={listRef} className="place-panel mkt-list" data-field="storage">
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
                const item = itemById.get(u.item)!;
                return (
                  <div
                    className="mkt-irow mkt-srow"
                    key={`${u.item}#${cur * STORAGE_PAGE + i}`}
                    data-item={u.item}
                    data-assigned={u.holder ? '1' : '0'}
                    data-holder={u.holder ?? undefined}
                  >
                    <ItemArt item={item} />
                    <span className="c-nm">{itemName(item)}</span>
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
                    <span className="c-fx">{itemText(item)}</span>
                  </div>
                );
              })}
            </div>
            <Pager page={cur} pageCount={pageCount} onPage={setPage} field="storagePager" />
          </>
        )}
        <Say text={note} level={profile.cityLevel} name="storageNote" repeat />
      </section>

      <section className="place-panel cmd-panel mkt-cmds">
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
          title={t('market.storage.pickTitle', { item: itemName(pickedItem) })}
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
              item: revokingItem ? itemName(revokingItem) : '',
            })}
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
