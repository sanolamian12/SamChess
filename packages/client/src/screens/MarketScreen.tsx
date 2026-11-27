/**
 * 장터 (2026-09-24 재구성, pptx 75~88쪽 — 「UI update 260924」).
 *
 * ```
 * 장터 홈                      현황판 한 줄 + 배너 셋 — [용병 시장] [도시 물자] [전투 아이템]  + 바닥 [금화 충전]
 *                              (2026-11-24 기획자 — 옛 [상품 구매] 판을 홈으로 올렸다. 현황판은 장터 Lv · 금화 · 보관함 둘만)
 *   용병 시장   → market/MercView.tsx   새 카드 뽑기 · 보유 카드 정리
 *   전투 아이템 → market/ItemShop.tsx   아이템 사기 · 보관함 · 지급
 *   도시 물자   → market/GoodsView.tsx  자재 · 군량 · 연구 초기화 · 초심의 서
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
import { officerById } from '@samchess/data';
import {
  MARKET_ITEM_MIN_LEVEL, RESPEC_GOLD, marketCapacity, marketLevel, marketOwnedCount, pendingGuide,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { Say } from './Steward.tsx';
import { currentSession } from '../meta/auth.ts';
import { devGrantOnServer, devGrantsEnabled } from '../meta/city.ts';
import { Celebrate } from './Celebrate.tsx';
import { BusyVeil } from './BusyVeil.tsx';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { GradeBadge } from './GradeBadge.tsx';
import { Layer, LayerContext, useServerCall } from './market/parts.tsx';
import { MercStatus, MercView } from './market/MercView.tsx';
import { ItemShop, ItemStorage, ItemsStatus } from './market/ItemShop.tsx';
import { GoodsStatus, GoodsView } from './market/GoodsView.tsx';
import { GameIcon } from './GameIcon.tsx';
import { buildingNameText } from './buildingText.ts';
import { BuildingLevel } from './LevelBadge.tsx';
import { useGuide } from './useGuide.tsx';

type View = 'home' | 'gold' | 'merc' | 'items' | 'storage' | 'goods';

/** 아래 [뒤로 가기]가 가는 곳 — 한 칸 위 판 */
const PARENT: Record<Exclude<View, 'home'>, View> = {
  gold: 'home', merc: 'home', items: 'home', goods: 'home', storage: 'items',
};

/** 제목 명패 — 판마다 (목업의 청동 명패 글자) */
const TITLE: Record<View, string> = {
  home: 'place.market', gold: 'market.btn.gold',
  merc: 'market.shop.merc', items: 'market.shop.items', goods: 'market.shop.goods', storage: 'market.shop.items',
};

/**
 * 금화 상품 여섯 — 싼 것부터, 한 줄에 셋씩 두 줄 (2026-11-13 기획자). 그림은 `market/pack-{금화}.png`(`tools/build_market.py`의
 * `GOLD_PACKS` ← `assets/icons/new/pack-{금화}-{가격}KRW`). 가격 띠의 붓 획은 컬렉션 시대 칩과 같은 그림(`ui/era-stroke-b-{n}.png`,
 * `tools/build_ui.py`의 `ERA_STROKE_COLORS`) — 옥색 · 청회색 · 쪽빛 · 짙은 자주 · 녹슨 갈색 · 주홍(금은 금빛 글자가 묻혀 뺐다).
 *
 * ⚠ **임시로 화면에 적어 둔 표다.** 정본은 엑셀 → `economy.json`의 `goldPacks`인데 아직 옛 셋(10 · 60 · 120)뿐이고 엑셀은 읽기 전용이다 —
 * 결제를 붙일 때 엑셀에 이 여섯 줄을 넣고 여기를 `ECONOMY.goldPacks`로 되돌린다. `pack-10`은 그림 이름에 가격이 없어 지금 값(₩1,000)을 둔다.
 */
const GOLD_SHOP = [
  { gold: 10, krw: 1000, stroke: 5 },
  { gold: 35, krw: 3000, stroke: 3 },
  { gold: 70, krw: 5000, stroke: 7 },
  { gold: 150, krw: 10000, stroke: 6 },
  { gold: 320, krw: 20000, stroke: 2 },
  { gold: 500, krw: 30000, stroke: 4 },
] as const;
/** 가격 — 환율은 아직 안 따진다. 원화 그대로 「₩1,000」(언어와 무관하게 같은 꼴) */
const krwText = (krw: number): string => `₩${krw.toLocaleString('en-US')}`;

