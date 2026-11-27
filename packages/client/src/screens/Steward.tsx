/**
 * 안내 내관 — 화면 오른쪽 아래의 아바타와 두루마리 말풍선 (2026-10-22, pptx 113~116쪽)
 *
 * ```
 * ┌──────────────────────────┐
 * │                          │
 * │ ┌──────────────────────┐ │  ← 말풍선 — 두루마리(`ui/field-frame.png` ← `assets/icons/ui/textfield.png`)
 * │ │ 주공! 처음 인사 드립… │ │
 * │ │                   ✔  │ │  ← [다음] — 마지막 마디에서는 물러난다
 * │ └──────────────────────┘ │
 * │                   ┌───┐  │
 * │                   │내관│  │  ← 도시 레벨 둘씩 한 사람(`ui/steward-{1..5}.png`). 병영 · 산 너머 건물은 그 자리의 사람(`guideSpeaker`)
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { stewardTier as stewardTierOf } from '@samchess/meta';
import type { GuideChapter, GuideHonor, GuideId, GuideMainTopic, GuideShelf, StewardTier } from '@samchess/meta';
import type { GuideSpeaker } from './guideScript.ts';
import { playStewardVoice } from '../audio/stewardVoice.ts';
import { onLangChange, t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { SPOT_SELECTOR, guideChapterTitle, guideSpeaker, guideSpeakerArt, guideStrokeUrl, guideTopicTitle, guideVoicePrefix, GUIDE_ABOVE, GUIDE_HOLD } from './guideScript.ts';
import { Pager } from './PagerButton.tsx';
import { useSteadyPage } from './useSteadyPage.ts';
import type { GuideLine } from './guideScript.ts';

/** 물러나는 연출 길이 — `style.css`의 `.stw[data-phase="out"]`과 같은 값 */
const OUT_MS = 450;
/** 이만큼(프레임 폭에 대한 비율) 밀면 건너뛴다 */
const SKIP_RATIO = 0.22;
/** 거리가 모자라도 이 빠르기(px/ms)로 튕기면 건너뛴다 — 손가락으로 휙 미는 몸짓 */
const FLICK_SPEED = 0.6;
/**
 * 이것이 프레임에 있는 동안은 들어오지 않고 기다린다 — 입장 하늘 · 순위 불러오기 · 서버 왕복 가리개.
 * **앱이 띄우는 사건 팝업도** (2026-11-14) — 도적떼 · 방어 기록 · 선전포고 · 연구 완료 · 판 방치 팝업이 메인을 덮은 채 내관이 들어오면
 * 말풍선이 팝업 밑에 깔려 아무도 못 읽는데, 한 마디짜리는 펴지는 순간 「들었다」로 적힌다(`town.open`이 그렇게 사라졌다).
 * **결과 두루마리는 결말 장(「승리」)이 넘어간 뒤에** — 첫 결과 안내가 결말 장에 서서 아직 안 뜬 보상 칸을 가리켰다.
 * 내관이 말하는 동안은 두루마리도 저절로 넘어가지 않는다(`ResultScroll`).
 */
const HOLD_SELECTOR = [
  '#frame[data-sky]', '#frame [data-modal="rankingLoading"]', '#frame [data-modal="busy"]', '#frame [data-modal="enterLoading"]',
  '#frame [data-modal="raidAlert"]', '#frame [data-modal="warInbox"]',
  '#frame [data-modal="academyNotice"]', '#frame [data-modal="aiAbandoned"]',
  '#frame .brs-frame[data-page="title"]', '#frame .brs-frame[data-veil]',
  // 다른 내관이 서 있다 — 앱이 세운 화면 안내와 화면 안에서 세운 안내(장수 일람 → 장수 상세)가 차례로 선다(2026-11-14).
  // 기다리는 자기 자신(`wait`)은 세지 않는다
  '#frame .stw:not([data-phase="wait"])',
].join(', ');
/**
 * 한 마디 안내(`Say`)가 기다리는 것 — 입장 하늘과 **다른 사람이 말하는 중**뿐이다. 팝업은 안 기다린다 — 그 팝업 안의 일(이름 변경 · 도적떼 알림의
 * 오류)을 말하러 나오는 것이라 팝업 위에 선다
 */
