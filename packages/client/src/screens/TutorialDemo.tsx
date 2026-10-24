/**
 * 튜토리얼 판을 로그인 없이 보는 통로 — `?tutorial=basic-1` (`basic-2` · `basic-3` · 판이 선 S급 `s-jo-jo` · `s-yeo-po` …).
 *
 * `?demo=1`(DemoBattle)과 같은 결이다 — 계정 · 서버 없이 판과 안내 층만 띄운다. 완료는 서버에 안 적고
 * 새 계정 하나를 돌려준 셈 치며, 끝나면 같은 판을 처음부터 다시 띄운다(눈으로 여러 번 보기 좋게).
 */

import { useRef, useState } from 'react';
import { createProfile, isTutorialId, tutorialReady } from '@samchess/meta';
import type { TutorialId } from '@samchess/meta';
import { TutorialBattleScreen } from './TutorialBattleScreen.tsx';
import { useFrameFit } from './useFrameFit.ts';

export function TutorialDemo({ params }: { params: URLSearchParams }): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  useFrameFit(frameRef);
  const asked = params.get('tutorial');
  const id: TutorialId = isTutorialId(asked) && tutorialReady(asked) ? asked : 'basic-1';
  const [round, setRound] = useState(0);
  return (
    <div id="frame" className="battle" ref={frameRef}>
      <TutorialBattleScreen
        key={round}
        id={id}
        save={() => Promise.resolve(createProfile('튜토리얼', 1))}
        onDone={() => setRound((n) => n + 1)}
        onExit={() => setRound((n) => n + 1)}
      />
    </div>
  );
}
