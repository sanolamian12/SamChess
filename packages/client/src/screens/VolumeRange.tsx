/**
 * 소리 크기 과녁 — 환경설정의 배경 음악 · 효과음 한 줄씩 (2026-10-23 기획자 지정)
 *
 * ```
 *  배경 음악   20   40   60   80   100    ← 칸 숫자는 이름과 같은 줄, 제 과녁 바로 위
 *  🏹       ▯    ▯    ▯    ▯    ▯        ← 과녁을 누르면 활이 쏘고, 화살이 그 과녁에 박히는 소리로 크기를 들려준다
 *    ⃠                                     ← 활을 누르면 음소거 — 활 오른쪽 아래에 작은 금지 표시
 * ```
 *
 * **음소거는 활이다** (2026-10-23 기획자) — 과녁은 20~100%뿐이라 끄는 칸이 없다. 활을 누르면 그 갈래만 꺼지고(칸은 남는다),
 * 다시 누르거나 과녁을 쏘면 켜진다. 꺼진 동안 과녁은 흐리게.
 *
 * 과녁은 시작점(활)에서 **고르게** 서 있고, 하나가 20%다(`audio/volume.ts`의 다섯 칸).
 * 화살은 **포물선**으로 거리에 비례해 날아간다 — 가장 먼 100%가 0.5초(`FLIGHT_MS`, 높이는 `arcKeyframes`). 박히는 순간 `volume_arrow` 소리를 **그 칸의 크기로** 튼다.
 * 지금 칸의 과녁은 화살 박힌 그림(`target-hit`)이다.
 *
 * 그림은 `assets/icons/volume_{1..5}.png` → `ui/volume/`(`tools/build_ui.py`의 `VOLUME_ART`):
 * 1 활과 화살 · 2 화살이 떠난 활 · 3 화살 · 4 과녁 · 5 화살 박힌 과녁.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { playSfx } from '../audio/sfx.ts';
import { VOLUME_STEPS, onVolumeChange, setVolumeLevel, setVolumeMuted, volumeLevel, volumeMuted } from '../audio/volume.ts';
import type { VolumeChannel } from '../audio/volume.ts';

/** 100%(가장 먼 과녁)까지 화살이 나는 시간 — 가까운 과녁은 거리만큼 짧다 */
export const FLIGHT_MS = 500;
/** 쏜 뒤 활이 다시 화살을 메기기까지 */
const RELOAD_MS = 350;

/**
 * **포물선** (2026-10-23 기획자) — 화살은 쏜 높이와 같은 높이(과녁 판 가운데)로 떨어지는 대칭 포물선을 그린다.
 * 내려와 박히는 기울기를 화살 박힌 과녁 그림(`target-hit`)의 화살과 맞춘다 — 그림 속 화살대의 기울기는 155/630(약 14°)이고
 * 과녁을 옆으로 누르는 비율(`style.css`의 `--vr-squash` .7)만큼 화면에서 가팔라진다. 대칭 포물선의 착지 기울기는 4h/거리라
 * 높이는 거리에 비례한다(가까운 과녁은 낮게, 먼 과녁은 높게 — 비행 시간과 같은 결).
 */
const LAND_SLOPE = 155 / 630 / 1;
const ARC_FRAMES = 16;

/** 촉이 지나는 길 — 0 → `dist`, 높이는 `4h·t(1−t)`. 화살은 그 자리의 기울기로 돈다(촉을 축으로) */
function arcKeyframes(dist: number): Keyframe[] {
  const h = (dist * LAND_SLOPE) / 4;
  return Array.from({ length: ARC_FRAMES + 1 }, (_, i) => {
    const t = i / ARC_FRAMES;
    const y = -4 * h * t * (1 - t);
    const slope = dist > 0 ? (-4 * h * (1 - 2 * t)) / dist : 0;
    return { transform: `translate(${t * dist}px, ${y}px) rotate(${Math.atan(slope)}rad)`, opacity: 1 };
  });
}

const STEPS = Array.from({ length: VOLUME_STEPS }, (_, i) => i + 1);

