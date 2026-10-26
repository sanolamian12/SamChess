/**
 * 튜토리얼 목록 — 병영의 [튜토리얼] (G3, `Design/튜토리얼_시나리오_초안.md`, 2026-10-22 기획자).
 *
 * 병영의 문 화면과 같은 꼴이다 — 판때기 하나에 넓은 단추가 위에서 아래로. **무엇이 보이고 켜지는지는 규칙이 정한다**
 * (`tutorialList` — 기본 1 → 2 → 3 차례로 열리고, S급은 보유해야 보이고 기본 셋 뒤에 켜진다). 화면은 그리기만 한다.
 *
 * S급 판은 아직 시나리오가 없다 — 보이기는 하되 「준비 중」으로 잠가 둔다. 단추가 눌리지 않는 것만으로는 이유가
 * 안 보이므로 사연(`.sub`)에 적는다.
 *
 * **단추는 판때기의 직계 자식이다** — 병영 문과 같은 규약(스모크가 `.place-panel > .btn`으로 센다).
 */

import { useState } from 'react';
import { BASIC_TUTORIALS, tutorialList, tutorialReady } from '@samchess/meta';
import type { BasicTutorialId, PlayerProfile, TutorialId } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { pickOfficerNameById } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { placeBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon } from './GameIcon.tsx';
import { tutorialIntro } from './tutorialIntro.ts';

const isBasic = (id: TutorialId): id is BasicTutorialId => (BASIC_TUTORIALS as readonly string[]).includes(id);

export function TutorialListScreen({ profile, onBack, onPlay }: {
  profile: PlayerProfile;
  onBack: () => void;
  onPlay: (id: TutorialId) => void;
}): React.JSX.Element {
  useLang();
  const rows = tutorialList(profile);
  /** 판을 누르면 곧장 들어가지 않고 **소개 패널**을 띄운다(2026-10-26 기획자) — 한 줄 이야기 · 클리어 목표 · 클리어 여부 ·
      [입장하기] [돌아가기]. 끝낸 판을 다시 묻던 물음(2026-10-24)은 이 패널의 「클리어함」 줄이 대신한다 */
  const [intro, setIntro] = useState<{ id: TutorialId; title: string; done: boolean } | null>(null);
  const play = (id: TutorialId, status: string, title: string): void => setIntro({ id, title, done: status === 'done' });
  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-place scr-place-barracks scr-tutorials"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="tutorials">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('place.back'))}
        </button>
        <span className="place-nm">{t('tut.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel bar-doors">
          {rows.map(({ id, status }) => {
            if (isBasic(id)) {
              const sub = status === 'done' ? t('tut.status.done')
                : status === 'locked' ? t('tut.status.locked')
                : t(`tut.${id}.sub`);
              return (
                <button
                  key={id}
                  className={`btn wide${status === 'open' ? ' primary' : ''}`}
                  data-action="tutorial" data-tutorial={id} data-status={status}
                  disabled={status === 'locked'}
                  onClick={() => play(id, status, t(`tut.${id}`))}
                >
                  <span className="lbl">{t(`tut.${id}`)}</span>
                  <span className="sub">{sub}</span>
                </button>
              );
            }
            // S급 — 판이 선 장수만 열린다. 아직 판이 없으면 「준비 중」(30판은 차례로 선다)
            const officer = id.slice(2);
            const ready = tutorialReady(id);
            const sub = status === 'locked' ? t('tut.status.sLocked')
              : !ready ? t('tut.s.sub')
              : status === 'done' ? t('tut.status.done') : t('tut.s.open');
            return (
              <button
                key={id}
                className={`btn wide${ready && status === 'open' ? ' primary' : ''}`}
                data-action="tutorial" data-tutorial={id} data-status={ready ? status : 'soon'}
                disabled={status === 'locked' || !ready}
                onClick={() => play(id, status, t('tut.s', { name: pickOfficerNameById(officer, officer) }))}
              >
                <span className="lbl">{t('tut.s', { name: pickOfficerNameById(officer, officer) })}</span>
                <span className="sub">{sub}</span>
              </button>
            );
          })}
        </section>
      </div>

      {intro && (
        <IntroPanel
          {...intro}
          onEnter={() => { const id = intro.id; setIntro(null); onPlay(id); }}
          onClose={() => setIntro(null)}
        />
      )}
    </ScreenChrome>
  );
}

/** 소개 패널 — 판 이름 · 한 줄 이야기 · 승리 조건 · 패배 조건(메달 + 짧은 글) · 클리어 표 + [입장하기]/[다시하기] · [돌아가기].
    가리개를 누르면 [돌아가기]와 같다 */
function IntroPanel({ id, title, done, onEnter, onClose }: {
  id: TutorialId; title: string; done: boolean; onEnter: () => void; onClose: () => void;
}): React.JSX.Element {
  const info = tutorialIntro(id);
  return (
    <div className="modal-back" data-modal="tutorialIntro" data-tutorial={id} onClick={onClose}>
      <div className="modal mod-plank tut-intro" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{title}</p>
        <p className="tut-intro-story" data-field="story">{info.story}</p>
        <div className="tut-intro-sec" data-field="goals">
          <span className="cap">{t('tut.intro.goals')}</span>
          <ul>{info.win.map((g, i) => <li key={i}><GameIcon name={g.icon} label={g.text} text /></li>)}</ul>
        </div>
        {info.lose.length > 0 && (
          <div className="tut-intro-sec lose" data-field="lose">
            <span className="cap">{t('tut.intro.lose')}</span>
            <ul>{info.lose.map((g, i) => <li key={i}><GameIcon name={g.icon} label={g.text} text /></li>)}</ul>
          </div>
        )}
        <div className="srt-modal-acts">
          {/* 클리어 표 + [입장하기] / [다시하기] — 안 깼으면 붉은 체크 인장, 깼으면 같은 인장이 파랗다(기획자 2026-10-26).
              「한 번이라도 해 봤나」는 기록이 없다(서버는 깬 판만 적는다) — 깬 판이면 [다시하기] */}
          <div className="tut-intro-go" data-field="cleared" data-done={done ? '1' : '0'}>
            <GameIcon name={done ? 'mk-done-blue' : 'mk-done'} label={done ? t('tut.intro.retry') : t('tut.intro.enter')} />
            <button className="btn primary wide" data-action="introEnter" onClick={onEnter}>{t(done ? 'tut.intro.retry' : 'tut.intro.enter')}</button>
          </div>
          <button className="btn wide" data-action="introBack" onClick={onClose}>{t('tut.intro.back')}</button>
        </div>
      </div>
    </div>
  );
}
