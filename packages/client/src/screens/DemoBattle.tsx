/**
 * 데모 전투 — 계정·편성을 건너뛰고 한 판만 띄운다 (`?demo=1`).
 *
 * 화면 회귀 확인(`npm run smoke:ui` · `npm run shot`)이 이 길을 쓴다. 편성 화면을 거치면
 * 시드가 편성에서 나오므로 "같은 URL이면 같은 판"이 성립하지 않기 때문이다.
 *
 * **데모 편성은 Lv1이 아니다** (기획자 지정) — 전원 Lv9 · 능력 전부 HP · 책략은 환술 8종.
 * Lv1은 책략이 없어 버프·디버프가 아예 생기지 않아 화면에 띄울 것이 없다.
 */

import { useEffect, useRef } from 'react';
import type { BattleMode, Side } from '@samchess/rules';
import { bootBattle } from '../battle/boot.ts';
import { createDemoBattle } from '../battle/setup.ts';
import { BattleStage } from './BattleStage.tsx';
import { useFrameFit } from './useFrameFit.ts';

export function DemoBattle({ params }: { params: URLSearchParams }): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  useFrameFit(frameRef);

  useEffect(() => {
    const seed = Number(params.get('seed') ?? 1);
    const mode = (params.get('mode') ?? '3v3') as BattleMode;
    const humanSide = params.get('auto') ? null : ((params.get('side') ?? 'P1') as Side);
    const sp = params.get('sp');

    const handle = bootBattle({
      initial: createDemoBattle(seed, mode, sp === null ? {} : { sp: Number(sp) }),
      humanSide,
    });
    return () => handle.destroy();
    // 데모는 URL이 정한다. 한 번 띄우면 그대로 간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="frame" className="battle" ref={frameRef}>
      <BattleStage />
    </div>
  );
}
