/**
 * 도적떼 방어전 — 전투와 결과 (GDD §5.11).
 *
 * ────────────────────────────────────────────────────────────────
 * 판은 **서버가 굳혀 둔 것**으로 만든다
 * ────────────────────────────────────────────────────────────────
 *
 * [지금 전투]를 누르면 서버가 시드를 내고 파수꾼을 굳힌다(`startRaid`). 이 화면은 그렇게
 * 받은 계정에서 `raidBattleConfig()`로 판을 만든다 — **서버의 재생 검증이 부르는 것과 같은
 * 함수**다. 화면이 판을 따로 조립하면 둘이 어긋나는 순간 정직한 판이 「조작」으로 읽혀
 * 항복 처리된다.
 *
 * 판정 주체는 AI 대전과 같은 `LocalTransport`다. 끝나면 사람이 낸 의도만 서버로 보낸다.
 * **로컬로 반영하지 않는다** — 군량·도적떼가 서버 소유라 `PUT`이 되쓴다. 못 닿으면 계정을
 * 다시 읽고 그 까닭을 결과 화면에 적는다(서버는 60분 뒤 항복으로 정산한다).
 *
 * ────────────────────────────────────────────────────────────────
 * 끊긴 판은 **서버가 덧붙여 둔 수**로 되살린다 (2026-10-15)
 * ────────────────────────────────────────────────────────────────
 *
 * 수를 낼 때마다 `RaidIntentUploader`가 서버에 덧붙인다(`raid.battle.intents`). 브라우저를 껐다가 메인의
 * [전투 재개]로 들어오면 그 수를 처음부터 재생해(`resumeRaidState` — 서버가 덧붙이기를 받을 때와 같은 함수)
 * **다음 사람 차례**에서 판을 띄운다. 지난 수의 연출은 다시 안 보여 준다. 정산은 여전히 전체 기록을 보내고,
 * 서버는 그것이 **덧붙여 둔 수로 시작하는지** 본다 — 처음부터 다른 수로 다시 둔 판은 받지 않는다.
 */

import { useEffect, useRef, useState } from 'react';
import { BANDIT_SIDE, createBattle } from '@samchess/rules';
import { raidBattleConfig, raidIntentsOf, resumeRaidState } from '@samchess/meta';
import type { PlayerProfile, RaidState } from '@samchess/meta';
import { Say } from './Steward.tsx';
import { bootBattle } from '../battle/boot.ts';
import { LocalTransport } from '../battle/transport.ts';
import { RaidIntentUploader, RaidRequestFailed, settleRaidOnServer } from '../meta/raid.ts';
import { currentSession } from '../meta/auth.ts';
import { loadProfile } from '../meta/storage.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { resultBackdrop } from './backdrop.ts';
import type { ResultBackdropId } from './backdrop.ts';
import { BattleStage } from './BattleStage.tsx';
import { BigLine, ResultScroll, hasRewards, rewardSheet, winWhy } from './ResultScreen.tsx';
import type { ResultSheet } from './ResultScreen.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { CardRewardReveal } from './market/CardRewardReveal.tsx';

export interface RaidBattleDone {
  profile: PlayerProfile;
  /** 판이 끝났을 때 살아 있던 도적 수 — 결과 화면이 보여 준다 */
  banditsLeft: number;
  /** 판이 끝난 방식(`BattleState.outcome`) — 이긴 사유 줄(적 전멸 · 적 King 격퇴). 판 없이 끝났으면 `null` */
  outcomeKind: string | null;
  /** 서버가 결과를 못 받았거나 거절했다 — 사람에게 보여 줄 말 */
  error: string | null;
}

export function RaidBattleScreen({ profile, onDone }: {
  /** `startRaid` 뒤의 계정 — `raid.status === 'fighting'`이어야 한다 */
  profile: PlayerProfile;
  onDone: (done: RaidBattleDone) => void;
}): React.JSX.Element {
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const { humanSide, ...config } = raidBattleConfig(profile);
    // 덧붙여 둔 수가 있으면 끊긴 자리에서 — 재생이 안 되면(있어선 안 된다) 처음부터 다시 둘 수는 없으니 그 까닭을 알린다
    const saved = raidIntentsOf(profile.raid);
    const resumed = saved.length > 0 ? resumeRaidState(profile, saved) : null;
    if (resumed && !resumed.ok) {
      done.current({ profile, banditsLeft: profile.raid?.bandits ?? 0, outcomeKind: null, error: resumed.reason });
      return undefined;
    }
    const initial = resumed?.ok ? resumed.state : createBattle(config);
    let uploader: RaidIntentUploader | null = null;
    const transport = new LocalTransport(initial, humanSide, {
      intentLog: saved,
      onIntent: () => uploader?.push(),
      // 배치 30초 없이 정찰부터 — AI와 싸우는 판(2026-11-27 기획자). 파수꾼은 기본 자리(King은 성채 한가운데)
      skipDeploy: true,
    });
    uploader = new RaidIntentUploader(() => transport.getIntentLog(), saved.length);

    const settle = async (state: typeof initial): Promise<void> => {
      await uploader?.drain();
      const banditsLeft = Object.values(state.units).filter((u) => u.side === BANDIT_SIDE && u.alive).length;
      const outcomeKind = state.outcome ?? null;
      try {
        const next = await settleRaidOnServer(transport.getIntentLog());
        done.current({ profile: next, banditsLeft, outcomeKind, error: null });
      } catch (e) {
        // 재생이 어긋나 서버가 항복으로 정산했을 수도 있다 — 어느 쪽이든 서버 값을 다시 읽는다
        const fresh = await loadProfile().catch(() => null);
        done.current({
          profile: fresh ?? profile,
          banditsLeft,
          outcomeKind,
          error: e instanceof RaidRequestFailed ? e.message : String(e),
        });
      }
    };
    // 마지막 수가 판을 끝냈는데 정산 전에 끊겼다 — 띄울 판이 없으니 곧장 정산한다
    if (initial.phase === 'finished') { void settle(initial); return undefined; }

    const handle = bootBattle({ transport, bgm: 'raid', onFinish: settle });
    return () => { uploader?.stop(); handle.destroy(); };
    // 전투는 한 번 시작하면 끝까지 간다 — `BattleScreen`과 같다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BattleStage />;
}

