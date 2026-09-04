/**
 * 메인 — 도시 (pptx 35쪽)
 *
 * ```
 * ┌──────────────────────────┐
 * │ 만민의 삼국지        ⚙   │
 * │ 도시 이름                 │
 * │ [도시 정보]               │
 * │            궁궐           │  ← 이름 · 소개글이 그림 위에 늘 떠 있다
 * │  병영                     │     (호버 없이도 항상 보인다)
 * │  랭킹      장터           │
 * └──────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 자리 이름표는 **늘 떠 있다** — 호버로 나타나지 않는다 (2026-08-25 두 번째 리디자인)
 * ────────────────────────────────────────────────────────────────
 *
 * 바로 전 리디자인은 그림 속 건물 윤곽을 손으로 따서 SVG 다각형으로 깔고,
 * 마우스를 올려야 이름표가 뜨게 했었다. **모바일엔 호버가 없다** — 손가락으로는
 * 짚기 전까지 그게 클릭되는 자리인지 알 길이 없다. 그래서 이름표(이름 + 짧은
 * 소개글)를 호버와 상관없이 늘 그림 위에 띄우는 쪽으로 바꿨다.
 *
 * 이름표가 늘 보이면 **건물 윤곽을 정확히 딸 이유도 함께 없어진다** — 어차피
 * 눈에 보이는 글자가 「여기다」를 말해 주므로, 클릭 영역은 그 자리를 넉넉히
 * 덮는 **네모**면 충분하다(손가락으로 짚기에도 다각형보다 네모가 관대하다).
 * 마우스 호버 시의 노란 테두리 강조는 **데스크톱 사용자를 위한 덤으로만**
 * 남겨 뒀다 — 순수 CSS `:hover`/`:focus-visible`라 자바스크립트 상태가 없다.
 *
 * - **궁궐** — 가운데 오른쪽의 성문 누각과 그 옆 성벽 일대.
 * - **병영** — 가운데보다 약간 아래, 왼쪽에 모인 천막 일대.
 * - **장터** — 맨 아래 전체가 아니라 아래쪽 **오른쪽**의 지붕 일대.
 * - **랭킹** — 병영 바로 아래, 작은 민가와 좌판 상인이 보이는 자리
 *   (2026-08-25 세 번째 리디자인). 병영과 **너비·가로 위치가 같다** — 그대로
 *   내려와 로그아웃 버튼 위에서 멈춘다.
 *
 * 좌표(`CITY_HOTSPOTS`)는 `main-day.jpg`(685×1536, 다른 시간대도 같은 구도)를
 * 보고 손으로 잡았다 — 그림이 바뀌면 다시 잡아야 한다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「랭킹」은 새 화면이 아니다 — 이미 있던 [도시 전적] 화면을 그대로 쓴다
 * ────────────────────────────────────────────────────────────────
 *
 * 예전엔 궁궐 → 도시 관리 → 도시 전적, 세 번을 눌러야 닿았다. `RankingScreen`
 * 자체는 안 건드리고, 메인에 자리 하나를 더 내 `onRanking`으로 바로 부른다 —
 * 「뒤로」가 어디서 왔는지는 `App.tsx`의 `ranking.from`이 가른다.
 *
 * **핫스팟은 `ScreenChrome`의 `artOverlay`로 들어간다 — `children`이 아니다.**
 * 그림이 몇 초마다 아주 조금씩 밀리는데(`backdropMotion.ts`의 드리프트), 이름표가
 * `children`(안 흔들리는 층)에 있으면 그림만 움직이고 이름표는 제자리에 남아
 * 어긋난다. `artOverlay`는 그림과 같은 `.scr-art` 안에 들어가 같은 `transform`을
 * 받으므로 항상 붙어 다닌다.
 *
 * SVG의 `viewBox`를 그림의 실제 픽셀 크기(685×1536)로, `preserveAspectRatio`를
 * `xMidYMid slice`로 두면 배경의 `background-size: cover; center`와 **정확히
 * 같은 규칙으로 잘리고 확대된다** — 화면 크기가 얼마든 좌표를 다시 셀 필요가 없다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「AI 대전」은 여기서 병영으로 옮겼다
 * ────────────────────────────────────────────────────────────────
 *
 * 3:3 · 5:5 고르기는 원래 이 화면에 있었는데, 기획자 지정대로 **병영** 안으로
 * 들어갔다(`PlaceScreen`). 도시는 갈림길만 보여주고 하는 일은 각 자리가 맡는다.
 */

