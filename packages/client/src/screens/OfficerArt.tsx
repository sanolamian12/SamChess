/**
 * 장수 그림 한 장 — 기본은 수묵화 → 타일 초상화 → 빈자리 순으로 물러난다.
 *
 * 대체 규칙은 `ui/art.ts` 한 곳에 있고 여기서는 그걸 React에 붙일 뿐이다.
 * 수묵화(`assets/CharsInBattle/`)는 260명 중 일부만 있어서, 없는 장수가 더 흔하다.
 *
 * `primary="portrait"`를 주면 **순서를 뒤집어** 타일 초상화(`assets/Chars/`,
 * 전투에서 기물로 쓰는 그 그림)를 먼저 보여준다 — 장수 카드(pptx 53쪽) 전용.
 */

import { useEffect, useState } from 'react';
import { actionSheetUrl, ACTION_FRAME_COUNT, setOfficerArt } from '../ui/art.ts';

export function OfficerArt({ officer, className, primary }: {
  officer: string;
  className?: string;
  primary?: 'battle' | 'portrait';
}): React.JSX.Element {
  return (
    <img
      className={className ?? 'art'}
      alt=""
      // key를 두어 장수가 바뀌면 img를 새로 만든다 — onerror 사슬이 남아 있으면
      // 이전 장수의 대체 경로로 흘러간다
      key={officer}
      ref={(el) => { if (el) setOfficerArt(el, officer, primary); }}
    />
  );
}

const STAND_MS = 3000;
const ACTION_MIN_MS = 1000;
const ACTION_MAX_MS = 2000;

type Pose = { frame: number; flip: boolean };

/** 대기(0번 칸) — 항상 이 자세로 돌아온다. 뒤집지 않는다: 매번 같은 모양이어야
    「돌아왔다」는 기준점 노릇을 한다(뒤집혔다 안 뒤집혔다 하면 기준이 안 선다). */
const STAND: Pose = { frame: 0, flip: false };

/** 대기 자세(0번)를 뺀 나머지(이동·공격·책략·피격) 중 하나를 무작위로, 좌우도 무작위로. */
function randomAction(): Pose {
  return { frame: 1 + Math.floor(Math.random() * (ACTION_FRAME_COUNT - 1)), flip: Math.random() < 0.5 };
}

/**
 * 장수 정보 패널 전용 — 정적 초상화 대신 전투 액션 시트(다섯 칸 × 좌우반전)를 돌려
 * 「가만히 안 서 있다」는 인상을 준다(2026-09-02 지정, 2026-09-02 타이밍 재지정).
 * **대기 3초 → 무작위 동작 1~2초 → 대기 3초 → …**를 반복한다 — 대기가 시작이자
 * 매번 돌아오는 기준 박자이고, 동작만 무작위다(대기 자체를 무작위로 건너뛰지 않는다).
 * 시트가 없는 장수는(에셋 미배포·비주류 장수) `probe`가 로드 실패를 잡아 기존
 * `OfficerArt`(수묵화 → 초상화 순으로 물러나는 그 컴포넌트)로 조용히 물러난다.
 */
export function OfficerActionArt({ officer, className }: {
  officer: string;
  className?: string;
}): React.JSX.Element {
  const [missing, setMissing] = useState(false);
  const [pose, setPose] = useState<Pose>(STAND);

  useEffect(() => {
    setMissing(false);
    setPose(STAND);
    const probe = new Image();
    probe.onerror = () => setMissing(true);
    probe.src = actionSheetUrl(officer);

    let timer: number;
    let standing = true;
    const scheduleNext = (delay: number): void => {
      timer = window.setTimeout(() => {
        if (standing) {
          setPose(randomAction());
          standing = false;
          scheduleNext(ACTION_MIN_MS + Math.random() * (ACTION_MAX_MS - ACTION_MIN_MS));
        } else {
          setPose(STAND);
          standing = true;
          scheduleNext(STAND_MS);
        }
      }, delay);
    };
    scheduleNext(STAND_MS);
    return () => window.clearTimeout(timer);
  }, [officer]);

  if (missing) {
    return <OfficerArt officer={officer} className={className ?? 'art'} primary="portrait" />;
  }

  return (
    <div
      className={`${className ?? 'art'} ofc-action-art`}
      style={{
        backgroundImage: `url(${actionSheetUrl(officer)})`,
        backgroundSize: `${ACTION_FRAME_COUNT * 100}% 100%`,
        backgroundPosition: `${(pose.frame / (ACTION_FRAME_COUNT - 1)) * 100}% 0`,
        transform: pose.flip ? 'scaleX(-1)' : undefined,
      }}
    />
  );
}
