/**
 * 대장간 — 제조 · 지급 관리 (트랙 11h 이어서, 2026-09-09).
 *
 * ────────────────────────────────────────────────────────────────
 * 제조는 서버가, 지급은 화면이 판정한다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 금화를 내고 아이템(`forgeOrder`·`forgeOwned`의 키)을 받는 거래라
 * `MarketScreen`의 건축 자재 구매와 같은 결로 **서버가 판정한다**
 * (`startForgeOrderOnServer`/`cancelForgeOrderOnServer`, `../meta/city.ts`).
 * **못 닿으면 로컬로 물러나지 않는다** — 물러나면 금화만 사라진다.
 *
 * 반대로 **지급/해제는 총량을 바꾸지 않으므로**(이미 만든 것을 이 장수 저
 * 장수로 옮길 뿐) 다른 메타 화면처럼 `equipOfficer`/`unequipOfficer`를 로컬로
 * 불러 `onChange`(→ `App.tsx`의 `setProfile` → 자동 `PUT`)로 반영한다.
 *
 * ────────────────────────────────────────────────────────────────
 * 셋으로 나뉜 화면
 * ────────────────────────────────────────────────────────────────
 *
 * 홈(요약 + 버튼 둘) · 제조(목록 또는 「제작 중」) · 지급 관리(보유 목록).
 * `MarketScreen`처럼 한 파일 안에서 서브 컴포넌트로 가른다 — 새 `Screen` 변형을
 * 늘리지 않는다(뒤로가기가 전부 `BuildingScreen`의 「산 너머로」 하나로 간다).
 */

import { useEffect, useState } from 'react';
import { equipmentById, officerById } from '@samchess/data';
import type { EquipmentData } from '@samchess/data';
import {
  craftDurationMs, craftableEquipment, equipOfficer, equippedBy, forgeLevel, forgeOrderRemainingMs,
  forgeSummary, unequipOfficer,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { CityActionRejected, cancelForgeOrderOnServer, startForgeOrderOnServer } from '../meta/city.ts';
import { currentSession } from '../meta/auth.ts';
import { pickOfficerName, pickOfficerNameById } from '../i18n/story.ts';
import { buildingBackdrop } from './backdrop.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

type View = 'home' | 'craft' | 'assign';

/** 남은 시간을 `{d}일 {h}시간`류 한 줄로 — 표시 전용, 판정에 안 쓴다 */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return t('forge.time.d', { d, h });
  if (h > 0) return t('forge.time.h', { h, m });
  if (m > 0) return t('forge.time.m', { m, s });
  return t('forge.time.s', { s });
}

