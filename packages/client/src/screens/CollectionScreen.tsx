/**
 * 컬렉션 — 대자보 [컬렉션 보기] (2026-10-13, `Design/컬렉션_기획.md` §7).
 *
 * ```
 * ┌ 상단 판(약 1/5) — 완성 · 등록 중 · 점수 · 순위 · 넣은 것 ┐
 * ├ 검색 · [정렬 필터]                                        ┤
 * └ 목록 판(약 4/5) — 한 줄이 두 줄짜리 카드                  ┘
 *     줄을 누르면 **상세 판**(죽간 위의 종이)이 바로 뜬다 — 2026-10-14에 두루마리 펴기 연출을 걷었다
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
import type { CollectionData, CollectionSlotData } from '@samchess/data';
import {
  COLLECTION_SORTS, collectionRows, collectionStatus, collectionSummary, searchCollections, slotCounts, slotState,
  sortCollections,
} from '@samchess/meta';
import type { CollectionRankRow, CollectionRow, CollectionSort, PlayerProfile, SlotBlock } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { CityActionRejected, registerCollectionOnServer } from '../meta/city.ts';
import { fetchCollectionRanking } from '../meta/ranking.ts';
import type { CollectionRanking } from '../meta/ranking.ts';
import { playSfx } from '../audio/sfx.ts';
import { sealUrl } from '../ui/art.ts';
import { rankingBackdrop } from './backdrop.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { Pager } from './PagerButton.tsx';
import { SortMenu, stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { currentLang, t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickEquipName, pickMarketItemName, pickOfficerName } from '../i18n/story.ts';
import {
  collectionDesc, collectionHanja, collectionLore, collectionTitle, effectLine, eraText,
} from './collectionText.ts';

/** 한 쪽의 줄 수 — 줄이 두 줄짜리라 장수 일람(10)보다 적다 */
const PAGE_SIZE = 5;

