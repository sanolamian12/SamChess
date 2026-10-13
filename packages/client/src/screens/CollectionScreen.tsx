/**
 * 컬렉션 — 대자보 [컬렉션 보기] (2026-10-13, `Design/컬렉션_기획.md` §7).
 *
 * ```
 * ┌ 상단 판(약 1/5) — 완성 · 등록 중 · 점수 · 순위 · 넣은 것 ┐
 * ├ 검색 · [정렬 필터]                                        ┤
 * └ 목록 판(약 4/5) — 한 줄이 두 줄짜리 카드                  ┘
 *     줄을 누르면 **두루마리**가 펴진다(고유기술 연출과 같은 그림 · 16칸)
 * ```
 *
 * 화면은 **그리기만** 한다 — 상태 · 칸 판정 · 정렬 · 검색 · 요약은 전부 `@samchess/meta`의
 * `collection.ts`이고, 등록은 서버(`POST /collection/register`)다. 칸 · 비용 · 등급은 엑셀에서
 * 추출기가 다시 잰 `COLLECTIONS`를 그대로 읽는다.
 *
 * 스모크가 거는 속성: 목록 줄 `data-state="none | partial | done"`, 홀더
 * `data-slot-state="done | ready | blocked"` — 글자가 아니라 속성으로 건다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { COLLECTIONS, equipmentById, marketItemById, officerById } from '@samchess/data';
import type { CollectionData, CollectionSlotData, CollectionTier } from '@samchess/data';
import {
  COLLECTION_SORTS, collectionRows, collectionStatus, collectionSummary, searchCollections, slotCounts, slotState,
  sortCollections,
} from '@samchess/meta';
import type { CollectionRow, CollectionSort, PlayerProfile, SlotBlock } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { CityActionRejected, registerCollectionOnServer } from '../meta/city.ts';
import { playSfx } from '../audio/sfx.ts';
import { scrollSheetUrl, sealUrl } from '../ui/art.ts';
import { SCROLL_FRAMES, SCROLL_FRAME_MS } from '../ui/skillFx.ts';
import { rankingBackdrop } from './backdrop.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { Pager } from './PagerButton.tsx';
import { SortMenu, stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickEquipName, pickMarketItemName, pickOfficerName } from '../i18n/story.ts';

/** 한 쪽의 줄 수 — 줄이 두 줄짜리라 장수 일람(10)보다 적다 */
const PAGE_SIZE = 6;

const SORT_KEY: Record<CollectionSort, StringKey> = {
  era: 'collection.sort.era',
  tier: 'collection.sort.tier',
  reach: 'collection.sort.reach',
};
const TIER_KEY: Record<CollectionTier, StringKey> = {
  common: 'collection.tier.common',
  rare: 'collection.tier.rare',
  epic: 'collection.tier.epic',
  legend: 'collection.tier.legend',
  realm: 'collection.tier.realm',
};
const BLOCK_KEY: Record<SlotBlock, StringKey> = {
  noSpare: 'collection.slot.noSpare',
  notOwned: 'collection.slot.notOwned',
  equipped: 'collection.slot.equipped',
  carried: 'collection.slot.carried',
};

/** 칸의 표시 이름 — 장수 · 병기 · 아이템 */
function slotLabel(slot: CollectionSlotData): string {
  if (slot.kind === 'card') {
    const o = officerById.get(slot.id);
    return o ? pickOfficerName(o) : slot.id;
  }
  if (slot.kind === 'weapon') {
    const e = equipmentById.get(slot.id);
    return e ? pickEquipName(e) : slot.id;
  }
  const m = marketItemById.get(slot.id);
  return m ? pickMarketItemName(m) : slot.id;
}

const slotImage = (slot: CollectionSlotData): string =>
  slot.kind === 'weapon' ? `blacksmith/${slot.id}.png` : `market-items/${slot.id}.png`;

const eraText = (c: CollectionData): string => c.eraLabel;
const artUrl = (c: CollectionData): string => `collections/${c.id}.jpg`;