export function MarketScreen({ profile, onBack, onChange, onAcademy }: {
  profile: PlayerProfile;
  /** 「도시로」 */
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
  /** 태학 연구 초기화 뒤 [태학으로 이동] */
  onAcademy: () => void;
}): React.JSX.Element {
  useLang();
  const [view, setView] = useState<View>('home');
  const { busy, note, setNote, run } = useServerCall(onChange);
  const go = (v: View): void => { setNote(null); setView(v); };
  const up = (): void => go(view === 'home' ? 'home' : PARENT[view]);
  /**
   * 장터 안의 안내 (2026-11-14) — 용병 시장 · 전투 아이템에 처음 들어왔을 때. 장터 홈의 소개(`market.intro`)는 앱이 세우고,
   * 안의 갈래는 화면 안의 상태(`view`)라 이 화면이 세운다(도시 관리 · 건물 관리와 같은 결). 서버 일 중에는 미룬다
   */
  const subGuide = useGuide(
    profile, onChange,
    busy ? null : view === 'merc' ? pendingGuide(profile, 'marketMerc') : view === 'items' ? pendingGuide(profile, 'marketItems')
      : view === 'storage' ? pendingGuide(profile, 'marketStorage') : null,
    `market-${view}`,
  );

  /**
   * 개발용 통로는 **`SAMCHESS_DEV_GRANTS=1`일 때만** 뜬다 (태학·병원과 같은 스위치).
   * 금화팩 결제가 붙기 전까지 뽑기를 시험할 길이 이것뿐이다.
   */
  /** 팝업이 뜰 자리 — 화면(`.scr`) 그 자체(`market/parts.tsx`의 `Layer` 참조) */
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  /** 방금 받은 금화 — 「구매 완료」 축하 화면을 띄운다(금화 구매만 — 개별 물품 구매는 가벼운 알림 그대로, 2026-11-20 기획자) */
  const [bought, setBought] = useState<number | null>(null);
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
      {/* 걸이 함수는 다시 그릴 때마다 `null` → 요소로 두 번 불린다 — `null`에 닻을 비우면 팝업 층이 잠깐 사라졌다 돌아와
          그 안의 팝업이 통째로 다시 만들어진다(초심의 서 도입부가 무대가 열리는 순간 처음부터 다시 돌았다, 2026-11-26). 비우지 않는다 */}
      <i hidden ref={(el) => { const p = el?.parentElement ?? null; if (p && p !== layer) setLayer(p); }} />
      <LayerContext.Provider value={layer}>
      <div className="place-bar" data-screen="market">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{stripBackArrow(t('place.back'))}</button>
        <span className="place-nm" data-view={view}>{t(TITLE[view] as Parameters<typeof t>[0])}</span>
      </div>

      {/* 현황판은 홈 · 용병 시장 · 도시 물자 모두 제목 바 바로 밑 같은 자리 · 같은 높이 (2026-11-24 기획자) */}
      {view === 'home' && <MarketStatus profile={profile} />}
      {view === 'merc' && <MercStatus profile={profile} />}
      {view === 'goods' && <GoodsStatus profile={profile} />}
      {view === 'items' && <ItemsStatus profile={profile} />}

      <div className="place-body mkt-body mkt-body-flow" data-view={view}>
        {/* 홈 = 현황판 + 배너 셋 + 바닥의 [금화 충전] 하나 (2026-11-24 기획자 — 옛 [상품 구매] 판을 홈으로 올렸다) */}
        {view === 'home' && (
          <>
            <div className="mkt-banners">
              <Banner id="merc" onClick={() => go('merc')} />
              {/* 차례 — 용병 시장 · 도시 물자 · 전투 아이템 (2026-11-23 기획자 — 물자와 아이템 자리를 맞바꿨다. 장터 Lv1에서 잠긴 배너가 맨 아래로) */}
              <Banner id="goods" onClick={() => go('goods')} />
              {/* 장터 Lv1은 아이템을 안 판다 — 들어가서 「올리면 판다」를 읽게 하지 않고 배너에서 막는다 (2026-11-12 지정) */}
              <Banner id="items" onClick={() => go('items')}
                lockedUntil={marketLevel(profile) < MARKET_ITEM_MIN_LEVEL ? MARKET_ITEM_MIN_LEVEL : undefined} />
            </div>
            <section className="place-panel cmd-panel mkt-cmds">
              <div className="frg-buttons">
                {/* 아이콘은 왼쪽에 붙고 글자는 단추 가운데 (2026-11-24 기획자) */}
                <button className="btn wide mkt-ctr-btn" data-action="openGold" onClick={() => go('gold')}>
                  <span className="lbl"><GameIcon name="mk-topup" label={t('market.btn.gold')} text /></span>
                </button>
              </div>
            </section>
          </>
        )}

        {view === 'gold' && (
          <>
            {/* 판 안 제목 · 「결제 연동 전」 줄은 걷었다(2026-11-13 기획자 — 제목은 위 명패가 이미 말한다).
                상품 셋은 카드 — 주머니 그림 · 상품명([금화] 10) · 가격 띠(붓 획 위 금빛 글자). 결제가 붙기 전이라 누르는 자리는 없다 */}
            <section className="place-panel mkt-list mkt-charge">
              <div className="mkt-packs">
                {GOLD_SHOP.map((pack, i) => {
                  const { stroke } = pack;
                  return (
                    // 결제가 붙기 전에는 **개발용 지급이 켜진 환경에서만** 눌린다 — 그 금화를 지급하고 「구매 완료」 축하 화면(2026-11-20 기획자).
                    // 결제가 붙으면 결제 성공 자리에서 같은 `setBought`를 부른다
                    <button key={pack.gold} type="button" className="mkt-pack" data-pack={i} data-gold={pack.gold} data-krw={pack.krw}
                      data-action="buyGold" disabled={!devOpen || busy}
                      onClick={() => run(() => devGrantOnServer({ gold: pack.gold }), () => setBought(pack.gold))}>
                      <img className="mkt-pack-art" src={`market/pack-${pack.gold}.png`} alt="" />
                      <span className="mkt-pack-name"><GameIcon name="res-gold" label={t('market.gold')} />{pack.gold}</span>
                      <span className="mkt-pack-price" data-stroke={stroke}>{krwText(pack.krw)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            {/* 가진 금화 — 판 바깥 왼쪽 아래, 금빛 붓 획(`ui/era-stroke-b-8.png` ← `era-stroke-금`) 위에 「보유 [금화] : 0」 (2026-11-13 기획자) */}
            <p className="mkt-charge-have" data-field="goldHave" data-gold={profile.gold}>
              {t('market.charge.have')} <GameIcon name="res-gold" label={t('market.gold')} /> : {profile.gold.toLocaleString('en-US')}
            </p>
            <BackPanel onBack={up} />
            {/* 화면(`.scr`) 맨 위 층으로 — 판 안에 두면 어둠이 제목 줄까지 못 덮는다 */}
            {bought !== null && <Layer><GoldCelebrate gold={bought} have={profile.gold} onClose={() => setBought(null)} /></Layer>}
          </>
        )}

        {subGuide.node}
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
          />
        )}

        {/* 규칙·서버가 거부한 말은 **한 자리**다 — 어느 판에서 거부당했든 같은 줄에 뜬다 */}
        <Say text={note} level={profile.cityLevel} name="refused" repeat />

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
 * 현황판 한 줄 (2026-11-24 기획자) — 왼쪽 단: 장터 배지 + 레벨(왼쪽 정렬), 오른쪽 단: 금화 | 보관함(보유 / 최대)(오른쪽 정렬).
 * 장터 Lv1은 보관함이 없다(「Lv 2부터」 — 언어마다 길이가 달라 짧게). 군량 · 자재 · 장수 카드는 그 판(도시 물자 · 용병 시장)이 보여 준다
 */
function MarketStatus({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  const lv = marketLevel(profile);
  return (
    <section className="place-panel mkt-status" data-field="status">
      <span className="mkt-lv" data-field="marketLevel"><BuildingLevel id="market" name={buildingNameText('market')} level={lv} /></span>
      <span className="mkt-cur" data-currency="gold" data-field="gold" data-gold={profile.gold}>
        <img src="market/gold.png" alt={t('market.gold')} title={t('market.gold')} data-tip={t('market.gold')} />
        <b className="v">{profile.gold.toLocaleString('en-US')}</b>
      </span>
      <span className="mkt-cur mkt-stock" data-field="items">
        <GameIcon name="mk-storage" label={t('market.status.items')} />
        <b className="v">{lv < 2 ? <span className="mkt-merc-cards">{t('market.status.items.none')}</span> : `${marketOwnedCount(profile)}/${marketCapacity(profile)}`}</b>
      </span>
    </section>
  );
}

/**
 * 배너 한 장 (76쪽 오른쪽). 그림은 `market/banner-{id}.jpg`(셋이 같은 화풍, `build_market.py`)이고
 * **없으면 옛 가챠 배너로 물러난다**(assets 방침: 없으면 건너뛴다 — 그림을 안 받은 사람 화면).
 */
function Banner({ id, onClick, lockedUntil }: {
  id: 'merc' | 'items' | 'goods'; onClick: () => void;
  /** 이 장터 레벨부터 열린다 — 있으면 어둡게 · 흐리게 + 자물쇠 + 「장터 Lv2부터」, 눌리지 않는다 */
  lockedUntil?: number | undefined;
}): React.JSX.Element {
  const [src, setSrc] = useState(`market/banner-${id}.jpg`);
  const action = { merc: 'openMerc', items: 'openItems', goods: 'openGoods' }[id];
  const locked = lockedUntil !== undefined;
  return (
    <button className="mkt-banner" data-action={action} data-banner={id} data-locked={locked ? '1' : undefined}
      disabled={locked} onClick={onClick}>
      <span className="mkt-banner-art">
        <img src={src} alt="" onError={() => { if (src !== 'market/gacha-banner.jpg') setSrc('market/gacha-banner.jpg'); }} />
        {/* 이름은 그림 가운데에 (2026-11-24 기획자 — 아래 명패 띠는 걷었다). 평소엔 어둡게 + 이름, 포커스면 본래 밝기 + 이름은 숨는다 */}
        {!locked && <span className="mkt-banner-lbl">{t(`market.shop.${id}`)}</span>}
        {locked && (
          <span className="mkt-banner-lock" data-field="bannerLock">
            <span className="mkt-banner-lbl">{t(`market.shop.${id}`)}</span>
            <GameIcon name="mk-lock" label={t('market.shop.items.locked', { level: lockedUntil })} />
            <span className="mkt-banner-lock-t">{t('market.shop.items.locked', { level: lockedUntil })}</span>
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * 금화 구매 완료 — 공용 축하 화면(`Celebrate`, 2026-11-20 기획자 「구매 완료」 예시): 보물 상자 위에 금화 주머니가 내려찍히고
 * 「[금화] +N」, 아래에 지금 가진 금화. 결제가 붙으면 결제 성공 자리가 이것을 띄운다
 */
function GoldCelebrate({ gold, have, onClose }: { gold: number; have: number; onClose: () => void }): React.JSX.Element {
  return (
    <Celebrate
      modal="goldDone"
      tier="small"
      className="gold-cel"
      tone="gold"
      title={t('market.gold.done.title')}
      art={<img className="cel-art-img" src="ui/cel-chest.png" alt="" />}
      badge={<img className="gold-cel-bag" src="ui/cel-goldbag.png" alt="" />}
      big={(
        <span className="gold-cel-got" data-gold={gold}>
          <GameIcon name="res-gold" label={t('market.gold')} />+{gold.toLocaleString('en-US')}
        </span>
      )}
      bigField="goldGot"
      onClose={onClose}
    >
      <p className="row dim" data-field="goldHave" data-gold={have}>
        {t('market.charge.have')} <GameIcon name="res-gold" label={t('market.gold')} /> {have.toLocaleString('en-US')}
      </p>
    </Celebrate>
  );
}

/** 한 칸짜리 바닥 판 — [뒤로 가기] */
function BackPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <section className="place-panel cmd-panel mkt-cmds">
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
              <span style={{ flex: 1, fontSize: '.8rem' }}><GradeBadge grade={o.grade} /> {pickOfficerName(o)}</span>
              <button className="btn ghost sm" data-dev="cards" data-officer={o.id} disabled={busy} onClick={() => grant({ officer: o.id as OfficerId, cards: 5 })}>+5</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
