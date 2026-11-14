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
  CITY_NAME_MAX, CITY_RENAME_GOLD, buildingLevel, canRenameCity, grainCap, grainCost, hasEmperor,
  growthCue, guideSeen, poolCap, poolUsed, SORTIE_TUTORIALS, S_TUTORIAL_OFFICERS, SQUAD_SLOTS, sTutorialId, squadAt, squadRow, sumTally,
  tutorialDone, tutorialStatus,
} from '@samchess/meta';
import type { MetaResult, PlayerProfile } from '@samchess/meta';
import { useEffect, useState } from 'react';
import { fetchDefense } from '../meta/defense.ts';
import { OfficerStand } from './OfficerArt.tsx';
import { pickOfficerNameById } from '../i18n/story.ts';
import type { GameIconName } from '../ui/gameIcon.ts';
import { reasonText } from '../i18n/reason.ts';
import { currentSession } from '../meta/auth.ts';
import { renameCityOnServer } from '../meta/city.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { CityBonusMark } from './CityBonus.tsx';
import { placeBackdrop } from './backdrop.ts';
import type { PlaceId } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon, ModeIcon } from './GameIcon.tsx';
import { t } from '../i18n/index.ts';
import { roleText } from './squadText.ts';
import { useLang } from '../i18n/useLang.ts';
import { guidesEnabled } from './guideScript.ts';


/** 그림 화살표(`::before`)를 입힌 자리 — 거기서만 문구의 「← 」를 뗀다.
    장터는 아직 리스킨 전이라 글자 화살표가 유일한 신호다(머리말 참조). */
const RESKINNED: readonly PlaceId[] = ['palace', 'barracks'];

export function PlaceScreen({ profile, place, onBack, onChange, sortieBlocked, onSortie, onSquads, onTutorial, onOfficers, onCity }: {
  profile: PlayerProfile;
  place: PlaceId;
  onBack: () => void;
  /** 궁궐 현황 판의 [이름 변경]이 서버에서 받은 계정을 갈아 끼우는 자리 (2026-09-18) */
  onChange: (next: PlayerProfile) => void;
  /** 출정이 막히는가 — 기본 튜토리얼 · 도적떼(GDD §5.11). 규칙(`sortieGate`)이 정하고 여기는 받기만 한다 */
  sortieBlocked?: MetaResult;
  onSortie: () => void;
  onSquads: () => void;
  /** 튜토리얼 목록 (G3, 2026-10-22) */
  onTutorial: () => void;
  onOfficers: () => void;
  onCity: () => void;
}): React.JSX.Element {
  useLang();
  const [growthOn] = useState(guidesEnabled);
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
      {place === 'palace' && <PalaceStatus profile={profile} onChange={onChange} />}

      <div className="place-body">
        {place === 'barracks' && (
          <BarracksDoors onSortie={onSortie} onSquads={onSquads} onTutorial={onTutorial} blocked={sortieBlocked} />
        )}
        {place === 'palace' && (
          /* 37쪽의 두 갈래. **[도시 관리]는 C2(41쪽)가 열었다** — 잠겨 있던 동안
             「아직 열리지 않았다」를 달아 둔 것이 「눌리는데 아무 일도 없으면
             「고장인가」가 남는다」에 대한 처리였다. */
          <section className="place-panel">
            {/* 장수 일람으로 이끈다 — 상세를 한 번 열어 볼 때까지(`officer.card`), 증축 표지가 없을 때만 (2026-11-14 기획자) */}
            <button className="btn wide" data-action="officers" onClick={onOfficers}
              data-guide-cue={growthOn && !growthCue(profile) && !guideSeen(profile, 'officer.card') ? '' : undefined}>
              <span className="lbl">{t('palace.officers')}</span>
              <span className="sub">{t('palace.officers.sub')}</span>
            </button>
            {/* 첫 증축의 길(2026-11-13) — 증축할 채비가 됐거나 첫 증축 뒤 아직 안 지었으면 [도시 관리]가 빛난다 */}
            <button className="btn wide" data-action="city" data-guide-cue={growthOn && growthCue(profile) ? '' : undefined} onClick={onCity}>
              <span className="lbl">{t('palace.city')}</span>
              <span className="sub">{t('palace.city.sub')}</span>
            </button>
          </section>
        )}
        {/* 장터는 이 자리 화면을 거치지 않는다 (2026-09-24, pptx 76쪽) — 도시의 장터 자리가
            곧장 장터 홈(`MarketScreen`)을 연다. 홈이 곧 현황판·명령판이라 자리 화면이 한 겹 더
            있으면 [가챠] 하나만 든 빈 걸음이 된다 */}
      </div>
    </ScreenChrome>
  );
}

