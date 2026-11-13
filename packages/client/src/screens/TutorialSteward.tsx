/**
 * 튜토리얼 안내의 사람 — 일기토는 병사, 설전은 태학 학사가 오른쪽 아래에 서서 두루마리로 말한다 (2026-11-13 기획자).
 *
 * 도시 안내(`Steward.tsx`)와 **같은 꼴 · 같은 CSS**(`.stw-*`)다 — 들어오고 · 말풍선을 펴고 · 물러나는 연출도 같다.
 * 다른 것은 셋이다:
 * - **판을 막는다** — 튜토리얼 안내는 닫혀야 그 단계의 잠금이 걸리므로(`TutorialBattleScreen`) 가리개(`tutorialGuide`)가 뒤를 막는다.
 *   스모크(`tools/tutorial_ux.ts`)가 거는 `data-modal="tutorialGuide"` · `data-key` · `[data-action="tutorialNext"]`는 옛 안내판 그대로다.
 * - **건너뛰기가 없다** — 대본이 끝까지 가야 판이 이어진다. 사람을 눌러도 말풍선과 같이 다음 장으로 넘어간다.
 * - **전투 프레임은 기준 위치가 없다**(`#frame.battle`) — 층을 `fixed`로 두고 프레임의 자리를 재서 덮는다(크기 단위 cqw가 프레임 폭이 되게).
 *
 * 목소리는 판에서 처음 들어올 때 한 번(부르는 쪽 `onEnter`) — 안내가 열릴 때마다 부르면 합마다 「주공!」이다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { guideSpeakerArt } from './guideScript.ts';
import type { GuideSpeaker } from './guideScript.ts';

/** 물러나는 연출 길이 — `style.css`의 `.stw[data-phase="out"]`(`Steward.tsx`의 `OUT_MS`와 같다) */
const OUT_MS = 450;

interface Rect { left: number; top: number; width: number; height: number }

const frameRect = (): Rect | null => {
  const r = document.getElementById('frame')?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
};

export function TutorialSteward({ speaker, tier, lineKey, text, onNext, onEnter }: {
  speaker: GuideSpeaker;
  /** 도시 레벨 단 — 병사 그림이 갑옷을 갈아입는다(`stewardTier`) */
  tier: number;
  /** 지금 장의 열쇠 — 없으면(안내가 닫혔다) 물러난다 */
  lineKey: string | null;
  text: string;
  onNext: () => void;
  /** 들어오기 시작하는 순간 — 목소리 */
  onEnter?: () => void;
}): React.JSX.Element | null {
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>(lineKey ? 'in' : 'gone');
  /** 물러나는 동안에도 보일 마지막 글 */
  const [shown, setShown] = useState({ key: lineKey ?? '', text });
  const [rect, setRect] = useState<Rect | null>(frameRect);
  const enter = useRef(onEnter);
  enter.current = onEnter;

  useEffect(() => {
    if (lineKey) {
      setShown({ key: lineKey, text });
      setPhase((p) => {
        if (p === 'gone') enter.current?.();
        return 'in';
      });
      return;
    }
    setPhase((p) => (p === 'in' ? 'out' : p));
    const timer = window.setTimeout(() => setPhase((p) => (p === 'out' ? 'gone' : p)), OUT_MS);
    return () => window.clearTimeout(timer);
  }, [lineKey, text]);

  // 프레임의 자리 — 창 크기가 바뀌면 다시 잰다
  useLayoutEffect(() => {
    if (phase === 'gone') return;
    const measure = (): void => setRect(frameRect());
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [phase]);

  if (phase === 'gone' || !rect) return null;
  const layer = (
    <div className="stw tut-stw" data-phase={phase} data-speaker={speaker} style={rect}>
      <div className="stw-drag">
        <div className="stw-bubble" onClick={onNext}>
          <p key={shown.key} className="stw-text" data-field="line">{shown.text}</p>
          <button
            className="stw-next"
            data-action="tutorialNext"
            aria-label={t('tut.next')}
            onClick={(e) => { e.stopPropagation(); onNext(); }}
          >
            <img src="icons/confirm.png" alt="" />
          </button>
        </div>
        <img className="stw-man" src={guideSpeakerArt(speaker, tier)} alt="" draggable={false} onClick={onNext} />
      </div>
    </div>
  );
  // 펴져 있는 동안만 가리개가 판을 막는다 — 물러나는 동안은 이미 다음 단계다
  return phase === 'in'
    ? <div className="modal-back gi-ask-back tut-back tut-stw-back" data-modal="tutorialGuide" data-key={shown.key}>{layer}</div>
    : layer;
}