/** 결말 → 큰 글씨 — 막아 냈으면 「승 리」, 물러갔으면 「무승부」, 그 밖은 「패 배」 */
const BIG: Record<RaidState['status'], StringKey> = {
  pending: 'result.big.lose', fighting: 'result.big.lose', won: 'result.big.win', drawn: 'result.big.draw',
  lost: 'result.big.lose', surrendered: 'result.big.lose',
};

/**
 * 결말 → 배경 · 두루마리 — 막아 냈으면 승리(황금), 물러갔으면 무승부(비취), 빼앗겼으면 패배(낡은 것).
 * 「물러갔다」는 시간 상한에서 HP 합까지 같은 무승부다(GDD §5.11) — 약탈도 보상도 없다.
 */
const BG: Record<RaidState['status'], ResultBackdropId> = {
  pending: 'lose', fighting: 'lose', won: 'win', drawn: 'draw', lost: 'lose', surrendered: 'lose',
};

type RaidPage = 'title' | 'reward';

/**
 * 방어전 결과 (2026-10-13 — 대전 결과의 두루마리로 옮겼다. 2026-11-26 — 대전과 같은 「쿵」 연출).
 *
 * 껍데기는 대전 결과와 같은 `ResultScroll`이고 장만 다르다:
 * **결말**(「승 리」 · 사유 — 막아 냈으면 적 전멸 · 적 King 격퇴, 물러갔으면 「도적떼가 물러갔다」, 졌으면 약탈당한 군량)
 * → 받은 것이 있으면 **「보상」**(받은 장수가 있으면 먼저 장수 모집 결과와 같은 무대, 닫으면 보상이 한꺼번에 찍힌다).
 * 막아 낸 판의 카드는 C~D 한 장이다(2026-11-26 기획자 — 두 장씩이라 장수가 너무 빨리 늘었다).
 * 전과 장은 없다 — 방어전은 전적에 안 들어간다. 나가는 길은 [농지로] 하나다(기획자 지정).
 */
export function RaidResultScreen({ profile, banditsLeft, outcomeKind = null, error, onFarm }: {
  profile: PlayerProfile;
  banditsLeft: number;
  /** 판이 끝난 방식 — 막아 냈으면 사유 줄(적 전멸 · 적 King 격퇴). 도적에게도 두목(King)이 있다 */
  outcomeKind?: string | null;
  error: string | null;
  onFarm: () => void;
}): React.JSX.Element {
  useLang();
  const raid = profile.raid;
  const status = raid?.status ?? 'surrendered';
  const loot = raid?.loot ?? 0;
  const won = status === 'won';
  const given = won ? raid?.rewards ?? null : null;
  const cards = given?.cards ?? [];
  const pages: readonly RaidPage[] = hasRewards(given) ? ['title', 'reward'] : ['title'];

  const render = (page: RaidPage): ResultSheet => {
    if (page === 'reward') return rewardSheet(given!);
    // 막아 낸 판의 사유는 넷 중 하나일 때만(그 밖 — 시간 상한의 HP 합 판정 · 정산 오류로 판을 모름 — 은 줄째 없다, 2026-11-26 기획자)
    // 진 판(약탈당함 · 항복)은 사유 줄이 없다 — 약탈 줄이 남는다. 물러간 판(무승부)만 「도적떼가 물러갔다」 (2026-11-26 기획자)
    const why = won ? winWhy(outcomeKind) : status === 'drawn' ? t('raid.result.drawn') : null;
    return {
      beats: [
        <BigLine key="big" text={t(BIG[status])} field="verdict" />,
        ...(why ? [<p key="why" className="brs-lede" data-field="bandits" data-n={banditsLeft} data-outcome={won ? outcomeKind ?? undefined : status}>{why}</p>] : []),
        ...(status === 'lost' || status === 'surrendered'
          ? [<p key="loot" className="brs-gain brs-loot" data-field="lootPage">
              <img src="market/grain.png" alt="" />
              <span>{loot > 0 ? t('raid.result.loot', { n: loot }) : t('raid.result.noLoot')}</span>
            </p>]
          : []),
      ],
      extra: <Say text={error} name="error" repeat />,
    };
  };

  return (
    <ResultScroll
      bg={BG[status]}
      pages={pages}
      interlude={cards.length > 0 ? { at: 'reward', render: (done) => <CardRewardReveal cards={cards} onDone={done} /> } : null}
      render={render}
      // 약탈량은 장과 상관없이 틀에 단다 — 스모크가 첫 장에서 읽는다
      attrs={{ 'data-screen': 'raidResult', 'data-raid': status, 'data-loot': String(loot) }}
      acts={(
        <button className="btn primary wide" data-action="farm" onClick={onFarm}>
          <span className="lbl">{t('raid.result.farm')}</span>
        </button>
      )}
    />
  );
}
