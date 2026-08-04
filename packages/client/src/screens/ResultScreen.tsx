/**
 * 전투 결과 — 승패와 보상 (GDD §6.4)
 *
 * **AI 대전은 군량만 준다.** 카드가 안 나오는 것이 버그로 보이지 않도록 그 이유를 적는다
 * (2026-08-04 확정 — 봇 파밍 방지).
 */

import { officerById } from '@samchess/data';
import type { BattleRewards } from '@samchess/meta';
import { OfficerArt } from './OfficerArt.tsx';

export function ResultScreen({ won, outcome, rewards, onAgain, onHome }: {
  won: boolean;
  outcome: string;
  rewards: BattleRewards;
  onAgain: () => void;
  onHome: () => void;
}): React.JSX.Element {
  const card = rewards.card ? officerById.get(rewards.card) : undefined;

  return (
    <div className={`scr scr-result ${won ? 'win' : 'lose'}`}>
      <h1 className="title">{won ? '승리' : '패배'}</h1>
      <p className="lede">{outcome}</p>

      <section className="rewards">
        <h2 className="cap">보상</h2>
        <div className="row"><span className="k">군량</span><span className="v">{rewards.grain > 0 ? `+${rewards.grain}` : '없음'}</span></div>
        {card ? (
          <div className="row card">
            <OfficerArt officer={card.id} className="thumb" />
            <span className="k">{card.name}</span>
            <span className="v">{rewards.cardGrade}급 카드</span>
          </div>
        ) : (
          <p className="hint">AI 대전은 장수 카드를 주지 않는다 — 카드는 온라인 대전과 상점에서 나온다.</p>
        )}
      </section>

      <footer className="foot">
        <button className="btn wide" onClick={onAgain}>다시 편성</button>
        <button className="btn primary wide" onClick={onHome}>도시로</button>
      </footer>
    </div>
  );
}