export function VolumeRange({ channel, label }: { channel: VolumeChannel; label: string }): React.JSX.Element {
  const level = useSyncExternalStore(onVolumeChange, () => volumeLevel(channel), () => volumeLevel(channel));
  const muted = useSyncExternalStore(onVolumeChange, () => volumeMuted(channel), () => volumeMuted(channel));
  /** 날고 있는 화살이 향하는 칸 — 날아가는 동안 지금 칸의 과녁은 아직 그대로다 */
  const [flying, setFlying] = useState<number | null>(null);
  const [shot, setShot] = useState(false);
  const rangeRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLImageElement>(null);
  const timers = useRef<number[]>([]);
  const anim = useRef<Animation | null>(null);
  useEffect(() => () => { timers.current.forEach((id) => window.clearTimeout(id)); anim.current?.cancel(); }, []);

  const fire = (step: number): void => {
    const range = rangeRef.current;
    const arrow = arrowRef.current;
    const target = range?.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (!range || !arrow || !target) { setVolumeLevel(channel, step); return; }
    anim.current?.cancel();
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];

    // 화살 촉이 과녁 칸의 가운데에 닿을 때까지 — 레이아웃 값(offsetLeft, 화살과 칸 둘 다 `.vr-range` 기준)으로 잰다(틀이 transform으로 줄어 있어도 맞다)
    const from = arrow.offsetLeft;
    const to = target.offsetLeft + target.offsetWidth / 2 - arrow.offsetWidth;
    const far = range.querySelector<HTMLElement>(`[data-step="${VOLUME_STEPS}"]`);
    const longest = far ? far.offsetLeft + far.offsetWidth / 2 - arrow.offsetWidth - from : to - from;
    const ms = Math.max(1, FLIGHT_MS * ((to - from) / Math.max(1, longest)));

    setFlying(step);
    setShot(true);
    anim.current = arrow.animate(arcKeyframes(to - from), { duration: ms, easing: 'linear', fill: 'forwards' });
    anim.current.onfinish = () => {
      // 박혔다 — 칸을 바꾸고, 바뀐 크기로 박히는 소리를 낸다
      setVolumeLevel(channel, step);
      playSfx('volume_arrow', { channel });
      setFlying(null);
      anim.current?.cancel();
      anim.current = null;
      timers.current.push(window.setTimeout(() => setShot(false), RELOAD_MS));
    };
  };

  return (
    <div className="vr" data-channel={channel} data-level={level} data-muted={muted ? '1' : '0'}>
      <span className="vr-k">{label}</span>
      <div className="vr-range" ref={rangeRef}>
        {/* 활 = 음소거 단추. 꺼지면 오른쪽 아래에 작은 금지 표시 */}
        <button type="button" className="vr-bow-btn" data-action="mute" aria-pressed={muted}
          aria-label={`${label} — ${muted ? 'unmute' : 'mute'}`} onClick={() => { if (flying === null) setVolumeMuted(channel, !muted); }}>
          <img className="vr-bow" src={shot ? 'ui/volume/bow-shot.png' : 'ui/volume/bow.png'} alt="" draggable={false} />
          {muted && (
            <svg className="vr-ban" viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="#2a1208cc" stroke="#d8433a" strokeWidth="3" />
              <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="#d8433a" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
        </button>
        {/* 날아가는 화살 — 활 자리에서 출발한다. 메긴 화살은 활 그림에 그려져 있어, 쏠 때만 보인다 */}
        <img className="vr-arrow" ref={arrowRef} src="ui/volume/arrow.png" alt="" draggable={false} data-flying={flying !== null ? '1' : '0'} />
        {STEPS.map((step) => {
          const hit = step === level && flying === null;
          return (
            <button key={step} type="button" className="vr-slot" data-step={step} data-on={step === level ? '1' : '0'}
              style={{ '--i': step } as React.CSSProperties}
              aria-label={`${label} ${step * (100 / VOLUME_STEPS)}%`} aria-pressed={step === level && !muted} onClick={() => fire(step)}>
              {/* 칸 숫자 — 이름(`.vr-k`)과 같은 줄로 올라간다(`style.css`) */}
              <span className="vr-pct">{step * (100 / VOLUME_STEPS)}</span>
              <span className="vr-mark">
                <img className="vr-target" src="ui/volume/target.png" alt="" draggable={false} style={{ visibility: hit ? 'hidden' : undefined }} />
                {hit && <img className="vr-target-hit" src="ui/volume/target-hit.png" alt="" draggable={false} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
