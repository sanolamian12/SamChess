/**
 * 매칭 — 다섯 상태 (pptx 45쪽 · F, 2026-08-18 · H2b, 2026-08-20)
 *
 * ```
 * 대전 상대를 찾고 있습니다..   [뒤로 가기]        ← 대기열 탐색 (최대 30초)
 * 대전 상대를 생성중입니다..    [뒤로 가기]        ← 못 찾아 AI로 넘어갔다
 * 찾았습니다!  부대명|멤버|전투력                  ← 상대가 정해졌다(아직 방은 안 열렸다)
 *                       [전투준비]  [다시 찾기 (군량 1소모)]
 * 상대의 확인을 기다리는 중..   [뒤로 가기]        ← 나는 확인했다, 상대를 기다린다
 * 상대가 거절했습니다..                            ← 잠깐 보이고 다시 찾는 중으로
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 참가비는 **방이 열린 순간에** 나간다 ★ (§5-60 · GDD §6.1)
 * ────────────────────────────────────────────────────────────────
 *
 * [전투준비]를 누른 시점이 아니다 — 둘 다 확인해야 방이 열리므로, 내가 눌러도
 * 상대가 아직이거나 그때 거절할 수 있다. **`onReady`(전투 화면으로 실제로 넘어가는
 * 콜백)가 온 순간에만** 참가비를 낸다. AI는 확인할 상대가 없어 누르는 즉시 낸다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「다시 찾기」는 **온라인일 때만** 뜬다
 * ────────────────────────────────────────────────────────────────
 *
 * AI는 상대를 「생성」하는 것이라 거절당하는 상대가 없다(§5-15). `opponent.kind`가
 * 지금 어느 쪽인지 말해 준다. 거절이 반복되면 군량이 참가비에 닿고, 그때부터
 * **단추가 사라진다**(`canDeclineMatch`).
 *
 * ────────────────────────────────────────────────────────────────
 * 검색은 **한 번만 연다** — 재대기는 서버가 한다
 * ────────────────────────────────────────────────────────────────
 *
 * 대기열 접속(`searchOnline`)은 마운트에서 한 번 열고 언마운트에서 닫는다.
 * 거절·상대의 거절·상대의 이탈은 전부 **대기열 안에서 requeue**되고
 * (`packages/server/src/queue-logic.ts`), 클라는 새 `matched`가 올 때까지 콜백만
 * 받는다 — 예전처럼 라운드를 세어 매번 새 접속을 여는 것이 아니다.
 */

import { useEffect, useRef, useState } from 'react';
import {
  MATCH_DECLINE_GRAIN, battlePower, canDeclineMatch, declineMatch, grainCost,
  opponentMembers, spendGrain, squadDeployment, toRosterEntries, winChance,
} from '@samchess/meta';
import type { MatchOpponent, PlayerProfile, Squad } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { fallbackAiOpponent, searchMs, searchOnline } from '../meta/matchmaking.ts';
import type { OnlineSearch } from '../meta/matchmaking.ts';
import { currentSession } from '../meta/auth.ts';
import type { BattleTransport } from '../battle/transport.ts';
import { playSfx } from '../audio/sfx.ts';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** AI를 만드는 데 걸리는 것처럼 보여 주는 시간. 45쪽의 「생성중입니다..」가 지나가야 한다 */
const CREATE_MS = 700;

/** 「상대가 거절했습니다」가 화면에 머무는 시간 — 지나면 다시 찾는 중으로 */
const DECLINED_NOTICE_MS = 1_800;

type Phase = 'searching' | 'creating' | 'found' | 'waitingReady' | 'declined';