const SAY_HOLD_SELECTOR = '#frame[data-sky], #frame .stw:not([data-phase="wait"])';

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

/**
 * 한 마디 안내가 떠 있는 팝업 · 장수 카드를 비켜 서는 자리 — 대본 안내의 `dodge`와 같되, 위아래 어디에도 안 들어가면
 * **머리 줄 바로 밑**에 선다(팝업의 단추는 대개 바닥에 모여 있다 — 바닥에 서면 [뒤로]를 가렸다, 2026-11-19 raid_play)
 */
function dodgeSay(frame: HTMLElement, bubble: HTMLElement | null, target: Element | null): number | null {
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
  const head = f.width * 0.18;
  if (top - DODGE_GAP - h >= head) return f.height - (top - DODGE_GAP);
  if (f.height - (bottom + DODGE_GAP + h) >= 0) return f.height - (bottom + DODGE_GAP + h);
  return besideSteward(f, bubble, target, homeBottom, h, head);
}

/**
 * 팝업이 거의 화면을 다 덮어 위아래 어디에도 안 들어갈 때 — **내관 곁(제자리)에 서되 팝업의 단추만 비킨다** (2026-11-23 기획자).
 * 예전에는 머리 줄 바로 밑으로 올라가 장수 카드의 「레벨 상한」이 내관과 화면 반대 끝에 떴다. 제자리에서 덮는 단추가 있으면
 * 그 단추 바로 위까지만 올라가고(덮는 것이 없을 때까지 되풀이), 그래도 머리 줄에 닿으면 옛 자리(머리 줄 밑)다.
 * 제자리(`null`)를 먼저 보는 것은 바닥의 [뒤로]를 가렸던 일(2026-11-19 raid_play) 때문 — 단추를 덮지 않는 한 내관 곁이다.
 */
function besideSteward(f: DOMRect, bubble: HTMLElement, target: Element, homeBottom: number, h: number, head: number): number | null {
  const b = bubble.getBoundingClientRect();
  const buttons = [...target.querySelectorAll('button')]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0 && r.right > b.left && r.left < b.right);
  let bottomPx = homeBottom;
  for (let i = 0; i < buttons.length + 1; i++) {
    const bubTop = f.height - bottomPx - h;
    const bubBottom = f.height - bottomPx;
    const hit = buttons.filter((r) => r.bottom - f.top > bubTop && r.top - f.top < bubBottom);
    if (hit.length === 0) break;
    bottomPx = f.height - (Math.min(...hit.map((r) => r.top - f.top)) - DODGE_GAP);
  }
  if (f.height - bottomPx - h < head) return f.height - head - h;
  return bottomPx === homeBottom ? null : bottomPx;
}

