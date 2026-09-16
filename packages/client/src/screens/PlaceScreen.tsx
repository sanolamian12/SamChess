/**
 * 궁궐 · 병영 · 장터 — 도시 안의 자리 (pptx 35·36쪽)
 *
 * 배경은 도시 레벨에 따라 갈린다 — `1~4`는 `eachBackground.png`, `5` 이상은
 * `eachBackground2.png`(기획자 지정). 나중에 레벨마다 더 잘게 나눌 예정이라
 * 그 경계는 `backdrop.ts`의 `placeTier()` 하나가 정한다.
 *
 * ────────────────────────────────────────────────────────────────
 * 세 자리가 지금 어디까지 이어지는가
 * ────────────────────────────────────────────────────────────────
 *
 * | 자리 | 지금 |
 * |---|---|
 * | **병영** | 42·45쪽의 셋 — `[부대 편성]` · `[출정하기]` · `[튜토리얼 시나리오]`(잠김) |
 * | **궁궐** | 장수 일람(37~40쪽)과 도시 관리(41쪽) 두 갈래 |
 * | **장터** | 아직 없다. 상점·가챠가 붙을 자리다 |
 *
 * ────────────────────────────────────────────────────────────────
 * 문이 하나로 합쳐졌다 ★ (F · 45쪽 · §5-32)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 병영에 `3:3` · `5:5` 두 단추가 있었고 그것이 곧 「AI 대전」이었다.
 * 45쪽의 출전지 셋(`AI 연습 대전` · `온라인 실전` · `튜토리얼 시나리오`) 중
 * **앞의 둘이 [출정하기] 하나로 합쳐졌으므로**(상대가 사람인지 AI인지는 고르는 것이
 * 아니라 그때의 운이다) 출전지 화면은 **살아 있는 단추가 하나뿐**이 된다 —
 * 그런 화면은 §5-20의 「자리만 만든 것」이라 두지 않고, 셋을 병영에 그대로 편다.
 *
 * 참여 인원(3v3·5v5)은 [출정하기] 안의 첫 걸음으로 내려갔다 (45쪽 「구성을 선택해주세요.」).
 *
 * ────────────────────────────────────────────────────────────────
 * 궁궐은 랭킹과 같은 화풍이다 — **화면 하나씩** 옮긴다 (2026-09-02)
 * ────────────────────────────────────────────────────────────────
 *
 * 랭킹 화면(`RankingScreen.tsx`)이 먼저 간판·환경설정의 목판·두루마리 화풍을
 * 입었다(2026-08-27). 궁궐이 그다음이고(2026-09-02), **병영이 2026-09-16에
 * 뒤따랐다**(트랙 10d) — 셀렉터를 `.scr-place-palace`·`.scr-place-barracks`로
 * 좁혀서(`style.css`) 장터(`.scr-place-market`)는 아직 건드리지 않는다.
 * 뒤로 단추의 글자 화살표(`place.back`이 이미 「← 」를 물고 있다)는 랭킹처럼
 * 그림 화살표(`::before`)로 대신하므로, **리스킨한 자리에서만**
 * `stripBackArrow()`로 뗀다 — 장터는 아직 그림 화살표가 없어 글자 화살표가
 * 유일한 신호다(`RankingCommon.tsx`의 같은 함수 머리말 참조).
 */

