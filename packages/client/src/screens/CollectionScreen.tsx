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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/** 「황건 · 반동탁 (184~192)」 — 연도가 없는 장(열전)은 이름만 (2026-10-14 지정) */
const eraText = (c: CollectionData): string => (c.eraYears ? `${c.eraLabel} (${c.eraYears})` : c.eraLabel);
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
    () => sortCollections(searchCollections(collectionRows(profile), query, (c) => c.slots.map(slotLabel)), sort),
    [profile, query, sort],
  );
  const summary = useMemo(() => collectionSummary(profile), [profile]);
  // 점수가 바뀌면(두루마리에서 마지막 칸을 채우면) 순위도 다시 묻는다
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
      {/* 라벨 그림을 줄 바탕에 워터마크로 (2026-10-14 지정) — 두루마리와 같은 그림. 아직 안 그린 컬렉션은 404 → 그냥 뺀다 */}
      {!noArt && <img className="clx-row-art" src={artUrl(c)} alt="" loading="lazy" onError={() => setNoArt(true)} />}
      {/* 등급 배지는 걷었다(2026-10-13 지정) — 무게는 점수가 말한다. 정렬도 「점수순」이다(10-14) */}
      <span className="clx-era" data-era={c.era}>{eraText(c)}</span>
      <span className="clx-row-pts">
        {row.status === 'partial' && <span className="clx-progress">{row.filled}/{row.total}</span>}
        {row.status === 'done' && <span className="clx-done-mark" aria-label={t('collection.done')}>完</span>}
        <span className="clx-pts">{t('collection.pointsN', { n: c.points })}</span>
      </span>
      <span className="clx-title">{c.displayTitle}</span>
      <span className="clx-req clx-req-cards">
        {n.card > 0 && (
          <span className="clx-req-card" title={t('collection.req.card')}>
            <img src="market/market_card.png" alt={t('collection.req.card')} /> {n.card}
          </span>
        )}
      </span>
      <span className="clx-row-desc">{c.desc}</span>
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

// ── 두루마리 (상세) ─────────────────────────────────────────────

/** 펴기(16칸) → 키우기(가운데만 세로로 늘린 다 편 두루마리) → 줄이기 → 말기(16칸 거꾸로) */
type ScrollPhase = 'unroll' | 'open' | 'shrink' | 'roll';
/** 키우고 줄이는 시간 — CSS의 `.clx-stage` `transition`과 같은 값 */
const GROW_MS = 450;
/** 라벨 그림의 세로 : 가로 (1626 × 336 — `Design/컬렉션_라벨_이미지프롬프트.md` §2) */
const ART_RATIO = 336 / 1626;
/** 워터마크 위쪽은 종이로 녹으므로(마스크 35%) 그만큼은 글 아래로 들어가도 된다 */
const ART_TUCK = 0.12;

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
  const backRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [openH, setOpenH] = useState<number | null>(null);

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
  // 다 편 높이 = 종이 안 글 · 칸의 아래 끝 + 워터마크 띠 + 위아래 손잡이 — 늘 화면 높이만큼 키우면 칸 아래가
  // 휑했다(2026-10-13 지정). 종이 안 간격은 폭(cqw) 기준이라 높이를 바꿔도 이 값이 안 흔들린다(style.css).
  // 펴는 중에도 글은 자리를 잡고 있어(투명할 뿐) 열리기 전에 잰다. 등록 완료 줄이 생기면 다시 잰다.
  useLayoutEffect(() => {
    const measure = (): void => {
      const back = backRef.current, paper = paperRef.current, body = bodyRef.current;
      const last = body?.lastElementChild as HTMLElement | null | undefined;
      if (!back || !paper || !body || !last) return;
      const content = last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(body).paddingBottom);
      const art = noArt ? 0 : paper.clientWidth * ART_RATIO * (1 - ART_TUCK);
      const w = back.clientWidth, h = back.clientHeight;
      // 위아래 손잡이 = 11.3cqw씩(`.clx-paper`의 top · bottom). +4px는 반올림 — 없으면 종이 안이 1px 굴렀다
      const want = content + art + 2 * 0.113 * w + 4;
      setOpenH(Math.ceil(Math.max(0.7516 * w, Math.min(want, 0.96 * h, 1.65 * w))));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [status, noArt]);

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
    <div
      className="clx-scroll-back"
      ref={backRef}
      data-modal="collection"
      data-phase={phase}
      style={openH ? { '--open-h': `${openH}px` } as React.CSSProperties : undefined}
      onClick={close}
    >
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
        <div className="clx-paper" ref={paperRef} data-collection={c.id} data-state={status} data-show={phase === 'open' ? '1' : '0'}>
          {!noArt && (
            <img className="clx-watermark" src={artUrl(c)} alt="" onError={() => setNoArt(true)} />
          )}
          <div className="clx-paper-body" ref={bodyRef}>
            <h2 className="clx-hanja">{c.hanja}</h2>
            {/* 한자의 읽기는 한자 밑에 작게, 큰 제목은 뜻을 푼 우리말 (2026-10-14) — 둘이 같으면 한 번만 */}
            {c.displayTitle !== c.title && <p className="clx-reading">{c.title}</p>}
            <h3 className="clx-name">{c.displayTitle}</h3>
            <p className="clx-meta">
              <span>{t('collection.pointsN', { n: c.points })}</span>
              <span>{c.eraLabel}{c.eraYears ? ` (${c.eraYears})` : ''}</span>
            </p>
            <p className="clx-lore">{c.lore}</p>
            <p className="clx-effect"><b>{t('collection.effect')}</b> {c.effectText}</p>

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
