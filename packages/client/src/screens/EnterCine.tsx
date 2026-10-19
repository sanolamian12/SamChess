/**
 * 입장 영상 — 간판 [입장] 뒤 메인 화면으로 넘어가는 10초 (2026-10-19)
 *
 * 성문 앞(간판 그림과 같은 자리)에서 카메라가 하늘로 올라갔다가 성 안 저잣거리(메인 그림과
 * 같은 자리)로 내려온다. 시간대 셋(낮 · 황혼 · 밤)이 따로 있고 고르는 기준은 배경과 같은
 * `currentBand()`다. 원본 → 웹용은 `tools/build_opening.py`(`npm run opening`).
 *
 * ────────────────────────────────────────────────────────────────
 * 메인 화면은 영상 **밑에서** 이미 서 있다
 * ────────────────────────────────────────────────────────────────
 *
 * `App.tsx`는 계정을 읽자마자 화면을 메인으로 바꾸고 그 위에 이것을 덮는다. 그래서 영상이
 * 끝나 흐려지는 동안 비치는 것은 그림까지 다 받아 둔 메인이다 — 영상의 마지막 장면과 메인
 * 배경이 같은 저잣거리라 겹쳐 넘어가는 것으로 읽힌다. 계정을 읽는 왕복은 영상 **앞**의
 * 입성 로딩(`EnterLoading`)이 덮는다 — 영상이 「계정이 있다」를 안 뒤에 시작해야 새 계정
 * (도시 이름 짓기로 가는 길)에 성 안 장면을 틀어 놓고 끊는 일이 없다.
 *
 * ────────────────────────────────────────────────────────────────
 * 영상이 못 돌면 그냥 지나간다 — 막히는 일이 없어야 한다
 * ────────────────────────────────────────────────────────────────
 *
 * 파일이 없다(`public/`은 git에 없다) · 재생이 거부된다 · 받는 것이 멈췄다 — 셋 다 「입장이
 * 안 된다」가 되면 안 되므로 곧장 끝낸다(`STALL_MS`). 소리는 [입장] 클릭이 이미 사용자
 * 조작이라 대개 허락되지만, 거부되면 **소리를 끄고 한 번 더** 튼다. 배경음악은 영상 동안
 * 붙들어 둔다(`holdBgm`) — 영상에 소리가 있어 둘이 겹친다. 음소거는 같은 스위치(`bgmMuted`).
 */

import { useEffect, useRef, useState } from 'react';
import { bgmMuted, holdBgm } from '../audio/bgm.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import type { TimeBand } from './backdrop.ts';

export const enterCineSrc = (band: TimeBand): string => `opening/enter-${band}.mp4`;
export const enterCinePoster = (band: TimeBand): string => `opening/enter-${band}.jpg`;

/** 흐려지며 메인을 비추는 시간. `.cine-enter[data-leaving]`의 전환과 같은 값이다 */
const LEAVE_MS = 700;
/** [건너뛰기]가 나타나기까지 — 처음부터 있으면 누르려던 손에 잘못 걸린다 */
const SKIP_AFTER_MS = 900;
/** 이만큼 재생이 시작되지 않으면 영상 없이 넘어간다 */
const STALL_MS = 4000;

/** 받아 둔 영상(Blob URL). 입장 팝업이 열릴 때 미리 받는다 — 인증 왕복 동안 다 받는다 */
const prefetched = new Map<TimeBand, Promise<string | null>>();

/** 영상을 미리 받는다. 몇 번 불러도 한 번만 받고, 못 받으면 `null`(그때는 그냥 주소로 튼다) */
export function prefetchEnterCine(band: TimeBand): void {
  if (prefetched.has(band)) return;
  prefetched.set(band, fetch(enterCineSrc(band))
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => (b && b.type.startsWith('video') ? URL.createObjectURL(b) : null))
    .catch(() => null));
}

export function EnterCine({ band, onReveal, onDone }: {
  band: TimeBand;
  /** 영상이 흐려지기 시작할 때 — 메인이 비치기 시작하는 순간(효과음 자리) */
  onReveal: () => void;
  /** 다 흐려졌을 때 — 이것을 걷는다 */
  onDone: () => void;
}): React.JSX.Element {
  useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [canSkip, setCanSkip] = useState(false);
  const left = useRef(false);
  const cbs = useRef({ onReveal, onDone });
  cbs.current = { onReveal, onDone };

  const leave = (): void => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    videoRef.current?.pause();
    holdBgm(false);
    cbs.current.onReveal();
    setTimeout(() => cbs.current.onDone(), LEAVE_MS);
  };

  // 받아 둔 것이 있으면 그것으로, 없거나 아직이면 주소로
  useEffect(() => {
    let live = true;
    const ready = prefetched.get(band);
    if (!ready) { setSrc(enterCineSrc(band)); return; }
    void ready.then((url) => { if (live) setSrc(url ?? enterCineSrc(band)); });
    return () => { live = false; };
  }, [band]);

  useEffect(() => {
    holdBgm(true);
    const skip = setTimeout(() => setCanSkip(true), SKIP_AFTER_MS);
    return () => { clearTimeout(skip); holdBgm(false); };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.muted = bgmMuted();
    const stall = setTimeout(() => { if (v.currentTime === 0) leave(); }, STALL_MS);
    void v.play().catch(() => {
      // 소리 때문에 거부됐을 수 있다 — 끄고 한 번 더. 그래도 안 되면 영상 없이 지나간다
      v.muted = true;
      return v.play();
    }).catch(() => leave());
    return () => clearTimeout(stall);
  }, [src]);

  return (
    <div
      className="cine-enter"
      data-modal="enterCine"
      data-band={band}
      data-leaving={leaving ? '' : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <video
        ref={videoRef}
        src={src ?? undefined}
        poster={enterCinePoster(band)}
        playsInline
        preload="auto"
        onEnded={leave}
        onError={leave}
      />
      {canSkip && !leaving && (
        <button className="cine-skip" data-action="cineSkip" onClick={leave}>{t('enter.skip')}</button>
      )}
    </div>
  );
}