import { buildingLevel, poolCap, poolUsed, gradeScore } from '@samchess/meta';
import { BUILDINGS } from '@samchess/data';
import type { BuildingId } from '@samchess/data';
import type { PlayerProfile } from '@samchess/meta';
import { clearCache } from '../meta/storage.ts';
import { currentSession, signOut } from '../meta/auth.ts';
import { playSfx } from '../audio/sfx.ts';
import { currentBand, extBackdrop, mainBackdrop } from './backdrop.ts';
import type { PlaceId } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { useState } from 'react';

/** 그림(`main-*.jpg`)의 실제 픽셀 크기. `preserveAspectRatio`가 `cover`와 같은
    규칙으로 자르려면 SVG `viewBox`가 이 크기와 같아야 한다. */
const ART_W = 685;
const ART_H = 1536;

/**
 * **확장 도시**(`ext-*.jpg`)의 크기. 지금은 메인과 사실상 같지만(686 vs 685)
 * **한 벌로 뭉치지 않는다** — 원본이 다른 파일이라 언제든 다시 갈릴 수 있고,
 * 그때 핫스팟이 조금씩 밀리는데 화면에서는 「누르면 옆 건물이 열린다」로만 보인다.
 *
 * ★ **글자 크기가 여기에 딸려 있다.** `<text>`는 이 `viewBox` 단위로 크기를 받으므로,
 * 두 그림의 좌표계가 다르면 **같은 `fontSize`가 화면에서 다른 크기로 보인다** —
 * 처음 원본이 482폭이었을 때 산 너머 이름표만 1.42배로 커져 「폰트가 다르다」로
 * 보였다. 원본을 같은 해상도로 받아 맞췄다 (2026-09-04).
 */
const EXT_W = 686;
const EXT_H = 1536;

/** 도시 화면의 두 겹 — 성 안(`core`)과 산 너머(`ext`) */
type CityView = 'core' | 'ext';

interface CityHotspot {
  key: string;
  nameKey: StringKey;
  subKey: StringKey;
  rect: { x: number; y: number; w: number; h: number };
  label: { x: number; y: number };
  onClick: () => void;
}

/** 자리마다 클릭 영역(그림 픽셀 좌표의 네모)과 이름표가 뜨는 자리.
    `main-day.jpg`를 보고 손으로 잡았다 — 건물을 정확히 덮을 필요는 없고,
    「그 근처」를 넉넉히 덮으면 된다(손가락으로 짚기엔 그게 더 낫다). */
function cityHotspots(onGo: (place: PlaceId) => void, onRanking: () => void): CityHotspot[] {
  return [
    // 성문 누각과 그 옆 성벽 — 가운데보다 오른쪽(2026-08-25 다섯 번째 조정: 위·왼쪽
    // 시작값과 높이는 그대로 두고 너비만 1.1배로 넓혔다).
    {
      key: 'palace', nameKey: 'place.palace', subKey: 'place.palace.sub',
      rect: { x: 248, y: 450, w: 385, h: 375 }, label: { x: 441, y: 610 },
      onClick: () => { playSfx('enter_palace'); onGo('palace'); },
    },
    // 천막이 모인 자리 — 가운데보다 약간 아래, 왼쪽. 처음부터 잘 맞아 안 건드렸다.
    {
      key: 'barracks', nameKey: 'place.barracks', subKey: 'place.barracks.sub',
      rect: { x: 0, y: 790, w: 255, h: 195 }, label: { x: 127, y: 900 },
      onClick: () => { playSfx('enter_barraks'); onGo('barracks'); },
    },
    // 아래쪽 전체가 아니라 오른쪽 지붕 일대만(2026-08-25 네 번째 조정: 시작 자리는
    // 그대로 두고 높이만 0.9배로 줄였다 — 세 번째 조정에서 너무 많이 늘렸다).
    {
      key: 'market', nameKey: 'place.market', subKey: 'place.market.sub',
      rect: { x: 420, y: 870, w: 265, h: 259 }, label: { x: 553, y: 955 },
      onClick: () => { playSfx('enter_market'); onGo('market'); },
    },
    // 병영 바로 아래 — 작은 민가와 좌판 상인이 있는 자리(2026-08-25 세 번째 조정에서
    // 새로 추가, 네 번째 조정에서 시작 높이를 원래 높이(385)의 8분의 1(48px)만큼
    // 아래로 내렸다 — 끝 지점은 그대로 고정).
    {
      key: 'ranking', nameKey: 'main.ranking', subKey: 'main.ranking.sub',
      rect: { x: 0, y: 1033, w: 255, h: 337 }, label: { x: 127, y: 1169 },
      onClick: onRanking,
    },
  ];
}

