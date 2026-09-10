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

import { useEffect, useMemo, useState } from 'react';
import { buildingById, equipmentById } from '@samchess/data';
import type { EquipmentData, EquipmentKind } from '@samchess/data';
import {
  craftableEquipment, equipOfficer, equippedBy, forgeLevel, forgeOrderRemainingMs, forgeSummary,
  syncCity, unequipOfficer,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { CityActionRejected, cancelForgeOrderOnServer, startForgeOrderOnServer } from '../meta/city.ts';
import { currentSession } from '../meta/auth.ts';
import {
  pickEquipLore, pickEquipName, pickEquipText, pickOfficerNameById,
} from '../i18n/story.ts';
import { buildingBackdrop } from './backdrop.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { OfficerListScreen } from './OfficerListScreen.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

type View = 'home' | 'craft' | 'assign';

/** 표시 전용 표기 — `Lv{해금 레벨} {이름}`. pptx 61~63쪽 목업이 아이템을
    가리킬 때마다 이 형태다(제작 목록·상세·제작 중·완성 알림·지급 목록 전부). */
function equipLabel(item: EquipmentData): string {
  return `Lv${item.unlockLevel} ${pickEquipName(item)}`;
}

/** 무기/방어구 라벨 — 아이콘의 `alt`/`aria-label`로만 쓴다(2026-09-09 네 번째
    팔로업 — 효과 줄의 「[무기]」 글자 태그는 `KindIcon`으로 바뀌었다). */
function kindLabel(kind: EquipmentKind): string {
  return t(kind === 'weapon' ? 'forge.kind.weapon' : 'forge.kind.armor');
}

/** `assets/blacksmith/weapon.png`/`shield.png` — 종류 태그가 글자 대신
    쓰는 아이콘(2026-09-09 네 번째 팔로업). */
function KindIcon({ kind }: { kind: EquipmentKind }): React.JSX.Element {
  return (
    <img
      className="frg-icon-inline"
      src={`blacksmith/${kind === 'weapon' ? 'weapon' : 'shield'}.png`}
      alt={kindLabel(kind)}
    />
  );
}

/** 해금 레벨 → 회전 스프라이트 색(기획 지정, `assets/blacksmith/lightEffect_lv*.png`
    파일명 그대로 — 등급처럼 값을 새로 매기지 않고 이미 있는 매핑을 읽는다). */
const GLOW_COLOR: Record<number, string> = { 1: 'silver', 2: 'green', 3: 'blue', 4: 'purple', 5: 'gold' };

/**
 * 무기 그림 뒤로 앉는 후광 — `assets/blacksmith/lightEffect_lv{1..5}_{색}.png`
 * (2026-09-09 열여덟 번째 팔로업부터 낱장 그림 한 장이다 — 6×4 격자 스프라이트
 * 시트였던 옛 버전은 CSS `transform: rotate()`로 대체했다, `style.css`의
 * `.frg-item-glow` 참조). 상세 패널에서는 계속 돌고, 제작 목록 카드에서는
 * `.frg-tile-glow`로 **회전 없이 정지 이미지**로 쓴다(열여덟 번째 팔로업 —
 * "이 화면에서는 애니메이션처럼 안 움직이고 정지 이미지를") — `className`으로
 * 어느 상자·회전 여부를 쓸지 가른다.
 */
function GlowLayer({ level, className = 'frg-item-glow' }: { level: number; className?: string }): React.JSX.Element {
  const color = GLOW_COLOR[level] ?? 'silver';
  return <div className={className} style={{ backgroundImage: `url(blacksmith/lightEffect_lv${level}_${color}.png)` }} />;
}

/**
 * `assets/blacksmith/level.png`(제작 목록 카드의 작은 배지) ·
 * `level2.png`(상세 패널 왼쪽 위 모서리 배지, 2026-09-09 여덟 번째 팔로업 —
 * "왼쪽 위 레벨 표시를 이 이미지 배열로") — 둘 다 Lv1~5 다섯 칸 스프라이트.
 * 텍스트 `Lv{n}`을 쓰던 자리를 이 그림으로 바꾼다(세 번째 팔로업 — "Lv1
 * 이런 식으로 텍스트로 표기된 부분을 아이콘으로"). 5칸 가로 배열이라 자리는
 * `(레벨-1)/(칸수-1) × 100%` — 되감는 다른 스프라이트(도장·팔괘 원반)와
 * 같은 격자 공식이다.
 */
function LevelBadge({ level, className, sheet = 'level.png' }: {
  level: number; className?: string; sheet?: 'level.png' | 'level2.png';
}): React.JSX.Element {
  return (
    <span
      className={`frg-item-lvbadge${className ? ` ${className}` : ''}`}
      style={{ backgroundImage: `url(blacksmith/${sheet})`, backgroundPositionX: `${((level - 1) / 4) * 100}%` }}
      role="img"
      aria-label={`Lv${level}`}
    />
  );
}

/**
 * 완성 알림을 「봤다」는 표시 — 게임 판정이 아니라 이 브라우저에서 한 번
 * 봤는지만 기억하는 화면 편의값이라 `PlayerProfile`이 아니라 `localStorage`에
 * 둔다(계정 저장 형식에 끼워 넣으면 「환영 문구를 봤는가」 같은 것까지 서버
 * 왕복을 타게 된다). 못 읽거나 못 쓰면 조용히 매번 다시 보여줄 뿐이다 —
 * 판정에 영향이 없는 값이라 실패해도 게임이 안 죽는다.
 */
const CELEBRATED_KEY = 'samchess.forge.celebrated';
function loadCelebrated(): Set<string> {
  try {
    const raw = window.localStorage.getItem(CELEBRATED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveCelebrated(ids: Set<string>): void {
  try {
    window.localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...ids]));
  } catch {
    /* 못 쓰면 다음에도 다시 뜰 뿐 — 판정에 안 쓰는 값이다 */
  }
}

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
  const [celebrated, setCelebrated] = useState(loadCelebrated);
  const [craftPage, setCraftPage] = useState(0);
  useEffect(() => { if (view === 'craft') setCraftPage(0); }, [view]);

  /**
   * ★ 임시 QA 도구 — `?forgeLevel=5`처럼 URL에 붙이면 대장간 레벨을 그 값으로
   * **화면에만** 가장한다(2026-09-09, "레이아웃 확인용으로 레벨 5를 임시로").
   * `?match=fast`(`meta/matchmaking.ts`)와 같은 자리·같은 결의 개발용 통로다.
   * 실제 `profile`은 절대 안 바꾼다 — 제작 시작(`startForgeOrderOnServer`)은
   * 여전히 진짜 프로필로 서버가 재검증하므로, 이 값으로 잠긴 레벨 이상을
   * 실제로 살 수는 없다(그러면 화면만 5로 보이고 주문은 서버가 거절한다).
   * 확인이 끝나면 이 블록과 `debugProfile` 참조 네 곳을 지운다. */
  const debugForgeLevel = Number(new URLSearchParams(location.search).get('forgeLevel'));
  const debugProfile = debugForgeLevel > 0
    ? { ...profile, buildings: { ...profile.buildings, forge: debugForgeLevel } }
    : profile;
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

  /*
   * **남은 시간이 0이 되는 그 순간에 정산한다** (2026-09-10).
   *
   * 정산 자체는 `App.tsx`의 분 단위 tick(`GRAIN_TICK_MS = 60_000`)이 이미 하는데,
   * 그 주기는 **시간당 차는 군량**에 맞춘 값이다. 제조 기간이 「Lv*n* = *n*분」이
   * 되면서 **1분짜리 주문이 최대 1분 늦게 발견된다** — 실측으로 카운트다운은 0에
   * 닿았는데 완성 팝업은 **117초 뒤**에 떴다(1분 주문). 화면에는 「0초인데 아무 일도
   * 안 일어난다」로만 보인다.
   *
   * 여기서 다시 거두지 않고 **`syncCity()`를 그대로 부른다** — 정산의 자리는 여전히
   * 하나이고(`collectForgeOrder`를 화면이 직접 부르면 두 번째 구현이 된다), 이
   * 화면은 「지금 몇 시인지」만 넣는다(§「시계는 화면이 넣는다」). 거두고 나면
   * `forgeOrder`가 없어져 조건이 다시 참이 되지 않으므로 되풀이하지 않는다.
   */
  useEffect(() => {
    if (!order || forgeOrderRemainingMs(order, Date.now()) > 0) return;
    const settled = syncCity(profile, Date.now());
    if (settled !== profile) onChange(settled);
  }, [order, now, profile, onChange]);

  /**
   * 완성됐지만 아직 못 본 아이템 — 「제작 완료 시, 또는 제작 완료 후 화면
   * 진입 시」(pptx 62쪽) 둘 다 이 값 하나로 잡는다. 정산(`syncCity` →
   * `collectForgeOrder`)은 이미 `App.tsx`가 분마다 해 두므로, 여기서는
   * **미지급 상태로 남은 것 중 아직 안 본 것**을 찾기만 한다.
   */
  const justDone = useMemo(() => {
    for (const [id, holder] of Object.entries(profile.forgeOwned)) {
      if (holder === null && !celebrated.has(id)) {
        const item = equipmentById.get(id);
        if (item) return item;
      }
    }
    return null;
  }, [profile.forgeOwned, celebrated]);

  const acknowledgeDone = (id: string): void => {
    const next = new Set(celebrated);
    next.add(id);
    saveCelebrated(next);
    setCelebrated(next);
  };

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

  /**
   * 제작 목록 페이지네이션(2026-09-09 스물네 번째 팔로업 — "레벨 3까지 보여주고
   * 페이지네이션을 넣자"). 대장간 레벨 5(만렙, `buildingById.get('forge').maxLevel`)
   * 전부를 한 화면에 욱여넣으면 다섯 줄이 안 담긴다(레벨 5 스크린샷으로 확인) —
   * 카드 자체를 줄이는 대신 **레벨 3칸씩 페이지로 자른다**(1페이지 Lv1~3, 2페이지
   * Lv4~6…). `craftableEquipment()`가 이미 해금 레벨 오름차순이라 그 순서를
   * 그대로 3칸씩 묶기만 하면 된다 — 레벨 상한이 나중에 늘어도 페이지 수가
   * 저절로 늘 뿐 이 계산은 안 바뀐다.
   */
  const craftList = craftableEquipment(debugProfile);
  const craftPages = useMemo(() => {
    const groups = new Map<number, EquipmentData[]>();
    for (const item of craftList) {
      const idx = Math.floor((item.unlockLevel - 1) / 3);
      const bucket = groups.get(idx);
      if (bucket) bucket.push(item); else groups.set(idx, [item]);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b).map(([, items]) => items);
  }, [craftList]);
  const currentCraftPage = Math.min(craftPage, Math.max(0, craftPages.length - 1));
  const forgeMaxLevel = buildingById.get('forge')?.maxLevel ?? forgeLevel(debugProfile);

  // 대장간이 아니라 궁궐 화면을 그대로 빌린다(파일 머리말 참조) — 새 서브뷰가
  // 아니라 이 함수의 return 자체를 갈아 끼운다. 나가는 자리는 `onBack`이
  // `setAssignPicking(null)`이라 여기로 돌아오면 다시 지급 관리 목록이다.
  const pickingItem = assignPicking ? equipmentById.get(assignPicking) : undefined;
  if (assignPicking && pickingItem) {
    return (
      <OfficerListScreen
        profile={profile}
        onBack={() => setAssignPicking(null)}
        onChange={onChange}
        equipPick={{
          item: pickingItem,
          /*
           * **교체는 물어보고 한다** (2026-09-10). `equipOfficer()`는 이미 다른
           * 병기를 낀 장수를 고르면 그것을 **말없이 풀어 준다**(장수당 슬롯 하나,
           * 2026-09-09 기획 확정) — 규칙은 그게 맞는데, 화면에서는 표의 「병기」
           * 칸에 이름이 적혀 있는 것이 유일한 예고였다. 그 칸은 「없음」과 같은
           * 색·같은 크기라 **한 병기가 조용히 벗겨지는 것**을 알아채기 어렵다
           * (장수 124명 계정으로 실제로 눌러 보고 잡았다 — 아무 표시 없이 바뀐다).
           * 이미 [회수]가 확인을 받으므로 같은 무게로 맞춘다. **낀 것이 없으면
           * 안 묻는다** — 잃는 것이 없는 수다.
           */
          onPick: (officer: OfficerId) => {
            const held = equippedBy(profile, officer);
            if (held && held.id !== assignPicking) {
              const name = pickOfficerNameById(officer, officer);
              if (!window.confirm(t('forge.assign.swapConfirm', {
                officer: name, from: equipLabel(held), to: equipLabel(pickingItem),
              }))) return;
            }
            onChange(equipOfficer(profile, assignPicking, officer));
            setAssignPicking(null);
          },
        }}
      />
    );
  }

  return (
    <ScreenChrome
      backdrop={buildingBackdrop('forge')}
      className="scr-place scr-building-forge"
      account={currentSession()?.email ?? null}
    >
      {/* 뒤로·제목은 궁궐·랭킹과 같은 UI다(`.scr-building-forge`, style.css —
          `.scr-place-palace`/`.scr-officers`/`.scr-ranking`과 값이 같다).
          그림 화살표(`::before`)와 글자 화살표가 겹치지 않게 `stripBackArrow()`로
          문구의 「← 」를 뗀다 — 궁궐이 `place === 'palace'`일 때만 떼는 것과
          같은 이유(`PlaceScreen.tsx` 머리말 참조). */}
      <div className="place-bar">
        <button
          className="btn ghost sm"
          data-action="back"
          onClick={() => (view === 'home' ? onBack() : setView('home'))}
        >
          {stripBackArrow(t(view === 'home' ? 'place.back' : 'forge.backHome'))}
        </button>
        <span className="place-nm">{t('place.forge')}</span>
      </div>

      {/* 현황 요약 — pptx 61쪽 세 목업 전부(홈·제작 목록·제작 상세)의 위쪽에
          똑같이 붙어 있다. 화면 상단, `place-body`(그림·목록) 앞에 늘 떠 있는
          줄이라 view별 분기 밖으로 뺐다. */}
      <div className="place-panel frg-status">
        <div className="frg-summary">
          <span data-field="level">{t('forge.summary.level', { level: forgeLevel(debugProfile) })}</span>
          <span data-field="total">{t('forge.summary.total', { n: summary.owned })}</span>
          <span data-field="stock">{t('forge.summary.stock', { n: summary.spare })}</span>
          <span data-field="assigned">{t('forge.summary.assigned', { n: summary.assigned })}</span>
        </div>
        {order && orderItem && (
          <p className="hint" data-field="orderStatus">
            {t('forge.order.inProgress', {
              name: equipLabel(orderItem), time: formatRemaining(forgeOrderRemainingMs(order, now)),
            })}
          </p>
        )}
      </div>

      {/* 홈은 궁궐처럼 하단 메뉴판이라 `.place-body`의 `margin-top: auto`로
          바닥에 붙는다. 제작·지급 관리는 목록 화면이라 그 여백이 위 요약
          패널과 목록 사이에 큰 그림 배경만 남겨 둘 뿐이었다 — `frg-body-flow`로
          바로 아래에 붙이고, 뜨는 간격은 요약 패널의 겉테두리 두께(1.5rem,
          `.scr-building-forge .place-panel`의 `border-width`)만큼만 준다. */}
      <div className={`place-body${view === 'home' ? '' : ' frg-body-flow'}`}>
        {view === 'home' && (
          <section className="place-panel frg-home">
            <div className="frg-buttons">
              <button className="btn wide" data-action="craft" onClick={() => setView('craft')}>
                <span className="lbl">{order ? t('forge.craft.cancelHome') : t('forge.craft')}</span>
              </button>
              <button className="btn wide" data-action="assign" onClick={() => setView('assign')}>
                <span className="lbl">{t('forge.assign')}</span>
              </button>
            </div>
          </section>
        )}

        {view === 'craft' && (
          <section className="place-panel frg-craft">
            <h2 className="cap">{t('forge.craft')}</h2>
            {order && orderItem ? (
              <div className="frg-inProgress" data-field="inProgress">
                <p className="frg-inProgress-name">{equipLabel(orderItem)}</p>
                <p className="hint">{t('forge.craft.remaining', { time: formatRemaining(forgeOrderRemainingMs(order, now)) })}</p>
                <button className="btn ghost" data-action="cancelOrder" onClick={cancel} disabled={busy}>
                  {t('forge.craft.cancel')}
                </button>
              </div>
            ) : craftList.length === 0 ? (
              <p className="hint">{t('forge.craft.empty', { level: forgeLevel(debugProfile) })}</p>
            ) : (
              <>
                <p className="hint" data-field="listTitle">{t('forge.craft.listTitle')}</p>
                <div className="frg-list">
                  {(craftPages[currentCraftPage] ?? []).map((item) => (
                    <button
                      key={item.id}
                      className="frg-tile"
                      data-item={item.id}
                      onClick={() => setDetail(item)}
                    >
                      {/* 카드 액자 — `assets/blacksmith/frame_item_list.png`
                          (2026-09-09 열일곱 번째 팔로업). 상세 패널의 액자와
                          같은 결(`.frg-item-frame` 참조) — 쌓는 순서는
                          **액자 → 후광(정지) → 사진**. `data-kind`는 방어구를
                          무기 기준으로 줄이기 위한 스코프다(스물네 번째
                          팔로업 — "무기와 방어구간 표출 크기 차이를 무기
                          기준으로 맞춰줘", `.frg-item-photo[data-kind="armor"]`와
                          같은 자리). */}
                      <div className="frg-tile-frame">
                        <img src="blacksmith/frame_item_list.png" alt="" className="frg-tile-frame-art" />
                        <GlowLayer level={item.unlockLevel} className="frg-tile-glow" />
                        <img src={`blacksmith/${item.id}.png`} alt="" className="frg-tile-photo" data-kind={item.kind} data-item={item.id} />
                      </div>
                      {/* 이름표는 액자 **아래** 별도 줄이다(2026-09-09 열아홉
                          번째 팔로업 — 겹쳐 얹었던 이전 지정을 다시 물렀다,
                          첨부 이미지처럼). 나무 명패(`blacksmith/nameplate.png`)
                          위에 금색 글자 — `.frg-tile-nameplate` 참조.

                          ★ **레벨 배지는 2026-09-10에 뺐다** (기획자 지정 —
                          "레벨 아이콘 없애고 제목 나무 패널로 그림 아랫공간을
                          다 할당하자"). 배지가 왼쪽에서 1.52rem을 가져가던 것이
                          그대로 명패 폭이 되어, 이름 두 줄 접기(§이름 다국어)에도
                          여유가 생긴다. **레벨을 잃지는 않는다** — 목록이 이미
                          레벨 3칸씩 쪽으로 묶여 있고(`craftPages`), 상세 패널은
                          왼쪽 위 모서리 배지(`LevelBadge`의 `corner`)를 그대로
                          띄운다. */}
                      <span className="frg-tile-label">
                        <span className="frg-tile-nameplate">
                          <span className="frg-tile-name">{pickEquipName(item)}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {/* 페이지 넘김 — 레벨 3칸씩(위 `craftPages` 참조). 페이지가
                    하나뿐이면(대장간 레벨이 낮아 목록이 짧을 때) 아예 안 그린다. */}
                {craftPages.length > 1 && (
                  <div className="frg-pager" data-field="pager">
                    <button
                      className="btn ghost sm"
                      data-action="prevPage"
                      disabled={currentCraftPage === 0}
                      onClick={() => setCraftPage((p) => Math.max(0, p - 1))}
                    >
                      ‹
                    </button>
                    <span className="frg-pager-label">{t('forge.craft.page', { page: currentCraftPage + 1, total: craftPages.length })}</span>
                    <button
                      className="btn ghost sm"
                      data-action="nextPage"
                      disabled={currentCraftPage >= craftPages.length - 1}
                      onClick={() => setCraftPage((p) => Math.min(craftPages.length - 1, p + 1))}
                    >
                      ›
                    </button>
                  </div>
                )}
                {/* 안내 문구 — 대장간이 아직 만렙(5)이 아닐 때만, 카드 목록
                    아래·패널 안쪽에(2026-09-09 스물네 번째 팔로업 — "레벨이
                    오르면 더 다양한 병기구 제작이 가능합니다"). 목록 제목과
                    같은 글꼴(`hint` 클래스 재사용, 새 클래스를 안 만든다). */}
                {forgeLevel(debugProfile) < forgeMaxLevel && (
                  <p className="hint" data-field="levelHint">{t('forge.craft.levelHint')}</p>
                )}
              </>
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
              <>
                <p className="hint" data-field="listTitle">{t('forge.assign.listTitle')}</p>
                <div className="frg-rows">
                  {Object.entries(profile.forgeOwned).map(([id, holder]) => {
                    const item = equipmentById.get(id);
                    if (!item) return null;
                    return (
                      <div className="frg-row" key={id} data-item={id} data-assigned={holder ? '1' : '0'}>
                        <img src={`blacksmith/${id}.png`} alt="" />
                        <span className="lbl">{equipLabel(item)}</span>
                        {holder ? (
                          <>
                            <span className="frg-row-holder">{pickOfficerNameById(holder, holder)}</span>
                            <button
                              className="btn ghost sm"
                              data-action="revoke"
                              onClick={() => {
                                if (window.confirm(t('forge.assign.revokeConfirm'))) onChange(unequipOfficer(profile, id));
                              }}
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
              </>
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

      {/* 「축하합니다! 완성!」(pptx 62쪽) — 제작 완료 시, 또는 완료 후 화면
          진입 시 뜬다(`justDone`이 그 둘을 이미 하나로 잡는다, 위 참조). */}
      {justDone && (
        <div className="modal-back" data-modal="forgeDone" onClick={() => acknowledgeDone(justDone.id)}>
          <div className="modal frg-done" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('forge.done.title')}</p>
            <img src={`blacksmith/${justDone.id}.png`} alt="" className="frg-detail-art" />
            <p className="frg-done-body">{t('forge.done.body', { item: equipLabel(justDone) })}</p>
            <p className="hint">{t('forge.done.hint')}</p>
            <button className="btn primary wide" data-action="ackDone" onClick={() => acknowledgeDone(justDone.id)}>
              {t('forge.done.confirm')}
            </button>
          </div>
        </div>
      )}

      {busy && <BusyVeil />}
    </ScreenChrome>
  );
}

/**
 * 무기/방어구 상세 — 장수 카드(`OfficerCardModal`/`OfficerCard`,
 * `RankingCommon.tsx`)와 같은 틀이다(2026-09-09 팔로업). 전용 패널 그림은
 * `assets/icons`에 없다 — 장수 카드도 별도 그림 없이 화면이 이미 쓰는
 * `.place-panel`(이 화면에서는 대장간의 열린 장부 프레임)을 그대로 빌리고,
 * 닫기는 `icons/close.png` X 아이콘 하나뿐이다. 그 결을 그대로 따른다.
 *
 * **닫는 자리는 패널 우상단의 X 하나뿐이다**(2026-09-09 두 번째 팔로업 —
 * 패널 밖으로 따로 뺐던 [닫기] 글자 단추를 없앴다). 패널을 벗어난 단추가
 * 남아 있으면 패널이 화면의 진짜 경계가 아니게 된다.
 *
 * 안의 그림·글자·단추도 이 화면 다른 곳에서 이미 검증된 그림을 그대로
 * 빌리거나(제작 단추·해설 문단), 전용으로 받은 그림을 쓴다(무기 그림 액자):
 * - 무기 그림 액자: `assets/blacksmith/frame_item.png`(2026-09-09 세 번째
 *   팔로업 — `ui/stat-frame.png` 9분할을 걷어내고 이걸로 바꿨다). 검정
 *   캔버스가 있는 두루마리 그림 한 장이라 9분할이 아니라 **쌓아 그린다** —
 *   순서는 **두루마리 → 후광(회전) → 사진**(2026-09-09 여섯 번째 팔로업
 *   지정 그대로) 이고, 아래 세 `<img>`의 DOM 순서가 그 순서다. 캔버스가
 *   뚫린 창이 아니라 그 자체로 불투명한 검정이라 액자가 맨 처음(맨 아래)
 *   이어야 위의 것들이 보인다(합성해서 확인). **품목 사진은 진짜 알파
 *   컷아웃이다**(2026-09-09 일곱 번째 팔로업 — `build_blacksmith.py`가
 *   RGB로 접으며 그 알파를 스스로 지우고 있었다, 그 파일 머리말 참조) —
 *   배경이 투명하므로 후광·캔버스가 사진 뒤로 그대로 비쳐 보인다. 사진은
 *   캔버스 자리에만(`.frg-item-photo`, 실측 좌표 — 아래 CSS 주석 참조)
 *   `object-fit: contain`으로 통째로(안 잘리게) 채우고, DOM에서 **가장
 *   나중**이라 무기 자체(불투명한 자리)는 후광이 아무리 밝아도 가려지지
 *   않는다.
 * - [제작] 단추: `ui/btn-primary.png` — 도시 관리의 [증축]과 같은 옥색 목판
 *   (`.scr-city .btn.primary`와 같은 슬라이스·글자색).
 * - 해설 문단: `ui/field-frame.png` — 장수 상세의 인물 열전(`.ofcard-story`)과
 *   같은 두루마리.
 */
function DetailModal({ item, gold, onStart, onClose }: {
  item: EquipmentData;
  gold: number;
  onStart: () => void;
  onClose: () => void;
}): React.JSX.Element {
  useLang();
  // 고르는 자리는 `i18n/story.ts` 하나다 — 화면마다 다시 적으면 한 곳만
  // 빠뜨렸을 때 그 화면에서만 한국어로 남는다(책략 칩이 밟았던 지뢰)
  const lore = pickEquipLore(item);
  const effect = pickEquipText(item);
  const canAfford = gold >= item.gold;
  return (
    <div className="modal-back" data-modal="forgeDetail" onClick={onClose}>
      <div className="frg-item-wrap" onClick={(e) => e.stopPropagation()}>
        <section className="place-panel frg-item">
          {/* 레벨 배지·제목·X를 한 줄에 놓고 셋의 세로 중심을 맞춘다
              (2026-09-09 스물두 번째 팔로업 — "왼쪽 레벨 아이콘, 제목,
              오른쪽 X의 위치 alignment를 맞춰줘"). 배지·X는 이 줄
              (`.frg-item-titlebar`, `position: relative`) 기준 절대
              배치라 자리를 그대로 옮겼고, 제목만 가운데 nameplate로
              바뀌었다. `kindLabel()`은 여전히 쓴다(`KindIcon`의 `alt`로).
              레벨 배지는 `level2.png`(여덟 번째 팔로업 지정) — 제작
              목록 카드의 작은 배지는 그대로 `level.png`다. */}
          <div className="frg-item-titlebar">
            <LevelBadge level={item.unlockLevel} className="corner" sheet="level2.png" />
            <button className="frg-item-close" data-action="closeDetail" onClick={onClose} aria-label={t('forge.detail.close')}>
              <img className="frg-item-close-icon" src="icons/close.png" alt="" />
            </button>
            {/* 제목 명패 — `public/blacksmith/nameplate.png`, 제작 목록
                카드의 이름표(`.frg-tile-nameplate`)와 같은 트리밍판을
                그대로 재사용한다(스물두 번째 팔로업 — "제목에 chip_neutral
                적용, 마찬가지로 좌우 투명 패딩을 잘라서"). 이미 좌우
                여백을 잘라낸 자산이라 새로 굽지 않는다. */}
            <span className="frg-item-nameplate">
              <h2 className="frg-item-title">{pickEquipName(item)}</h2>
            </span>
          </div>
          <div className="frg-item-frame">
            {/* 쌓는 순서(아래 → 위): 액자 → 후광(회전) → 사진(2026-09-09
                여섯 번째 팔로업 지정). 액자의 검정 캔버스는 **불투명**이라
                (뚫린 창이 아니라 그림 자체가 검정) 맨 아래여야 한다. 사진은
                무기 모양만 불투명한 **진짜 알파 컷아웃**이고(일곱 번째
                팔로업, `build_blacksmith.py` 참조) DOM 맨 나중(맨 위)이라
                — 무기 바깥은 투명해 후광이 비쳐 보이고, 무기 자체는 후광이
                아무리 밝게 돌아도 안 가려진다. `data-kind`는 방어구를 더
                작게 그리기 위한 스코프다(스물두 번째 팔로업 — "방어구는
                무기보다 살짝 더 작게", `.frg-item-photo[data-kind="armor"]`
                참조). */}
            <img src="blacksmith/frame_item.png" alt="" className="frg-item-frame-art" />
            <GlowLayer level={item.unlockLevel} />
            <img src={`blacksmith/${item.id}.png`} alt="" className="frg-item-photo" data-kind={item.kind} />
          </div>
          {/* 해설과 효과를 한 두루마리 안에 함께 담는다(2026-09-09 네 번째
              팔로업 — 손그림 목업처럼). 종류는 글자 대신 아이콘. */}
          <div className="frg-item-desc">
            <p className="frg-item-lore">{lore}</p>
            <p className="frg-item-effect">
              <KindIcon kind={item.kind} />
              {t('forge.detail.effectLine', { effect })}
            </p>
          </div>
          <button
            className="btn primary wide frg-item-make"
            data-action="startOrder"
            disabled={!canAfford}
            title={canAfford ? undefined : t('forge.detail.notEnough', { have: gold, need: item.gold })}
            onClick={onStart}
          >
            <span>{t('forge.detail.craft')} (</span>
            <img className="frg-icon-inline" src="market/gold.png" alt={t('forge.detail.gold')} />
            <span>×{item.gold},</span>
            <img className="frg-icon-inline" src="blacksmith/timer.png" alt={t('forge.detail.durationLabel')} />
            <span>{t('forge.detail.minutesSuffix', { minutes: item.unlockLevel })})</span>
          </button>
        </section>
      </div>
    </div>
  );
}
