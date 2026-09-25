/**
 * 출정하기 — 구성과 부대를 **한 화면에서** 고른다 (pptx 45쪽 · 2026-09-18 재구성)
 *
 * ```
 * [← 병영으로]        출 정 하 기
 * ┌ 구성 판 ────────────────────────────────┐
 * │ 구성을 선택해주세요.                      │
 * │ [ 3 vs 3  🌾 3 ]   [ 5 vs 5  🌾 5 ]      │
 * └─────────────────────────────────────────┘
 * ┌ 부대 판 (처음부터 **빈 채로** 서 있다) ───┐
 * │ 부대를 선택해주세요.                      │
 * │  이름   │   명단    │ 전투력              │
 * │ 초전박살 │ 조조, 관흥… │  843              │
 * │            1 / 2  (한 쪽에 다섯)          │
 * └─────────────────────────────────────────┘
 * ┌ 명령 판 (화면 바닥) ─────────────────────┐
 * │ [ 대전상대 찾기 ]  [ 뒤로 가기 ]          │
 * └─────────────────────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 걸음 둘을 한 화면으로 폈다 ★ (2026-09-18 기획자 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 「구성을 선택해주세요.」와 「부대를 선택해주세요.」가 **화면 둘**이었고
 * 제목 바가 그 안내문을 달고 있었다. 이제 제목은 **[출정하기]**(문의 이름 그대로)
 * 이고 안내문은 **제 판 안의 첫 줄**로 내려왔다 — 어느 판을 보고 하는 말인지가
 * 글자 옆에 붙어 있어야 한다. 구성 판은 고른 뒤에도 그대로 남아 **지금 고른 것이
 * 무엇인지**를 계속 말한다(`data-on`).
 *
 * ★ **부대 판은 처음부터 서 있다** (2026-09-18 둘째 지정) — 고른 뒤에 **새로
 * 나타나면** 그 순간 아래 판들이 통째로 밀려 내려가 화면이 한 번 들썩인다. 처음엔
 * **빈 명단**으로 서 있다가 구성을 고르면 **안이 갱신된다** — 자리는 처음부터
 * 정해져 있고 내용만 바뀐다.
 *
 * ★ **부대가 있는 구성은 미리 골라 둔다** (2026-09-25 지정, `defaultMode`) — 한쪽에만
 * 부대가 있으면 그쪽, 둘 다 있으면 3v3. 빈 명단으로 여는 것은 **부대가 하나도 없을
 * 때뿐**이다.
 *
 * `data-step`은 그대로다(`mode` → `squad`) — 화면이 하나가 되어도 「지금 어디까지
 * 골랐나」는 여전히 두 걸음이고, 스모크가 그 속성으로 걸음을 본다.
 *
 * **부대 목록은 한 쪽에 다섯이다**(`PAGE_SIZE`) — 부대 목록 화면(42쪽)과 같은 셈·
 * 같은 `Pager`. 화면마다 쪽 넘김 모양이 다르면 그때마다 눈으로 찾게 된다.
 *
 * ────────────────────────────────────────────────────────────────
 * [새 편성 만들기]는 **표가 있을 자리**에 선다 ★ (2026-09-18 둘째 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * 그 구성의 부대가 하나도 없으면 표 대신 「부대가 없습니다.」 한 줄과 그 아래
 * [새 편성 만들기]가 **표가 놓일 그 자리**에 들어앉는다. 예전처럼 바닥 명령 판에
 * 늘 세워 두면, **부대가 있을 때도** 눈이 그 단추를 먼저 지나게 된다 — 만들라는
 * 말은 만들 것이 없을 때만 해야 한다(막다른 길을 두지 않는다는 규약은 그대로다).
 *
 * | 단추 | 빌린 그림 | 왜 |
 * |---|---|---|
 * | [새 편성 만들기] | 병영 [부대 관리]의 참나무 | 「다른 데로 간다」는 수 |
 * | [대전상대 찾기] | 병영 [출정하기]의 옥색 | **이 화면의 한 수**는 하나뿐이다 |
 * | [뒤로 가기] | 부대 목록 바닥의 참나무 | 어느 화면에서든 같은 모양이라야 손이 기억한다 |
 *
 * 명령 판은 **화면 바닥에 붙는다**(`margin-top: auto`) — 부대 판이 남는 높이를
 * 먹지 않으므로 그 자리는 판때기가 아니라 여백이 채운다.
 *
 * ⚠ **「상대가 사람인지 AI인지…」는 뺐다** (2026-09-18 기획자 지정) — 병영의 문
 * 밑에서 이미 한 번 뺀 그 문구(`barracks.aiNote`)다. 문구는 열 언어에 그대로
 * 남겨 둔다(되살릴 때 번역을 다시 받지 않는다).
 *
 * ────────────────────────────────────────────────────────────────
 * 군량 안내는 **매칭에 들어가기 전에** 받는다 (§5-16)
 * ────────────────────────────────────────────────────────────────
 *
 * 딱 최소 군량이면 매칭된 상대와 반드시 싸워야 한다 — 들어간 뒤에 「거절이 안 된다」를
 * 알면 늦다. **판정은 화면이 하지 않는다**(`canDeclineMatch`) — `grain > 3`을 여기 적으면
 * 참가비나 패널티가 바뀌었을 때 조용히 어긋난다.
 *
 * 참가비도 마찬가지로 `grainCost()`가 낸다. **글자 「군량」은 그림으로 갈았다**
 * (2026-09-18 지정) — 장터·병영 현황이 이미 쓰는 그 아이콘(`market/grain.png`)이라
 * 한 눈금으로 읽힌다.
 */

