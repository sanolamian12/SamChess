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
 */

import { useEffect, useRef } from 'react';
import { officerById } from '@samchess/data';
import { BANDIT_SIDE, createBattle } from '@samchess/rules';
import { raidBattleConfig } from '@samchess/meta';
import type { PlayerProfile, RaidState } from '@samchess/meta';
import { bootBattle } from '../battle/boot.ts';
import { LocalTransport } from '../battle/transport.ts';
import { RaidRequestFailed, settleRaidOnServer } from '../meta/raid.ts';
import { loadProfile } from '../meta/storage.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { BattleStage } from './BattleStage.tsx';
import { OfficerArt } from './OfficerArt.tsx';

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
    const transport = new LocalTransport(createBattle(config), humanSide);

    const handle = bootBattle({
      transport,
      onFinish: async (state) => {
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
      },
    });
    return () => handle.destroy();
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

/** 결과 화면의 색 — 전투 결과 화면(`.scr-result.win` 등)을 그대로 빌린다 */
const TONE: Partial<Record<RaidState['status'], 'win' | 'lose' | 'draw'>> = {
  won: 'win', lost: 'lose', drawn: 'draw', surrendered: 'lose',
};

export function RaidResultScreen({ profile, banditsLeft, error, onHome, onFarm }: {
  profile: PlayerProfile;
  banditsLeft: number;
  error: string | null;
  onHome: () => void;
  onFarm: () => void;
}): React.JSX.Element {
  useLang();
  const raid = profile.raid;
  const status = raid?.status ?? 'surrendered';
  const loot = raid?.loot ?? 0;
  const given = raid?.rewards;

  return (
    <div className={`scr scr-result ${TONE[status] ?? 'draw'}`} data-screen="raidResult" data-raid={status}>
      <h1 className="title">{t(TITLE[status] ?? 'raid.result.surrendered')}</h1>
      <p className="lede" data-field="bandits">{t('raid.result.bandits', { n: banditsLeft })}</p>

      <section className="rewards" data-field="rewards">
        <div className="row">
          <span className="k">{t('raid.today')}</span>
          <span className="v" data-field="loot" data-loot={loot}>
            {loot > 0 ? t('raid.result.loot', { n: loot }) : t('raid.result.noLoot')}
          </span>
        </div>
        {status === 'won' && (
          <>
            <h2 className="cap">{t('result.rewards')}</h2>
            <div className="row">
              <span className="k">{t('result.grain')}</span>
              <span className="v" data-field="grain">{given && given.grain > 0 ? `+${given.grain}` : t('result.none')}</span>
            </div>
            <div className="row">
              <span className="k">{t('result.materials')}</span>
              <span className="v" data-field="materials">{given && given.materials > 0 ? `+${given.materials}` : t('result.none')}</span>
            </div>
            {(given?.cards ?? []).map((c, i) => {
              const o = officerById.get(c.officer);
              return (
                <div className="row card" key={`${c.officer}-${i}`} data-field="card" data-officer={c.officer} data-grade={c.grade}>
                  <OfficerArt officer={c.officer} className="thumb" />
                  <span className="k">{o ? pickOfficerName(o) : c.officer}</span>
                  <span className="v">{t('result.cardGrade', { g: c.grade })}</span>
                </div>
              );
            })}
          </>
        )}
      </section>

      {error && <p className="note" data-field="error">{error}</p>}

      <footer className="foot">
        <button className="btn wide" data-action="farm" onClick={onFarm}>{t('raid.result.farm')}</button>
        <button className="btn primary wide" data-action="home" onClick={onHome}>{t('raid.result.home')}</button>
      </footer>
    </div>
  );
}
