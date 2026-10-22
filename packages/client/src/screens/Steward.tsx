/**
 * 안내 내관 — 화면 오른쪽 아래의 아바타와 두루마리 말풍선 (2026-10-22, pptx 113~116쪽)
 *
 * ```
 * ┌──────────────────────────┐
 * │                          │
 * │ ┌──────────────────────┐ │  ← 말풍선 — 두루마리(`ui/field-frame.png` ← `assets/icons/textfield.png`)
 * │ │ 주공! 처음 인사 드립… │ │
 * │ │                   ✔  │ │  ← [다음] — 마지막 마디에서는 물러난다
 * │ └──────────────────────┘ │
 * │                   ┌───┐  │
 * │                   │내관│  │  ← 도시 레벨 둘씩 한 사람(`ui/steward-{1..5}.png`)
 * └───────────────────┴───┴──┘
 * ```
 *
 * - **들어올 때** 오른쪽 아래 바깥에서 왼쪽으로 미끄러지며 나타나고, **나갈 때** 오른쪽으로 미끄러지며 사라진다
 *   (기획자 지정). 말풍선은 내관이 자리에 선 뒤에 펴지고, 물러날 때는 먼저 접힌다.
 * - **판을 막지 않는다** — 가리개가 없다. 「[마을로]를 눌러 보세요」처럼 안내가 화면의 단추를 누르라고 하므로
 *   내관과 말풍선만 눌리고 나머지는 그대로 눌린다(`pointer-events`).
 * - **프레임에 포털로 띄운다** — `.scr`는 스크롤 칸이라 그 안에 두면 긴 화면에서 같이 밀려 올라간다.
 * - **입장 하늘이 덮고 있는 동안은 나오지 않는다**(`#frame[data-sky]`) — 하늘 밑에서 미끄러져 들어오면 아무도 못 본다.
 * - 마디가 가리키는 자리(`spot`)는 `#frame[data-guide-spot]`으로 반짝인다 — 화면이 그 자리를 따로 알 필요가 없다.
 * - **건너뛰기는 내관을 오른쪽으로 밀어낸다** (2026-10-22 기획자) — 손가락은 스와이프, 마우스는 눌러서 끈다. 판 전체가
 *   손을 따라 밀리고, 프레임 폭의 `SKIP_RATIO`를 넘기거나 빠르게 튕기면 그 자리에서 물러난다(못 미치면 제자리로 돌아온다).
 *   건너뛴 것도 「들었다」로 적는다 — 다시 들을 길은 [사용 안내]에 있다. 내관을 **톡 누르기만** 하면 ✔와 같다.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GuideId, StewardTier } from '@samchess/meta';
import { t } from '../i18n/index.ts';
import type { GuideLine } from './guideScript.ts';

/** 물러나는 연출 길이 — `style.css`의 `.stw[data-phase="out"]`과 같은 값 */
const OUT_MS = 450;
/** 이만큼(프레임 폭에 대한 비율) 밀면 건너뛴다 */
const SKIP_RATIO = 0.22;
/** 거리가 모자라도 이 빠르기(px/ms)로 튕기면 건너뛴다 — 손가락으로 휙 미는 몸짓 */
const FLICK_SPEED = 0.6;
/** 이보다 덜 움직였으면 끈 것이 아니라 누른 것이다 */
const TAP_SLOP = 6;

