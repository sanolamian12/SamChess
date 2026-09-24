/**
 * 장터 (2026-09-24 재구성, pptx 75~88쪽 — 「UI update 260924」).
 *
 * ```
 * 장터 홈 (76쪽 왼쪽)          현황판 — 장터 Lv · 보관함 · 금화/군량/자재 · 장수 카드 · 군량 충전
 *   [금화 충전]  현금으로 금화 구매
 *   [상품 구매]  금화로 상품 구매
 * 상품 구매 (76쪽 오른쪽)       배너 셋 — [용병 시장] [전투 아이템] [도시 물자]  + [뒤로 가기]
 *   용병 시장   → market/MercView.tsx   새 카드 뽑기 · 보유 카드 정리
 *   전투 아이템 → market/ItemShop.tsx   아이템 사기 · 보관함 · 지급
 *   도시 물자   → market/GoodsView.tsx  자재 · 군량 · 태학 연구 초기화 · 장수 재설계
 * ```
 *
 * **화풍은 궁궐과 같다** — 청동 명패 제목 · 뒤로 화살표 팻말 · 열린 장부 판 · 참나무 단추.
 * 목업이 궁궐 화면 위에 그려져 있었다(값은 `style.css`의 「장터」 절에 옮겨 적었다).
 *
 * **새 `Screen` 변형을 안 늘린다**(대장간과 같은 결) — 어느 판을 보는지는 이 화면의
 * 상태(`view`)이고, 아래 [뒤로 가기]는 한 칸 위 판으로, 왼쪽 위 「도시로」는 도시로 간다.
 * 도시의 장터 자리가 곧장 이 화면을 연다 — 가챠 하나만 들던 옛 자리 화면(`PlaceScreen`의
 * `market`)은 거치지 않는다.
 *
 * **판정도 계산도 화면이 하지 않는다** — 금화·카드·아이템이 전부 서버 소유라(A1·A2)
 * 사는 수는 모두 서버 왕복이고(`useServerCall`), 못 닿으면 **로컬로 물러나지 않고
 * 말한다**(물러나면 금화만 사라진다).
 */