/**
 * 궁궐의 현황 판 — 도시의 얼굴 (2026-09-18, 기획자 지정).
 *
 * ```
 *              테스트도시              [이름 변경]
 *   도시 Lv4      황제 : 옹립
 *   궁궐 Lv1      등용 장수 : 13 / 60 명
 * ```
 *
 * 두 단 · 왼쪽 정렬이고 줄이 곧 주제다 — 윗줄은 도시(레벨 · 황제), 아랫줄은 궁궐(레벨 ·
 * 궁궐이 정하는 등용 한도). [이름 변경]은 판 오른쪽 벽에 붙는다(2026-09-18 두 번째 지정).
 *
 * 이 넷만 적는다 — 증축에 드는 자재는 증축을 고르는 자리(도시 관리)에 남았다.
 * 글꼴은 병영 현황 판의 「병영 Lv1」(`.bar-level`)과 같다.
 *
 * **값은 규칙이 낸다** — `hasEmperor()`(보관함에 있어도 옹립이다 · 증축 조건과 같은 셈) ·
 * `poolCap()`/`poolUsed()`(궁궐이 정하는 등용 한도). 화면이 따로 셈하면 하나가 낡는다.
 *
 * **[이름 변경]은 도시 관리에서 옮겨 왔다** — 이름이 여기 있으니 고치는 단추도 여기다.
 * 서버가 한다(금화·쿨다운이 서버 소유, A1). 못 닿으면 물러나지 않고 말한다.
 */