export function Steward({ id, tier, lines, delayMs = 500, onRead, onDone }: {
  /** 어느 안내인가 — 화면에는 안 쓰고 `data-guide`로만 단다(눈 확인 도구가 건다) */
  id?: GuideId;
  tier: StewardTier;
  lines: GuideLine[];
  /** 화면이 뜨고 나서 들어오기까지 — 화면 전환 연출과 겹치지 않게 */
  delayMs?: number;
  /** 마지막 마디가 펴졌다 — 「봤다」고 적는 때. 물러나기 전에 화면을 떠나도 끝까지 읽은 것이다 */
  onRead?: () => void;
  /** 다 물러났다 */
  onDone: () => void;
}): React.JSX.Element | null {
  const [phase, setPhase] = useState<'wait' | 'in' | 'out'>('wait');
  const [idx, setIdx] = useState(0);
  const read = useRef(false);
  const last = idx >= lines.length - 1;

  // 들어오기 — 미루고, 입장 하늘이 걷힐 때까지 더 기다린다
  useEffect(() => {
    let timer = 0;
    const tryIn = (): void => {
      if (document.getElementById('frame')?.hasAttribute('data-sky')) timer = window.setTimeout(tryIn, 300);
      else setPhase('in');
    };
    timer = window.setTimeout(tryIn, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  useEffect(() => {
    if (phase !== 'in' || !last || read.current) return;
    read.current = true;
    onRead?.();
  }, [phase, last, onRead]);

  // 가리키는 자리 — 펴져 있는 동안만
  const spot = phase === 'in' ? lines[idx]?.spot : undefined;
  useEffect(() => {
    const frame = document.getElementById('frame');
    if (!frame || !spot) return;
    frame.dataset.guideSpot = spot;
    return () => { delete frame.dataset.guideSpot; };
  }, [spot]);

  useEffect(() => {
    if (phase !== 'out') return;
    const id = window.setTimeout(onDone, OUT_MS);
    return () => window.clearTimeout(id);
  }, [phase, onDone]);

  const next = (): void => {
    if (phase !== 'in') return;
    if (last) setPhase('out');
    else setIdx(idx + 1);
  };

  // 건너뛰기 — 내관을 오른쪽으로 끌어 민다
  const drag = useRef<{ x0: number; t0: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [snapBack, setSnapBack] = useState(false);
  const frameWidth = (): number => document.getElementById('frame')?.clientWidth ?? 400;
  const skip = (): void => {
    if (!read.current) { read.current = true; onRead?.(); }
    setPhase('out');
  };
  const onDown = (e: React.PointerEvent<HTMLImageElement>): void => {
    if (phase !== 'in') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, t0: performance.now(), moved: false };
    setSnapBack(false);
  };
  const onMove = (e: React.PointerEvent<HTMLImageElement>): void => {
    const g = drag.current;
    if (!g) return;
    const d = e.clientX - g.x0;
    if (Math.abs(d) > TAP_SLOP) g.moved = true;
    // 왼쪽으로는 거의 안 밀린다 — 갈 곳은 오른쪽뿐이라는 손맛
    setDx(d >= 0 ? d : d * 0.15);
  };
  const onUp = (e: React.PointerEvent<HTMLImageElement>): void => {
    const g = drag.current;
    drag.current = null;
    if (!g) return;
    const d = e.clientX - g.x0;
    const speed = d / Math.max(1, performance.now() - g.t0);
    if (!g.moved) { setDx(0); next(); return; }
    if (d > frameWidth() * SKIP_RATIO || (d > 30 && speed > FLICK_SPEED)) { skip(); return; }
    setSnapBack(true);
    setDx(0);
  };
  const onCancel = (): void => {
    drag.current = null;
    setSnapBack(true);
    setDx(0);
  };

  const host = document.getElementById('frame');
  const line = lines[idx];
  if (!line) return null;
  const layer = (
    <div className="stw" data-guide={id} data-phase={phase} data-guide-line={idx} data-guide-lines={lines.length}>
      {/* 끄는 동안 판 전체(말풍선 + 내관)가 손을 따라 밀린다. 물러나는 연출은 그 안에서 돌아 밀린 자리에서 이어진다 */}
      <div
        className="stw-drag"
        data-dragging={drag.current ? '' : undefined}
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          opacity: dx > 0 ? Math.max(0.25, 1 - dx / (frameWidth() * 0.6)) : undefined,
          transition: snapBack ? 'transform .25s ease-out, opacity .25s ease-out' : undefined,
        }}
      >
        <div className="stw-bubble" onClick={next}>
          {/* 마디가 바뀔 때마다 글자를 새로 띄운다(`key`) — 같은 칸에서 글자만 갈리면 바뀐 줄 모른다 */}
          <p key={idx} className="stw-text" data-field="guideText">{line.text}</p>
          <button
            className="stw-next"
            data-action="guideNext"
            aria-label={t('guide.next')}
            onClick={(e) => { e.stopPropagation(); next(); }}
          >
            <img src="icons/confirm.png" alt="" />
          </button>
        </div>
        <img
          className="stw-man"
          data-action="guideSkip"
          src={`ui/steward-${tier}.png`}
          alt=""
          draggable={false}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
        />
      </div>
    </div>
  );
  return host ? createPortal(layer, host) : layer;
}

/**
 * [사용 안내] — 지난 설명을 골라 다시 듣는다 (pptx 114쪽 「설명을 다시 보고 싶으시면 화면 상단의 아이콘을」).
 * **들은 것만** 뜬다(대본 차례대로) — 아직 안 온 안내까지 늘어놓으면 앞일을 미리 말하는 셈이다.
 */
export function GuideReplay({ ids, titleOf, onPick, onClose }: {
  ids: readonly GuideId[];
  titleOf: (id: GuideId) => string;
  onPick: (id: GuideId) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-back" data-modal="guideReplay" onClick={onClose}>
      <div className="modal mod-plank cty-modal stw-replay" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('guide.replay.title')}</p>
        <p className="row">{ids.length > 0 ? t('guide.replay.lede') : t('guide.replay.empty')}</p>
        <div className="stw-replay-list">
          {ids.map((id) => (
            <button key={id} className="btn wide" data-guide={id} onClick={() => onPick(id)}>
              <span className="lbl">{titleOf(id)}</span>
            </button>
          ))}
        </div>
        <div className="cty-acts">
          <button className="btn wide" data-action="guideReplayClose" onClick={onClose}>{t('guide.replay.close')}</button>
        </div>
      </div>
    </div>
  );
}