/**
 * 산 쪽 화살표 — **추가 건물을 하나라도 지어야 보인다** (pptx 58쪽).
 *
 * 「그 이전까지는 안 보임」이 기획자 지정이다. 아무것도 안 지었는데 화살표만
 * 있으면 눌러서 빈 들판을 보게 되고, 그건 「고장인가」로 읽힌다 — 지을 곳은
 * 궁궐 → 도시 관리다.
 */
export const hasExtendedCity = (profile: PlayerProfile): boolean =>
  BUILDINGS.some((b) => b.kind === 'extra' && buildingLevel(profile, b.id) > 0);

/**
 * 산 너머의 자리들 (pptx 58쪽 · `extendedBackground`).
 *
 * 좌표는 `ext-day.jpg`를 보고 손으로 잡았다 — 성 안 핫스팟과 같은 방식이다.
 * **안 지은 건물은 아예 안 뜬다** — 이름표만 띄워 두면 「왜 안 눌리지」가 남는다.
 */
function extHotspots(profile: PlayerProfile, onPick: (id: BuildingId) => void): CityHotspot[] {
  const spots: { id: BuildingId; nameKey: StringKey; rect: CityHotspot['rect']; label: CityHotspot['label'] }[] = [
    // 담장 안의 학당 — 성 안에서 궁궐이 있던 자리다
    { id: 'academy', nameKey: 'place.academy', rect: { x: 355, y: 465, w: 306, h: 290 }, label: { x: 508, y: 585 } },
    // 논밭과 물레방아 — 병영이 있던 자리
    { id: 'farm', nameKey: 'place.farm', rect: { x: 0, y: 770, w: 390, h: 270 }, label: { x: 195, y: 885 } },
    // 약재를 널어 둔 좌판 — 장터가 있던 자리
    { id: 'hospital', nameKey: 'place.hospital', rect: { x: 405, y: 850, w: 280, h: 262 }, label: { x: 545, y: 955 } },
    // 모루와 갑주 — 가로로 가운데, 세로로 맨 아래 (기획자 지정)
    { id: 'forge', nameKey: 'place.forge', rect: { x: 150, y: 1180, w: 425, h: 300 }, label: { x: 362, y: 1300 } },
  ];
  return spots
    .filter((s) => buildingLevel(profile, s.id) > 0)
    .map((s) => ({
      key: s.id,
      nameKey: s.nameKey,
      subKey: 'place.soon' as StringKey,
      rect: s.rect,
      label: s.label,
      onClick: () => onPick(s.id),
    }));
}