import { useEffect, useMemo, useState } from 'react';
import { MARKET_ITEMS, marketItemById } from '@samchess/data';
import type { MarketItemData } from '@samchess/data';
import {
  canStartMatch, canDeclineMatch, carryItem, equippedBy, grainCost, marketHeldCount, poolUsed,
  squadRow, squadsOf, uncarryItem,
} from '@samchess/meta';
import type { PlayerProfile, RosterPick, Squad, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { GrainCost } from './GrainCost.tsx';
import { Pager } from './PagerButton.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { SquadRoster } from './SquadViewScreen.tsx';
import { pickEquipName, pickMarketItemName } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

const MODES: BattleMode[] = ['3v3', '5v5'];

/** 한 쪽에 다섯 부대 — 부대 목록 화면(42쪽)과 같은 셈 */
const PAGE_SIZE = 5;

export function SortieScreen({ profile, onBack, onNewSquad, onSeek, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNewSquad: () => void;
  onSeek: (mode: BattleMode, squad: Squad) => void;
  /** 지참을 고치면 계정이 바뀐다 — `marketCarry`는 클라이언트 소유라 `PUT`으로 나간다 */
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  /** 구성을 고르기 전에는 부대 판을 안 편다 — 3v3 자리에 5v5 부대를 얹을 수 없다.
   *  처음 값은 `defaultMode()` — 부대가 있는 구성을 미리 골라 둔다 */
  const [mode, setMode] = useState<BattleMode | null>(() => defaultMode(profile));
  const [picked, setPicked] = useState<string | null>(null);
  /** 들여다보는 부대 — 줄을 누르면 부대 현황이 팝업으로 뜬다(고르는 것과 따로) */
  const [peek, setPeek] = useState<Squad | null>(null);
  /** 「딱 최소 군량」 안내. 확인을 받은 뒤에야 매칭으로 넘어간다 */
  const [asking, setAsking] = useState<{ mode: BattleMode; squad: Squad; reason: string } | null>(null);

  /** **그 모드의 부대만** 보여준다 — 값 범위가 겹치는 두 모드를 나란히 놓지 않는다(GDD §7.1) */
  const rows = useMemo(
    () => (mode === null ? [] : squadsOf(profile, mode).map((s) => squadRow(profile, s))),
    [profile, mode],
  );

  /* 쪽 — 구성을 바꾸면 첫 쪽으로. 부대가 줄어 지금 쪽이 사라지면 마지막 쪽에 머문다 */
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [mode]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  /** 성립하지 않는 부대(`power === null`)는 골라도 출전이 아니다 */
  const chosen = rows.find((r) => r.squad.id === picked && r.power !== null) ?? null;

  /** 지금 가진 아이템 — 보유가 0이 된 것은 목록에서 빠진다 */
  const ownedItems = useMemo(
    () => MARKET_ITEMS.filter((i) => marketHeldCount(profile, i.id) > 0),
    [profile],
  );

  const seek = (): void => {
    if (mode === null || !chosen) return;
    // 화면이 판정하지 않는다 — 거절할 수 없는 상태면 먼저 알린다.
    // **안내문도 규칙이 준다** — 옮겨 적으면 45쪽의 「군량 3소모」처럼 낡은 글자가 남는다
    const decline = canDeclineMatch(profile, mode);
    if (decline.ok) onSeek(mode, chosen.squad);
    else setAsking({ mode, squad: chosen.squad, reason: decline.reason });
  };

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-sortie"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="sortie" data-step={mode ? 'squad' : 'mode'}>
        {/* 그림 화살표(`::before`)를 입혔으므로 문구의 「← 」는 뗀다 — 병영·부대 목록과
            같은 자리·같은 이유(`RankingCommon.tsx`의 `stripBackArrow` 머리말) */}
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('sortie.back'))}
        </button>
        {/* 제목은 문의 이름 그대로 — 안내문은 판 안으로 내려갔다 */}
        <span className="place-nm">{t('barracks.sortie')}</span>
      </div>

      <div className="place-body">
        <ModeStep
          profile={profile}
          mode={mode}
          onPick={(m) => { setMode(m); setPicked(null); }}
        />

        {/* 부대 판 — **구성을 고르기 전에도 서 있다.** 그때는 명단이 비어 있고
            머리와 쪽 줄만 남는다(자리가 처음부터 정해져 있어야 화면이 안 들썩인다) */}
        <section className="place-panel srt-list" data-mode={mode ?? ''}>
          <p className="hint srt-guide" data-field="pickSquad">{t('sortie.pickSquad')}</p>
          <div className="srt-thead">
            <span>{t('squads.col.name')}</span>
            <span>{t('squads.col.members')}</span>
            <span>{t('squads.col.power')}</span>
            {/* 체크 칸의 제목 — 장수 고르기 팝업과 같은 낱말(`squad.pick`) */}
            <span className="c-pick">{t('squad.pick')}</span>
          </div>
          <div className="srt-page">
            {/* 「아직 안 골랐다」와 「그 구성의 부대가 없다」는 **다른 말**이다 —
                앞엣것은 빈 명단(위 구성 판을 보라는 뜻)이고, 뒤엣것만
                [새 편성 만들기]로 보낸다. 한 문구로 합치면 한쪽이 거짓말이 된다. */}
            {mode !== null && rows.length === 0 ? (
              <div className="srt-none">
                <p className="hint" data-field="noSquad">{t('sortie.empty')}</p>
                {/* 「직접 편성 루트」 — 만들 것이 없을 때 **그 자리에서** 만들고 온다
                    (막다른 길에 세우지 않는다) */}
                <button className="btn wide" data-action="newSquad" onClick={onNewSquad}>
                  <span className="lbl">{t('sortie.newSquad')}</span>
                </button>
              </div>
            ) : (
              <div className="srt-rows">
                {pageRows.map((row) => (
                  <SquadLine
                    key={row.squad.id}
                    row={row}
                    on={picked === row.squad.id}
                    onPick={() => setPicked(row.squad.id)}
                    onPeek={() => setPeek(row.squad)}
                  />
                ))}
              </div>
            )}
          </div>
          {/* 쪽이 하나여도 그린다 — `1 / 1`이 「여기가 전부다」를 말하고, 판 높이도
              쪽 수와 무관하게 같다(부대 목록과 같은 판단) */}
          <Pager page={current} pageCount={pageCount} onPage={setPage} ends />
        </section>

        {/*
         * 지참 판 — **부대를 고른 뒤에** 선다 (2026-09-23, GDD §6.5).
         *
         * 사는 곳은 장터지만 **판마다 다시 정하는 것**이라 여기서 고른다 — 장터에서만
         * 하면 「출정 → 아이템 없네 → 장터 갔다가 → 다시 병영」을 매 판 돈다.
         *
         * **가진 아이템이 없으면 줄만 한 줄 적고 목록을 안 편다** — 빈 드롭다운
         * 다섯 줄은 「고를 수 있는 것이 있다」로 읽힌다.
         */}
        {chosen && (
          <section className="place-panel srt-items" data-field="carry">
            <h2 className="cap">{t('sortie.items')}</h2>
            {ownedItems.length === 0 ? (
              <p className="hint" data-field="noItems">{t('sortie.items.none')}</p>
            ) : (
              <>
                <p className="hint">{t('sortie.items.lede')}</p>
                {chosen.squad.picks.map((pick) => (
                  <CarryRow
                    key={pick.officer}
                    profile={profile}
                    pick={pick}
                    items={ownedItems}
                    onPick={(item) => onChange(
                      item === null ? uncarryItem(profile, pick.officer)
                        : carryItem(profile, pick.officer, item),
                    )}
                  />
                ))}
              </>
            )}
          </section>
        )}

        {/* 명령 판 — 화면 바닥. 병영·부대 목록·도시와 같은 자리·같은 결 */}
        <section className="place-panel srt-acts">
          <button
            className="btn primary wide"
            data-action="seek"
            disabled={!chosen}
            onClick={seek}
          >
            <span className="lbl">{t('sortie.seek')}</span>
          </button>
          {/* [뒤로 가기] — 제목 바의 [병영으로]와 같은 일. 부대 목록 바닥 단추와
              **같은 참나무 목판**이고 글자도 같은 `match.back`이다 */}
          <button className="btn wide" data-action="backBottom" onClick={onBack}>
            <span className="lbl">{stripBackArrow(t('match.back'))}</span>
          </button>
        </section>
      </div>

      {peek && <SquadPeekModal profile={profile} squad={peek} onClose={() => setPeek(null)} />}

      {asking && (
        <MinGrainModal
          reason={asking.reason}
          onClose={() => setAsking(null)}
          onConfirm={() => { const it = asking; setAsking(null); onSeek(it.mode, it.squad); }}
        />
      )}
    </ScreenChrome>
  );
}

