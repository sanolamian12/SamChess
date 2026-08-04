/**
 * 메인 — 도시 현황과 갈림길 (GDD §8)
 *
 * 지금 있는 길은 **AI 대전**과 **장수 관리** 둘이다. 도시 증축·상점·랭킹·온라인은
 * 아직 없다(HANDOFF §7). 없는 메뉴를 비활성 버튼으로 세워 두면 "왜 안 눌리나"만
 * 남으므로, 있는 것만 둔다.
 */

import { grainCost, poolCap, poolUsed, gradeScore } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { clearProfile } from '../meta/storage.ts';
import type { Screen } from './App.tsx';

const MODES: BattleMode[] = ['3v3', '5v5'];

export function MainScreen({ profile, onGo, onReset }: {
  profile: PlayerProfile;
  onGo: (s: Screen) => void;
  onReset: () => void;
}): React.JSX.Element {
  return (
    <div className="scr scr-main">
      <header className="city">
        <h1 className="title">{profile.cityName}</h1>
        <div className="stats">
          <span className="stat"><i>도시</i><b>Lv{profile.cityLevel}</b></span>
          <span className="stat"><i>군량</i><b>{profile.grain}</b></span>
          <span className="stat"><i>장수</i><b>{poolUsed(profile)}/{poolCap(profile)}</b></span>
          <span className="stat"><i>등급 점수</i><b>{gradeScore(profile)}</b></span>
        </div>
      </header>

      <section className="menu">
        <h2 className="cap">AI 대전</h2>
        {MODES.map((mode) => {
          const cost = grainCost(mode);
          const poor = profile.grain < cost;
          const short = poolUsed(profile) < cost;
          return (
            <button
              key={mode}
              className="btn wide"
              data-mode={mode}
              disabled={poor || short}
              onClick={() => onGo({ name: 'roster', mode })}
            >
              <span className="lbl">{mode}</span>
              <span className="sub">
                {short ? `장수가 ${cost}명 필요하다` : `군량 ${cost}${poor ? ` — ${profile.grain}밖에 없다` : ''}`}
              </span>
            </button>
          );
        })}
        {/* AI 대전은 군량만 준다 — 카드는 온라인·상점에서만 (GDD §6.4, 2026-08-04 확정) */}
        <p className="hint">AI 대전은 이겨도 군량만 받는다. 장수 카드는 나오지 않는다.</p>
      </section>

      <section className="menu">
        <h2 className="cap">도시</h2>
        <button className="btn wide" onClick={() => onGo({ name: 'officers' })}>
          <span className="lbl">장수 관리</span>
          <span className="sub">정보 · 레벨업 · 전적</span>
        </button>
      </section>

      <footer className="foot">
        <button
          className="btn ghost"
          onClick={() => {
            if (window.confirm('계정을 지우고 처음부터 시작할까요? 되돌릴 수 없습니다.')) {
              clearProfile();
              onReset();
            }
          }}
        >계정 초기화</button>
      </footer>
    </div>
  );
}