export function MainScreen({ profile, onGo, onRanking, onReset, onDeleteCity }: {
  profile: PlayerProfile;
  onGo: (place: PlaceId) => void;
  /** 「랭킹」 자리 — 궁궐 → 도시 관리를 거치지 않고 [도시 전적]으로 바로 간다 */
  onRanking: () => void;
  onReset: () => void;
  /** 테스트용 — 지금 도시를 지우고 도시 생성 화면으로 돌아간다 */
  onDeleteCity: () => void;
}): React.JSX.Element {
  useLang();
  const [band] = useState(currentBand);
  /** 성 안인가 산 너머인가. **화면을 새로 만들지 않는다** — 배경과 핫스팟만 갈린다 */
  const [view, setView] = useState<CityView>('core');
  /** 아직 화면이 없는 자리를 눌렀을 때 — 「눌리는데 아무 일도 없다」를 남기지 않는다 */
  const [notice, setNotice] = useState<string | null>(null);

  const extended = hasExtendedCity(profile);
  // 산 너머에 있었는데 마지막 건물이 사라지면(되접기·초기화) 빈 들판에 갇힌다
  const at: CityView = view === 'ext' && extended ? 'ext' : 'core';

  const hotspots = at === 'ext'
    ? extHotspots(profile, (id) => setNotice(`${t(`place.${id}` as StringKey)} — ${t('place.soon')}`))
    : cityHotspots(onGo, onRanking);
  const art = at === 'ext' ? { w: EXT_W, h: EXT_H } : { w: ART_W, h: ART_H };

  return (
    <ScreenChrome
      backdrop={at === 'ext' ? extBackdrop(band) : mainBackdrop(band)}
      className="scr-main"
      account={currentSession()?.email ?? null}
      artOverlay={
        <svg
          className="city-hots"
          data-view={at}
          viewBox={`0 0 ${art.w} ${art.h}`}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="false"
        >
          {hotspots.map((spot) => (
            <g key={spot.key}>
              <rect
                className="city-hot"
                /* **스모크는 `data-*`로 건다** — 글자나 클래스로 잡으면 화풍이
                   바뀔 때 조용히 무력화된다(실제로 `.btn.ghost`가 그랬다) */
                data-place={spot.key}
                x={spot.rect.x}
                y={spot.rect.y}
                width={spot.rect.w}
                height={spot.rect.h}
                rx={18}
                role="button"
                tabIndex={0}
                aria-label={`${t(spot.nameKey)} — ${t(spot.subKey)}`}
                onClick={spot.onClick}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); spot.onClick(); } }}
              >
                <title>{t(spot.nameKey)}</title>
              </rect>
              {/* 호버 여부와 상관없이 늘 뜬다 — 모바일엔 호버가 없다(2026-08-25). */}
              <text
                className="city-lbl"
                x={spot.label.x}
                y={spot.label.y}
                fontSize={40}
                textAnchor="middle"
                pointerEvents="none"
              >{t(spot.nameKey)}</text>
              <text
                className="city-lbl city-lbl-sub"
                x={spot.label.x}
                y={spot.label.y + 30}
                fontSize={22}
                textAnchor="middle"
                pointerEvents="none"
              >{t(spot.subKey)}</text>
            </g>
          ))}

          {/*
            산 쪽 화살표 — 궁궐의 왼쪽, 병영의 위쪽 (기획자 지정 · pptx 58쪽).
            **추가 건물을 하나라도 지어야 보인다.** 산 너머에서는 같은 자리가
            돌아오는 문이 된다 — 자리를 옮기면 「어디로 돌아가지」가 남는다.
          */}
          {(extended || at === 'ext') && (
            <g
              className="city-gate"
              role="button"
              tabIndex={0}
              aria-label={t(at === 'ext' ? 'city.gate.back' : 'city.gate.go')}
              onClick={() => { setNotice(null); setView(at === 'ext' ? 'core' : 'ext'); }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                setNotice(null);
                setView(at === 'ext' ? 'core' : 'ext');
              }}
            >
              <rect
                className="city-hot"
                x={art.w * 0.06} y={art.h * 0.30} width={art.w * 0.26} height={art.h * 0.11}
                rx={18}
              >
                <title>{t(at === 'ext' ? 'city.gate.back' : 'city.gate.go')}</title>
              </rect>
              {/* 삼각형 하나 — 성 안에서는 산 쪽(왼쪽 위), 산 너머에서는 성 쪽(오른쪽 아래) */}
              <path
                className="city-arrow"
                d={at === 'ext'
                  ? `M ${art.w * 0.10} ${art.h * 0.335} l ${art.w * 0.14} ${art.h * 0.024} l ${-art.w * 0.14} ${art.h * 0.024} z`
                  : `M ${art.w * 0.24} ${art.h * 0.335} l ${-art.w * 0.14} ${art.h * 0.024} l ${art.w * 0.14} ${art.h * 0.024} z`}
                pointerEvents="none"
              />
              <text
                className="city-lbl city-lbl-sub"
                x={art.w * 0.19} y={art.h * 0.395}
                fontSize={34}
                textAnchor="middle"
                pointerEvents="none"
              >{t(at === 'ext' ? 'city.gate.back' : 'city.gate.go')}</text>
            </g>
          )}
        </svg>
      }
    >
      <div className="city">
        <h1 className="title">{profile.cityName}</h1>
        <div className="stats">
          <span className="stat"><i>{t('main.cityLevel')}</i><b>Lv{profile.cityLevel}</b></span>
          <span className="stat"><i>{t('main.grain')}</i><b>{profile.grain}</b></span>
          <span className="stat"><i>{t('main.officers')}</i><b>{poolUsed(profile)}/{poolCap(profile)}</b></span>
          <span className="stat"><i>{t('main.gradeScore')}</i><b>{gradeScore(profile)}</b></span>
        </div>
      </div>

      {/* 핫스팟(클릭 영역 + 이름표)은 위 `artOverlay`(그림과 함께 흔들리는 층)에
          있다 — 여기는 그 자리를 비워 두는 빈 칸이다(도시 정보와 하단 버튼 사이 간격). */}
      <div className="city-map" />

      {/* 아직 화면이 없는 자리 — 왜 아무 일도 안 일어나는지 적는다 */}
      {notice && <p className="note" data-field="soon">{notice}</p>}

      <footer className="foot">
        <button
          className="btn ghost sm"
          onClick={() => {
            if (window.confirm(t('main.logoutConfirm'))) {
              signOut();
              clearCache();
              onReset();
            }
          }}
        >{t('main.logout')}</button>
        <button
          className="btn ghost sm"
          onClick={() => {
            if (window.confirm(t('main.deleteCityConfirm'))) {
              void onDeleteCity();
            }
          }}
        >{t('main.deleteCity')}</button>
      </footer>
    </ScreenChrome>
  );
}