/**
 * 구성 단추가 잠겼나 — 군량 부족 · 장수 부족. 잠겼으면 그 이유를, 아니면 `null`.
 * `ModeStep`과 `defaultMode`가 **같은 판정**을 본다 — 잠긴 단추를 켜 둔 채로 열면
 * 누를 수 없는 구성의 부대가 깔린다.
 */
function modeLock(profile: PlayerProfile, m: BattleMode): string | null {
  const cost = grainCost(m);
  if (poolUsed(profile) < cost) return t('barracks.needOfficers', { n: cost });
  const grain = canStartMatch(profile, m);
  return grain.ok ? null : (grain as { reason: string }).reason;
}

/**
 * 처음 켜 둘 구성 (2026-09-25 기획자 지정) — 부대가 있는 구성을 미리 고른다.
 * 둘 다 있으면 3v3(`MODES`의 순서), 하나도 없으면 `null`(빈 명단 그대로).
 * 부대가 있어도 **잠긴 구성은 건너뛴다** — 누를 수 없는 단추가 켜져 있으면 거짓말이다.
 */
function defaultMode(profile: PlayerProfile): BattleMode | null {
  return MODES.find((m) => squadsOf(profile, m).length > 0 && modeLock(profile, m) === null) ?? null;
}

/**
 * 구성 판 — 「구성을 선택해주세요.」
 *
 * 잠기는 이유가 둘이라(군량 부족 · 장수 부족) **어느 쪽인지 글자로 말해 준다** —
 * 병영에 있던 그 판정이 그대로 옮겨 왔다. 잠긴 단추만 두면 「왜 안 눌리나」가 남는다.
 *
 * 고른 구성은 **그대로 켜져 남는다**(`data-on`) — 화면이 하나가 되면서 「지금 무엇을
 * 고른 상태인가」를 말할 자리가 여기밖에 없다.
 */
