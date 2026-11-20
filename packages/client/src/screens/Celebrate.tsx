/**
 * 축하 화면 — 「값을 치르고 무언가가 한 칸 올라갔다」를 알리는 한 벌 (2026-11-20 기획자 — 공용, `축하 예시.pptx`).
 *
 * 액자 없이 **화면 전체를 어둡게 깔고** 한가운데에서 터진다 — 강화 완료(팔뚝 + 레벨 배지) · 증축 완료(비계 탑 + 레벨 배지)가 같은 꼴이다.
 * 쓰는 자리: 강화(`LevelUpPanel`) · 도시 증축(`CityUpgrade`) · 짓기 · 증축(`BuildingsScreen`) · 대장간 완성(`ForgeScreen`).
 *
 * | 걸음 | 무엇 |
 * |---|---|
 * | 모음(`charge`, 5초) | 어둠 위 한가운데의 작은 삼각형 세 꼭짓점에서 흰 · 보라 · 금 섬광이 나선으로 돌며(점점 빠르게) 급히 커져 화면이 하얘진다 — 축하음(`sound`, 7초)이 이때 시작하고 **배경 음악은 멈춘다** |
 * | 열림 | 흰빛이 걷히며(「쾅」 — 소리의 절정과 같은 때) 무대가 드러난다. 화면이 한 번 하얗게(`cel-flash`) |
 * | 무대 | 주인공 그림(`art`)이 떠오르고 뒤에서 빛줄기(`BlinkGlow`)가 터진 뒤 돈다 |
 * | 쾅 | 배지(`badge`)가 크게 내려찍히며(`cel-slam`) 무대가 한 번 흔들린다(`cel-shake`) · 금가루 |
 * | 글 | 제목(`title`) · 큰 글씨(`big`) · 아래 줄(`children`), 끝에 「화면을 터치해주세요.」가 숨 쉬듯 |
 * | 닫힘 | **화면 아무 데나 누르거나 아무 키나** — 무대가 커지며 번쩍 사라지고(`data-leaving`, .36초) 그 뒤 `onClose`. **배경 음악은 이 화면이 다 사라진 뒤에** 다시 돈다 |
 *
 * 모으는 동안은 눌러도 · 키를 눌러도 안 닫힌다(소리와 맞춘 연출이다). **`data-modal`은 무대가 열린 뒤에야 붙는다** — 검사가
 * 「축하 화면이 떴다」를 기다리면 모음이 끝날 때까지 저절로 기다린다(모으는 중은 `.cel-back[data-phase="charge"]`).
 *
 * ★ **이어 뜨는 축하는 `key`를 준다** — 하나를 닫자마자 다음 것이 같은 자리에 오면(대장간 미지급 여럿 · 태학 알림) React가 「닫히는 중」인
 * 이 컴포넌트를 재사용해 다음 화면이 안 보인다(`forge_ux`가 잡았다).
 *
 * **바꾸는 것은 글과 그림뿐이다.** 검사가 거는 이름(`data-modal` · `data-field` · `data-action`)은 부르는 쪽이 정한다 —
 * 화면 전체를 덮는 투명한 누름 칸(`.cel-hit`)이 `data-action`(기본 `doneOk`)을 달아 옛 「[확인] 누르기」 검사가 그대로 돈다.
 * 무대 상자는 `.modal`이다(「판 안」 검사의 기준).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BlinkGlow } from './BlinkGlow.tsx';
import type { BlinkTone } from './BlinkGlow.tsx';
import { FitLine } from './FitLine.tsx';
import { playSfx } from '../audio/sfx.ts';
import { holdBgm } from '../audio/bgm.ts';
import type { SfxId } from '../audio/sfx.ts';
import { t } from '../i18n/index.ts';

/** 닫히는 연출의 길이 — CSS의 `cel-out`(.36초)과 같다 */
const LEAVE_MS = 360;
/**
 * 섬광을 모으는 길이 — 이 뒤에 무대가 열린다. 축하음(`celebrate.mp3`, 7.4초)이 4.5초부터 차오르는 그 끝에 맞췄다(2026-11-20 기획자 — 「5초 즈음 하얘지고 쾅」).
 * CSS의 `cel-swirl` · `cel-flare` · `cel-whiteout`(5초)과 같은 값이다 — 바꾸면 셋을 함께.
 */
const CHARGE_MS = 5000;
/** 흰 · 보라 · 금 — 삼각형 꼭짓점 셋(120°씩) */
const FLARES = ['white', 'purple', 'gold'] as const;