export function ForgeScreen({ profile, onBack, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const [view, setView] = useState<View>('home');
  const [detail, setDetail] = useState<EquipmentData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignPicking, setAssignPicking] = useState<string | null>(null);
  /** 1초마다 다시 그린다 — 「제작 중」 남은 시간이 화면에서 살아 있게. 판정엔 안 쓴다 */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!profile.forgeOrder) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [profile.forgeOrder]);

  const summary = forgeSummary(profile);
  const order = profile.forgeOrder;
  const orderItem = order ? equipmentById.get(order.equipmentId) : undefined;

  const start = (item: EquipmentData): void => {
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const next = await startForgeOrderOnServer(item.id);
        if (next) { onChange(next); setDetail(null); }
        else setError(t('forge.offline'));
      } catch (e) {
        setError(e instanceof CityActionRejected ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const cancel = (): void => {
    if (!orderItem) return;
    if (!window.confirm(t('forge.craft.cancelConfirm', { gold: orderItem.gold }))) return;
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const next = await cancelForgeOrderOnServer();
        if (next) onChange(next);
        else setError(t('forge.offline'));
      } catch (e) {
        setError(e instanceof CityActionRejected ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScreenChrome
      backdrop={buildingBackdrop('forge')}
      className="scr-place scr-building-forge"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button
          className="btn ghost sm"
          data-action="back"
          onClick={() => (view === 'home' ? onBack() : setView('home'))}
        >
          {t(view === 'home' ? 'place.back' : 'forge.backHome')}
        </button>
        <span className="place-nm">{t('place.forge')}</span>
      </div>

      <div className="place-body">
        {view === 'home' && (
          <section className="place-panel frg-home">
            <div className="frg-summary">
              <span>{t('forge.summary.owned', { n: summary.owned })}</span>
              <span>{t('forge.summary.assigned', { n: summary.assigned })}</span>
              <span>{t('forge.summary.spare', { n: summary.spare })}</span>
            </div>
            {order && orderItem && (
              <p className="hint" data-field="orderStatus">
                {t('forge.order.inProgress', {
                  name: orderItem.name, time: formatRemaining(forgeOrderRemainingMs(order, now)),
                })}
              </p>
            )}
            <div className="frg-buttons">
              <button className="btn primary" data-action="craft" onClick={() => setView('craft')}>
                {t('forge.craft')}
              </button>
              <button className="btn" data-action="assign" onClick={() => setView('assign')}>
                {t('forge.assign')}
              </button>
            </div>
          </section>
        )}

        {view === 'craft' && (
          <section className="place-panel frg-craft">
            <h2 className="cap">{t('forge.craft')}</h2>
            {order && orderItem ? (
              <div className="frg-inProgress" data-field="inProgress">
                <p className="frg-inProgress-name">{orderItem.name}</p>
                <p className="hint">{t('forge.craft.remaining', { time: formatRemaining(forgeOrderRemainingMs(order, now)) })}</p>
                <button className="btn ghost" data-action="cancelOrder" onClick={cancel} disabled={busy}>
                  {t('forge.craft.cancel')}
                </button>
              </div>
            ) : craftableEquipment(profile).length === 0 ? (
              <p className="hint">{t('forge.craft.empty', { level: forgeLevel(profile) })}</p>
            ) : (
              <div className="frg-list">
                {craftableEquipment(profile).map((item) => (
                  <button
                    key={item.id}
                    className="frg-tile"
                    data-item={item.id}
                    onClick={() => setDetail(item)}
                  >
                    <img src={`blacksmith/${item.id}.png`} alt="" />
                    <span className="lbl">{item.name}</span>
                    <span className="sub">{t('forge.detail.price', { gold: item.gold })}</span>
                  </button>
                ))}
              </div>
            )}
            {error && <p className="note" data-field="error">{error}</p>}
          </section>
        )}

        {view === 'assign' && (
          <section className="place-panel frg-assign">
            <h2 className="cap">{t('forge.assign')}</h2>
            {Object.keys(profile.forgeOwned).length === 0 ? (
              <p className="hint">{t('forge.assign.empty')}</p>
            ) : (
              <div className="frg-rows">
                {Object.entries(profile.forgeOwned).map(([id, holder]) => {
                  const item = equipmentById.get(id);
                  if (!item) return null;
                  return (
                    <div className="frg-row" key={id} data-item={id} data-assigned={holder ? '1' : '0'}>
                      <img src={`blacksmith/${id}.png`} alt="" />
                      <span className="lbl">{item.name}</span>
                      {holder ? (
                        <>
                          <span className="frg-row-holder">{pickOfficerNameById(holder, holder)}</span>
                          <button
                            className="btn ghost sm"
                            data-action="revoke"
                            onClick={() => onChange(unequipOfficer(profile, id))}
                          >
                            {t('forge.assign.revoke')}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="frg-row-holder dim">{t('forge.assign.unassigned')}</span>
                          <button className="btn ghost sm" data-action="give" onClick={() => setAssignPicking(id)}>
                            {t('forge.assign.give')}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {detail && (
        <DetailModal
          item={detail}
          gold={profile.gold}
          onStart={() => start(detail)}
          onClose={() => setDetail(null)}
        />
      )}

      {assignPicking && (
        <OfficerPickModal
          profile={profile}
          equipmentId={assignPicking}
          onPick={(officer) => { onChange(equipOfficer(profile, assignPicking, officer)); setAssignPicking(null); }}
          onClose={() => setAssignPicking(null)}
        />
      )}

      {busy && <BusyVeil />}
    </ScreenChrome>
  );
}

function DetailModal({ item, gold, onStart, onClose }: {
  item: EquipmentData;
  gold: number;
  onStart: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const lang = useLang();
  const lore = item.loreI18n?.[lang] ?? item.lore;
  const canAfford = gold >= item.gold;
  return (
    <div className="modal-back" data-modal="forgeDetail" onClick={onClose}>
      <div className="modal frg-detail" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{item.name}</p>
        <img src={`blacksmith/${item.id}.png`} alt="" className="frg-detail-art" />
        <p className="frg-detail-effect">{item.text}</p>
        <p className="frg-detail-lore">{lore}</p>
        <p className="frg-detail-price">{t('forge.detail.price', { gold: item.gold })}</p>
        <button
          className="btn primary wide"
          data-action="startOrder"
          disabled={!canAfford}
          title={canAfford ? undefined : t('forge.detail.notEnough', { have: gold, need: item.gold })}
          onClick={onStart}
        >
          {t('forge.detail.start', { weeks: item.unlockLevel })}
        </button>
        <button className="btn ghost" data-action="closeDetail" onClick={onClose}>
          {t('forge.detail.close')}
        </button>
      </div>
    </div>
  );
}

function OfficerPickModal({ profile, equipmentId, onPick, onClose }: {
  profile: PlayerProfile;
  equipmentId: string;
  onPick: (officer: OfficerId) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = (Object.keys(profile.roster) as OfficerId[])
    .map((id) => {
      const o = officerById.get(id);
      return { id, name: o ? pickOfficerName(o) : id };
    })
    .filter((r) => !q || r.name.toLowerCase().includes(q));

  return (
    <div className="modal-back" data-modal="forgeAssignPick" onClick={onClose}>
      <div className="modal frg-pick" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('forge.assign.pick.title')}</p>
        <input
          className="field"
          type="text"
          placeholder={t('forge.assign.pick.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="frg-pick-rows">
          {rows.map((r) => {
            const held = equippedBy(profile, r.id);
            return (
              <button key={r.id} className="frg-pick-row" data-officer={r.id} onClick={() => onPick(r.id)}>
                <span className="lbl">{r.name}</span>
                {held && held.id !== equipmentId && (
                  <span className="sub">{t('forge.assign.pick.swapHint', { item: held.name })}</span>
                )}
              </button>
            );
          })}
        </div>
        <button className="btn ghost" data-action="closePick" onClick={onClose}>
          {t('forge.detail.close')}
        </button>
      </div>
    </div>
  );
}
