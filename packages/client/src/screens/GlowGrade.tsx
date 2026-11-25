/**
 * 섬광 받는 등급 보석 — 장수 일람(2026-11-20 기획자).
 *
 * 뒤에는 꼬마 뒤 후광과 같은 섬광(`STAND_GLOW` — E 금 · S 자주 · A 붉은 · B 푸른 · C 초록 · D 흰 별빛),
 * 위에는 4.5초에 한 번 빛이 비스듬히 스치는 광택(`.glow-gr .gr::after` — 장수 상세 이름 줄과 같은 `gr-glint`, 보석 모양으로만).
 */

import { GradeBadge } from './GradeBadge.tsx';
import { BlinkGlow, STAND_GLOW } from './BlinkGlow.tsx';

export function GlowGrade({ grade }: { grade: string }): React.JSX.Element {
  const tone = STAND_GLOW[grade];
  return (
    <span className="glow-gr">
      {tone && <BlinkGlow tone={tone} className="glow-gr-halo" />}
      <GradeBadge grade={grade} />
    </span>
  );
}