function PalaceStatus({ profile, onChange }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  const emperor = hasEmperor(profile);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const rename = (name: string): void => {
    setRenaming(false);
    setRefused(null);
    setBusy(true);
    void (async () => {
      try {
        const fromServer = await renameCityOnServer(name);
        if (fromServer) onChange(fromServer);
        else setRefused(t('server.offline'));
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };
  // 팝업·가리개는 판 **밖**, 화면 바로 밑에 둔다 — 판 안이면 판(`position: relative`)에 갇혀
  // 판 크기만 한 팝업이 된다. 도시 관리가 두던 자리와 같다
  return (
    <>
    <section className="place-panel plc-status" data-field="palaceStatus">
      <div className="plc-name-row">
        <h2 className="cap plc-city" data-field="cityName">{profile.cityName}</h2>
        {/* 붉은 목판(`assets/icons/ui/button_forcedcancel.png` → `ui/btn-forcedcancel.png`) */}
        <button className="btn sm plc-rename" data-action="rename" onClick={() => setRenaming(true)}>
          <GameIcon name="mk-edit" label={t('city.rename')} text />
        </button>
      </div>
      <div className="plc-grid">
        <span className="plc-cell" data-field="cityLevel">{t('city.summary.level', { level: profile.cityLevel })}</span>
        <span className="plc-cell" data-field="emperor" data-emperor={emperor ? '1' : '0'}>
          <GameIcon name="emperor" label={t('palace.emperor', { state: emperor ? t('city.emperor.yes') : t('city.emperor.no') })} text />
        </span>
        <span className="plc-cell" data-field="palaceLevel">{t('palace.summary.level', { level: buildingLevel(profile, 'palace') })}</span>
        <span className="plc-cell" data-field="pool"><GameIcon name="tab-officer" label={t('palace.pool', { have: poolUsed(profile), max: poolCap(profile) })} text /></span>
      </div>
      {refused && <p className="note" data-field="refused">{refused}</p>}
    </section>
    {renaming && <RenameModal profile={profile} onClose={() => setRenaming(false)} onConfirm={rename} />}
    {busy && <BusyVeil />}
    </>
  );
}

/**
 * 도시 이름 변경 확인 — 랭킹·매칭에 노출될 이름이라 값싼 재설정을 막는
 * 관문(2026-08-25 기획: 금화 소모 + 3일 쿨다운). 값이 나가고 되돌릴 수 없는
 * 수라 증축과 같은 결로 한 번 묻는다. **왜 안 되는지는 `canRenameCity()`가
 * 말한다** — 잠긴 단추만 두면 화면이 「고장인가」로 읽힌다.
 */
function RenameModal({ profile, onClose, onConfirm }: {
  profile: PlayerProfile; onClose: () => void; onConfirm: (name: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState(profile.cityName);
  const check = canRenameCity(profile, name, Date.now());

  return (
    <div className="modal-back" data-modal="rename" onClick={onClose}>
      <div className="modal mod-plank cty-modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('city.rename.title')}</p>
        <input
          className="field"
          autoComplete="off"
          value={name}
          maxLength={CITY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && check.ok) onConfirm(name); }}
          autoFocus
        />
        <p className="row dim" data-field="cost">{t('city.rename.cost', { gold: CITY_RENAME_GOLD })}</p>
        {!check.ok && <p className="note" data-field="why">{check.reason}</p>}
        <div className="cty-acts">
          <button
            className="btn primary wide"
            data-action="renameConfirm"
            disabled={!check.ok}
            onClick={() => onConfirm(name)}
          >
            {t('city.rename.ok')}
          </button>
          <button className="btn wide" data-action="renameCancel" onClick={onClose}>
            {t('city.rename.cancel')}
          </button>
        </div>
      </div>
    </div>
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
 * 말이 나온다. 가진 군량을 문 앞에 세우면 그 걸음이 사라진다.
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
 * 전적은 **공격대 둘의 부대 전적 합**이다(2026-11-14 기획자 — 그전에는 계정 전적). 수성은 AI가 하는 것이라
 * 공성전에서 막은 판 수만 그 옆에 따로 세운다(방어 기록, 서버). 그 아래 튜토리얼 현황 한 줄과 부대 칸 넷(꼬마 명단만)이 선다 —
 * 옛 「부대 수」와 「최근 부대 셋」(부대마다 전적)은 걷었다.
 */
function BarracksStatus({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  const cost3 = grainCost('3v3');
  // 둘 중 **싼 쪽**도 못 내면 어느 문으로도 못 나간다 — 그때만 모자라다고 적는다
  const low = profile.grain < cost3;
  // 전적은 **공격대 둘의 부대 전적**만 합친다(2026-11-14 기획자) — 수성은 AI가 하는 것이라 아래 「막은 판」으로 따로 센다.
  // 키가 `{상대}/{모드}`라 3v3 · 5v5 칸이 겹치지 않아 그대로 합쳐 `sumTally()`에 넘긴다
  const attack = sumTally(Object.assign({}, ...(['3v3', '5v5'] as const).map((m) => squadAt(profile, m, 'attack')?.record ?? {})));
  // 수성전에서 막은 판 — 방어 기록은 서버에만 있다(`GET /defense`의 `summary.held`). 못 닿으면 「—」
  const [held, setHeld] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchDefense().then((d) => { if (alive && d) setHeld(d.summary.held); });
    return () => { alive = false; };
  }, []);
  return (
    <section className="place-panel bar-status">
      <div className="bar-stats">
        {/* 건물 레벨을 맨 앞에 — 병원·대장간 현황판의 「{건물} Lv{n}」과 같은 꼴(2026-09-18 지정).
            군량 상한이 곧 병영 레벨에서 나오므로 바로 옆 숫자의 까닭이기도 하다 */}
        <span className="bar-stat bar-level" data-field="level">
          {t('barracks.summary.level', { level: buildingLevel(profile, 'barracks') })}
        </span>
        <span className="bar-stat" data-field="grain" data-low={low ? '1' : '0'}>
          <img className="bar-icon" src="market/grain.png" alt={t('main.grain')} title={t('main.grain')} />
          <b className="v">{profile.grain}</b>
          <span className="cap">/ {grainCap(profile)}</span>
          {/* 최대 군량을 늘린 컬렉션이 있으면 인장 — 도시 관리 · 농지와 같은 표지 (2026-10-15) */}
          <CityBonusMark profile={profile} keys={['grainCap']} />
        </span>
      </div>
      {/* 전적 — 아이콘 + 군량만 한 큰 숫자: 전 · 승 · 무 · 패 · 적격파(공격대 합), 그 옆에 수성전에서 막은 판 (2026-11-14 기획자) */}
      <div className="bar-record" data-field="record"
        data-plays={attack.plays} data-w={attack.wins} data-d={attack.draws} data-l={attack.losses} data-k={attack.kills}>
        <RecordCell icon="rec-sorties" label={t('records.col.plays')} n={attack.plays} k="plays" />
        <RecordCell icon="rec-win" label={t('records.result.win')} n={attack.wins} k="w" />
        <RecordCell icon="rec-draw" label={t('records.result.draw')} n={attack.draws} k="d" />
        <RecordCell icon="rec-lose" label={t('records.result.lose')} n={attack.losses} k="l" />
        <RecordCell icon="rec-kills" label={t('ranking.col.kills')} n={attack.kills} k="k" />
        <span className="bar-rec bar-held" data-field="held" data-held={held ?? ''}>
          <GameIcon name="tut-next" label={t('barracks.held')} />
          <b className="v">{held ?? '—'}</b>
        </span>
      </div>
      <TutorialLine profile={profile} />
      {/* 참가비 줄은 2026-09-16에 뺐다(기획자 지정). **모자랄 때 말하는 것은 남는다** — 그쪽이 「왜 안 되는가」의 답이다 */}
      {low && <p className="note" data-field="lowGrain">{t('barracks.lowGrain')}</p>}
      <SquadBoard profile={profile} />
    </section>
  );
}

/** 전적 한 칸 — 아이콘 + 큰 숫자. 낱말은 `title`로 */
function RecordCell({ icon, label, n, k }: { icon: GameIconName; label: string; n: number; k: string }): React.JSX.Element {
  return (
    <span className="bar-rec" data-k={k}>
      <GameIcon name={icon} label={label} />
      <b className="v">{n}</b>
    </span>
  );
}

/**
 * 튜토리얼 클리어 현황 — 관리자 계정 상세의 요약과 같은 셈(2026-11-14 기획자): 출정 필수 판 끝낸 수 / 전부,
 * S급 판 끝낸 수 / 보유해서 열린 수(끝낸 것 포함). 판정은 meta의 `tutorialDone` · `tutorialStatus`
 */
function TutorialLine({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  const basic = SORTIE_TUTORIALS.filter((id) => tutorialDone(profile, id)).length;
  const sStatus = S_TUTORIAL_OFFICERS.map((o) => tutorialStatus(profile, sTutorialId(o)));
  const sDone = sStatus.filter((x) => x === 'done').length;
  const sOpen = sStatus.filter((x) => x !== 'hidden').length;
  return (
    <p className="hint bar-tut" data-field="tutorial" data-basic={basic} data-s-done={sDone} data-s-open={sOpen}>
      <GameIcon name="tut-unique" label={t('barracks.tutorial')} />
      {t('barracks.tutorial.sum', { basic, basicAll: SORTIE_TUTORIALS.length, s: sDone, sOpen })}
    </p>
  );
}

/**
 * 부대 현황 — 칸 넷을 꼬마 명단으로만 (2026-11-14 기획자). 위 줄 3v3 · 아래 줄 5v5, 왼쪽 공격대 · 오른쪽 수비대(`SQUAD_SLOTS` 차례).
 * 모드는 왼쪽 아이콘(3인 · 5인)이, 공격 · 수비는 그 옆 아이콘(쌍칼 · 수비군 메달)이 말한다 — 「3vs3 수비대」 글자 · 전적 · 전투력은 안 쓴다.
 */
function SquadBoard({ profile }: { profile: PlayerProfile }): React.JSX.Element {
  return (
    <div className="bar-squads" data-field="squads">
      {SQUAD_SLOTS.map((slot) => {
        const squad = squadAt(profile, slot.mode, slot.role);
        const members = squad ? squadRow(profile, squad).members : [];
        const names = members.map((m) => pickOfficerNameById(m.officer, m.name));
        return (
          <div key={slot.id} className="bar-sq" data-slot={slot.id} data-filled={squad ? '1' : '0'}>
            <span className="bar-sq-md"><ModeIcon mode={slot.mode} /></span>
            <img className="bar-sq-role" src={slot.role === 'attack' ? 'icons/battle.png' : 'ui/gi/me.png'}
              alt={roleText(slot.role)} title={roleText(slot.role)} draggable={false} />
            <span className="bar-sq-who" data-names={names.join(', ')} aria-label={names.join(', ') || '—'}>
              {squad ? members.map((m, i) => <OfficerStand key={m.officer} officer={m.officer} title={names[i] ?? m.name} />)
                : <span className="bar-sq-empty">—</span>}
            </span>
          </div>
        );
      })}
    </div>
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
function BarracksDoors({ onSortie, onSquads, onTutorial, blocked }: {
  onSortie: () => void;
  onSquads: () => void;
  onTutorial: () => void;
  blocked?: MetaResult | undefined;
}): React.JSX.Element {
  const why = blocked && !blocked.ok ? reasonText(blocked) : null;
  const code = blocked && !blocked.ok ? blocked.code ?? '' : '';
  // 수비군이 없어 막힌 것은 단추 밑에 안 적는다 — 내관이 병영 안내에서 말한다(2026-11-12 기획자). 단추는 그대로 잠긴다
  const said = why !== null && code !== 'sortie.noGarrison';
  return (
    <section className="place-panel bar-doors">
      {/* 튜토리얼이 열렸다 (G3, 2026-10-22) — 기본 셋을 끝내야 [출정하기]가 열린다(`sortieGate`) */}
      <button className="btn wide" data-action="tutorial" onClick={onTutorial}>
        <span className="lbl">{t('barracks.tutorial')}</span>
        <span className="sub">{t('barracks.tutorial.sub')}</span>
      </button>

      <button className="btn wide" data-action="squads" onClick={onSquads}>
        <span className="lbl">{t('barracks.squads')}</span>
        <span className="sub">{t('barracks.squads.sub')}</span>
      </button>

      <button className="btn wide primary" data-action="sortie" disabled={why !== null} data-blocked={code || undefined} onClick={onSortie}>
        <span className="lbl">{t('barracks.sortie')}</span>
        <span className="sub">{t('barracks.sortie.sub')}</span>
      </button>
      {/* 안 되는 이유는 제 단추 바로 밑에 — 기본 튜토리얼을 안 끝냈거나 도적떼가 농지를 노리는 동안이다 */}
      {/* `data-code` — 막은 쪽(튜토리얼 · 도적떼). 스모크가 글자가 아니라 이것으로 누가 막았는지 본다 */}
      {/* 막은 쪽은 글자가 없어도 단추의 `data-blocked`가 말한다 */}
      {said && <p className="hint" data-field="sortieBlocked" data-code={code}>{why}</p>}
    </section>
  );
}