import { useEffect, useState } from 'react';
import { ECONOMY, officerById } from '@samchess/data';
import {
  RESPEC_GOLD, grainCap, grainPerHour, grainStepMs, marketCapacity, marketLevel, marketOwnedCount,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { devGrantOnServer, devGrantsEnabled } from '../meta/city.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { GradeBadge } from './GradeBadge.tsx';
import { LayerContext, cardTally, useServerCall } from './market/parts.tsx';
import { MercView } from './market/MercView.tsx';
import { ItemShop, ItemStorage } from './market/ItemShop.tsx';
import { GoodsView } from './market/GoodsView.tsx';

type View = 'home' | 'shop' | 'gold' | 'merc' | 'items' | 'storage' | 'goods';

/** 아래 [뒤로 가기]가 가는 곳 — 한 칸 위 판 */
const PARENT: Record<Exclude<View, 'home'>, View> = {
  shop: 'home', gold: 'home', merc: 'shop', items: 'shop', goods: 'shop', storage: 'items',
};

/** 제목 명패 — 판마다 (목업의 청동 명패 글자) */
const TITLE: Record<View, string> = {
  home: 'place.market', shop: 'market.btn.shop', gold: 'market.btn.gold',
  merc: 'market.shop.merc', items: 'market.shop.items', goods: 'market.shop.goods', storage: 'market.shop.items',
};

/** `economy.json`의 `goldPacks`를 아이콘 순서(작은 것부터)에 그대로 맞춘 것 */
const GOLD_PACKS = ECONOMY.goldPacks;

export function MarketScreen({ profile, onBack, onChange, onAcademy, onLevelUp }: {
  profile: PlayerProfile;
  /** 「도시로」 */
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
  /** 태학 연구 초기화 뒤 [태학으로 이동] */
  onAcademy: () => void;
  /** 재설계 뒤 [궁궐로 이동] — 그 장수의 레벨/스킬 관리 */
  onLevelUp: (officer: OfficerId) => void;
}): React.JSX.Element {
  useLang();
  const [view, setView] = useState<View>('home');
  const { busy, note, setNote, run } = useServerCall(onChange);
  const go = (v: View): void => { setNote(null); setView(v); };
  const up = (): void => go(view === 'home' ? 'home' : PARENT[view]);

  /**
   * 개발용 통로는 **`SAMCHESS_DEV_GRANTS=1`일 때만** 뜬다 (태학·병원과 같은 스위치).
   * 금화팩 결제가 붙기 전까지 뽑기를 시험할 길이 이것뿐이다.
   */
  /** 팝업이 뜰 자리 — 화면(`.scr`) 그 자체(`market/parts.tsx`의 `Layer` 참조) */
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void devGrantsEnabled().then((on) => { if (alive) setDevOpen(on); });
    return () => { alive = false; };
  }, []);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('market', profile.cityLevel)}
      className="scr-place scr-market"
      account={currentSession()?.email ?? null}
    >
      {/* 팝업 층의 닻 — 이 빈 표식의 부모가 곧 화면(`.scr`)이다 */}
      <i hidden ref={(el) => { const p = el?.parentElement ?? null; if (p !== layer) setLayer(p); }} />
      <LayerContext.Provider value={layer}>
      <div className="place-bar" data-screen="market">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{stripBackArrow(t('place.back'))}</button>
        <span className="place-nm" data-view={view}>{t(TITLE[view] as Parameters<typeof t>[0])}</span>
      </div>

      {view === 'home' && <MarketStatus profile={profile} />}

      <div className={`place-body mkt-body${view === 'home' ? '' : ' mkt-body-flow'}`} data-view={view}>
        {view === 'home' && (
          <section className="place-panel mkt-cmds">
            <div className="frg-buttons">
              <button className="btn wide" data-action="openGold" onClick={() => go('gold')}>
                <span className="lbl">{t('market.btn.gold')}</span>
                <span className="sub">{t('market.btn.gold.sub')}</span>
              </button>
              <button className="btn wide" data-action="openShop" onClick={() => go('shop')}>
                <span className="lbl">{t('market.btn.shop')}</span>
                <span className="sub">{t('market.btn.shop.sub')}</span>
              </button>
            </div>
          </section>
        )}

        {view === 'shop' && (
          <>
            <div className="mkt-banners">
              <Banner id="merc" onClick={() => go('merc')} />
              <Banner id="items" onClick={() => go('items')} />
              <Banner id="goods" onClick={() => go('goods')} />
            </div>
            <BackPanel onBack={up} />
          </>
        )}

        {view === 'gold' && (
          <>
            <section className="place-panel mkt-list">
              <h2 className="cap">{t('market.gold.title')}</h2>
              <div className="mkt-packs">
                {(['pack-small', 'pack-mid', 'pack-large'] as const).map((icon, i) => (
                  <div key={icon} className="mkt-pack" data-disabled="1">
                    <img src={`market/${icon}.png`} alt="" />
                    <span className="lbl">{t('market.goldPack', { krw: GOLD_PACKS[i]!.krw, gold: GOLD_PACKS[i]!.gold })}</span>
                  </div>
                ))}
              </div>
              {/* 결제가 아직 없다 — 잠가 두고 **왜인지 적는다** */}
              <p className="hint">{t('market.goldPack.soon')}</p>
            </section>
            <BackPanel onBack={up} />
          </>
        )}

        {view === 'merc' && <MercView profile={profile} onChange={onChange} run={run} busy={busy} onBack={up} />}
        {view === 'items' && <ItemShop profile={profile} busy={busy} run={run} onStorage={() => go('storage')} onBack={up} />}
        {view === 'storage' && <ItemStorage profile={profile} onChange={onChange} onBack={up} />}
        {view === 'goods' && (
          <GoodsView
            profile={profile}
            onChange={onChange}
            busy={busy}
            run={run}
            onBack={up}
            onAcademy={onAcademy}
            onLevelUp={onLevelUp}
          />
        )}

        {/* 규칙·서버가 거부한 말은 **한 자리**다 — 어느 판에서 거부당했든 같은 줄에 뜬다 */}
        {note && <p className="note mkt-refused" data-field="refused">{note}</p>}

        {/* 개발용은 **금화 충전 판에만** — 용병 시장에 두면 긴 목록이 화면을 늘려 바닥 명령 판이
            바닥에서 떨어지고, 화면 크기에 맞춰 앉는 섬광·팝업까지 아래로 밀린다(눈으로 잡았다) */}
        {devOpen && view === 'gold' && <DevGrants busy={busy} run={run} />}
      </div>

      </LayerContext.Provider>

      {busy && <BusyVeil label={t('busy.wait')} />}
    </ScreenChrome>
  );
}

/**
 * 현황판 (76쪽) — 장터 Lv · 보관함 / 금화 · 군량 · 자재 / 장수 카드 · 정리 가능 / 군량 충전.
 * **값은 규칙이 낸다** — 정리 가능 카드도 `recycleSources()`·`recyclableCards()`가 정한
 * 것을 단위(3장)로 내려 더한다. 화면이 「3장 이상」을 다시 세면 규칙과 갈린다.
 */
