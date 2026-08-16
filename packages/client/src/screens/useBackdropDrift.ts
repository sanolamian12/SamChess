/**
 * 배경의 걸음을 세는 자리 — `backdropMotion.ts`와 React를 잇는다.
 *
 * `backdropMotion.ts`는 React도 시계도 모른다(`i18n/index.ts`와 같은 결).
 * `npm test`가 그대로 실행할 수 있어야 해서다. 시계를 읽는 것은 여기뿐이다.
 *
 * **움직임을 싫어하는 사용자에게는 아예 걷지 않는다.** 운영체제의
 * 「동작 줄이기」가 켜져 있으면 걸음을 세지 않으므로 자세가 첫 번째에서
 * 멈춘다 — 배경이 흔들리면 어지러운 사람이 있고, 브라우저가 그 뜻을
 * `prefers-reduced-motion`으로 알려 준다.
 */

import { useEffect, useState } from 'react';
import { DRIFT_MS } from './backdropMotion.ts';

/** 지금 몇 번째 걸음인가. 계속 늘어난다 — 접는 것은 `driftPose()`가 한다. */
export function useBackdropDrift(): number {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setStep((n) => n + 1), DRIFT_MS);
    return () => window.clearInterval(id);
  }, []);

  return step;
}
