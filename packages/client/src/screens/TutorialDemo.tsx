/**
 * 튜토리얼 판을 로그인 없이 보는 통로 — `?tutorial=basic-1` (`basic-2` · `basic-3` · 판이 선 S급 `s-jo-jo` · `s-yeo-po` …).
 *
 * `?demo=1`(DemoBattle)과 같은 결이다 — 계정 · 서버 없이 판과 안내 층만 띄운다. 완료는 서버에 안 적고
 * 새 계정 하나를 돌려준 셈 치며, 이기면 승리 두루마리(`TutorialResultScreen`)를 띄운다 — 보상은 그 새 계정에
 * meta의 `completeTutorial`을 그대로 부른 값이다(서버에는 아무것도 안 남는다). [튜토리얼 목록으로]를 누르면 같은 판을 처음부터.
 */

import { useRef, useState } from 'react';
import { BASIC_TUTORIALS, completeTutorial, createProfile, isTutorialId, tutorialReady } from '@samchess/meta';
import type { TutorialId } from '@samchess/meta';
import { TutorialBattleScreen } from './TutorialBattleScreen.tsx';
import { TutorialResultScreen } from './ResultScreen.tsx';
import type { TutorialDone } from '../meta/city.ts';
import { useFrameFit } from './useFrameFit.ts';

export function TutorialDemo({ params }: { params: URLSearchParams }): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  useFrameFit(frameRef);
  const asked = params.get('tutorial');
  const id: TutorialId = isTutorialId(asked) && tutorialReady(asked) ? asked : 'basic-1';
  const [round, setRound] = useState(0);
  const [won, setWon] = useState<TutorialDone | null>(null);
  // 처음 끝낸 판으로 친다 — 기본 1 말고는 앞 판이 잠겨 있으므로 그 앞 판들을 끝낸 새 계정으로
  const fresh = (): TutorialDone => {
    // 새 계정은 창고가 가득 차 군량 보상이 「없음」으로 보인다(들어간 만큼만 적는다) — 데모는 빈 창고로 시작해 +1을 보인다
    let p = { ...createProfile('튜토리얼', 1), grain: 0 };
    for (const before of BASIC_TUTORIALS) {
      if (before === id) break;
      p = completeTutorial(p, before, 1).profile;
    }
    // S급 판은 새 계정에 그 장수가 없을 수 있다 — 그때는 보상 없이 승리 장면만
    try { return completeTutorial(p, id, round + 1); } catch { return { profile: p, rewards: null }; }
  };
  if (won) {
    return (
      <div id="frame" className="meta" ref={frameRef}>
        <TutorialResultScreen id={id} rewards={won.rewards} onBack={() => { setWon(null); setRound((n) => n + 1); }} />
      </div>
    );
  }
  return (
    <div id="frame" className="battle" ref={frameRef}>
      <TutorialBattleScreen
        key={round}
        id={id}
        save={() => Promise.resolve(fresh())}
        onDone={(d) => setWon(d)}
        onExit={() => setRound((n) => n + 1)}
      />
    </div>
  );
}