export function MatchScreen({ profile, mode, squad, seed, onBack, onChange, onReady }: {
  profile: PlayerProfile;
  mode: BattleMode;
  squad: Squad;
  seed: number;
  onBack: () => void;
  /** 거절로 군량이 줄면 곧바로 저장한다 — 나갔다 오면 되돌아오는 값이 아니다 */
  onChange: (next: PlayerProfile) => void;
  /**
   * 방이 **열렸다** — 여기서 참가비를 낸다(§5-60). **온라인이면 판정 주체까지
   * 함께 넘긴다** — 사람을 찾았다는 것은 이미 방에 붙었다는 뜻이다.
   */
  onReady: (spent: PlayerProfile, opponent: MatchOpponent, online: BattleTransport | null) => void;
}): React.JSX.Element {
  useLang();
  const [phase, setPhase] = useState<Phase>('searching');
  const [opponent, setOpponent] = useState<MatchOpponent | null>(null);
  const [left, setLeft] = useState(searchMs());
  /** 대기열 접속 하나 — 마운트에서 열고 언마운트에서 닫는다 */
  const search = useRef<OnlineSearch | null>(null);
  /** 한 번이라도 상대를 찾았는가 — 그 뒤로는 검색 카운트다운을 안 보여 준다 */
  const everFound = useRef(false);
  /**
   * [전투준비]로 방이 열려 **전투 화면에 넘겼는가.**
   *
   * 안 세면 이 화면이 사라질 때 정리 코드가 **방금 넘긴 방을 닫는다** — 전투가
   * 시작되자마자 상대에게 「사라진 사람」이 된다.
   */
  const handed = useRef(false);

  // 내 전투력이 상대를 고르는 눈금이다 (§5-32 · GDD §7.1)
  const myEntries = toRosterEntries(profile, squad.picks);
  const myPower = battlePower(mode, myEntries);

  useEffect(() => {
    let alive = true;
    let declinedTimer: ReturnType<typeof setTimeout> | null = null;

    setPhase('searching');
    setOpponent(null);
    setLeft(searchMs());
    const started = Date.now();
    everFound.current = false;
    const tick = setInterval(() => {
      if (everFound.current) return;   // 한 번 찾은 뒤에는 카운트다운이 없다(파일 머리 참조)
      setLeft(Math.max(0, searchMs() - (Date.now() - started)));
    }, 200);

    const exclude = myEntries.map((e) => e.officer);
    const opts = {
      mode, myPower, seed, exclude, entries: myEntries, squadName: squad.name,
      // 저장된 배치를 **서버가 깐다** — 어느 진영이 될지도 서버가 정하므로
      // 남군 것을 실어 보낸다. 두 군데서 깔면 한쪽이 언젠가 안 깐다(§5-45·74)
      deploy: squadDeployment(profile, squad, 'P1'),
    };

    search.current = searchOnline(opts, {
      onFound: (found) => {
        if (!alive) return;
        everFound.current = true;
        // **온라인 매칭이 실제로 성사됐을 때만** — 아래 AI 대체 생성은 알림이 아니다
        playSfx('ring');
        setOpponent(found);
        setPhase('found');
      },
      onDeclinedByOpponent: () => {
        if (!alive) return;
        setOpponent(null);
        setPhase('declined');
        declinedTimer = setTimeout(() => { if (alive) setPhase('searching'); }, DECLINED_NOTICE_MS);
      },
      onReady: (found, transport) => {
        if (!alive) { transport.close(); return; }
        handed.current = true;
        onReady(spendGrain(profile, mode), found, transport);
      },
      onTimeout: () => {
        if (!alive) return;
        setPhase('creating');
        setTimeout(() => {
          if (!alive) return;
          setOpponent(fallbackAiOpponent(opts));
          setPhase('found');
        }, CREATE_MS);
      },
    });

    // **떠날 때는 대기열/방에서도 나간다** — [전투준비]로 넘긴 방은 건드리지 않는다
    return () => {
      alive = false;
      clearInterval(tick);
      if (declinedTimer) clearTimeout(declinedTimer);
      if (!handed.current) search.current?.close();
      search.current = null;
    };
    // 마운트에서 한 번만 연다 — 재대기는 서버가 한다(파일 머리 참조)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decline = canDeclineMatch(profile, mode);
  /** 거절은 **온라인에만** 있다 — AI에게는 거절당할 상대가 없다 */
  const canRetry = opponent?.kind === 'online' && decline.ok;

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-match"
      account={currentSession()?.email ?? null}
    >
      <div
        className="place-bar"
        data-screen="match"
        data-state={phase}
        data-kind={opponent?.kind ?? ''}
        data-grain={profile.grain}
      >
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('match.back')}</button>
        <span className="place-nm">{t(`match.${phase}`)}</span>
      </div>

      <div className="place-body">
        {phase !== 'found' || !opponent ? (
          <section className="place-panel mtc-wait">
            <p className="mtc-msg" data-field="msg">{t(`match.${phase}`)}</p>
            {/* 남은 시간을 보여 준다 — 기다리는 화면에 진행 표시가 없으면 「멈췄나」가 된다.
                한 번이라도 찾은 뒤로는 상한이 없다(파일 머리 참조) — 숫자를 안 보여 준다 */}
            {phase === 'searching' && !everFound.current && (
              <p className="hint" data-field="left">{t('match.left', { s: Math.ceil(left / 1000) })}</p>
            )}
          </section>
        ) : (
          <>
            <Opponent opponent={opponent} myPower={myPower} />
            <section className="place-panel mtc-acts">
              <button
                className="btn primary wide"
                data-action="ready"
                onClick={() => {
                  if (opponent.kind === 'ai') {
                    handed.current = true;
                    onReady(spendGrain(profile, mode), opponent, null);
                    return;
                  }
                  // 온라인 — 확인만 보낸다. 방은 **상대도 확인해야** 열린다(§5-60)
                  search.current?.confirmReady();
                  setPhase('waitingReady');
                }}
              >
                {t('match.ready', { n: grainCost(mode) })}
              </button>
              {canRetry && (
                <button
                  className="btn wide"
                  data-action="decline"
                  onClick={() => {
                    onChange(declineMatch(profile, mode));
                    search.current?.decline();
                    setOpponent(null);
                    setPhase('searching');
                  }}
                >
                  {t('match.decline', { n: MATCH_DECLINE_GRAIN })}
                </button>
              )}
              {/* 왜 [다시 찾기]가 없는지 말해 준다 — 없는 단추는 「고장인가」로 읽힌다 */}
              {opponent.kind === 'online' && !decline.ok && (
                <p className="note" data-field="noDecline">{decline.reason}</p>
              )}
              {opponent.kind === 'ai' && (
                <p className="hint" data-field="aiNote">{t('match.aiNoDecline')}</p>
              )}
            </section>
          </>
        )}
      </div>
    </ScreenChrome>
  );
}

