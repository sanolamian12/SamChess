/**
 * 공성전 — 칠 도시 고르기 (2026-10-27, GDD §8.8 단계 2)
 *
 * ```
 * [← 출정하기로]          공 성 전
 * ┌ 탭 판 ──────────────────────────────────┐
 * │ 칠 도시를 고르세요.                       │
 * │ [ 추천 ]   [ 상위 도전 ]                  │
 * │ 출전 부대 초전박살 · 전투력 843           │
 * └─────────────────────────────────────────┘
 * ┌ 도시 판 ────────────────────────────────┐
 * │  도시      │  수비군      │ 전투력 │ 점수 │
 * │ 낙양 Lv3   │ 조조, 하후돈… │  901  │  40  │
 * │            1 / 2  (한 쪽에 다섯)          │
 * └─────────────────────────────────────────┘
 * ┌ 명령 판 ────────────────────────────────┐
 * │ [ 자동 매칭 ]  [ 뒤로 가기 ]              │
 * └─────────────────────────────────────────┘
 * ```
 *
 * 줄을 누르면 **상대 수비군 상세**(`TargetModal`) — 명단 · 예상 승률 · 「약한 상대 — 보상이 줄어듭니다」와 [전투준비].
 * [전투준비]는 서버에 상대를 정하고(`/siege/match`, 그 순간의 수비군을 서버가 읽는다) 곧바로 AI 대전과 같은 시작
 * (`/battle/ai-start`, 참가비 · 휴대품)을 지나 전투로 간다. 판이 서버에 적히므로 끊겨도 같은 판으로 돌아온다.
 *
 * ★ **부대를 먼저 고른다** — GDD §8.8의 흐름은 「도시 → 상대 상세 → 내 부대」였지만 출정하기가 이미 「구성 → 부대」라
 * 그 뒤에 목록을 둔다(2026-10-27). 그러면 **목록의 줄마다** 보상 줄(`rewardTier`)을 미리 말할 수 있다 — 알리지 않고 깎으면
 * 「보상이 왜 이래」가 된다.
 *
 * [자동 매칭]은 지금까지의 매칭 화면(대기열 → 못 찾으면 AI)이다 — 목록이 비었을 때(출시 초기)의 길이고, 접속 중인 상대와의
 * 야전(선전포고, 단계 4)이 서면 그쪽으로 바뀐다. 「딱 최소 군량」 안내(거절할 수 없다)는 그 길에만 해당해 여기로 옮겨 왔다.
 *
 * 화면 모양은 출정하기의 장부 판을 그대로 입는다(`scr-sortie`) — 고르는 화면이 둘이라도 손이 한 모양을 기억한다.
 */

import { useEffect, useState } from 'react';
import {
  SIEGE_TABS, battlePower, canDeclineMatch, grainCost, opponentMembers, rewardTier, toRosterEntries, winChance,
} from '@samchess/meta';
import type { AiBattleState, MatchOpponent, PlayerProfile, SiegeListRow, SiegeTab, Squad } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { startAiOnServer } from '../meta/aiBattle.ts';
import { fetchSiegeTargets, matchSiegeOnServer } from '../meta/siege.ts';
import { placeBackdrop } from './backdrop.ts';
import { GrainCost } from './GrainCost.tsx';
import { Pager } from './PagerButton.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon } from './GameIcon.tsx';
import { MinGrainModal } from './SortieScreen.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** 한 쪽에 다섯 도시 — 출정하기의 부대 목록과 같은 셈 */
const PAGE_SIZE = 5;

/** 받아 온 것 — **어느 탭의 것인지(`key`)를 함께 든다.** 탭을 누른 직후 한 번은 옛 탭의 줄이 새 탭 이름으로 그려진다
 *  (불러오기는 그린 뒤에 시작한다) — `key`가 지금 탭과 다르면 「불러오는 중」으로 본다(`siege_ux`가 잡았다) */
type Load = { key: string; state: 'failed' } | { key: string; state: 'ok'; rows: SiegeListRow[] };