const SORT_KEY: Record<CollectionSort, StringKey> = {
  era: 'collection.sort.era',
  points: 'collection.sort.points',
  reach: 'collection.sort.reach',
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

const artUrl = (c: CollectionData): string => `collections/${c.id}.jpg`;

export function CollectionScreen({ profile, onBack, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (p: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CollectionSort>('era');
  /** 한 번이라도 골랐는가 — 고르기 전엔 단추가 「정렬 필터」, 고른 뒤엔 그 기준을 단다 */
  const [sorted, setSorted] = useState(false);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  /** 서버 순위 — `undefined`는 불러오는 중, `null`은 못 불러왔다 */
  const [ranking, setRanking] = useState<CollectionRanking | null | undefined>(undefined);
  const [rankOpen, setRankOpen] = useState(false);

  // 표시 언어의 장수 · 품목 이름으로도 찾는다 — meta는 한국어 이름만 안다
  const rows = useMemo(
    () => sortCollections(searchCollections(collectionRows(profile), query,
      // 지금 언어의 제목 · 설명으로도 걸린다 — 한국어 글은 meta가 이미 본다
      (c) => [collectionTitle(c), collectionDesc(c), ...c.slots.map(slotLabel)]), sort),
    [profile, query, sort],
  );
  const summary = useMemo(() => collectionSummary(profile), [profile]);
  // 점수가 바뀌면(상세 판에서 마지막 칸을 채우면) 순위도 다시 묻는다
  useEffect(() => {
    let live = true;
    fetchCollectionRanking().then((r) => { if (live) setRanking(r); }, () => { if (live) setRanking(null); });
    return () => { live = false; };
  }, [summary.points]);
  const rankText = ranking === undefined ? '…'
    : ranking?.mine ? t('collection.sum.rankN', { n: ranking.mine.rank }) : t('collection.sum.rankNone');
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
        {/* 백버튼 · 제목 판 · [정렬 필터] 목판 · 글꼴은 장수 일람(`.scr-officers`)의 규칙을 함께 쓴다(style.css) */}
        <span className="place-nm">{t('collection.title')}</span>
      </div>

      <div className="place-body">
        {/* 상단 판 (2026-10-13 지정) — 첫 줄 왼쪽 순위 · 점수, 오른쪽 벽 [랭킹 보기] / 둘째 줄 왼쪽 넣은 것, 오른쪽 벽 완성.
            개인 값은 프로필에서 바로, 순위만 서버(`GET /ranking/collection`) — 늦으면 「…」, 못 닿으면 「—위」 */}
        <section className="place-panel clx-head" data-field="collection-summary">
          <div className="clx-head-row">
            <span className="clx-stat" data-field="rank">
              <b>{t('collection.sum.rank')}</b> {rankText}
            </span>
            <span className="clx-stat clx-points" data-field="points">
              <b>{t('collection.sum.points')}</b> {summary.points.toLocaleString()}
            </span>
            <button className="btn sm clx-rank-btn" data-action="collectionRanking" onClick={() => { playSfx('paper'); setRankOpen(true); }}>
              {t('collection.rank.view')}
            </button>
          </div>
          <div className="clx-head-row clx-invested" data-field="invested">
            <b>{t('collection.sum.invested')}</b>
            <span>
              {t('collection.sum.cards')} {invested.length ? invested.join(' · ') : '0'}
              {' · '}{t('collection.sum.weapons')} {summary.invested.weapons}
              {' · '}{t('collection.sum.items')} {summary.invested.items}
            </span>
            <span className="clx-stat clx-done-count" data-field="done">
              <b>{t('collection.sum.done')}</b> {summary.done} / {summary.total}
            </span>
          </div>
        </section>

        {/* 검색 : 정렬 = 1 : 1 한 줄 (2026-10-13 지정). 「지금 기준」 나무판을 따로 두지 않고 **단추가 그 일을 겸한다** —
            처음엔 「정렬 필터」, 한 번 고른 뒤엔 고른 기준이 단추 글자가 되고, 눌러서 또 바꾼다 */}
        <div className="rk-searchbar clx-findbar">
          <input
            className="field rk-search"
            data-field="search"
            value={query}
            placeholder={t('collection.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SortMenu
            options={COLLECTION_SORTS}
            value={sort}
            onChange={(v) => { setSort(v); setSorted(true); }}
            label={(v) => t(SORT_KEY[v])}
            {...(sorted ? { buttonLabel: t(SORT_KEY[sort]) } : {})}
          />
        </div>

        <section className="place-panel block grow clx-list" data-field="collection-list">
          <div className="clx-rows">
            {pageRows.length === 0 && <p className="clx-empty">{t('collection.empty')}</p>}
            {pageRows.map((r) => <CollectionLine key={r.collection.id} row={r} onOpen={() => {
              playSfx('paper');
              setOpenId(r.collection.id);
            }} />)}
          </div>
        </section>
        {/* 쪽 넘김은 **종이 바깥**, 판 아래에 (2026-10-14 지정 — 종이 한 장 안에는 글만 둔다). [처음]·[끝]까지 — 117개라 24쪽이다 */}
        {pageCount > 1 && <Pager page={page} pageCount={pageCount} onPage={setPage} ends field="collection-pager" />}
      </div>

      {rankOpen && (
        <CollectionRankingModal ranking={ranking} myCity={profile.cityName} onClose={() => setRankOpen(false)} />
      )}
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

/**
 * 목록 한 줄 — 세 줄짜리 (2026-10-14 지정):
 *
 * ```
 * [시대]                      점수
 * 한글 제목(큰 글씨)          요건 — 장수 카드
 * 설명(작은 글씨, 두 줄 자리)  요건 — 병기 · 아이템
 * ```
 *
 * 제목은 한자어 타이틀이 아니라 뜻을 푼 `displayTitle`이다. 설명은 한 줄 말줄임으로 두면 다국어에서 잘리는
 * 문장이 늘어 두 줄 자리를 늘 잡는다.
 * 바탕에는 그 컬렉션의 라벨 그림이 옅게 깔린다(`.clx-row-art`) — 글자는 그 위에 선다.
 */
function CollectionLine({ row, onOpen }: { row: CollectionRow; onOpen: () => void }): React.JSX.Element {
  const c = row.collection;
  const n = slotCounts(c);
  const goods = c.slots.filter((s) => s.kind !== 'card');
  const [noArt, setNoArt] = useState(false);
  return (
    <button
      className="clx-row"
      data-state={row.status}
      data-collection={c.id}
      onClick={onOpen}
    >
      {/* 라벨 그림을 줄 바탕에 워터마크로 (2026-10-14 지정) — 상세 판과 같은 그림. 아직 안 그린 컬렉션은 404 → 그냥 뺀다 */}
      {!noArt && <img className="clx-row-art" src={artUrl(c)} alt="" loading="lazy" onError={() => setNoArt(true)} />}
      {/* 등급 배지는 걷었다(2026-10-13 지정) — 무게는 점수가 말한다. 정렬도 「점수순」이다(10-14) */}
      <span className="clx-era" data-era={c.era}>{eraText(c)}</span>
      <span className="clx-row-pts">
        {row.status === 'partial' && <span className="clx-progress">{row.filled}/{row.total}</span>}
        {row.status === 'done' && <span className="clx-done-mark" aria-label={t('collection.done')}>完</span>}
        <span className="clx-pts">{t('collection.pointsN', { n: c.points })}</span>
      </span>
      <span className="clx-title">{collectionTitle(c)}</span>
      <span className="clx-req clx-req-cards">
        {n.card > 0 && (
          <span className="clx-req-card" title={t('collection.req.card')}>
            <img src="market/market_card.png" alt={t('collection.req.card')} /> {n.card}
          </span>
        )}
      </span>
      <span className="clx-row-desc">{collectionDesc(c)}</span>
      <span className="clx-req clx-req-goods">
        {goods.map((s, i) => (
          <img key={i} className="clx-req-good" data-kind={s.kind} src={slotImage(s)} alt={slotLabel(s)} title={slotLabel(s)} />
        ))}
      </span>
    </button>
  );
}

/**
 * [랭킹 보기] — 서버 1~10등 (2026-10-13 지정). 판은 목록과 같은 양피지 장부. 내 도시가 열 안에 있으면 그 줄을
 * 물들이고, 밖이면 줄 하나를 띄운 뒤 맨 아래에 내 줄을 덧붙인다. 아직 완성한 것이 없으면 내 줄은 안 선다.
 */
function CollectionRankingModal({ ranking, myCity, onClose }: {
  ranking: CollectionRanking | null | undefined;
  myCity: string;
  onClose: () => void;
}): React.JSX.Element {
  const line = (r: CollectionRankRow, key: string) => (
    <div key={key} className="clx-rank-row" data-rank={r.rank} data-mine={r.cityName === myCity ? '1' : '0'}>
      <span className="c-rk">{r.rank}</span>
      <span className="c-city">{r.cityName}</span>
      <span className="c-done">{r.done}</span>
      <span className="c-pts">{r.points.toLocaleString()}</span>
    </div>
  );
  const mineOutside = ranking?.mine && !ranking.top.some((r) => r.cityName === myCity) ? ranking.mine : null;
  return (
    <div className="modal-back clx-rank-back" onClick={onClose}>
      <section className="place-panel clx-rank" data-modal="collection-ranking" onClick={(e) => e.stopPropagation()}>
        <div className="clx-rank-titlerow">
          <span className="clx-rank-title">{t('collection.rank.title')}</span>
          <button className="ofcard-close" data-action="closeCollectionRanking" onClick={onClose} aria-label={t('ranking.card.close')}>
            <img className="ofcard-close-icon" src="icons/close.png" alt="" />
          </button>
        </div>
        <div className="clx-rank-row clx-rank-head">
          <span className="c-rk">{t('collection.rank.col.rank')}</span>
          <span className="c-city">{t('collection.rank.col.city')}</span>
          <span className="c-done">{t('collection.rank.col.done')}</span>
          <span className="c-pts">{t('collection.rank.col.points')}</span>
        </div>
        {ranking === undefined && <p className="clx-rank-note">{t('ranking.loading')}</p>}
        {ranking === null && <p className="clx-rank-note">{t('server.offline')}</p>}
        {ranking && ranking.top.length === 0 && <p className="clx-rank-note">{t('collection.rank.empty')}</p>}
        {ranking && ranking.top.map((r) => line(r, r.cityName))}
        {mineOutside && <div className="clx-rank-gap">⋮</div>}
        {mineOutside && line(mineOutside, 'mine')}
      </section>
    </div>
  );
}

// ── 상세 판 ─────────────────────────────────────────────────────

/**
 * 상세 — **죽간 위에 얹은 종이 한 장**이 바로 뜬다 (2026-10-14 기획자 지정 — 두루마리 펴기 · 말기 연출을 걷었다).
 * 판은 `ui/panel-detail-bamboo.png`를 9분할로 깔아 **높이를 내용에 맞춘다**(대쪽이 세로라 위아래로 늘려도 티가 안 난다).
 * 라벨 그림은 종이 하단에 **워터마크처럼** 옅게 깔리고(기획자 지정), 마지막 칸을 채운 순간 낙관이 「꾹」 찍힌다.
 */
function CollectionScroll({ collection: c, profile, onChange, onClose }: {
  collection: CollectionData;
  profile: PlayerProfile;
  onChange: (p: PlayerProfile) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stamped, setStamped] = useState(false);
  const [noArt, setNoArt] = useState(false);

  const status = collectionStatus(profile, c);
  const wasDone = useRef(status === 'done');

  // 마지막 칸을 채운 순간에만 도장이 「꾹」 찍힌다 — 이미 완성된 것을 열 때는 그냥 찍혀 있다
  useEffect(() => {
    if (status === 'done' && !wasDone.current) { setStamped(true); wasDone.current = true; }
  }, [status]);

  const close = (): void => {
    if (busy) return;
    setAsking(null);
    playSfx('paper');
    onClose();
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
    <div className="clx-detail-back" data-modal="collection" onClick={close}>
      {/* `data-lang` — 큰 한자를 그 언어의 한자 글꼴로(간체 글자는 한국 글꼴에 없다), 고유기술 연출(`.fx-root`)과 같은 방식 */}
      <div className="clx-detail" data-lang={currentLang()} onClick={(e) => e.stopPropagation()}>
        {/* `data-show`는 늘 1이다 — 펴는 연출이 있던 때의 속성을 스모크가 기다린다 */}
        <div className="clx-paper" data-collection={c.id} data-state={status} data-show="1">
          <div className="clx-paper-body">
            {/* 머리 = 한자 · 제목(점수) · 시대, 그 뒤에 라벨 그림이 깔린다 (2026-10-14 지정 — 하단 워터마크를 위로 올렸다).
                한자 읽기 줄(「손견과 전국옥새」)은 걷었다 */}
            <header className="clx-hero" data-art={noArt ? '0' : '1'}>
              {!noArt && (
                <img className="clx-watermark" src={artUrl(c)} alt="" onError={() => setNoArt(true)} />
              )}
              <h2 className="clx-hanja">{collectionHanja(c)}</h2>
              {/* 중국어권은 제목이 한자 성어 그대로인 것이 많다(간체 14 · 번체 9) — 큰 한자와 같으면 제목 줄 없이 점수만 */}
              {collectionTitle(c) !== collectionHanja(c)
                ? <h3 className="clx-name">{collectionTitle(c)} <small className="clx-name-pts">({t('collection.pointsN', { n: c.points })})</small></h3>
                : <p className="clx-meta">({t('collection.pointsN', { n: c.points })})</p>}
              <p className="clx-meta">{eraText(c)}</p>
            </header>
            <p className="clx-lore">{collectionLore(c)}</p>
            <p className="clx-effect"><b>{t('collection.effect')}</b> {effectLine(c)}</p>

            {/* 상세에서는 목록의 설명(`c.desc`)을 다시 안 적는다 — 상세 설명이 그 자리다 */}
            <h4 className="clx-slots-title">{t('collection.slots.title')}</h4>
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
                    title={st.state === 'blocked' ? t(BLOCK_KEY[st.reason!])
                      : st.state === 'ready' ? t(s.kind === 'card' ? 'collection.slot.spare' : 'collection.slot.have', { n: st.have })
                      : t('collection.slot.done')}
                    onClick={(e) => { e.stopPropagation(); setError(null); setAsking(i); }}
                  >
                    <span className="clx-slot-art">
                      {s.kind === 'card'
                        ? <OfficerArt officer={s.id} className="clx-slot-img" primary="portrait" />
                        : <img className="clx-slot-img" src={slotImage(s)} alt="" />}
                      {st.state === 'done' && <span className="clx-slot-done">完</span>}
                    </span>
                    {/* 칸 아래 설명 줄은 걷었다(기획자 지정) — 상태는 칸의 모습(회색 · 노란 네온 · 등록됨)이
                        말하고, 이유 · 여분 수는 `title`과 등록 확인창이 말한다 */}
                    <span className="clx-slot-name">{slotLabel(s)}</span>
                  </button>
                );
              })}
            </div>

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