function ModeStep({ profile, mode, onPick }: {
  profile: PlayerProfile;
  mode: BattleMode | null;
  onPick: (mode: BattleMode) => void;
}): React.JSX.Element {
  return (
    <section className="place-panel srt-modes">
      <p className="hint srt-guide" data-field="pickMode">{t('sortie.pickMode')}</p>
      {/* 칩 둘은 **한 줄에 나란히** (2026-09-18 둘째 지정) — 새 편성 만들기의
          `.sqd-modes`와 같은 격자다 */}
      <div className="srt-moderow">
      {MODES.map((m) => {
        const lock = modeLock(profile, m);
        return (
          <button
            key={m}
            className="btn wide"
            data-mode={m}
            data-on={mode === m ? '1' : '0'}
            aria-pressed={mode === m}
            disabled={lock !== null}
            onClick={() => onPick(m)}
          >
            <span className="lbl">{m === '3v3' ? '3 vs 3' : '5 vs 5'}</span>
            <span className="sub">
              {lock ?? <GrainCost n={grainCost(m)} have={profile.grain} />}
            </span>
          </button>
        );
      })}
      </div>
    </section>
  );
}

/**
 * 45쪽 목록의 한 줄 — **고르는 것과 들여다보는 것은 다른 몸짓이다** (2026-09-18 지정).
 *
 * | 누르는 곳 | 일 |
 * |---|---|
 * | 맨 오른쪽 **체크 나무판**(`선택` 열) | 이 부대로 나간다 — 표시만 하고, 실제 출전은 [대전상대 찾기] |
 * | 줄의 나머지 | 부대 현황을 **팝업으로** 본다(`SquadPeekModal`) |
 *
 * 체크 판은 장수 고르기 팝업(부대 편집·대장간 지급)의 `선택` 열과 **같은 그림·같은
 * 클래스**다(`.lv-check` + `icons/confirm.png`) — 「고르는 UI는 한 가지」(기획자 지정).
 * 켜짐은 줄의 `data-on`이 말한다(장수 쪽은 `data-picked`, 레벨업은 `.on`).
 *
 * 줄이 `<button>`이 아니라 `role="button"`인 `<div>`인 이유도 장수 쪽과 같다 —
 * 안에 체크 단추가 또 들어가는데 **버튼 안 버튼은 무효 HTML**이라 브라우저가 태그를
 * 조용히 갈라 클릭 영역이 어긋난다.
 *
 * **성립하지 않는 부대는 고를 수 없고 이유를 적는다** — 들여다보는 것은 된다
 * (무엇이 모자란지 보려면 오히려 열어 봐야 한다).
 */