export function SiegeScreen({ profile, mode, squad, onBack, onAuto, onReady }: {
  profile: PlayerProfile;
  mode: BattleMode;
  squad: Squad;
  onBack: () => void;
  /** [자동 매칭] — 지금까지의 매칭 화면으로 */
  onAuto: () => void;
  /** 서버가 시작을 굳혔다 — 참가비가 빠진 계정 · 상대 · 굳힌 판 */
  onReady: (spent: PlayerProfile, opponent: MatchOpponent, ai: AiBattleState) => void;
}): React.JSX.Element {
  useLang();
  const [tab, setTab] = useState<SiegeTab>('recommended');
  const [got, setGot] = useState<Load | null>(null);
  /** 다시 불러오기 — 수비군이 바뀌어 상대를 못 정했을 때 */
  const [nonce, setNonce] = useState(0);
  const [peek, setPeek] = useState<SiegeListRow | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const key = `${mode}/${tab}/${nonce}`;
  useEffect(() => {
    let live = true;
    setPage(0);
    void fetchSiegeTargets(mode, tab).then((rows) => {
      if (live) setGot(rows ? { key, state: 'ok', rows } : { key, state: 'failed' });
    });
    return () => { live = false; };
  }, [key]);
  const load: Load | { state: 'loading' } = got?.key === key ? got : { state: 'loading' };

  /** 내 전투력 — **시각 없이**(목록의 수비군 전투력과 같은 눈금, 매칭 화면과 같다) */
  const myPower = battlePower(mode, toRosterEntries(profile, squad.picks));
  const rows = load.state === 'ok' ? load.rows : [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const auto = (): void => {
    // 「딱 최소 군량」 — 대기열에서 만난 상대를 거절할 수 없다. 들어가기 전에 알린다(규칙이 문구를 준다)
    const decline = canDeclineMatch(profile, mode);
    if (decline.ok) onAuto();
    else setAsking(decline.reason);
  };

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-sortie scr-siege"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="siege" data-tab={tab} data-load={load.state}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('siege.back'))}
        </button>
        <span className="place-nm">{t('siege.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel srt-modes sge-tabs">
          <p className="hint srt-guide" data-field="pickCity">{t('siege.pickCity')}</p>
          <div className="srt-moderow">
            {SIEGE_TABS.map((k) => (
              <button
                key={k}
                className="btn wide"
                data-tab={k}
                data-on={tab === k ? '1' : '0'}
                aria-pressed={tab === k}
                onClick={() => setTab(k)}
              >
                <span className="lbl">{t(`siege.tab.${k}`)}</span>
              </button>
            ))}
          </div>
          <p className="hint sge-mine" data-field="mine" data-power={myPower}>
            {t('siege.mine', { name: squad.name, power: myPower.toLocaleString() })}
          </p>
        </section>

        <section className="place-panel srt-list" data-mode={mode}>
          <div className="srt-thead">
            <span>{t('siege.col.city')}</span>
            <span>{t('siege.col.garrison')}</span>
            <span>{t('siege.col.power')}</span>
            <span>{t('siege.col.score')}</span>
          </div>
          <div className="srt-page">
            {load.state !== 'ok' || rows.length === 0 ? (
              <div className="srt-none">
                <p className="hint" data-field="listState">
                  {load.state === 'loading' ? t('siege.loading')
                    : load.state === 'failed' ? t('siege.failed') : t(`siege.empty.${tab}`)}
                </p>
              </div>
            ) : (
              <div className="srt-rows">
                {pageRows.map((row) => (
                  <CityLine key={row.defenderId} row={row} myPower={myPower} onOpen={() => setPeek(row)} />
                ))}
              </div>
            )}
          </div>
          <Pager page={current} pageCount={pageCount} onPage={setPage} ends />
        </section>

        <section className="place-panel srt-acts">
          <button className="btn wide" data-action="autoMatch" onClick={auto}>
            <span className="lbl"><GameIcon name="opp-ai" label={t('siege.auto')} text /></span>
          </button>
          <p className="hint sge-auto-hint" data-field="autoHint">{t('siege.autoHint')}</p>
          <button className="btn wide" data-action="backBottom" onClick={onBack}>
            <span className="lbl">{stripBackArrow(t('match.back'))}</span>
          </button>
        </section>
      </div>

      {peek && (
        <TargetModal
          profile={profile}
          mode={mode}
          squad={squad}
          row={peek}
          myPower={myPower}
          onClose={() => setPeek(null)}
          onGone={() => { setPeek(null); setNonce((n) => n + 1); }}
          onReady={onReady}
        />
      )}

      {asking && (
        <MinGrainModal
          reason={asking}
          onClose={() => setAsking(null)}
          onConfirm={() => { setAsking(null); onAuto(); }}
        />
      )}
    </ScreenChrome>
  );
}

/** 목록의 한 줄 — 누르면 상대 수비군 상세. 약한 상대면 전투력 칸이 말한다(`data-tier`) */
function CityLine({ row, myPower, onOpen }: { row: SiegeListRow; myPower: number; onOpen: () => void }): React.JSX.Element {
  const tier = rewardTier({ mine: myPower, theirs: row.power });
  return (
    <div className="srt-row" data-city={row.defenderId} data-level={row.cityLevel} data-tier={tier}>
      <div className="srt-open" role="button" tabIndex={0} data-action="openCity" onClick={onOpen}>
        <span className="srt-nm" data-field="city">{row.cityName} <small>Lv{row.cityLevel}</small></span>
        <span className="srt-who" data-field="members">
          {opponentMembers({ kind: 'online', id: row.defenderId, squadName: row.squadName, entries: row.entries, power: row.power })
            .map((m) => pickOfficerNameById(m.officer, m.name)).join(', ')}
        </span>
        <span className="srt-pw" data-field="power" data-power={row.power}>
          {tier === 'weak' && <GameIcon name="mk-warn" label={t('siege.weak')} />}
          {row.power.toLocaleString()}
        </span>
        <span className="sge-score" data-field="score" data-score={row.score}>{row.score.toLocaleString()}</span>
      </div>
    </div>
  );
}

/**
 * 상대 수비군 상세 — 명단 · 예상 승률 · 보상 줄. [전투준비]가 **상대 정하기 → 시작**을 잇달아 부른다.
 * 정하는 순간 서버가 수비군을 다시 읽으므로, 그 사이 수비군이 사라졌으면 목록을 다시 불러온다.
 */
function TargetModal({ profile, mode, squad, row, myPower, onClose, onGone, onReady }: {
  profile: PlayerProfile; mode: BattleMode; squad: Squad; row: SiegeListRow; myPower: number;
  onClose: () => void; onGone: () => void;
  onReady: (spent: PlayerProfile, opponent: MatchOpponent, ai: AiBattleState) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const opponent: MatchOpponent = { kind: 'online', id: row.defenderId, squadName: row.squadName, entries: row.entries, power: row.power };
  const members = opponentMembers(opponent);
  const weak = rewardTier({ mine: myPower, theirs: row.power }) === 'weak';

  const ready = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const m = await matchSiegeOnServer(row.defenderId, mode, squad.picks, squad.id);
    if (!m.ok) {
      setBusy(false);
      if (m.code === 'siege.noTarget') { onGone(); return; }
      setErr(t('siege.err.start'));
      return;
    }
    const started = await startAiOnServer();
    if (!started) { setBusy(false); setErr(t('siege.err.start')); return; }
    onReady(started.profile, m.opponent, started.ai);
  };

  return (
    <div className="modal-back" data-modal="siegeTarget" data-city={row.defenderId} onClick={busy ? undefined : onClose}>
      <div className="modal mod-plank srt-modal sge-target" onClick={(e) => e.stopPropagation()}>
        <p className="row sge-target-head" data-field="city">
          <b>{row.cityName}</b> Lv{row.cityLevel} · {t('siege.score', { n: row.score.toLocaleString() })}
        </p>
        <p className="row" data-field="garrison">{t('siege.garrison', { squad: row.squadName })}</p>
        <ul className="sge-members" data-field="members">
          {members.map((m) => (
            <li key={m.piece} data-officer={m.officer}>{pickOfficerNameById(m.officer, m.name)} Lv{m.level}</li>
          ))}
        </ul>
        <p className="row" data-field="odds">
          {t('match.odds', {
            mine: myPower.toLocaleString(), theirs: row.power.toLocaleString(), pct: Math.round(winChance(myPower, row.power) * 100),
          })}
        </p>
        {weak && <p className="note" data-field="weak"><GameIcon name="mk-warn" label={t('siege.weak')} text /></p>}
        {err && <p className="note" data-field="error">{err}</p>}
        <div className="srt-modal-acts">
          <button className="btn primary wide" data-action="siegeReady" disabled={busy} onClick={() => { void ready(); }}>
            <span className="lbl"><GameIcon name="cmd-ready" label={t('match.readyLbl')} text /></span>
            <GrainCost n={grainCost(mode)} have={profile.grain} />
          </button>
          <button className="btn wide" data-action="siegeClose" disabled={busy} onClick={onClose}>
            {t('sortie.peek.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
