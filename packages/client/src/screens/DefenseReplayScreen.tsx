/**
 * 방어 기록 리플레이 (2026-10-28, GDD §8.8 단계 5) — 전투 무대(`BattleStage`)를 그대로 쓰고 판정 주체만 `ReplayTransport`다.
 *
 * 사람이 없는 관전이라 명령 판이 빈다 — 그 아래 칸에 리플레이 띠(`.dfr-bar`)를 얹는다: 제목 · 끝났을 때 한 줄 · [목록으로].
 * **정산이 없다** — 판이 끝나도 결과 화면으로 가지 않고 띠가 「판이 끝났습니다」를 말한다. 공격자가 자리를 떠 기록이 끊긴 판은
 * 그 자리에서 멈추고 「공격자가 자리를 떴습니다」(기획자 확정 — 둔 데까지).
 * 스모크는 `window.__replay`(지금 상태 · 다 썼는가)를 서버 재생과 견준다.
 */

import { useEffect, useState } from 'react';
import type { DefenseReplayData } from '@samchess/meta';
import { bootBattle } from '../battle/boot.ts';
import { ReplayTransport } from '../battle/replayTransport.ts';
import type { DefenseReplay } from '../battle/replayTransport.ts';
import { BattleStage } from './BattleStage.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function DefenseReplayScreen({ data, onBack }: { data: DefenseReplayData; onBack: () => void }): React.JSX.Element {
  useLang();
  const [end, setEnd] = useState<'finished' | 'cut' | null>(null);

  useEffect(() => {
    const rec: DefenseReplay = {
      seed: data.seed, mode: data.mode,
      entries: data.replay.entries as DefenseReplay['entries'],
      deploy: data.replay.deploy as DefenseReplay['deploy'],
      intents: data.replay.intents as DefenseReplay['intents'],
      ...(data.replay.scenario ? { scenario: data.replay.scenario } : {}),
      ...(data.replay.policy ? { policy: data.replay.policy as NonNullable<DefenseReplay['policy']> } : {}),
    };
    const transport = new ReplayTransport(rec, () => setEnd('cut'));
    (window as unknown as { __replay?: ReplayTransport }).__replay = transport;
    const handle = bootBattle({ transport, onFinish: () => setEnd('finished') });
    return () => { handle.destroy(); delete (window as unknown as { __replay?: ReplayTransport }).__replay; };
    // 판은 한 번 띄우면 끝까지 간다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <BattleStage />
      <div className="dfr-bar" data-screen="defenseReplay" data-end={end ?? ''}>
        <span className="dfr-title">{t('defense.replay.title')}</span>
        {end && <span className="dfr-end" data-field="replayEnd">{t(end === 'finished' ? 'defense.replay.done' : 'defense.replay.cut')}</span>}
        <button className="btn sm" data-action="replayBack" onClick={onBack}>{t('defense.replay.back')}</button>
      </div>
    </>
  );
}
