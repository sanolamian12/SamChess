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
import { ResultScroll, RewardsPage, titleSize } from './ResultScreen.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { CardRewardReveal } from './market/CardRewardReveal.tsx';

export interface RaidBattleDone {
  profile: PlayerProfile;
  /** 판이 끝났을 때 살아 있던 도적 수 — 결과 화면이 보여 준다 */
  banditsLeft: number;
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
      done.current({ profile, banditsLeft: profile.raid?.bandits ?? 0, error: resumed.reason });
      return undefined;
    }
    const initial = resumed?.ok ? resumed.state : createBattle(config);
    let uploader: RaidIntentUploader | null = null;
    const transport = new LocalTransport(initial, humanSide, {
      intentLog: saved,
      onIntent: () => uploader?.push(),
    });
    uploader = new RaidIntentUploader(() => transport.getIntentLog(), saved.length);

    const settle = async (state: typeof initial): Promise<void> => {
      await uploader?.drain();
      const banditsLeft = Object.values(state.units).filter((u) => u.side === BANDIT_SIDE && u.alive).length;
      try {
        const next = await settleRaidOnServer(transport.getIntentLog());
        done.current({ profile: next, banditsLeft, error: null });
      } catch (e) {
        // 재생이 어긋나 서버가 항복으로 정산했을 수도 있다 — 어느 쪽이든 서버 값을 다시 읽는다
        const fresh = await loadProfile().catch(() => null);
        done.current({
          profile: fresh ?? profile,
          banditsLeft,
          error: e instanceof RaidRequestFailed ? e.message : String(e),
        });
      }
    };
    // 마지막 수가 판을 끝냈는데 정산 전에 끊겼다 — 띄울 판이 없으니 곧장 정산한다
    if (initial.phase === 'finished') { void settle(initial); return undefined; }

    const handle = bootBattle({ transport, onFinish: settle });
    return () => { uploader?.stop(); handle.destroy(); };
    // 전투는 한 번 시작하면 끝까지 간다 — `BattleScreen`과 같다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BattleStage />;
}

const TITLE: Partial<Record<RaidState['status'], StringKey>> = {
  won: 'raid.result.won',
  lost: 'raid.result.lost',
  drawn: 'raid.result.drawn',
  surrendered: 'raid.result.surrendered',
};

/**
 * 결말 → 배경 · 두루마리 — 막아 냈으면 승리(황금), 물러갔으면 무승부(비취), 빼앗겼으면 패배(낡은 것).
 * 「물러갔다」는 시간 상한에서 HP 합까지 같은 무승부다(GDD §5.11) — 약탈도 보상도 없다.
 */
const BG: Record<RaidState['status'], ResultBackdropId> = {
  pending: 'lose', fighting: 'lose', won: 'win', drawn: 'draw', lost: 'lose', surrendered: 'lose',
};

type RaidPage = 'title' | 'reward';
const PAGES: readonly RaidPage[] = ['title', 'reward'];

/**
 * 방어전 결과 (2026-10-13 — 대전 결과의 두루마리로 옮겼다. 옛 농지 화풍 판은 걷었다).
 *
 * 껍데기는 대전 결과와 같은 `ResultScroll`이고 장만 다르다:
 * **결말**(판정 · 남은 도적 · 약탈당한 군량) → **보상**(막아 냈으면 대전과 같은 보상 장, 아니면 약탈당한 군량).
 * 전과 장은 없다 — 방어전은 장수 전적에 안 들어가 통산 승무패를 보여 주면 「안 오른 숫자」가 된다.
 * 나가는 길은 [농지로] 하나다(기획자 지정).
 *
 * **보상에 장수 카드가 있으면 결말 장과 보상 장 사이에** 장터 1회 뽑기와 같은 섬광 → 카드 판이 돈다
 * (2026-10-14 지정, 2026-10-20에 두루마리 앞에서 장 사이로 옮겼다 — 「승리!」를 쓴 두루마리째 어두워진 뒤 연출,
 * 밝아지며 보상 글자가 쓰인다. `ResultScroll`의 `interlude`).
 */
export function RaidResultScreen({ profile, banditsLeft, error, onFarm }: {
  profile: PlayerProfile;
  banditsLeft: number;
  error: string | null;
  onFarm: () => void;
}): React.JSX.Element {
  useLang();
  const raid = profile.raid;
  const status = raid?.status ?? 'surrendered';
  const loot = raid?.loot ?? 0;
  const lootLine = loot > 0 ? t('raid.result.loot', { n: loot }) : t('raid.result.noLoot');
  const verdict = t(TITLE[status] ?? 'raid.result.surrendered');
  const cards = status === 'won' ? raid?.rewards?.cards ?? [] : [];

  const render = (page: RaidPage): React.ReactNode => {
    if (page === 'title') {
      return (
        <>
          <h1 className="brs-ttl" style={{ fontSize: `${Math.min(12, titleSize(verdict))}cqw` }}>{verdict}</h1>
          <p className="brs-lede" data-field="bandits" data-n={banditsLeft}>{t('raid.result.bandits', { n: banditsLeft })}</p>
          {error && <p className="brs-lede" data-field="error">{error}</p>}
        </>
      );
    }
    if (status === 'won') return <RewardsPage given={raid?.rewards ?? null} />;
    return (
      <div className="brs-refund brs-loot" data-field="lootPage">
        <img src="market/grain.png" alt="" />
        <p>{lootLine}</p>
      </div>
    );
  };

  return (
    <ResultScroll
      bg={BG[status]}
      pages={PAGES}
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