/** 금가루 열여섯 — 자리 · 늦춤 · 길이 · 크기는 고정 값(난수를 쓰지 않는다: 같은 화면은 언제나 같게 보인다) */
const FLAKES = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 37 + 11) % 96 + 2}%`,
  delay: `${(0.45 + (i * 0.27) % 1.6).toFixed(2)}s`,
  dur: `${(2.8 + ((i * 7) % 5) * 0.35).toFixed(2)}s`,
  size: `${(0.3 + ((i * 5) % 4) * 0.09).toFixed(2)}rem`,
  drift: `${((i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.6)).toFixed(1)}rem`,
}));

export function Celebrate({ modal, title, art, badge, big, bigField = 'doneLevel', tone = 'plain', okAction = 'doneOk',
  sound = 'celebrate', onClose, className = '', children }: {
  /** `data-modal` — 검사가 이 화면을 찾는 이름 */
  modal: string;
  /** 큰 제목(「강화 완료」) — 언제나 한 줄, 안 들면 그 글만 줄인다(`FitLine`) */
  title: string;
  /** 주인공 그림(팔뚝 · 비계 탑 · 병기 …) — 뒤에서 빛줄기가 터진다 */
  art?: ReactNode;
  /** 그림 한가운데에 내려찍히는 배지(레벨 배지 …) */
  badge?: ReactNode;
  /** 제목 아래 큰 글씨(「도시 Lv2」 …) — 글이면 한 줄로 맞추고, 노드면 그대로 */
  big?: ReactNode;
  bigField?: string;
  /** 빛줄기 색 — 흰 별빛(기본, 예시 그대로) · 금 · 자주 */
  tone?: BlinkTone;
  /** 화면 전체를 덮는 누름 칸의 `data-action` */
  okAction?: string;
  /** 열릴 때 소리 — 기본은 전용 축하음(`celebrate`, 2026-11-20 기획자) */
  sound?: SfxId | null;
  onClose: () => void;
  /** 갈래 클래스(글자 꼴 · 크기) — 예: 도시 증축의 `cty-done` */
  className?: string;
  /** 큰 글씨 아래 줄들 */
  children?: ReactNode;
}): React.JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const [charging, setCharging] = useState(true);
  const chargingRef = useRef(true);
  const left = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const leave = useCallback((): void => {
    if (left.current || chargingRef.current) return;   // 두 번 눌러도 한 번만 · 모으는 동안은 안 닫힌다
    left.current = true;
    setLeaving(true);
    playSfx('woong', { volume: 0.7 });
    window.setTimeout(() => closeRef.current(), LEAVE_MS);
  }, []);

  // 배경 음악 — 열리면 멈추고, **이 화면이 사라질 때**(닫힘 연출까지 끝나 부르는 쪽이 내릴 때) 다시 튼다
  useEffect(() => {
    holdBgm(true);
    return () => holdBgm(false);
  }, []);

  useEffect(() => {
    if (sound) playSfx(sound);
    const shown = window.setTimeout(() => { chargingRef.current = false; setCharging(false); }, CHARGE_MS);
    // 아무 키나 — 무대가 열리고 한 박자 뒤부터 듣는다(열리는 순간 눌려 있던 키는 넘긴다)
    let on = false;
    const arm = window.setTimeout(() => { on = true; }, CHARGE_MS + 250);
    const onKey = (e: KeyboardEvent): void => {
      if (!on || e.repeat) return;
      e.preventDefault();
      leave();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(shown); window.clearTimeout(arm); window.removeEventListener('keydown', onKey); };
  }, [sound, leave]);

  if (charging) {
    return (
      <div className="modal-back cel-back" data-phase="charge" aria-hidden>
        <div className="cel-charge">
          <div className="cel-swirl">
            {FLARES.map((c, i) => (
              <i key={c} style={{ rotate: `${i * 120}deg` }}><b><span data-c={c} /></b></i>
            ))}
          </div>
          <span className="cel-whiteout" />
        </div>
      </div>
    );
  }

  return (
    <div className="modal-back cel-back" data-modal={modal} data-phase="show" data-leaving={leaving ? '1' : undefined} onClick={leave}>
      {/* 화면 전체를 덮는 누름 칸 — 맨 위에 서서 어디를 눌러도 닫힌다. 검사는 옛 [확인]처럼 이 칸을 `data-action`으로 찾는다 */}
      <button type="button" className="cel-hit" data-action={okAction} aria-label={t('celebrate.tap')} />
      <span className="cel-flash" aria-hidden />
      <span className="cel-unwhite" aria-hidden />
      <span className="cel-flakes" aria-hidden>
        {FLAKES.map((f, i) => (
          <i key={i} style={{ left: f.left, animationDelay: f.delay, animationDuration: f.dur, width: f.size, height: f.size,
            '--cel-drift': f.drift } as React.CSSProperties} />
        ))}
      </span>
      <div className={`modal cel ${className}`.trim()}>
        {(art || badge) && (
          <div className="cel-stage">
            <BlinkGlow tone={tone} className="cel-rays" burst />
            {art && <div className="cel-art">{art}</div>}
            {badge && <div className="cel-badge">{badge}</div>}
          </div>
        )}
        <FitLine className="modal-ttl cel-ttl" field="doneTitle" text={title} />
        {typeof big === 'string'
          ? <FitLine className="cty-done-lv cel-big" field={bigField} text={big} />
          : big != null && <div className="cel-big cel-big-node" data-field={bigField}>{big}</div>}
        {children}
        <p className="cel-tap">{t('celebrate.tap')}</p>
      </div>
    </div>
  );
}