export function CollectionScreen({ profile, onBack, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (p: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CollectionSort>('era');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  // 표시 언어의 장수 · 품목 이름으로도 찾는다 — meta는 한국어 이름만 안다
  const rows = useMemo(
    () => sortCollections(searchCollections(collectionRows(profile), query, (c) => c.slots.map(slotLabel)), sort),
    [profile, query, sort],
  );
  const summary = useMemo(() => collectionSummary(profile), [profile]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => { setPage(0); }, [query, sort]);
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const open = openId ? COLLECTIONS.find((c) => c.id === openId) ?? null : null;

  const invested = (['S', 'A', 'B', 'C', 'D', 'E'] as const)
    .filter((g) => summary.invested.cards[g])
    .map((g) => `${g} ${summary.invested.cards[g]}`);

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-collection"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="collection">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{stripBackArrow(t('board.back'))}</button>
        <span className="place-nm">{t('collection.title')}</span>
      </div>

      <div className="place-body">
        {/* 상단 판 — 개인 값은 프로필에서 바로, 순위만 서버(아직 안 붙었다 — 「—위」) */}
        <section className="place-panel clx-head" data-field="collection-summary">
          <div className="clx-head-row">
            <span className="clx-stat" data-field="done">
              <b>{t('collection.sum.done')}</b> {summary.done} / {summary.total}
            </span>
            <span className="clx-stat" data-field="partial">
              <b>{t('collection.sum.partial')}</b> {summary.partial}
            </span>
            <span className="clx-stat clx-points" data-field="points">
              <b>{t('collection.sum.points')}</b> {summary.points.toLocaleString()}
            </span>
            <span className="clx-stat" data-field="rank">
              <b>{t('collection.sum.rank')}</b> {t('collection.sum.rankNone')}
            </span>
          </div>
          <div className="clx-head-row clx-invested" data-field="invested">
            <b>{t('collection.sum.invested')}</b>
            <span>
              {t('collection.sum.cards')} {invested.length ? invested.join(' · ') : '0'}
              {' · '}{t('collection.sum.weapons')} {summary.invested.weapons}
              {' · '}{t('collection.sum.items')} {summary.invested.items}
            </span>
          </div>
        </section>

        <input
          className="field rk-search"
          data-field="search"
          value={query}
          placeholder={t('collection.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ofc-sortrow">
          <span className="ofc-sort-current">{t(SORT_KEY[sort])}</span>
          <SortMenu options={COLLECTION_SORTS} value={sort} onChange={setSort} label={(v) => t(SORT_KEY[v])} />
        </div>

        <section className="place-panel block grow clx-list" data-field="collection-list">
          {pageRows.length === 0 && <p className="clx-empty">{t('collection.empty')}</p>}
          {pageRows.map((r) => <CollectionLine key={r.collection.id} row={r} onOpen={() => {
            playSfx('paper');
            setOpenId(r.collection.id);
          }} />)}
        </section>
        {pageCount > 1 && <Pager page={page} pageCount={pageCount} onPage={setPage} field="collection-pager" />}
      </div>

      {open && (
        <CollectionScroll
          key={open.id}
          collection={open}
          profile={profile}
          onChange={onChange}
          onClose={() => setOpenId(null)}
        />
      )}
    </ScreenChrome>
  );
}

/** 목록 한 줄 — 첫 줄 [시대] [등급] [타이틀] [요건], 둘째 줄 설명 */
function CollectionLine({ row, onOpen }: { row: CollectionRow; onOpen: () => void }): React.JSX.Element {
  const c = row.collection;
  const n = slotCounts(c);
  const goods = c.slots.filter((s) => s.kind !== 'card');
  return (
    <button
      className="clx-row"
      data-state={row.status}
      data-collection={c.id}
      onClick={onOpen}
    >
      <span className="clx-row-top">
        <span className="clx-era" data-era={c.era}>{eraText(c)}</span>
        <span className="clx-tier" data-tier={c.tier}>{t(TIER_KEY[c.tier])}</span>
        <span className="clx-title">{c.title}</span>
        <span className="clx-req">
          {n.card > 0 && (
            <span className="clx-req-card" title={t('collection.req.card')}>
              <img src="icons/tab-officer.png" alt={t('collection.req.card')} />×{n.card}
            </span>
          )}
          {goods.map((s, i) => (
            <img key={i} className="clx-req-good" data-kind={s.kind} src={slotImage(s)} alt={slotLabel(s)} title={slotLabel(s)} />
          ))}
          {row.status === 'partial' && <span className="clx-progress">{row.filled}/{row.total}</span>}
          {row.status === 'done' && <span className="clx-done-mark" aria-label={t('collection.done')}>完</span>}
        </span>
      </span>
      <span className="clx-row-desc">{c.desc}</span>
    </button>
  );
}

// ── 두루마리 (상세) ─────────────────────────────────────────────

/** 펴기(16칸) → 키우기(가운데만 세로로 늘린 다 편 두루마리) → 줄이기 → 말기(16칸 거꾸로) */
type ScrollPhase = 'unroll' | 'open' | 'shrink' | 'roll';
/** 키우고 줄이는 시간 — CSS의 `.clx-stage` `transition`과 같은 값 */
const GROW_MS = 450;

/**
 * 상세 — 고유기술 연출의 두루마리(`skills/scroll.webp` 16칸)를 편다(1.6초). 다 펴지면 **세로로 키운다** —
 * 원래 비율(479:360)로는 종이에 글 · 홀더가 다 안 들어가서, 다 편 칸(`collections/_scroll.png`)을
 * 위 · 아래 손잡이는 그대로 두고 가운데만 늘리는 3분할로 바꿔 낀다. 흰 종이 위에 글이 차례로 떠오르고,
 * 라벨 그림은 종이 하단에 **워터마크처럼** 옅게 깔린다(기획자 지정). 닫으면 줄인 뒤 거꾸로 말린다.
 * 펴는 중에 누르면 건너뛴다.
 */
function CollectionScroll({ collection: c, profile, onChange, onClose }: {
  collection: CollectionData;
  profile: PlayerProfile;
  onChange: (p: PlayerProfile) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [frame, setFrame] = useState(1);
  const [phase, setPhase] = useState<ScrollPhase>('unroll');
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stamped, setStamped] = useState(false);
  const [noArt, setNoArt] = useState(false);
  const timer = useRef<number | null>(null);

  const status = collectionStatus(profile, c);
  const wasDone = useRef(status === 'done');

  // 칸 번호는 ref로 센다 — 상태 갱신 함수(`setFrame(f => …)`) 안에서 「다 폈다」를 부르면 그 안에서
  // 부모의 상태(`onClose`)까지 바뀌어 React가 「렌더 중에 다른 컴포넌트를 갱신했다」고 경고한다
  const at = useRef(1);
  const run = (dir: 1 | -1, done: () => void): void => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const next = at.current + dir;
      if (next < 1 || next > SCROLL_FRAMES) {
        window.clearInterval(timer.current!);
        timer.current = null;
        done();
        return;
      }
      at.current = next;
      setFrame(next);
    }, SCROLL_FRAME_MS);
  };
  useEffect(() => {
    run(1, () => setPhase('open'));
    return () => { if (timer.current !== null) window.clearInterval(timer.current); };
  }, []);
  // 마지막 칸을 채운 순간에만 도장이 「꾹」 찍힌다 — 이미 완성된 것을 열 때는 그냥 찍혀 있다
  useEffect(() => {
    if (status === 'done' && !wasDone.current) { setStamped(true); wasDone.current = true; }
  }, [status]);

  const close = (): void => {
    if (phase === 'shrink' || phase === 'roll' || busy) return;
    setAsking(null);
    playSfx('paper');
    if (phase === 'unroll') { setPhase('roll'); run(-1, onClose); return; }
    setPhase('shrink');
    window.setTimeout(() => { setPhase('roll'); run(-1, onClose); }, GROW_MS);
  };
  const skip = (): void => {
    if (phase !== 'unroll') return;
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    at.current = SCROLL_FRAMES;
    setFrame(SCROLL_FRAMES);
    setPhase('open');
  };

  const register = (index: number): void => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const next = await registerCollectionOnServer(c.id, index);
        if (next) { onChange(next); playSfx('select_confirm'); setAsking(null); } else setError(t('server.offline'));
      } catch (e) {
        setError(e instanceof CityActionRejected ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const asked = asking !== null ? c.slots[asking]! : null;
  const askedState = asking !== null ? slotState(profile, c, asking) : null;

  return (
    <div className="clx-scroll-back" data-modal="collection" data-phase={phase} onClick={close}>
      <div className="clx-stage" onClick={(e) => { e.stopPropagation(); skip(); }}>
        <div className="clx-scroll-open" />
        <div
          className="clx-scroll"
          style={{
            backgroundImage: `url(${scrollSheetUrl})`,
            backgroundPositionX: `${((frame - 1) / (SCROLL_FRAMES - 1)) * 100}%`,
          }}
          data-frame={frame}
        />
        <div className="clx-paper" data-collection={c.id} data-state={status} data-show={phase === 'open' ? '1' : '0'}>
          {!noArt && (
            <img className="clx-watermark" src={artUrl(c)} alt="" onError={() => setNoArt(true)} />
          )}
          <div className="clx-paper-body">
            <h2 className="clx-hanja">{c.hanja}</h2>
            <h3 className="clx-name">{c.title}</h3>
            <p className="clx-meta">
              <span className="clx-tier" data-tier={c.tier}>{t(TIER_KEY[c.tier])}</span>
              <span>{t('collection.pointsN', { n: c.points })}</span>
              <span>{c.eraLabel}{c.eraYears ? ` (${c.eraYears})` : ''}</span>
            </p>
            <p className="clx-lore">{c.lore}</p>

            <div className="clx-slots">
              {c.slots.map((s, i) => {
                const st = slotState(profile, c, i);
                return (
                  <button
                    key={i}
                    className="clx-slot"
                    data-slot-state={st.state}
                    data-kind={s.kind}
                    data-slot={i}
                    disabled={st.state !== 'ready' || busy}
                    title={st.state === 'blocked' ? t(BLOCK_KEY[st.reason!]) : undefined}
                    onClick={(e) => { e.stopPropagation(); setError(null); setAsking(i); }}
                  >
                    <span className="clx-slot-art">
                      {s.kind === 'card'
                        ? <OfficerArt officer={s.id} className="clx-slot-img" primary="portrait" />
                        : <img className="clx-slot-img" src={slotImage(s)} alt="" />}
                      {st.state === 'done' && <span className="clx-slot-done">完</span>}
                    </span>
                    <span className="clx-slot-name">{slotLabel(s)}</span>
                    <span className="clx-slot-sub">
                      {st.state === 'done' ? t('collection.slot.done')
                        : st.state === 'ready' ? t(s.kind === 'card' ? 'collection.slot.spare' : 'collection.slot.have', { n: st.have })
                        : t(BLOCK_KEY[st.reason!])}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="clx-effect"><b>{t('collection.effect')}</b> {c.effectText}</p>
            <p className="clx-desc">{c.desc}</p>
            {status === 'done' && (
              <p className="clx-complete" data-field="complete">{t('collection.done')}</p>
            )}
          </div>
          {status === 'done' && (
            <img className="clx-seal" data-stamp={stamped ? '1' : '0'} src={sealUrl} alt="" />
          )}
        </div>
        <button className="clx-close" data-action="closeCollection" onClick={(e) => { e.stopPropagation(); close(); }}
          aria-label={t('ranking.card.close')}>
          <img src="icons/close.png" alt="" />
        </button>
      </div>

      {asked && askedState && (
        <div className="modal-back clx-ask-back" onClick={(e) => { e.stopPropagation(); if (!busy) setAsking(null); }}>
          <div className="modal clx-ask" data-modal="collection-register" onClick={(e) => e.stopPropagation()}>
            <p className="clx-ask-q">{t('collection.ask.title')}</p>
            <p className="clx-ask-what">
              {asked.kind === 'card'
                ? t('collection.ask.card', { name: slotLabel(asked), from: askedState.have, to: askedState.have - 1 })
                : t('collection.ask.good', { name: slotLabel(asked), from: askedState.have, to: askedState.have - 1 })}
            </p>
            <p className="clx-ask-warn">{t('collection.ask.final')}</p>
            {error && <p className="clx-ask-err">{error}</p>}
            <div className="clx-ask-btns">
              <button className="btn" data-action="cancelRegister" disabled={busy} onClick={() => setAsking(null)}>
                {t('collection.ask.no')}
              </button>
              <button className="btn primary" data-action="confirmRegister" disabled={busy} onClick={() => register(asking!)}>
                {t('collection.ask.yes')}
              </button>
            </div>
          </div>
        </div>
      )}
      {busy && <BusyVeil label={t('collection.busy')} />}
    </div>
  );
}
