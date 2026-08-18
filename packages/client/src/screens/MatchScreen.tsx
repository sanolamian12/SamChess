/**
 * 매칭 — 세 상태 (pptx 45쪽 · F, 2026-08-18)
 *
 * ```
 * 대전 상대를 찾고 있습니다..   [뒤로 가기]        ← 온라인 탐색 (최대 30초)
 * 대전 상대를 생성중입니다..    [뒤로 가기]        ← 못 찾아 AI로 넘어갔다
 * 찾았습니다!  부대명|멤버|전투력                  ← 상대가 정해졌다
 *                       [전투준비]  [다시 찾기 (군량 1소모)]
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 참가비는 **[전투준비]에서** 나간다 ★ (§5-16 · GDD §6.1)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 편성 화면의 「출전」에서 냈다. 거절 −1이 **참가비를 내기 전의 잔여 군량**을
 * 기준으로 갈리므로 차감이 매칭 뒤로 옮겨졌다 — 매칭만 하고 안 싸웠는데 떼면 거절과
 * 이중으로 물린다. 그래서 [뒤로 가기]로 나가면 **한 톨도 안 나간다.**
 *
 * ────────────────────────────────────────────────────────────────
 * 「다시 찾기」는 **온라인일 때만** 뜬다
 * ────────────────────────────────────────────────────────────────
 *
 * AI는 상대를 「생성」하는 것이라 거절당하는 상대가 없다(§5-15). 문이 하나로
 * 합쳐져도 이 경계는 남으므로 **화면이 지금 어느 쪽인지 알아야 한다** —
 * `opponent.kind`가 그 답이고, 그래서 매칭이 상대를 「어디서 왔는지까지」 들고 온다.
 *
 * 거절이 반복되면 군량이 참가비에 닿고, 그때부터 **단추가 사라진다** — 진입 전
 * 안내문만으로는 못 막는 자리다(들어온 뒤에 바닥에 닿기 때문). 판정은 화면이 하지
 * 않는다(`canDeclineMatch`).
 */

import { useEffect, useRef, useState } from 'react';
import {
  MATCH_DECLINE_GRAIN, battlePower, canDeclineMatch, declineMatch, grainCost, makeAiOpponent,
  opponentMembers, spendGrain, toRosterEntries, winChance,
} from '@samchess/meta';
import type { MatchOpponent, PlayerProfile, Squad } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { searchMs, searchOnline } from '../meta/matchmaking.ts';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/** AI를 만드는 데 걸리는 것처럼 보여 주는 시간. 45쪽의 「생성중입니다..」가 지나가야 한다 */
const CREATE_MS = 700;

type Phase = 'searching' | 'creating' | 'found';

export function MatchScreen({ profile, mode, squad, seed, onBack, onChange, onReady }: {
  profile: PlayerProfile;
  mode: BattleMode;
  squad: Squad;
  seed: number;
  onBack: () => void;
  /** 거절로 군량이 줄면 곧바로 저장한다 — 나갔다 오면 되돌아오는 값이 아니다 */
  onChange: (next: PlayerProfile) => void;
  onReady: (spent: PlayerProfile, opponent: MatchOpponent) => void;
}): React.JSX.Element {
  useLang();
  const [phase, setPhase] = useState<Phase>('searching');
  const [opponent, setOpponent] = useState<MatchOpponent | null>(null);
  /** 몇 번째 탐색인가. 거절할 때마다 늘어 **다른 상대**가 나오게 한다 */
  const [round, setRound] = useState(0);
  const [left, setLeft] = useState(searchMs());

  // 내 전투력이 상대를 고르는 눈금이다 (§5-32 · GDD §7.1)
  const myEntries = toRosterEntries(profile, squad.picks);
  const myPower = battlePower(mode, myEntries);
  const mine = useRef(myPower);
  mine.current = myPower;

  /*
   * 한 바퀴 = 「온라인을 찾아보고, 없으면 AI를 만든다」.
   *
   * **[뒤로 가기]로 나가면 기다리던 것을 끊는다** — 안 끊으면 떠난 화면에
   * `setState`가 떨어져 콘솔이 시끄럽고, 서버가 붙으면 방에 남는다.
   */
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    setPhase('searching');
    setOpponent(null);
    setLeft(searchMs());

    const started = Date.now();
    const tick = setInterval(() => setLeft(Math.max(0, searchMs() - (Date.now() - started))), 200);

    void (async () => {
      const exclude = myEntries.map((e) => e.officer);
      const found = await searchOnline(mode, mine.current, seed + round, exclude, abort.signal);
      if (!alive) return;
      if (found) { setOpponent(found); setPhase('found'); return; }

      // 30초 안에 못 찾았다 — AI를 **내 전투력에 맞춰** 만든다
      setPhase('creating');
      await new Promise((r) => setTimeout(r, CREATE_MS));
      if (!alive) return;
      setOpponent(makeAiOpponent(mode, mine.current, seed + round, exclude));
      setPhase('found');
    })();

    return () => { alive = false; abort.abort(); clearInterval(tick); };
    // 거절하면 `round`가 늘어 다시 돈다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const decline = canDeclineMatch(profile, mode);
  /** 거절은 **온라인에만** 있다 — AI에게는 거절당할 상대가 없다 */
  const canRetry = opponent?.kind === 'online' && decline.ok;

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-match"
      account={null}
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
            {/* 남은 시간을 보여 준다 — 기다리는 화면에 진행 표시가 없으면 「멈췄나」가 된다 */}
            {phase === 'searching' && (
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
                onClick={() => onReady(spendGrain(profile, mode), opponent)}
              >
                {t('match.ready', { n: grainCost(mode) })}
              </button>
              {canRetry && (
                <button
                  className="btn wide"
                  data-action="decline"
                  onClick={() => { onChange(declineMatch(profile, mode)); setRound((n) => n + 1); }}
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
          {rows.map((r) => `${r.name} Lv${r.level}`).join(', ')}
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
