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
 * - **입장 하늘 · 불러오는 중 가리개가 덮고 있는 동안은 나오지 않는다**(`HOLD_SELECTOR`) — 그 밑에서 미끄러져 들어오면 아무도 못 보고,
 *   대자보의 순위 가리개(z 60)는 내관(z 40)을 덮어 ✔가 안 눌렸다(2026-10-23 눈 확인 도구가 잡았다).
 * - 마디가 가리키는 자리(`spot`)는 `#frame[data-guide-spot]`으로 반짝인다 — 화면이 그 자리를 따로 알 필요가 없다.
 * - **건너뛰기는 내관을 오른쪽으로 밀어낸다** (2026-10-22 기획자) — 손가락은 스와이프, 마우스는 눌러서 끈다. 판 전체가
 *   손을 따라 밀리고, 프레임 폭의 `SKIP_RATIO`를 넘기거나 빠르게 튕기면 그 자리에서 물러난다(못 미치면 제자리로 돌아온다).
 *   건너뛴 것도 「들었다」로 적는다 — 다시 들을 길은 [사용 안내]에 있다. 내관을 **톡 누르기만** 하면 ✔와 같다.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GuideHonor, GuideId, StewardTier } from '@samchess/meta';
import { playStewardVoice } from '../audio/stewardVoice.ts';
import { t } from '../i18n/index.ts';
import { SPOT_SELECTOR } from './guideScript.ts';
import type { GuideLine } from './guideScript.ts';

/** 물러나는 연출 길이 — `style.css`의 `.stw[data-phase="out"]`과 같은 값 */
const OUT_MS = 450;
/** 이만큼(프레임 폭에 대한 비율) 밀면 건너뛴다 */
const SKIP_RATIO = 0.22;
/** 거리가 모자라도 이 빠르기(px/ms)로 튕기면 건너뛴다 — 손가락으로 휙 미는 몸짓 */
const FLICK_SPEED = 0.6;
/** 이것이 프레임에 있는 동안은 들어오지 않고 기다린다 — 입장 하늘 · 순위 불러오기 · 서버 왕복 가리개 */
const HOLD_SELECTOR = '#frame[data-sky], #frame [data-modal="rankingLoading"], #frame [data-modal="busy"], #frame [data-modal="enterLoading"]';

/** 이보다 덜 움직였으면 끈 것이 아니라 누른 것이다 */
const TAP_SLOP = 6;

/** 제자리 말풍선의 바닥 — 프레임 폭에 대한 비율(`style.css`의 `.stw-bubble { bottom: 45cqw }`와 같은 값) */
const BUBBLE_BOTTOM = 0.45;
/** 비켜 설 때 가리킨 자리와 띄우는 틈(px) */
const DODGE_GAP = 10;

/**
 * **가리킨 자리를 말풍선이 덮으면 비켜 선다** — 병영 · 궁궐처럼 문이 화면 아래에 모인 곳에서 반짝이는 단추가 말풍선 밑에
 * 깔렸다(눈 확인에서 잡았다). 덮으면 그 자리 **바로 위**로, 위에 자리가 없으면 **바로 아래**로. 안 덮으면 `null`(제자리).
 * 제자리 기준으로 재므로 이미 비켜 선 말풍선이 제자리로 돌아오려다 다시 덮는 흔들림이 없다.
 */
function dodge(frame: HTMLElement, bubble: HTMLElement | null, target: Element | null): number | null {
  if (!bubble || !target) return null;
  const f = frame.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const h = bubble.offsetHeight;
  const homeBottom = f.width * BUBBLE_BOTTOM;
  const homeTop = f.height - homeBottom - h;
  const top = r.top - f.top;
  const bottom = r.bottom - f.top;
  if (bottom <= homeTop || top >= f.height - homeBottom) return null;
  const head = f.width * 0.18;   // 머리 줄(제목 · 기어)은 덮지 않는다
  if (top - DODGE_GAP - h >= head) return f.height - (top - DODGE_GAP);
  return Math.max(0, f.height - (bottom + DODGE_GAP + h));
}