function SquadLine({ row, on, onPick, onPeek }: {
  row: SquadRow; on: boolean; onPick: () => void; onPeek: () => void;
}): React.JSX.Element {
  const broken = row.power === null;
  return (
    <div className="srt-row" data-squad={row.squad.id} data-on={on ? '1' : '0'} data-broken={broken ? '1' : '0'}>
      <div className="srt-open" role="button" tabIndex={0} data-action="peekSquad" onClick={onPeek}>
        <span className="srt-nm" data-field="name">{row.squad.name}</span>
        <span className="srt-who" data-field="members">
          {row.members.map((m) => pickOfficerNameById(m.officer, m.name)).join(', ') || '—'}
        </span>
        {/* 전투력은 규칙이 낸다 — `squadPower()`(= `battlePower()`) */}
        <span className="srt-pw" data-field="power" data-power={row.power ?? ''}>
          {broken ? '—' : row.power!.toLocaleString()}
        </span>
        <span className="c-pick">
          {/* `stopPropagation` — 줄을 누르면 팝업이 뜨는데, 고르는 것은 그와 다른 몸짓이다 */}
          <button
            className="lv-check"
            data-action="pickSquad"
            aria-pressed={on}
            aria-label={t('squad.pick')}
            disabled={broken}
            onClick={(e) => { e.stopPropagation(); onPick(); }}
          >
            <img className="lv-check-icon" src="icons/confirm.png" alt="" />
          </button>
        </span>
      </div>
      {row.problem && <p className="note" data-field="broken">{t('squads.broken', { why: row.problem })}</p>}
    </div>
  );
}

/**
 * 부대 현황 팝업 — 부대 현황 화면(67쪽)의 **판 하나만** 띄운다 (2026-09-18 지정).
 *
 * 속은 `SquadRoster`(부대 현황 화면과 **같은 컴포넌트**)이고, 판때기는 이 화면의 장부
 * 그림을 그대로 입는다. 닫는 자리는 **둘**이다 — 우상단의 X(대장간 병기 상세와 같은
 * `icons/close.png`)와 명단 바로 아래의 [닫기]. 바깥을 눌러도 닫힌다(`.modal-back`).
 *
 * 여기서는 **아무것도 안 고친다** — 고치는 길은 병영의 [부대 관리] 하나다(부대 현황
 * 화면 머리말). 여기서 고칠 수 있으면 배치를 안 본 채 저장되는 옛 길이 되살아난다.
 */
