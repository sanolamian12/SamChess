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

const isBasic = (id: TutorialId): id is BasicTutorialId => (BASIC_TUTORIALS as readonly string[]).includes(id);

export function TutorialListScreen({ profile, onBack, onPlay }: {
  profile: PlayerProfile;
  onBack: () => void;
  onPlay: (id: TutorialId) => void;
}): React.JSX.Element {
  useLang();
  const rows = tutorialList(profile);
  /** 이미 끝낸 판을 눌렀다 — 잘못 누른 것일 수 있으니 한 번 더 묻는다(2026-10-24 기획자) */
  const [replay, setReplay] = useState<TutorialId | null>(null);
  const play = (id: TutorialId, status: string): void => { if (status === 'done') setReplay(id); else onPlay(id); };
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
                  onClick={() => play(id, status)}
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
                onClick={() => play(id, status)}
              >
                <span className="lbl">{t('tut.s', { name: pickOfficerNameById(officer, officer) })}</span>
                <span className="sub">{sub}</span>
              </button>
            );
          })}
        </section>
      </div>

      {replay && (
        <div className="modal-back" data-modal="tutorialReplay" onClick={() => setReplay(null)}>
          <div className="modal mod-plank srt-modal" onClick={(e) => e.stopPropagation()}>
            <p className="row" data-field="ask">{t('tut.replay.q')}</p>
            <div className="srt-modal-acts">
              <button className="btn primary wide" data-action="replayOk" onClick={() => { const id = replay; setReplay(null); onPlay(id); }}>
                {t('tut.retry')}
              </button>
              <button className="btn wide" data-action="replayCancel" onClick={() => setReplay(null)}>
                {t('sortie.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ScreenChrome>
  );
}