export function Steward({ id, tier, honor, lines, delayMs = 500, onRead, onDone }: {
  /** 어느 안내인가 — 화면에는 안 쓰고 `data-guide`로만 단다(눈 확인 도구가 건다) */
  id?: GuideId;
  tier: StewardTier;
  /** 들어올 때 부르는 호칭 — 목소리(`cityvoice/{호칭}.{더빙}.mp3`)를 고른다. 없으면 말없이 들어온다 */
  honor?: GuideHonor;
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

  // 호칭은 들어오는 순간의 것 하나 — 계정이 바뀌어도(마지막 마디의 「들었다」 저장) 들어오기를 다시 돌리지 않는다
  const honorRef = useRef(honor);
  honorRef.current = honor;

  // 들어오기 — 미루고, 입장 하늘 · 불러오는 중 가리개가 걷힐 때까지 더 기다린다
  useEffect(() => {
    let timer = 0;
    const tryIn = (): void => {
      if (document.querySelector(HOLD_SELECTOR)) timer = window.setTimeout(tryIn, 300);
      else {
        setPhase('in');
        // 미끄러져 들어오기 시작하는 그 순간 — 기다리는 동안(입장 하늘)에 부르면 아무도 없는 데서 말한다
        if (honorRef.current !== undefined) playStewardVoice(honorRef.current);
      }
    };
    timer = window.setTimeout(tryIn, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  useEffect(() => {
    if (phase !== 'in' || !last || read.current) return;
    read.current = true;
    onRead?.();
  }, [phase, last, onRead]);

  // 가리키는 자리 — 펴져 있는 동안만. 고른 요소에 `data-guide-glow`를 붙이고(`style.css`), 프레임에는 이름을 단다(눈 확인 도구가 읽는다).
  // **조금씩 다시 고른다** — 화면이 서버 값을 받아 늦게 그리는 줄(장수 일람의 도장 등)은 말풍선보다 늦게 선다
  const spot = phase === 'in' ? lines[idx]?.spot : undefined;
  const select = phase === 'in' ? (lines[idx]?.select ?? (spot ? SPOT_SELECTOR[spot] : '')) : '';
  const bubbleRef = useRef<HTMLDivElement>(null);
  /** 말풍선의 바닥 높이(px, 프레임 아래에서) — 가리킨 자리가 말풍선 밑에 깔리면 비켜 선다. `null`이면 제자리(CSS) */
  const [bubbleBottom, setBubbleBottom] = useState<number | null>(null);
  useEffect(() => {
    const frame = document.getElementById('frame');
    if (!frame || !spot) { setBubbleBottom(null); return; }
    frame.dataset.guideSpot = spot;
    const mark = (): void => {
      if (!select) return;
      const found = frame.querySelectorAll(select);
      found.forEach((el) => el.setAttribute('data-guide-glow', ''));
      setBubbleBottom(dodge(frame, bubbleRef.current, found[0] ?? null));
    };
    mark();
    const timer = window.setInterval(mark, 400);
    return () => {
      window.clearInterval(timer);
      delete frame.dataset.guideSpot;
      frame.querySelectorAll('[data-guide-glow]').forEach((el) => el.removeAttribute('data-guide-glow'));
    };
  }, [spot, select]);

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
        <div
          className="stw-bubble"
          ref={bubbleRef}
          data-dodge={bubbleBottom !== null ? '' : undefined}
          style={bubbleBottom !== null ? { bottom: bubbleBottom } : undefined}
          onClick={next}
        >
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
export function GuideReplay({ groups, titleOf, onPick, onClose }: {
  /** 화면별 묶음 — 들은 것이 있는 화면만, 처음 하는 사람이 지나가는 차례로 (2026-10-22 기획자 — 화면별로 묶는다) */
  groups: readonly { title: string; ids: readonly GuideId[] }[];
  titleOf: (id: GuideId) => string;
  onPick: (id: GuideId) => void;
  onClose: () => void;
}): React.JSX.Element {
  const any = groups.some((g) => g.ids.length > 0);
  return (
    <div className="modal-back" data-modal="guideReplay" onClick={onClose}>
      <div className="modal mod-plank cty-modal stw-replay" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('guide.replay.title')}</p>
        <p className="row">{any ? t('guide.replay.lede') : t('guide.replay.empty')}</p>
        <div className="stw-replay-list">
          {groups.filter((g) => g.ids.length > 0).map((g) => (
            <section key={g.title} className="stw-replay-group" data-guide-group={g.title}>
              <p className="stw-replay-head">{g.title}</p>
              {g.ids.map((id) => (
                <button key={id} className="btn wide" data-guide={id} onClick={() => onPick(id)}>
                  <span className="lbl">{titleOf(id)}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
        <div className="cty-acts">
          <button className="btn wide" data-action="guideReplayClose" onClick={onClose}>{t('guide.replay.close')}</button>
        </div>
      </div>
    </div>
  );
}