/**
 * 45쪽의 상대 표 — `부대명 | 멤버 | 전투력`.
 *
 * **AI에게는 부대 이름이 없다**(§4-7②) — 화면이 「AI 부대」라고 적을 뿐 이력의
 * `theirSquad`에는 `null`이 들어간다. 예상 승률은 `winChance()`가 낸다.
 */
function Opponent({ opponent, myPower }: {
  opponent: MatchOpponent; myPower: number;
}): React.JSX.Element {
  const rows = opponentMembers(opponent);
  const chance = winChance(myPower, opponent.power);
  return (
    <section className="place-panel mtc-foe" data-kind={opponent.kind} data-power={opponent.power}>
      <div className="mtc-thead">
        <span>{t('squads.col.name')}</span>
        <span>{t('squads.col.members')}</span>
        <span>{t('squads.col.power')}</span>
      </div>
      <div className="mtc-row">
        <span className="mtc-nm" data-field="foeName">
          {opponent.squadName ?? t('match.aiSquad')}
        </span>
        <span className="mtc-who" data-field="foeMembers">
          {rows.map((r) => `${pickOfficerNameById(r.officer, r.name)} Lv${r.level}`).join(', ')}
        </span>
        <span className="mtc-pw" data-field="foePower">{opponent.power.toLocaleString()}</span>
      </div>
      {/* 내 전투력과 나란히 — 「인접한 전투력끼리 매칭」이 눈에 보여야 한다 (44쪽) */}
      <p className="hint" data-field="odds">
        {t('match.odds', {
          mine: myPower.toLocaleString(),
          theirs: opponent.power.toLocaleString(),
          pct: Math.round(chance * 100),
        })}
      </p>
    </section>
  );
}