function MarketStatus({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  const { held: cardsHeld, recyclable } = cardTally(profile);
  const lv = marketLevel(profile);
  const toFull = Math.max(0, Math.ceil((grainCap(profile) - profile.grain) * grainStepMs(profile) / 60_000));
  return (
    <section className="place-panel mkt-status" data-field="status">
      <div className="mkt-status-top">
        <span className="mkt-lv" data-field="marketLevel">{t('market.status.level', { level: lv })}</span>
        <span className="mkt-box" data-field="items">
          {t('market.status.items')}{' '}
          {lv < 2 ? t('market.status.items.none') : t('market.status.items.v', { have: marketOwnedCount(profile), max: marketCapacity(profile) })}
        </span>
      </div>
      <div className="mkt-currency">
        <CurrencyStat icon="gold" label={t('market.gold')} value={profile.gold} />
        <CurrencyStat icon="grain" label={t('market.grain')} value={`${profile.grain}/${grainCap(profile)}`} />
        <CurrencyStat icon="materials" label={t('market.materials')} value={profile.materials} />
      </div>
      <dl className="mkt-rows">
        <dt>{t('market.status.cards')}</dt>
        <dd data-field="cards">{t('market.status.cards.v2', { n: cardsHeld, m: recyclable })}</dd>
        <dt>{t('market.status.grain')}</dt>
        <dd data-field="grainRate">{t('market.status.grain.v', { n: grainPerHour(profile), m: toFull })}</dd>
      </dl>
    </section>
  );
}

function CurrencyStat({ icon, label, value }: { icon: string; label: string; value: string | number }): React.JSX.Element {
  return (
    <span className="mkt-cur" data-currency={icon}>
      <img src={`market/${icon}.png`} alt={label} title={label} />
      <b className="v">{value}</b>
    </span>
  );
}

/**
 * 배너 한 장 (76쪽 오른쪽). 그림은 `market/banner-{id}.jpg`(셋이 같은 화풍, `build_market.py`)이고
 * **없으면 옛 가챠 배너로 물러난다**(assets 방침: 없으면 건너뛴다 — 그림을 안 받은 사람 화면).
 */
function Banner({ id, onClick }: { id: 'merc' | 'items' | 'goods'; onClick: () => void }): React.JSX.Element {
  const [src, setSrc] = useState(`market/banner-${id}.jpg`);
  const action = { merc: 'openMerc', items: 'openItems', goods: 'openGoods' }[id];
  return (
    <button className="mkt-banner" data-action={action} data-banner={id} onClick={onClick}>
      <span className="mkt-banner-art">
        <img src={src} alt="" onError={() => { if (src !== 'market/gacha-banner.jpg') setSrc('market/gacha-banner.jpg'); }} />
      </span>
      <span className="mkt-banner-lbl">{t(`market.shop.${id}`)}</span>
    </button>
  );
}

/** 한 칸짜리 바닥 판 — [뒤로 가기] */
function BackPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <section className="place-panel mkt-cmds">
      <div className="frg-buttons">
        <button className="btn wide" data-action="backHome" onClick={onBack}>
          <span className="lbl">{t('market.backHome')}</span>
        </button>
      </div>
    </section>
  );
}

/**
 * 개발용 지급 — 금화 · 장수 카드. 디자인은 신경 쓰지 않는다(시험용). 결제가 붙으면 없앤다.
 * 금화·카드가 서버 소유라 서버에 시킨다(A1·A2).
 */
function DevGrants({ busy, run }: { busy: boolean; run: ReturnType<typeof useServerCall>['run'] }): React.JSX.Element {
  const grant = (g: { gold?: number; officer?: OfficerId; cards?: number }): void => run(() => devGrantOnServer(g));
  return (
    <>
      <div className="devtools">
        <span className="cap">개발용</span>
        <button className="btn ghost sm" data-dev="gold" disabled={busy} onClick={() => grant({ gold: 100 })}>금화 +100</button>
        <button className="btn ghost sm" data-dev="gold-respec" disabled={busy} onClick={() => grant({ gold: RESPEC_GOLD })}>금화 +{RESPEC_GOLD}</button>
        <span className="dim">시험용 통로다. 결제가 붙으면 없앤다.</span>
      </div>
      <div className="devtools">
        <span className="cap">개발용 — 장수 카드 +5</span>
        <div style={{ maxHeight: '12rem', overflowY: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
          {[...officerById.values()].map((o) => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <span style={{ flex: 1, fontSize: '.7rem' }}><GradeBadge grade={o.grade} /> {pickOfficerName(o)}</span>
              <button className="btn ghost sm" data-dev="cards" data-officer={o.id} disabled={busy} onClick={() => grant({ officer: o.id as OfficerId, cards: 5 })}>+5</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