export function Steward({ id, tier, honor, lines, delayMs = 500, onRead, onDone, speaker: who, say, sayCode, leaving, waitPopups }: {
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
  /** 누가 서는가 — 안내(`id`)가 정하는 대신 밖에서 준다(한 마디 안내 `Say`) */
  speaker?: GuideSpeaker;
  /** 한 마디 안내의 이름 — 있으면 팝업 위에 서고, 팝업을 안 기다리며, `data-say`로 단다(검사가 건다) */
  say?: string;
  /** 막은 까닭의 코드(`MetaResult.code`) — `data-say-code`. 검사가 글자 대신 이것을 본다 */
  sayCode?: string | undefined;
  /** 말할 까닭이 사라졌다 — 물러난다(아직 안 들어왔으면 그대로 끝난다) */
  leaving?: boolean;
  /**
   * 한 마디 안내인데도 팝업 · 다른 사람을 다 기다린다(`HOLD_SELECTOR`) — 팝업 안의 일을 말하는 것이 아니라 **스스로 찾아온 알림**
   * (메인의 대장간 완성 부름, 2026-11-22)이라 도적떼 · 연구 완료 팝업 밑에 깔리면 아무도 못 읽는다
   */
  waitPopups?: boolean;
}): React.JSX.Element | null {
  const [phase, setPhase] = useState<'wait' | 'in' | 'out'>('wait');
  const [idx, setIdx] = useState(0);
  const read = useRef(false);
  const last = idx >= lines.length - 1;

  // 호칭은 들어오는 순간의 것 하나 — 계정이 바뀌어도(마지막 마디의 「들었다」 저장) 들어오기를 다시 돌리지 않는다
  const honorRef = useRef(honor);
  /** 누가 서는가 — 안내마다 정해진다(`guideSpeaker` — 갈래마다). 들어오는 순간의 목소리도 이것으로 고른다 */
  const speaker = who ?? guideSpeaker(id);
  honorRef.current = honor;

  // 들어오기 — 미루고, 입장 하늘 · 불러오는 중 가리개가 걷힐 때까지 더 기다린다
  useEffect(() => {
    let timer = 0;
    const tryIn = (): void => {
      const extra = id ? GUIDE_HOLD[id] : undefined;
      if (document.querySelector(say && !waitPopups ? SAY_HOLD_SELECTOR : HOLD_SELECTOR) || (extra && document.querySelector(extra))) timer = window.setTimeout(tryIn, 300);
      else {
        setPhase('in');
        // 미끄러져 들어오기 시작하는 그 순간 — 기다리는 동안(입장 하늘)에 부르면 아무도 없는 데서 말한다
        if (honorRef.current !== undefined) playStewardVoice(honorRef.current, guideVoicePrefix(speaker));
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
    // 한 마디 안내는 가리킬 자리가 없다 — 대신 **떠 있는 팝업을 덮지 않게** 비켜 선다(팝업 위에 서므로 [닫기] 같은 단추를 가렸다, 2026-11-19 war_ux)
    const sayMode = !spot && !!say && phase === 'in';
    if (!frame || (!spot && !sayMode)) { setBubbleBottom(null); return; }
    if (sayMode) {
      const markSay = (): void => {
        const modals = frame.querySelectorAll('.modal-back .modal, .ofcard');
        // 팝업이 없으면 화면 바닥 명령 판(`.cmd-panel`)을 비킨다 — 병영의 [튜토리얼 시나리오]를 「튜토리얼을 먼저」 말풍선이 덮어 못 눌렀다
        // (2026-11-27 — 단추의 소개 글을 걷어 판이 낮아지자 말풍선 자리까지 내려왔다. `smoke:meta`가 잡았다)
        const target = modals[modals.length - 1] ?? [...frame.querySelectorAll('.cmd-panel')].find((e) => e.getBoundingClientRect().height > 0) ?? null;
        setBubbleBottom(dodgeSay(frame, bubbleRef.current, target));
      };
      markSay();
      const t = window.setInterval(markSay, 400);
      return () => window.clearInterval(t);
    }
    if (!spot) return;
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
  }, [spot, select, say, phase]);

  useEffect(() => {
    if (!leaving) return;
    if (phase === 'wait') onDone();
    else if (phase === 'in') setPhase('out');
  }, [leaving, phase, onDone]);

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
    <div className="stw" data-guide={id} data-say={say} data-say-code={sayCode || undefined} data-above={say || (id && GUIDE_ABOVE.has(id)) ? '' : undefined} data-phase={phase} data-guide-line={idx} data-guide-lines={lines.length}>
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
          data-speaker={speaker}
          src={guideSpeakerArt(speaker, tier)}
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

/** 지난 설명 오른쪽 칸의 한 쪽 — 안내 단추 여덟 (2026-11-23 기획자, 10-23의 다섯을 늘림 — 판이 화면 높이의 80%가 되어 여덟이 든다) */
export const GUIDE_REPLAY_PAGE = 8;

/**
 * [사용 안내] — 지난 설명을 골라 다시 듣는다 (pptx 114쪽 「설명을 다시 보고 싶으시면 화면 상단의 아이콘을」).
 * **들은 것만** 뜬다(대본 차례대로) — 아직 안 온 안내까지 늘어놓으면 앞일을 미리 말하는 셈이다.
 *
 * ```
 *           지 난 설 명
 *  ┌────────────┬──────────────────────┐
 *  │ 메인 화면 › │ ▓▓ 처음 인사 · 도시 소개 ▓▓ │  ← 3단: 붓질 바탕(그 칸의 색) 위에 글
 *  │ 궁궐       │ ▓▓ 다음은 장터 ▓▓          │
 *  │ 병영       │ …                       │
 *  │ …         │        ‹ 1 / 2 ›         │  ← 다섯씩 쪽 넘김
 *  └────────────┴──────────────────────┘
 *                 [닫기]
 * ```
 *
 * 판은 옛 우편함 판(목판 · 두 칸) 그대로다(2026-10-23 기획자 — 우편함은 죽간 종이로 갈아입었다). 왼쪽이 1단(메인 화면 · 건물)이고,
 * **메인 화면을 누르면 왼쪽 칸이 2단(여덟 갈래)으로 바뀐다** — 맨 위 「‹ 처음으로」가 1단으로 돌아간다. 건물은 1단에서 곧장 3단이다.
 * 분류는 meta의 `GUIDE_PLACE` · `guideShelves()`, 색은 `guideScript.ts`의 `GUIDE_STROKE`.
 */
export function GuideReplay({ shelves, titleOf, onPick, onClose, initial }: {
  shelves: readonly GuideShelf[];
  /**
   * 처음 펼칠 1단 — 연 화면의 칸(2026-10-23 기획자: 농지에서 열면 농지 안내가 펼쳐져 있다). 그 칸에 들은 안내가 없거나
   * 메인 화면이면 맨 앞 칸(메인이면 그 2단)이다
   */
  initial?: GuideChapter | null;
  titleOf: (id: GuideId) => string;
  onPick: (id: GuideId) => void;
  onClose: () => void;
}): React.JSX.Element {
  const first = shelves.find((x) => x.chapter === initial) ?? shelves[0];
  /** 고른 1단 · (메인이면) 2단 */
  const [chapter, setChapter] = useState<GuideChapter | null>(first?.chapter ?? null);
  const [topic, setTopic] = useState<GuideMainTopic | null>(first?.topics[0]?.topic ?? null);
  /** 왼쪽 칸이 메인의 2단을 펼치고 있나 */
  const [inMain, setInMain] = useState(first?.chapter === 'main');
  const [page, setPage] = useState(0);

  const shelf = shelves.find((x) => x.chapter === chapter);
  const ids = !shelf ? [] : shelf.chapter === 'main' ? shelf.topics.find((g) => g.topic === topic)?.ids ?? [] : shelf.ids;
  const pageCount = Math.max(1, Math.ceil(ids.length / GUIDE_REPLAY_PAGE));
  // 판 높이는 쪽을 넘겨도 그대로 — 가장 긴 쪽에 맞춘다(`useSteadyPage`, 2026-11-13 기획자)
  const bodyRef = useRef<HTMLDivElement>(null);
  const view = useSteadyPage(bodyRef, page, pageCount, [ids.join()]);
  const shown = ids.slice(view * GUIDE_REPLAY_PAGE, (view + 1) * GUIDE_REPLAY_PAGE);
  const stroke = shelf ? guideStrokeUrl(shelf.chapter === 'main' ? (topic ?? 'intro') : shelf.chapter) : '';
  const main = shelves.find((x) => x.chapter === 'main');

  const pickChapter = (c: GuideChapter): void => {
    setPage(0);
    setChapter(c);
    if (c === 'main') { setInMain(true); setTopic(main?.topics[0]?.topic ?? null); }
  };
  const pickTopic = (g: GuideMainTopic): void => { setPage(0); setChapter('main'); setTopic(g); };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal mod-plank gdr-modal" data-modal="guideReplay" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-ttl">{t('guide.replay.title')}</h2>
        {shelves.length === 0 ? <p className="gdr-none">{t('guide.replay.empty')}</p> : (
          <div className="gdr-cols">
            <ul className="gdr-side" data-field="guideChapters" data-level={inMain ? '2' : '1'}>
              {inMain ? (
                <>
                  <li>
                    <button className="gdr-row gdr-up" data-action="guideChaptersBack" onClick={() => setInMain(false)}>
                      {t('guide.chapter.back')}
                    </button>
                  </li>
                  {main?.topics.map((g) => (
                    <li key={g.topic}>
                      <button className={`gdr-row${chapter === 'main' && topic === g.topic ? ' on' : ''}`} data-guide-topic={g.topic}
                        onClick={() => pickTopic(g.topic)}>
                        <span className="gdr-swatch" style={{ backgroundImage: `url(${guideStrokeUrl(g.topic)})` }} />
                        <span className="gdr-row-nm">{guideTopicTitle(g.topic)}</span>
                      </button>
                    </li>
                  ))}
                </>
              ) : shelves.map((x) => (
                <li key={x.chapter}>
                  <button className={`gdr-row${chapter === x.chapter ? ' on' : ''}`} data-guide-group={x.chapter}
                    onClick={() => pickChapter(x.chapter)}>
                    {x.chapter === 'main'
                      ? <span className="gdr-swatch gdr-swatch-many" />
                      : <span className="gdr-swatch" style={{ backgroundImage: `url(${guideStrokeUrl(x.chapter)})` }} />}
                    <span className="gdr-row-nm">{guideChapterTitle(x.chapter)}</span>
                    {x.chapter === 'main' && <span className="gdr-more" aria-hidden>›</span>}
                  </button>
                </li>
              ))}
            </ul>

            <div ref={bodyRef} className="gdr-body" data-field="guideItems">
              <div className="gdr-items">
                {shown.map((id) => (
                  <button key={id} className="gdr-item" data-guide={id} style={{ backgroundImage: `url(${stroke})` }} onClick={() => onPick(id)}>
                    <span className="lbl">{titleOf(id)}</span>
                  </button>
                ))}
              </div>
              {ids.length > GUIDE_REPLAY_PAGE && (
                <Pager page={page} pageCount={pageCount} onPage={setPage} actionPrefix="guide" field="guidePager" spread={false} />
              )}
            </div>
          </div>
        )}
        <button className="btn primary wide" data-action="guideReplayClose" onClick={onClose}>{t('guide.replay.close')}</button>
      </div>
    </div>
  );
}

/**
 * **한 마디 안내** (2026-11-19 기획자) — 판 안에 숨었다가 나타나던 안내 · 오류 줄(「지금과 같은 이름이다」 · 「서버에 닿지 못했다」)을 걷고,
 * 그 자리의 사람(내관 · 무관 · 학사 …)이 말풍선으로 말한다. 판 크기가 조작에 따라 출렁이지 않는다.
 *
 * - `text`가 생기는 **그 순간** 들어온다(기획자 — 단추를 누를 때가 아니라). 글이 바뀌면 새로 들어오고, `null`이 되면 물러난다.
 * - 「들었다」로 적지 않는다(대본 안내가 아니다). 목소리도 없다 — 조작마다 인사하면 시끄럽다.
 * - **빤한 것은 말하지 않는다** — 이름 변경 판에서 같은 이름이라 [변경한다]가 막힌 것처럼, 그 판에 들어온 까닭으로 알 수 있는 것은
 *   부르는 쪽이 `text`를 `null`로 둔다(단추만 막는다).
 */
/** 지금 계정의 도시 레벨 — `App`이 계정을 받을 때마다 적는다(`setSayLevel`). 계정을 안 받는 화면(장수 카드 · 로그인)의 `Say`가 이것으로 옷을 고른다 */
let sayLevel = 1;
export const setSayLevel = (level: number): void => { sayLevel = level; };

/**
 * **한 건물 안에서는 한 번만** (2026-11-23 기획자) — 궁궐 · 병영 · 장터 … 안에서 쪽을 오가면 화면이 다시 그려질 때마다 같은 안내
 * (「군량이 모자랍니다」 · 「레벨 상한」 …)가 또 섰다. 한 번 선 말(이름 + 글)은 **그 건물을 완전히 벗어났다가 다시 들어올 때**까지 다시 안 선다.
 * 지금 어느 건물에 있는지는 `App`이 화면마다 적는다(`setSayVisit` ← `sayVisitOf`) — 메인으로 나가면 건물이 바뀌어 비워진다.
 * 「섰다」는 말풍선이 실제로 펴진 때 적는다 — 기다리다 화면을 떠났으면 안 들은 것이다.
 * 누른 일의 대답(서버 거절 · 실패 · 「건넸다」)은 `repeat`로 늘 선다 — 안내가 아니라 그때그때의 결과다.
 */
let sayVisit = '';
const saidThisVisit = new Set<string>();
/**
 * **언어를 바꾸기 전에 선 말의 이름** — 글이 새 언어로 바뀌면 「이름 + 글」로는 같은 말인 줄 모른다(언어를 바꿀 때마다 같은 안내가 또 섰다).
 * 그래서 언어가 바뀌는 순간 그때까지 선 말을 이름으로 옮겨 두고, 이 건물 안에서는 그 이름을 글과 상관없이 「섰다」로 본다
 */
const saidBeforeLang = new Set<string>();
const nameOf = (key: string): string => key.slice(0, key.indexOf('\n'));
onLangChange(() => { for (const k of saidThisVisit) saidBeforeLang.add(nameOf(k)); });
export const setSayVisit = (visit: string): void => {
  if (visit === sayVisit) return;
  sayVisit = visit;
  saidThisVisit.clear();
  saidBeforeLang.clear();
};

export function Say({ text, who = 'steward', level, name, code, repeat = false }: {
  /** 할 말 — `null`이면 아무도 안 선다(서 있으면 물러난다) */
  text: string | null | undefined;
  who?: GuideSpeaker;
  /** 도시 레벨 — 내관 · 병사의 옷(`stewardTier`). 없으면 앱이 적어 둔 지금 계정의 것 */
  level?: number;
  /** 무엇에 대한 말인가 — `data-say`(검사가 건다). 옛 `data-field` 이름을 그대로 쓴다 */
  name: string;
  /** 막은 까닭의 코드 — `data-say-code`(옛 `data-code`) */
  code?: string | undefined;
  /** 누른 일의 대답 — 같은 건물 안에서도 생길 때마다 선다(`setSayVisit` 참조) */
  repeat?: boolean;
}): React.JSX.Element | null {
  const [shown, setShown] = useState<{ text: string; leaving: boolean; seq: number } | null>(null);
  const lang = useLang();
  const langRef = useRef(lang);
  /** 새로 들어올 때마다 하나씩 — 말풍선의 `key`. 언어만 바뀐 것은 새로 들어오지 않고 그 자리에서 글만 갈린다 */
  const seq = useRef(0);
  useEffect(() => {
    const relabel = langRef.current !== lang;
    langRef.current = lang;
    const fresh = !!text && (repeat || (!saidThisVisit.has(`${name}\n${text}`) && !saidBeforeLang.has(name)));
    setShown((s) => {
      if (text && relabel && s && !s.leaving) return { ...s, text };
      if (fresh) return { text: text!, leaving: false, seq: ++seq.current };
      return s && !s.leaving ? { ...s, leaving: true } : s;
    });
  }, [text, lang]);
  const done = useCallback(() => setShown((s) => (s && s.leaving ? null : s)), []);
  const closed = useCallback(() => setShown(null), []);
  const said = useCallback(() => { if (!repeat && shown) saidThisVisit.add(`${name}\n${shown.text}`); }, [repeat, name, shown]);
  if (!shown) return null;
  return (
    <Steward
      key={shown.seq}
      tier={stewardTierOf(level ?? sayLevel)}
      speaker={who}
      say={name}
      sayCode={code}
      lines={[{ text: shown.text }]}
      delayMs={120}
      leaving={shown.leaving}
      onRead={said}
      onDone={shown.leaving ? done : closed}
    />
  );
}
