/**
 * 장터 — 가챠 (트랙 9, 2026-08-24 UI 1차 초안)
 *
 * ```
 * [← 장터로]                    장터
 *  금화 X   군량 Y/max   재료 Z
 * [가챠 배너]
 *  [단발 뽑기 10냥]  [10연 뽑기 90냥]
 * ─ 거래 ─
 *  카드 정리   재설계 (궁궐에서)   금화팩 3종 (결제 연동 전)   건축 자재
 * ```
 *
 * **UI 자체가 초안이다.** 기획자가 목업을 따로 주기로 했던 것을, 이미 확보된
 * `assets/market/` 그림만으로 먼저 만들어 보고 고쳐 나가는 자리다 — 카드 액자
 * 안에서 초상화가 앉는 자리(`.mkt-card-art`의 `%` 값)는 프레임 그림을 눈대중으로
 * 잘라 넣은 것이라 특히 다시 볼 곳이다.
 *
 * ────────────────────────────────────────────────────────────────
 * 골드 차감·카드 지급은 여기서 하지 않는다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * `@samchess/meta`의 `buyGacha()`가 가격 검증(`canAffordGacha`) · 배열 소비
 * (`drawGacha`) · 카드 지급(`addCard`)을 전부 한다 — 화면은 부르고 결과를
 * 보여줄 뿐이다. 다른 메타 화면(`CityScreen`의 `applyCityUpgrade`)과 같은 결.
 *
 * ────────────────────────────────────────────────────────────────
 * 「거래」의 둘은 아직 살 수 없다 — 왜인지 각자 적는다
 * ────────────────────────────────────────────────────────────────
 *
 * - **카드 정리는 열렸다** (2026-09-14) — 같은 등급 3장 → 보유한 장수 중 고른 1명의
 *   카드 1장. 판정·계산은 `@samchess/meta`의 `canRecycle`·`applyRecycle`이 하고
 *   (`recycle.ts`), 화면은 **재료를 사람이 고르게** 할 뿐이다. `cards`는 클라이언트
 *   소유 필드라 가챠와 같은 결로 로컬에서 부르고 `PUT`으로 올린다.
 * - **재설계**: 이미 `LevelUpScreen`에 있는 기능이다(둔갑천서, 장수별로 쓴다).
 *   장터에 새 구매 흐름을 만들지 않고 가격만 보여주고 그리로 보낸다 — 같은
 *   기능을 두 곳에서 다른 이름으로 부르면 어긋난다.
 * - **금화팩**: 결제가 모의 vs 실 PG 중 아직 안 정해졌다(HANDOFF §7) — 그래서
 *   버튼을 잠그고 이유를 적는다(「눌리는데 아무 일도 없으면 「고장인가」가
 *   남는다」).
 *
 * ────────────────────────────────────────────────────────────────
 * 건축 자재만은 실제로 팔린다 — 그리고 **서버가 판다** (2026-09-04)
 * ────────────────────────────────────────────────────────────────
 *
 * 자재가 들어오는 길이 전투 승리 하나뿐이라 증축을 시험할 수가 없었다. 가챠는
 * `buyGacha()`를 로컬에서 부르고 `PUT`으로 올리면 그만이지만(`gold`·`cards`는
 * 클라이언트 소유), **`materials`는 서버 소유 필드**라 그렇게 하면 금화만 줄고
 * 자재는 조용히 삼켜진다 — 그래서 이것만 `POST /market/materials`를 거친다
 * (`meta/city.ts`의 증축·건설·치료와 같은 결이다). **다만 못 닿아도 로컬로
 * 물러나지 않는다** — 아래 `buyMaterials` 주석 참조.
 */

import { useEffect, useState } from 'react';
import { ECONOMY, officerById } from '@samchess/data';
import type { MarketItemData } from '@samchess/data';
import {
  MATERIAL_PACK, RECYCLE_CARDS_IN, RECYCLE_MIN_HELD, RESPEC_GOLD, addCard, applyRecycle, buyGacha,
  GRAIN_PACK, canAffordGacha, canBuyGrain, canBuyMaterials, canBuyMarketItem, canRecycle,
  gachaPullCost, grainCap, grainPackCost,
  grainPerHour, grainStepMs, marketCapacity, marketHeldCount, marketItemsOf, marketLevel,
  marketOwnedCount, marketStockLeft, materialPackCost, recycleMaterials, recycleOutput,
  recycleTargets, recycleTotal,
} from '@samchess/meta';
import type { GachaPullKind, MetaResult, PlayerProfile, RecycleInputs } from '@samchess/meta';
import type { Grade, OfficerId } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import {
  buyGrainOnServer, buyMarketItemOnServer, buyMaterialsOnServer, devGrantOnServer, devGrantsEnabled,
  pullGachaOnServer, recycleOnServer,
} from '../meta/city.ts';
import { pickMarketItemName, pickMarketItemText } from '../i18n/story.ts';
import { reasonText } from '../i18n/reason.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { GradeBadge } from './GradeBadge.tsx';

