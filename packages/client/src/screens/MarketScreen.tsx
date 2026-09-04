/**
 * 장터 — 가챠 (트랙 9, 2026-08-24 UI 1차 초안)
 *
 * ```
 * [← 장터로]                    장터
 *  금화 X   군량 Y/max   재료 Z
 * [가챠 배너]
 *  [단발 뽑기 10냥]  [10연 뽑기 90냥]
 * ─ 거래 ─
 *  카드 정리 (아직)   재설계 (궁궐에서)   금화팩 3종 (결제 연동 전)
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
 * 「거래」의 나머지 셋은 아직 살 수 없다 — 왜인지 각자 적는다
 * ────────────────────────────────────────────────────────────────
 *
 * - **카드 정리**: `economy.json`에 `recycle`(카드 10장 → 재료, 등급별 점수) 값은
 *   있지만 그걸 계정에 반영하는 meta 함수가 아직 없다 — 기획자와 교환 규칙을
 *   다시 확인하기 전에는 화면이 판정을 대신 만들지 않는다(「화면이 판정하지
 *   않는다」).
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
import {
  MATERIAL_PACK, RESPEC_GOLD, addCard, buyGacha, canAffordGacha,
  canBuyMaterials, gachaPullCost, grainCap, materialPackCost,
} from '@samchess/meta';
import type { GachaPullKind, PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { buyMaterialsOnServer } from '../meta/city.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';

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
  /** 서버 왕복 중에는 두 번 못 누른다 — 두 번 누르면 금화를 두 번 낸다 */
  const [busy, setBusy] = useState(false);
  /** 규칙이 거부한 이유. **그쪽이 한 말을 그대로 보여 준다**(`CityScreen`과 같은 결) */
  const [refused, setRefused] = useState<string | null>(null);

  const buy = (kind: GachaPullKind): void => {
    if (!canAffordGacha(profile, kind).ok) return;
    // **시드는 여기서 넣는다** — meta는 `Date.now()`를 스스로 안 읽는다(`gacha.ts`
    // 머리말과 같은 이유). 이미 `gachaPool`이 있는 계정은 `buyGacha`가 이 값을 무시한다.
    const result = buyGacha(profile, kind, Date.now());
    onChange(result.profile);
    setReveal({
      kind, drawn: result.drawn, exhausted: result.exhausted,
      phase: kind === 'single' ? 'anim' : 'shown',
    });
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
    setBusy(true);
    void (async () => {
      try {
        const fromServer = await buyMaterialsOnServer();
        if (fromServer) onChange(fromServer);
        else setRefused(t('market.buyMaterials.offline'));
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };

  const materialsCan = canBuyMaterials(profile);
  const materialsGold = materialPackCost();

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

      <div className="place-body mkt-body">
        <section className="place-panel mkt-currency">
          <CurrencyStat icon="gold" label={t('market.gold')} value={profile.gold} />
          <CurrencyStat icon="grain" label={t('market.grain')} value={`${profile.grain}/${grainCap(profile)}`} />
          <CurrencyStat icon="materials" label={t('market.materials')} value={profile.materials} />
        </section>

        <section className="place-panel mkt-gacha">
          <img className="mkt-banner" src="market/gacha-banner.jpg" alt="" data-field="banner" />
          <h2 className="cap">{t('market.gacha.title')}</h2>
          <div className="mkt-pulls">
            <GachaButton kind="single" profile={profile} onBuy={buy} />
            <GachaButton kind="ten" profile={profile} onBuy={buy} />
          </div>
        </section>

        <section className="place-panel mkt-shop">
          <h2 className="cap">{t('market.shop.title')}</h2>
          <div className="mkt-goods">
            <ShopTile
              icon="recycle"
              title={t('market.recycle')}
              sub={t('market.recycle.sub', { n: ECONOMY.recycle.cardsIn })}
              disabled
            />
            <ShopTile icon="respec-scroll" title={t('market.respec')} sub={t('market.respec.sub', { gold: RESPEC_GOLD })} disabled />
            {(['pack-small', 'pack-mid', 'pack-large'] as const).map((icon, i) => (
              <ShopTile
                key={icon}
                icon={icon}
                title={t('market.goldPack', { krw: GOLD_PACKS[i]!.krw, gold: GOLD_PACKS[i]!.gold })}
                sub={t('market.goldPack.soon')}
                disabled
              />
            ))}
            {/* 「거래」 여섯 칸의 마지막 자리 — 여기만 실제로 팔린다 (2026-09-04) */}
            <ShopTile
              icon="materials"
              action="buyMaterials"
              title={t('market.buyMaterials')}
              sub={t('market.buyMaterials.sub', { n: MATERIAL_PACK, gold: materialsGold })}
              disabled={busy || !materialsCan.ok}
              hint={materialsCan.ok ? undefined : materialsCan.reason}
              onClick={buyMaterials}
            />
          </div>
          {/* **규칙이 거부한 말을 그대로 적는다** — 화면이 이유를 다시 짓지 않는다 */}
          {refused && <p className="note" data-field="refused">{refused}</p>}
        </section>

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
            onClick={() => onChange({ ...profile, gold: profile.gold + 100 })}
          >
            금화 +100
          </button>
          <button
            className="btn ghost sm"
            data-dev="gold-respec"
            onClick={() => onChange({ ...profile, gold: profile.gold + RESPEC_GOLD })}
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
                <span style={{ flex: 1, fontSize: '.7rem' }}>[{o.grade}] {pickOfficerName(o)}</span>
                <button
                  className="btn ghost sm"
                  data-dev="cards"
                  data-officer={o.id}
                  onClick={() => onChange(addCard(profile, o.id as OfficerId, 5))}
                >
                  +5
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {reveal && (
        <RevealModal reveal={reveal} onSettled={() => setReveal((r) => (r ? { ...r, phase: 'shown' } : r))} onClose={() => setReveal(null)} />
      )}

      {/* 자재 구매만 서버 왕복이다 — 가챠는 로컬이라 기다릴 것이 없다 */}
      {busy && <BusyVeil label={t('market.buyMaterials.busy')} />}
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
function ShopTile({ icon, title, sub, disabled, hint, action, onClick }: {
  icon: string; title: string; sub: string; disabled?: boolean;
  /** 잠긴 이유 — 규칙이 한 말 그대로. 마우스를 올리면 보인다 */
  hint?: string | undefined;
  action?: string;
  onClick?: () => void;
}): React.JSX.Element {
  const inner = (
    <>
      <img src={`market/${icon}.png`} alt="" />
      <span className="lbl">{title}</span>
      <span className="sub">{sub}</span>
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