function SquadPeekModal({ profile, squad, onClose }: {
  profile: PlayerProfile; squad: Squad; onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-back" data-modal="squadPeek" data-squad={squad.id} onClick={onClose}>
      <div className="srt-peek-wrap" onClick={(e) => e.stopPropagation()}>
        <section className="place-panel sqv-panel srt-peek">
          <button className="srt-peek-x" data-action="peekX" onClick={onClose} aria-label={t('sortie.peek.close')}>
            <img className="srt-peek-x-icon" src="icons/close.png" alt="" />
          </button>
          <SquadRoster profile={profile} squad={squad} />
          <button className="btn wide" data-action="peekClose" onClick={onClose}>
            <span className="lbl">{t('sortie.peek.close')}</span>
          </button>
        </section>
      </div>
    </div>
  );
}

/**
 * 「대전을 위한 최소군량만 있을 때는 상대 매칭 시 거절을 할 수 없습니다.」
 *
 * **문구는 규칙이 준다** (`canDeclineMatch`의 이유). 화면이 옮겨 적으면 45쪽 목업의
 * 「군량 3소모」처럼 낡은 글자가 남는다.
 */
function MinGrainModal({ reason, onClose, onConfirm }: {
  reason: string; onClose: () => void; onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-back" data-modal="minGrain" onClick={onClose}>
      <div className="modal srt-modal" onClick={(e) => e.stopPropagation()}>
        <p className="row" data-field="warn">{reason}</p>
        <div className="srt-modal-acts">
          <button className="btn primary wide" data-action="minGrainOk" onClick={onConfirm}>
            {t('sortie.confirm')}
          </button>
          <button className="btn wide" data-action="minGrainCancel" onClick={onClose}>
            {t('sortie.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 지참 한 줄 — 장수 하나에 고르는 것 하나 (2026-09-23, GDD §6.5).
 *
 * **「없음」은 병기로 돌아간다** — 아이템과 병기가 같은 칸이라, 아이템을 안 들면
 * 지급받은 병기가 그대로 선다. 그래서 빈 칸의 이름이 「없음」이 아니라
 * **「병기 그대로」**다(병기가 있을 때) — 무엇을 들고 나가는지를 말해야 한다.
 *
 * 고를 수 있는 것은 **지금 가진 것**뿐이고, `canCarryItem()`이 「가진 만큼만」을
 * 판정하므로 여기서는 세지 않는다 — 규칙을 두 군데서 적지 않는다.
 */
function CarryRow({ profile, pick, items, onPick }: {
  profile: PlayerProfile;
  pick: RosterPick;
  items: readonly MarketItemData[];
  onPick: (item: string | null) => void;
}): React.JSX.Element {
  const carried = profile.marketCarry?.[pick.officer];
  const weapon = equippedBy(profile, pick.officer);
  return (
    <div className="srt-item-row" data-officer={pick.officer}>
      <span className="srt-item-who">
        <span className="srt-item-pc">{pick.piece}</span>
        <span>{pickOfficerNameById(pick.officer, pick.officer)}</span>
      </span>
      <select
        className="srt-item-pick"
        data-field="carry"
        data-officer={pick.officer}
        value={carried ?? ''}
        onChange={(e) => onPick(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">
          {weapon ? `${t('sortie.items.weapon')} — ${pickEquipName(weapon)}` : t('sortie.items.empty')}
        </option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {`${pickMarketItemName(item)} (${marketHeldCount(profile, item.id)})`}
          </option>
        ))}
        {/* 이미 든 것이 목록에 없을 수 있다 — 마지막 한 개를 들면 보유가 0이 된다.
            그때 값을 못 찾으면 브라우저가 첫 줄을 고른 것처럼 보여 **조용히 바뀐다** */}
        {carried && !items.some((i) => i.id === carried) && (
          <option value={carried}>{pickMarketItemName(marketItemById.get(carried)!)}</option>
        )}
      </select>
    </div>
  );
}