/** 개봉 연출 한 칸의 재생 시간. `build_market.py`의 `REVEAL_FRAME_SIZE`(px)와
 *  달리 이건 **시간** 값이라 도구와 공유하지 않는다 — 순전히 화면의 느낌이다. */
const REVEAL_FRAME_MS = 260;
/** `build_market.py`의 `REVEAL_FRAME_SIZE`와 같은 값이어야 스프라이트가 안 밀린다. */
const REVEAL_FRAME_PX = 256;

type Reveal = { kind: GachaPullKind; drawn: OfficerId[]; exhausted: boolean; phase: 'anim' | 'shown' };

export function MarketScreen({ profile, onBack, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const [reveal, setReveal] = useState<Reveal | null>(null);
  /**
   * 서버 왕복 중에는 두 번 못 누른다 — 두 번 누르면 금화를 두 번 낸다. **무엇을 기다리는지**를
   * 함께 든다: 가챠·개발용 지급도 서버 왕복이 되어(2026-09-14, A1) 가리개가 늘 「건축 자재를
   * 사는 중」이라고 말하면 거짓말이다
   */
  const [busy, setBusy] = useState<null | 'materials' | 'wait'>(null);
  /** 규칙이 거부한 이유. **그쪽이 한 말을 그대로 보여 준다**(`CityScreen`과 같은 결) */
  const [refused, setRefused] = useState<string | null>(null);
  /** 카드 정리 팝업이 열려 있는가 */
  const [recycling, setRecycling] = useState(false);
  /**
   * 어느 판을 보고 있나 — **새 `Screen` 변형을 안 늘린다**(대장간과 같은 결).
   * 뒤로가기가 전부 「장터 홈」 하나로 모이고, `App.tsx`의 화면 표가 안 커진다.
   */
  const [view, setView] = useState<'home' | 'merc' | 'goods' | 'gold'>('home');
  /**
   * 개발용 통로는 **`SAMCHESS_DEV_GRANTS=1`일 때만** 뜬다 (태학·병원과 같은 스위치).
   * 켜 두면 260명 목록이 홈에 통째로 펼쳐져 **바닥 명령 판이 바닥이 아니게 된다** —
   * 실제로 그렇게 보였고 눈으로만 잡혔다.
   */
  const [devOpen, setDevOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void devGrantsEnabled().then((on) => { if (alive) setDevOpen(on); });
    return () => { alive = false; };
  }, []);

  const buy = (kind: GachaPullKind): void => {
    if (busy || !canAffordGacha(profile, kind).ok) return;
    /*
     * **가챠는 서버가 뽑는다** (2026-09-14, A1). `gold`·`gachaPool`이 서버 소유라 로컬로
     * 뽑아 `PUT`으로 올리면 **금화도 배열도 되돌아가고 카드만 남는다** — 그리고 그전에는
     * API를 직접 불러 금화를 마음대로 적을 수 있었다. 시드도 서버가 만든다.
     * 못 닿으면 물러나지 않고 말한다(자재 구매와 같은 결).
     */
    setRefused(null);
    setBusy('wait');
    void (async () => {
      try {
        const pulled = await pullGachaOnServer(kind);
        if (!pulled) { setRefused(t('server.offline')); return; }
        onChange(pulled.profile);
        setReveal({
          kind, drawn: pulled.drawn, exhausted: pulled.exhausted,
          phase: kind === 'single' ? 'anim' : 'shown',
        });
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  /**
   * 건축 자재 한 묶음. **판정도 계산도 서버가 한다** — `materials`는 서버 소유
   * 필드다.
   *
   * ★ **여기서는 로컬로 물러나지 않는다** (2026-09-04). 증축·건설·치료는 못 닿으면
   * 로컬로 계산해 두고 다음 왕복에 정정되지만(§5-61), **이 수는 내는 것과 받는 것의
   * 임자가 다르다** — `gold`는 클라이언트 소유라 `PUT`으로 남고 `materials`는 서버
   * 소유라 버려진다. 물러나면 **금화만 사라진다.** 그래서 못 닿으면 **아무것도
   * 하지 않고 말한다.**
   */
  const buyMaterials = (): void => {
    setRefused(null);
    setBusy('materials');
    void (async () => {
      try {
        const fromServer = await buyMaterialsOnServer();
        if (fromServer) onChange(fromServer);
        else setRefused(t('market.buyMaterials.offline'));
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  /** 개발용 지급 — 금화가 서버 소유라 서버에 시킨다(2026-09-14, A1). 못 닿으면 말한다 */
  const devGrant = (grant: { gold?: number; officer?: OfficerId; cards?: number }): void => {
    setRefused(null);
    setBusy('wait');
    void (async () => {
      try {
        const fromServer = await devGrantOnServer(grant);
        if (fromServer) onChange(fromServer);
        else setRefused(t('server.offline'));
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  /**
   * 시장 아이템 한 개. **자재 구매와 같은 결** — `gold`도 `marketOwned`도 서버
   * 소유라 못 닿으면 **로컬로 물러나지 않는다**(물러나면 금화만 사라진다).
   * 하루 매물은 서버 시계가 재는 값이라 로컬로는 계산할 수도 없다.
   */
  const buyItem = (item: string): void => {
    setRefused(null);
    setBusy('wait');
    void (async () => {
      try {
        const fromServer = await buyMarketItemOnServer(item);
        if (fromServer) onChange(fromServer);
        else setRefused(t('server.offline'));
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  /** 군량 한 묶음 — 자재와 같은 결(서버가 판다, 못 닿으면 안 물러난다) */
  const buyGrain = (): void => {
    setRefused(null);
    setBusy('materials');
    void (async () => {
      try {
        const fromServer = await buyGrainOnServer();
        if (fromServer) onChange(fromServer);
        else setRefused(t('market.buyMaterials.offline'));
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  const grainCan = canBuyGrain(profile, Date.now());
  const materialsCan = canBuyMaterials(profile);
  const materialsGold = materialPackCost();
  const now = Date.now();
  const cardsHeld = Object.values(profile.cards).reduce<number>((n, c) => n + (c ?? 0), 0);
  const items = marketItemsOf(profile);
  const back = (): void => { setRefused(null); setView('home'); };

  return (
    <ScreenChrome
      backdrop={placeBackdrop('market', profile.cityLevel)}
      className="scr-market"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="market">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('market.back')}</button>
        <span className="place-nm">{t('place.market')}</span>
      </div>

      <div className="place-body mkt-body" data-view={view}>
        {/* ── 현황판 — 재화 한 줄 + 장터에서만 아는 것 둘 ────────────── */}
        <section className="place-panel mkt-status" data-field="status">
          <div className="mkt-currency">
            <CurrencyStat icon="gold" label={t('market.gold')} value={profile.gold} />
            <CurrencyStat icon="grain" label={t('market.grain')} value={`${profile.grain}/${grainCap(profile)}`} />
            <CurrencyStat icon="materials" label={t('market.materials')} value={profile.materials} />
          </div>
          <dl className="mkt-rows">
            <dt>{t('market.status.cards')}</dt>
            <dd data-field="cards">{t('market.status.cards.v', { n: cardsHeld })}</dd>
            <dt>{t('market.status.items')}</dt>
            <dd data-field="items">
              {marketLevel(profile) < 2
                ? t('market.status.items.none')
                : t('market.status.items.v', {
                  have: marketOwnedCount(profile), max: marketCapacity(profile),
                })}
            </dd>
            <dt>{t('market.status.grain')}</dt>
            <dd data-field="grainRate">
              {t('market.status.grain.v', {
                n: grainPerHour(profile),
                m: Math.max(0, Math.ceil(
                  (grainCap(profile) - profile.grain) * grainStepMs(profile) / 60_000)),
              })}
            </dd>
          </dl>
        </section>

        {/* ── 홈 — 바닥 명령 판 셋 ─────────────────────────────────── */}
        {view === 'home' && (
          <section className="place-panel mkt-home">
            <div className="frg-buttons">
              <button className="btn wide" data-action="openGold" onClick={() => setView('gold')}>
                <span className="lbl">{t('market.btn.gold')}</span>
              </button>
              <button className="btn wide primary" data-action="openMerc" onClick={() => setView('merc')}>
                <span className="lbl">{t('market.btn.merc')}</span>
              </button>
              <button className="btn wide" data-action="openGoods" onClick={() => setView('goods')}>
                <span className="lbl">{t('market.btn.goods')}</span>
              </button>
            </div>
          </section>
        )}

        {/* ── 용병 장터 — 장수 카드와 장수 아이템 ───────────────────── */}
        {view === 'merc' && (
          <>
            <section className="place-panel mkt-gacha">
              <img className="mkt-banner" src="market/gacha-banner.jpg" alt="" data-field="banner" />
              <h2 className="cap">{t('market.gacha.title')}</h2>
              <div className="mkt-pulls">
                <GachaButton kind="single" profile={profile} onBuy={buy} />
                <GachaButton kind="ten" profile={profile} onBuy={buy} />
              </div>
              <div className="mkt-goods mkt-goods-2">
                <ShopTile
                  icon="recycle"
                  action="recycle"
                  title={t('market.recycle')}
                  sub={t('market.recycle.sub', { n: RECYCLE_CARDS_IN })}
                  onClick={() => setRecycling(true)}
                />
                <ShopTile
                  icon="respec-scroll"
                  title={t('market.respec')}
                  sub={t('market.respec.sub', { gold: RESPEC_GOLD })}
                  disabled
                />
              </div>
            </section>

            {/* 장수 아이템 — 한 줄이 한 품목이다 (2026-09-23, GDD §6.5) */}
            <section className="place-panel mkt-items" data-field="itemShop">
              <h2 className="cap">{t('market.items.title')}</h2>
              {items.length === 0 ? (
                <p className="hint" data-field="itemsLocked">{t('market.items.locked')}</p>
              ) : (
                <div className="mkt-item-list">
                  {items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      held={marketHeldCount(profile, item.id)}
                      stock={marketStockLeft(profile, item.id, now)}
                      can={canBuyMarketItem(profile, item.id, now)}
                      busy={busy !== null}
                      onBuy={() => buyItem(item.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* ── 물자 장터 ────────────────────────────────────────────── */}
        {view === 'goods' && (
          <section className="place-panel mkt-shop">
            <h2 className="cap">{t('market.goods.title')}</h2>
            <div className="mkt-goods">
              <ShopTile
                icon="grain"
                action="buyGrain"
                title={t('market.buyGrain')}
                sub={t('market.buyGrain.sub', { n: GRAIN_PACK, gold: grainPackCost() })}
                disabled={busy !== null || !grainCan.ok}
                hint={grainCan.ok ? undefined : reasonText(grainCan)}
                onClick={buyGrain}
              />
              <ShopTile
                icon="materials"
                action="buyMaterials"
                title={t('market.buyMaterials')}
                sub={t('market.buyMaterials.sub', { n: MATERIAL_PACK, gold: materialsGold })}
                disabled={busy !== null || !materialsCan.ok}
                hint={materialsCan.ok ? undefined : materialsCan.reason}
                onClick={buyMaterials}
              />
              {/* 초기화 아이템 — **사는 곳은 장터, 쓰는 곳은 원래 자리**(GDD §6.5).
                  파는 칸은 아직 없다: 지금은 궁궐·태학에서 금화를 바로 낸다 */}
              <ShopTile
                icon="respec-scroll"
                title={t('market.reset')}
                sub={t('market.reset.sub')}
                disabled
              />
            </div>
          </section>
        )}

        {/* ── 금화 충전 — 결제라 제 판이다 ──────────────────────────── */}
        {view === 'gold' && (
          <section className="place-panel mkt-shop">
            <h2 className="cap">{t('market.gold.title')}</h2>
            <div className="mkt-goods">
              {(['pack-small', 'pack-mid', 'pack-large'] as const).map((icon, i) => (
                <ShopTile
                  key={icon}
                  icon={icon}
                  title={t('market.goldPack', { krw: GOLD_PACKS[i]!.krw, gold: GOLD_PACKS[i]!.gold })}
                  sub={t('market.goldPack.soon')}
                  disabled
                />
              ))}
            </div>
          </section>
        )}

        {devOpen && view === 'merc' && (
          <>
          {/* 상점이 아직 없던 시절 CityScreen의 「재료 +10」과 같은 자리 — 골드 결제가
              붙기 전까지 가챠를 시험해 볼 통로다. 결제가 붙으면 함께 지운다.
              **레벨/스킬 관리 판(`LevelUpPanel.tsx`)의 개발용 카드·금화 지급도
              여기로 옮겨왔다**(2026-09-02) — 이제 상점이 있으니 개발용 통로는
              한 곳에 모은다. 디자인은 신경 쓰지 않는다 — 시험용이다. */}
          <div className="devtools">
            <span className="cap">개발용</span>
            <button
              className="btn ghost sm"
              data-dev="gold"
              disabled={busy !== null}
              onClick={() => devGrant({ gold: 100 })}
            >
              금화 +100
            </button>
            <button
              className="btn ghost sm"
              data-dev="gold-respec"
              disabled={busy !== null}
              onClick={() => devGrant({ gold: RESPEC_GOLD })}
            >
              금화 +{RESPEC_GOLD}
            </button>
            <span className="dim">시험용 통로다. 결제가 붙으면 없앤다.</span>
          </div>

          {/* 장수별 카드 +5 — 레벨업·재설계를 시험하려면 장수를 골라 카드를 받아야
              한다. 디자인 없이 이름 + 버튼만 늘어놓은 목록이다(개발용, 260명
              전부 스크롤). `officerById`가 게임에 등장하는 장수 전체다. */}
          <div className="devtools">
            <span className="cap">개발용 — 장수 카드 +5</span>
            <div style={{ maxHeight: '12rem', overflowY: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
              {[...officerById.values()].map((o) => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <span style={{ flex: 1, fontSize: '.7rem' }}><GradeBadge grade={o.grade} /> {pickOfficerName(o)}</span>
                  <button
                    className="btn ghost sm"
                    data-dev="cards"
                    data-officer={o.id}
                    disabled={busy !== null}
                    onClick={() => devGrant({ officer: o.id as OfficerId, cards: 5 })}
                  >
                    +5
                  </button>
                </div>
              ))}
            </div>
          </div>
          </>
        )}

        {/* **규칙이 거부한 말을 그대로 적는다** — 화면이 이유를 다시 짓지 않는다.
            판마다 따로 적지 않고 **한 자리**다 — 어느 판에서 거부당했든 같은 줄에 뜬다 */}
        {refused && <p className="note" data-field="refused">{refused}</p>}

        {/* 하위 판의 [뒤로 가기]는 **장터 홈**으로 — 새 화면을 안 늘린 값이다 */}
        {view !== 'home' && (
          <section className="place-panel mkt-foot">
            <button className="btn wide" data-action="backHome" onClick={back}>
              <span className="lbl">{t('market.backHome')}</span>
            </button>
          </section>
        )}
      </div>

      {reveal && (
        <RevealModal reveal={reveal} onSettled={() => setReveal((r) => (r ? { ...r, phase: 'shown' } : r))} onClose={() => setReveal(null)} />
      )}

      {recycling && (
        <RecycleModal profile={profile} onChange={onChange} onClose={() => setRecycling(false)} />
      )}

      {/* 자재 구매만 서버 왕복이다 — 가챠는 로컬이라 기다릴 것이 없다 */}
      {busy && <BusyVeil label={t(busy === 'materials' ? 'market.buyMaterials.busy' : 'busy.wait')} />}
    </ScreenChrome>
  );
}

/** `economy.json`의 `goldPacks`를 아이콘 순서(작은 것부터)에 그대로 맞춘 것.
 *  값 자체는 화면에 옮겨 적지 않고 `@samchess/data`의 `ECONOMY`를 그대로 쓴다. */
const GOLD_PACKS = ECONOMY.goldPacks;

function CurrencyStat({ icon, label, value }: { icon: string; label: string; value: string | number }): React.JSX.Element {
  return (
    <span className="mkt-cur" data-currency={icon}>
      <img src={`market/${icon}.png`} alt="" />
      <span className="k">{label}</span>
      <b className="v">{value}</b>
    </span>
  );
}

function GachaButton({ kind, profile, onBuy }: {
  kind: GachaPullKind;
  profile: PlayerProfile;
  onBuy: (kind: GachaPullKind) => void;
}): React.JSX.Element {
  const cost = gachaPullCost(kind);
  const can = canAffordGacha(profile, kind);
  const icon = kind === 'single' ? 'gacha-single' : 'gacha-ten';
  const label = kind === 'single' ? t('market.pull.single') : t('market.pull.ten');
  return (
    <button
      className="btn mkt-pull"
      data-action={`pull-${kind}`}
      disabled={!can.ok}
      title={can.ok ? undefined : t('market.pull.notEnough', { have: profile.gold, need: cost.gold })}
      onClick={() => onBuy(kind)}
    >
      <img src={`market/${icon}.png`} alt="" />
      <span className="lbl">{label}</span>
      <span className="sub">{t('market.pull.cost', { gold: cost.gold })}</span>
    </button>
  );
}

/**
 * 「거래」의 한 칸.
 *
 * **누를 데가 없는 칸은 `<div>`, 팔리는 칸은 `<button>`이다.** 전부 버튼으로
 * 두면 잠긴 칸도 초점을 받아 「눌리는데 아무 일도 없다」가 되고, 전부 div로
 * 두면 키보드로 못 산다 — 두 뜻이 다르므로 요소도 다르다.
 */
/**
 * 장수 아이템 한 줄 — 그림 · 이름 · 효과 · 오늘 매물 · 보유 · [구매] (2026-09-23).
 *
 * **못 사는 이유는 규칙이 낸 말을 그대로 적는다** — 화면이 이유를 다시 짓지 않는다.
 * 그림은 `public/market-items/{id}.png`이고, 원본 시트가 저해상도라 작게 띄운다.
 */
function ItemRow({ item, held, stock, can, busy, onBuy }: {
  item: MarketItemData;
  held: number;
  stock: number;
  can: MetaResult;
  busy: boolean;
  onBuy: () => void;
}): React.JSX.Element {
  return (
    <div className="mkt-item" data-item={item.id} data-kind={item.kind} data-group={item.group}>
      <img className="mkt-item-art" src={`market-items/${item.id}.png`} alt="" />
      <div className="mkt-item-body">
        <span className="mkt-item-head">
          <span className="mkt-item-nm">{pickMarketItemName(item)}</span>
          {/* 패시브/액티브는 **뜻이 다른 물건**이라 이름 옆에서 갈린다 */}
          <span className="mkt-item-kind" data-kind={item.kind}>
            {t(item.kind === 'active' ? 'market.items.active' : 'market.items.passive')}
          </span>
          <span className="mkt-item-lv">{t('market.items.lv', { lv: item.unlockLevel })}</span>
        </span>
        <span className="mkt-item-fx">{pickMarketItemText(item)}</span>
        <span className="mkt-item-meta">
          <span data-field="stock">{t('market.items.stock', { n: stock })}</span>
          <span data-field="held">{t('market.items.held', { n: held })}</span>
        </span>
      </div>
      <div className="mkt-item-buy">
        <button
          className="btn sm primary"
          data-action="buyItem"
          data-item={item.id}
          disabled={busy || !can.ok}
          onClick={onBuy}
        >
          <span className="lbl">{t('market.items.buy', { gold: item.gold })}</span>
        </button>
        {/* 안 되는 이유는 **제 단추 바로 밑에** — 끝에 몰면 어느 단추 이야기인지 모른다 */}
        {!can.ok && <span className="hint" data-field="why">{reasonText(can)}</span>}
      </div>
    </div>
  );
}

function ShopTile({ icon, title, sub, disabled, hint, action, onClick }: {
  icon: string; title: string; sub: string; disabled?: boolean;
  /**
   * 잠긴 이유 — 규칙이 한 말 그대로. **글자로 적는다** (2026-09-23).
   *
   * ★ 예전에는 `title`(마우스 올림)뿐이었다 — **모바일에는 올림이 없어** 영원히
   * 안 보였고, 「눌리는데 아무 일도 없으면 「고장인가」가 남는다」에 그대로 걸린다.
   * 군량 칸이 「창고가 가득 찼다」로 자주 막히면서 드러났다.
   */
  hint?: string | undefined;
  action?: string;
  onClick?: () => void;
}): React.JSX.Element {
  const inner = (
    <>
      <img src={`market/${icon}.png`} alt="" />
      <span className="lbl">{title}</span>
      <span className="sub">{sub}</span>
      {/* 이유는 **제 칸 안에** — 끝에 몰면 어느 단추 이야기인지 모른다 */}
      {hint && <span className="mkt-tile-why" data-field="why">{hint}</span>}
    </>
  );
  if (!onClick) {
    return <div className="mkt-tile" data-disabled={disabled ? '1' : '0'}>{inner}</div>;
  }
  return (
    <button
      className="mkt-tile"
      data-disabled={disabled ? '1' : '0'}
      data-action={action}
      disabled={disabled}
      title={hint}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}

/**
 * 뽑기 결과.
 *
 * **단발만 개봉 연출을 튼다.** `reveal-{grade}.png`의 4칸 스트립을 `REVEAL_FRAME_MS`마다
 * 한 칸씩 넘기다가 끝나면 부모에 알려 `phase: 'shown'`으로 넘어간다. 10연은 카드가
 * 열 장이라 한 장씩 연출을 틀면 너무 늘어져 — 처음부터 결과만 편다(사용자 피드백을
 * 받아 바꿀 자리 1순위).
 */
function RevealModal({ reveal, onSettled, onClose }: {
  reveal: Reveal;
  onSettled: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const topGrade = reveal.drawn.length > 0 ? officerById.get(reveal.drawn[0]!)?.grade ?? 'E' : 'E';

  useEffect(() => {
    if (reveal.phase !== 'anim') return;
    const id = window.setTimeout(onSettled, REVEAL_FRAME_MS * 4);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal.phase]);

  if (reveal.phase === 'anim') {
    return (
      <div className="modal-back" data-modal="reveal">
        <RevealAnim grade={topGrade} />
      </div>
    );
  }

  return (
    <div className="modal-back" data-modal="reveal" onClick={onClose}>
      <div className="modal mkt-modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('market.reveal.title')}</p>
        <div className={`mkt-cards ${reveal.drawn.length > 1 ? 'grid' : ''}`}>
          {reveal.drawn.map((id, i) => {
            const o = officerById.get(id);
            return (
              <div key={`${id}-${i}`} className="mkt-card" data-grade={o?.grade ?? 'E'}>
                <div className="mkt-card-frame" style={{ backgroundImage: `url(market/frame-${o?.grade ?? 'E'}.png)` }}>
                  <OfficerArt officer={id} className="mkt-card-art" />
                </div>
                <span className="mkt-card-name">{o ? pickOfficerName(o) : id}</span>
              </div>
            );
          })}
        </div>
        {reveal.exhausted && <p className="note">{t('market.reveal.exhausted')}</p>}
        <button className="btn primary wide" data-action="revealClose" onClick={onClose}>
          {t('market.reveal.close')}
        </button>
      </div>
    </div>
  );
}

/** 카드 정리에서 고를 수 있는 등급. 헌제(E)는 한 명뿐이라 같은 등급 재료가 없다 */
const RECYCLE_GRADES: readonly Grade[] = ['S', 'A', 'B', 'C', 'D'];

/**
 * 카드 정리 — **등급 → 받을 장수 → 재료**를 사람이 고른다 (2026-09-14 기획자 지정).
 *
 * 판정은 전부 `canRecycle()`이 하고 **잠긴 이유도 그쪽 말 그대로** 적는다. 화면이
 * 고르는 수를 막는 것(`−`/`+`의 끝)은 편의일 뿐이고 규칙이 아니다 — 끝을 넘어도
 * `canRecycle`이 거절한다.
 */
function RecycleModal({ profile, onChange, onClose }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [grade, setGrade] = useState<Grade>('C');
  const [target, setTarget] = useState<OfficerId | null>(null);
  const [inputs, setInputs] = useState<RecycleInputs>({});
  const [done, setDone] = useState<string | null>(null);
  /** 서버 왕복 중 — [바꾸기]를 두 번 누르면 재료를 두 번 낸다 (2026-09-14, A2) */
  const [sending, setSending] = useState(false);
  /** 서버가 거절했거나 못 닿았다 — 그 말을 그대로 적는다 */
  const [note, setNote] = useState<string | null>(null);

  const targets = recycleTargets(profile, grade);
  const materials = recycleMaterials(profile, grade, target);
  const total = recycleTotal(inputs);
  const out = recycleOutput(inputs);
  const can = target ? canRecycle(profile, target, inputs) : null;

  const nameOf = (id: OfficerId): string => {
    const o = officerById.get(id);
    return o ? pickOfficerName(o) : id;
  };
  const pickGrade = (g: Grade): void => { setGrade(g); setTarget(null); setInputs({}); setDone(null); };
  const pickTarget = (id: OfficerId): void => {
    setTarget(id);
    // 받을 장수는 재료가 될 수 없다 — 이미 골라 둔 수가 있으면 뗀다
    setInputs((prev) => { const { [id]: _drop, ...rest } = prev; return rest; });
    setDone(null);
  };
  const bump = (id: OfficerId, usable: number, d: number): void => {
    setInputs((prev) => {
      const n = Math.max(0, Math.min(usable, (prev[id] ?? 0) + d));
      const next = { ...prev };
      if (n > 0) next[id] = n;
      else delete next[id];
      return next;
    });
    setDone(null);
  };
  const confirm = (): void => {
    if (!target || !can?.ok || sending) return;
    /*
     * **카드 정리는 서버가 한다** (2026-09-14, A2) — `cards`가 서버 소유라 로컬로 바꿔
     * `PUT`하면 되돌아간다. 못 닿으면 물러나지 않고 말한다(자재 구매와 같은 결).
     */
    const got = { name: nameOf(target), n: out };
    setSending(true);
    setDone(null);
    setNote(null);
    void (async () => {
      try {
        const fromServer = await recycleOnServer(target, inputs);
        if (!fromServer) { setNote(t('server.offline')); return; }
        onChange(fromServer);
        setInputs({});
        setDone(t('recycle.done', got));
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err));
      } finally {
        setSending(false);
      }
    })();
  };

  return (
    <div className="modal-back" data-modal="recycle" onClick={onClose}>
      <div className="modal rcy-modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('recycle.title')}</p>
        <p className="rcy-rule">{t('recycle.rule', { n: RECYCLE_CARDS_IN, min: RECYCLE_MIN_HELD, keep: RECYCLE_MIN_HELD - 1 })}</p>

        <div className="rcy-grades">
          {RECYCLE_GRADES.map((g) => (
            <button
              key={g}
              className={`btn sm rcy-grade${g === grade ? ' on' : ''}`}
              data-grade-pick={g}
              onClick={() => pickGrade(g)}
            >
              <GradeBadge grade={g} />
            </button>
          ))}
        </div>

        <p className="rcy-cap">{t('recycle.target')}</p>
        <div className="rcy-list" data-field="targets">
          {targets.length === 0
            ? <p className="dim">{t('recycle.targetEmpty')}</p>
            : targets.map((id) => {
              const level = profile.roster[id]?.level;
              return (
                <button
                  key={id}
                  className={`rcy-row${id === target ? ' on' : ''}`}
                  data-target={id}
                  onClick={() => pickTarget(id)}
                >
                  <span className="nm">{nameOf(id)}</span>
                  <span className="lv">{level === undefined ? t('recycle.boxed') : t('recycle.level', { n: level })}</span>
                  <span className="n">{t('recycle.held', { n: profile.cards[id] ?? 0 })}</span>
                </button>
              );
            })}
        </div>

        <p className="rcy-cap">{t('recycle.materials')}</p>
        <div className="rcy-list" data-field="materials">
          {!target
            ? <p className="dim">{t('recycle.pickTargetFirst')}</p>
            : materials.length === 0
              ? <p className="dim">{t('recycle.materialsEmpty', { min: RECYCLE_MIN_HELD })}</p>
              : materials.map((m) => {
                const use = inputs[m.officer] ?? 0;
                return (
                  <div key={m.officer} className="rcy-row" data-material={m.officer} data-use={use}>
                    <span className="nm">{nameOf(m.officer)}</span>
                    <span className="n">{t('recycle.usable', { n: m.usable })}</span>
                    <span className="rcy-step">
                      <button className="btn ghost sm" data-action="less" disabled={use === 0} onClick={() => bump(m.officer, m.usable, -1)}>−</button>
                      <b>{use}</b>
                      <button className="btn ghost sm" data-action="more" disabled={use >= m.usable} onClick={() => bump(m.officer, m.usable, 1)}>+</button>
                    </span>
                  </div>
                );
              })}
        </div>

        {target && (
          <p className="rcy-sum" data-field="summary" data-total={total} data-out={out}>
            {t('recycle.summary', { total, name: nameOf(target), n: out })}
          </p>
        )}
        {/* 규칙이 거절한 말 그대로 — 아직 아무것도 안 골랐을 때는 띄우지 않는다 */}
        {target && total > 0 && can && !can.ok && <p className="note" data-field="why">{can.reason}</p>}
        {done && <p className="note rcy-done" data-field="done">{done}</p>}
        {note && <p className="note" data-field="recycleNote">{note}</p>}

        <div className="rcy-acts">
          <button className="btn wide" data-action="recycleClose" onClick={onClose}>{t('recycle.close')}</button>
          <button className="btn primary wide" data-action="recycleConfirm" disabled={!can?.ok || sending} onClick={confirm}>
            {t('recycle.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RevealAnim({ grade }: { grade: string }): React.JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFrame((f) => Math.min(f + 1, 3)), REVEAL_FRAME_MS);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div
      className="mkt-anim"
      data-frame={frame}
      style={{
        backgroundImage: `url(market/reveal-${grade.toLowerCase()}.png)`,
        backgroundPosition: `-${frame * REVEAL_FRAME_PX}px 0`,
      }}
    />
  );
}