import {
  accountTally, grainCap, grainCost, squadCap,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import type { PlaceId } from './backdrop.ts';
import { stripBackArrow, sumText } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/** 그림 화살표(`::before`)를 입힌 자리 — 거기서만 문구의 「← 」를 뗀다.
    장터는 아직 리스킨 전이라 글자 화살표가 유일한 신호다(머리말 참조). */
const RESKINNED: readonly PlaceId[] = ['palace', 'barracks'];

export function PlaceScreen({ profile, place, onBack, onSortie, onSquads, onOfficers, onCity, onMarket }: {
  profile: PlayerProfile;
  place: PlaceId;
  onBack: () => void;
  onSortie: () => void;
  onSquads: () => void;
  onOfficers: () => void;
  onCity: () => void;
  onMarket: () => void;
}): React.JSX.Element {
  useLang();
  // 자리 그림은 **시간대를 타지 않는다** — 원본이 자리별로만 그려져 있다.
  return (
    <ScreenChrome
      backdrop={placeBackdrop(place, profile.cityLevel)}
      className={`scr-place scr-place-${place}`}
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {RESKINNED.includes(place) ? stripBackArrow(t('place.back')) : t('place.back')}
        </button>
        <span className="place-nm">{t(`place.${place}`)}</span>
      </div>

      {/* 병영의 현황 판은 **`.place-body` 밖**, 제목 바 바로 밑이다 — 대장간의
          `.frg-status`와 같은 자리다. `.place-body`가 `margin-top: auto`로 문
          판을 바닥에 붙이므로(궁궐과 같은 결) 그 안에 넣으면 현황도 함께 내려와
          그림이 통째로 가려진다. */}
      {place === 'barracks' && <BarracksStatus profile={profile} />}

      <div className="place-body">
        {place === 'barracks' && <BarracksDoors onSortie={onSortie} onSquads={onSquads} />}
        {place === 'palace' && (
          /* 37쪽의 두 갈래. **[도시 관리]는 C2(41쪽)가 열었다** — 잠겨 있던 동안
             「아직 열리지 않았다」를 달아 둔 것이 「눌리는데 아무 일도 없으면
             「고장인가」가 남는다」에 대한 처리였다. */
          <section className="place-panel">
            <button className="btn wide" data-action="officers" onClick={onOfficers}>
              <span className="lbl">{t('palace.officers')}</span>
              <span className="sub">{t('palace.officers.sub')}</span>
            </button>
            <button className="btn wide" data-action="city" onClick={onCity}>
              <span className="lbl">{t('palace.city')}</span>
              <span className="sub">{t('palace.city.sub')}</span>
            </button>
          </section>
        )}
        {place === 'market' && (
          /* 42쪽처럼 「자리 → 그 안의 화면」 한 걸음이다 — 가챠 하나뿐이라도
             지금까지의 결(궁궐·병영)을 그대로 따른다. 골드 충전·카드 정리는
             아직 결정 안 됐으므로 이름을 미리 붙이지 않는다(§5-20). */
          <section className="place-panel">
            <button className="btn wide" data-action="gacha" onClick={onMarket}>
              <span className="lbl">{t('place.gacha')}</span>
              <span className="sub">{t('place.gacha.sub')}</span>
            </button>
          </section>
        )}
      </div>
    </ScreenChrome>
  );
}

/**
 * 병영의 현황 판 — 「문 앞에서 말한다」 (2026-09-16, 트랙 10d).
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 여기에 숫자를 세우나 ★
 * ────────────────────────────────────────────────────────────────
 *
 * [출정하기]가 **왜 안 되는지를 지금은 안쪽에 들어가야만 알았다** — 문을 열고
 * `SortieScreen`의 「구성을 선택해주세요.」까지 가야 모드마다 군량이 모자란다는
 * 말이 나온다. 가진 군량과 부대 수를 문 앞에 세우면 그 걸음이 사라진다.
 *
 * **숫자는 전부 이미 있는 함수가 낸다** — `grainCap()`·`grainCost()`·
 * `squadCap()`·`accountTally()`. 화면이 상한이나 참가비를 다시 적으면(예: 3·5를
 * 글자로 박으면) 정원이 바뀌는 날 **표시만** 조용히 어긋난다. 참가비를 **글자로
 * 보여 주는 줄은 2026-09-16에 뺐지만**(기획자 지정) `grainCost()`는 여전히
 * 여기서 부른다 — 「모자란다」의 경계가 그 값이기 때문이다.
 *
 * **[출정하기]는 여전히 안 잠근다** — 잠기는 이유가 둘이고(군량 · 장수 수) 모드마다
 * 갈려서, 여기서 막으면 「3v3은 되는데 5v5는 안 된다」를 말할 자리가 없다. 대신
 * 모자랄 때 **그 사실만** 한 줄로 적는다(`data-low`).
 *
 * 전적은 **계정 전적**(`accountTally`)이다 — 장수 전적을 더하면 한 판에 3~5명이
 * 뛰어 출전 수가 사람 수만큼 부풀려진다(§전적은 한 번만 센다).
 */
function BarracksStatus({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  const cost3 = grainCost('3v3');
  // 둘 중 **싼 쪽**도 못 내면 어느 문으로도 못 나간다 — 그때만 모자라다고 적는다
  const low = profile.grain < cost3;
  return (
    <section className="place-panel bar-status">
      <div className="bar-stats">
        <span className="bar-stat" data-field="grain" data-low={low ? '1' : '0'}>
          <img className="bar-icon" src="market/grain.png" alt={t('main.grain')} title={t('main.grain')} />
          <b className="v">{profile.grain}</b>
          <span className="cap">/ {grainCap(profile)}</span>
        </span>
        <span className="bar-stat" data-field="squads">
          <img className="bar-icon" src="icons/tab-squad.png" alt={t('squads.title')} title={t('squads.title')} />
          <b className="v">{profile.squads.length}</b>
          <span className="cap">/ {squadCap(profile)}</span>
        </span>
      </div>
      {/* 통산 전적 — 랭킹·전적 화면이 쓰는 그 한 줄(`records.sum`)을 그대로 빌린다 */}
      <p className="hint" data-field="record">{sumText(accountTally(profile))}</p>
      {/* 참가비 줄(「출정 참가비 — 3vs3 3 · 5vs5 5」)은 **2026-09-16에 뺐다**
          (기획자 지정). 문구(`barracks.cost`)는 열 언어에 그대로 남겨 둔다 —
          되살릴 때 번역을 다시 받지 않아도 되고, 안 쓰는 키는 값이 안 든다.
          **모자랄 때 말하는 것은 남는다** — 그쪽이 「왜 안 되는가」의 답이다. */}
      {low && <p className="note" data-field="lowGrain">{t('barracks.lowGrain')}</p>}
    </section>
  );
}

/**
 * 병영의 문 셋 — 42·45쪽.
 *
 * **차례는 [튜토리얼 시나리오] · [부대 편성] · [출정하기]다** (2026-09-16 기획자
 * 지정). 처음 온 사람이 밟을 차례대로 위에서 아래이고, 맨 아래의 [출정하기]만
 * 옥색이라 **「오늘 누를 단추」가 눈의 끝에 온다.**
 *
 * **단추는 판때기의 직계 자식이어야 한다** — 스모크가
 * `.scr-place-barracks .place-panel > .btn`으로 문을 센다(`tools/smoke_meta.ts`).
 * 대장간처럼 `<div>`로 감싸면 검사가 조용히 빈 목록을 보고, 그러면 「문이 없다」가
 * 아니라 **아무 말도 안 하게** 된다.
 *
 * ⚠ **안내문 둘을 뺐다** (2026-09-16 기획자 지정) — [출정하기] 밑의 「상대가
 * 사람인지 AI인지는 고를 수 없다」(`barracks.aiNote`)와 [튜토리얼] 밑의 「아직
 * 열리지 않았다」(`place.soon`)다. 뒤엣것은 **§5-20**(「잠긴 자리는 왜인지
 * 적는다 — 아무 말이 없으면 「고장인가」가 남는다」)와 부딪히는데, 잠긴 단추가
 * **눌리지 않는 것 자체로** 말한다는 판단이다. 되살릴 자리는 여기 한 곳이고
 * 문구는 열 언어에 그대로 남아 있다.
 */
function BarracksDoors({ onSortie, onSquads }: {
  onSortie: () => void;
  onSquads: () => void;
}): React.JSX.Element {
  return (
    <section className="place-panel bar-doors">
      <button className="btn wide" data-action="tutorial" disabled>
        <span className="lbl">{t('barracks.tutorial')}</span>
        <span className="sub">{t('barracks.tutorial.sub')}</span>
      </button>

      <button className="btn wide" data-action="squads" onClick={onSquads}>
        <span className="lbl">{t('barracks.squads')}</span>
        <span className="sub">{t('barracks.squads.sub')}</span>
      </button>

      <button className="btn wide primary" data-action="sortie" onClick={onSortie}>
        <span className="lbl">{t('barracks.sortie')}</span>
        <span className="sub">{t('barracks.sortie.sub')}</span>
      </button>
    </section>
  );
}
