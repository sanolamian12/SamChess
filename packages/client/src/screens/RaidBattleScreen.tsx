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
import { currentSession } from '../meta/auth.ts';
import { LocalTransport } from '../battle/transport.ts';
import { RaidRequestFailed, settleRaidOnServer } from '../meta/raid.ts';
import { loadProfile } from '../meta/storage.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { buildingBackdrop } from './backdrop.ts';
import { BattleStage } from './BattleStage.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { GradeBadge } from './GradeBadge.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';

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

/**
 * 결과의 색 — 농지 현황판의 「도적단 출현」과 **같은 색**이다(`raidText.ts`의 `RaidTone`).
 * 막았으면 파랑, 빼앗겼으면 짙은 회색. 무승부는 약탈이 없어 파랑 쪽이다.
 */
const TONE: Record<RaidState['status'], 'cleared' | 'looted'> = {
  pending: 'looted', fighting: 'looted', won: 'cleared', drawn: 'cleared', lost: 'looted', surrendered: 'looted',
};

/**
 * 방어전 결과 (2026-09-21 화풍) — 농지 화면과 같은 틀이다.
 *
 * ```
 * ┌ 도적떼 방어전 ───────────────┐   ← 청동 명패
 * ┌ 도적떼를 막아 냈다 ───────────┐   ← 현황판: 판정(색) · 남은 도적 · 약탈당한 군량
 * ┌ 보상 ───────────────────────┐   ← 이겼을 때만: [군량][재료] 두 칸 + 카드(장터 뽑기와 같은 액자)
 *                  (농지 그림)
 * ┌ [농지로]  [메인으로] ─────────┐   ← 바닥 명령 판
 * ```
 *
 * 나가는 문이 둘이라 뒤로 화살표는 없다 — 판이 끝난 자리에서 「뒤로」는 전투로 돌아가는 말로 읽힌다.
 */
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
  const cards = given?.cards ?? [];

  return (
    <ScreenChrome
      backdrop={buildingBackdrop('farm')}
      className="scr-place scr-building-farm scr-raid-result"
      account={currentSession()?.email ?? null}
    >
      <div className="rrs-frame" data-screen="raidResult" data-raid={status}>
        <div className="place-bar">
          <span className="place-nm">{t('raid.result.title')}</span>
        </div>

        <section className="place-panel rrs-status" data-field="status">
          <h1 className="rrs-verdict" data-tone={TONE[status]}>{t(TITLE[status] ?? 'raid.result.surrendered')}</h1>
          <dl className="frm-info">
            <div className="frm-line" data-field="bandits" data-n={banditsLeft}>
              <dt>{t('raid.result.k.bandits')}</dt>
              <dd>{t('raid.result.v.bandits', { n: banditsLeft })}</dd>
            </div>
            <div className="frm-line frm-raid">
              <dt>{t('raid.result.k.loot')}</dt>
              <dd data-field="loot" data-loot={loot} data-tone={loot > 0 ? 'looted' : 'cleared'}>
                {loot > 0 ? t('raid.result.v.loot', { n: loot }) : t('result.none')}
              </dd>
            </div>
          </dl>
          {error && <p className="note" data-field="error">{error}</p>}
        </section>

        {status === 'won' && (
          <section className="place-panel rrs-rewards" data-field="rewards">
            <h2 className="cap rrs-cap">{t('result.rewards')}</h2>
            <div className="rrs-gains">
              <div className="rrs-gain">
                <img src="market/grain.png" alt="" />
                <span className="k">{t('result.grain')}</span>
                <b className="v" data-field="grain">{given && given.grain > 0 ? `+${given.grain}` : t('result.none')}</b>
              </div>
              <div className="rrs-gain">
                <img src="market/materials.png" alt="" />
                <span className="k">{t('result.materials')}</span>
                <b className="v" data-field="materials">{given && given.materials > 0 ? `+${given.materials}` : t('result.none')}</b>
              </div>
            </div>
            {cards.length > 0 && (
              // 카드는 장터 뽑기 결과와 **같은 액자**다(`.mkt-card`) — 한 게임 안에서 「카드를 얻었다」가 한 모양이다
              <div className="mkt-cards rrs-cards">
                {cards.map((c, i) => {
                  const o = officerById.get(c.officer);
                  return (
                    <div key={`${c.officer}-${i}`} className="mkt-card" data-field="card" data-officer={c.officer} data-grade={c.grade}>
                      <div className="mkt-card-frame" style={{ backgroundImage: `url(market/frame-${c.grade}.png)` }}>
                        <OfficerArt officer={c.officer} className="mkt-card-art" />
                      </div>
                      <span className="mkt-card-name">{o ? pickOfficerName(o) : c.officer}</span>
                      <span className="rrs-card-grade"><GradeBadge grade={c.grade} /></span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div className="place-body">
          <section className="place-panel rrs-acts">
            <div className="frg-buttons">
              <button className="btn wide" data-action="farm" onClick={onFarm}>
                <span className="lbl">{t('raid.result.farm')}</span>
              </button>
              <button className="btn primary wide" data-action="home" onClick={onHome}>
                <span className="lbl">{t('raid.result.home')}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </ScreenChrome>
  );
}
