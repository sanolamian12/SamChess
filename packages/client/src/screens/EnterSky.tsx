/**
 * 입장 하늘 — 간판 [입장] 뒤, 카메라가 하늘로 올라갔다가 메인으로 내려앉는다 (2026-10-19)
 *
 * ```
 *   in      밑의 간판에서 팝업 · 단추 · 제목이 0.7초 동안 흐려진다 — 이 층은 다 흐려진 뒤 간판과 같은 그림으로 한 번에 선다
 *   up      땅이 아래로 밀려 내려가고 시간대 하늘(`sky-{band}.jpg`)이 내려온다
 *   hold    하늘에 머문다 — 도시를 불러오는 동안. 이 사이에 땅 그림을 간판 → 도착지로 바꾼다
 *   down    도착지(메인 · 도시 이름 짓기) 그림이 올라와 화면과 같은 자리에 선다
 *   out     이 층이 흐려지며 밑에 이미 서 있는 진짜 화면(단추 · 자리 이름)이 드러난다
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 처음엔 영상이었다 — 출발 · 도착이 화면과 달라 걷어 냈다
 * ────────────────────────────────────────────────────────────────
 *
 * 시간대별 입장 영상(`EnterCine`, 같은 날 오전)은 첫 장면이 간판 그림과, 끝 장면이 메인 그림과 **다른
 * 그림**이라 [입장] 순간과 도착 순간에 이질감이 컸다(기획자 실기). 여기서는 화면에 깔린 **바로 그
 * 그림**을 움직인다 — 출발과 도착이 화면과 한 치도 안 어긋난다. 그러려고 이 층이 서 있는 동안
 * 진짜 화면의 배경 드리프트를 첫 자세(`scale(1.06)`)에 묶어 둔다(`style.css`의 `#frame[data-sky]`) —
 * 여기 땅 그림도 같은 자세다.
 *
 * ────────────────────────────────────────────────────────────────
 * 하늘이 로딩이다
 * ────────────────────────────────────────────────────────────────
 *
 * 인증이 끝나면 곧장 올라가고, 계정을 읽는 왕복은 하늘에 머무는 동안 끝난다. 도착지(`to`)가 오기 전에는 안 내려온다 —
 * 늦으면 하늘에 더 머물 뿐이다.
 *
 * **새 계정(`to: 'cut'`)은 하늘에서 내려오지 않는다** (2026-10-19 기획자 지정) — 도시 이름 짓기 화면은 노을 한 장뿐이라
 * 낮 · 밤에 하늘에서 그 땅으로 내려오면 「시간이 지나 있다」. 그때 이 층은 `hold`에 머물고, `App.tsx`가 흰 전환(`whiteCut`)으로
 * 하늘 → 도시 이름 짓기를 넘긴 뒤 이 층을 걷는다(하늘 장면이 커지며 흐려지고 흰빛 — `#frame[data-flash="out"] > .sky-enter`).
 * 한때는 `in`에서 도착지를 기다렸다가 하늘로 갈지 정했는데, 그러면 계정 읽기가 흐려진 간판 위에서 보여 「멈췄다」로 읽혔다(기획자 실기). 진짜 화면을 바꾸는 것은 `App.tsx`가 **하늘에
 * 닿은 뒤**(`onCovered`)에 한다 — 이 층이 아직 반투명할 때 바꾸면 밑의 화면이 바뀌는 게 비친다.
 * 끊긴 판으로 곧장 돌아가는 길(`to: 'none'`)은 내려앉지 않고 하늘에서 흐려지며 전투를 비춘다.
 *
 * 이음매 — 하늘 그림의 아래쪽과 땅 그림의 위쪽이 겹치고(`--sky-overlap`), 땅의 위 가장자리를 마스크로
 * 흐려 섞는다. 마스크는 출발 · 도착 순간엔 없어야 화면과 같으므로, 마스크 없는 땅(`.sky-ground-solid`)을
 * 한 장 더 얹어 출발 직후 흐려 걷고 도착 직전 다시 들인다(마스크는 전환되지 않는다).
 */

import { useEffect, useRef, useState } from 'react';
import { skyBackdrop } from './backdrop.ts';
import type { TimeBand } from './backdrop.ts';

/** 단계 길이(ms) — `.sky-enter`의 전환 길이와 같은 값이어야 한다 */
export const SKY_MS = { in: 700, up: 1800, hold: 600, down: 2000, out: 550 } as const;

type Phase = 'in' | 'up' | 'hold' | 'down' | 'out';

/** 하늘 · 간판 · 도착지 그림을 미리 받는다 — 입장 팝업을 열 때 */
export function preloadSky(band: TimeBand, ...more: string[]): void {
  for (const src of [skyBackdrop(band), ...more]) new Image().src = src;
}

export function EnterSky({ band, from, to, onCovered, onLand, onDone }: {
  band: TimeBand;
  /** 출발 — 지금 화면에 깔린 배경(간판) */
  from: string;
  /** 도착지 배경. `null`이면 아직 모른다(하늘에서 기다린다), `'none'`이면 내려앉지 않고 흐려진다, `'cut'`이면 하늘에 머문다(흰 전환이 넘긴다) */
  to: string | null | 'none' | 'cut';
  /** 하늘에 닿았다 — 이제 밑의 화면을 바꿔도 안 비친다 */
  onCovered: () => void;
  /** 내려앉아 흐려지기 시작 — 메인이 드러나는 순간(효과음 자리) */
  onLand: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('in');
  const [ground, setGround] = useState(from);
  const cbs = useRef({ onCovered, onLand, onDone });
  cbs.current = { onCovered, onLand, onDone };

  useEffect(() => {
    const at = (ms: number, fn: () => void): number => window.setTimeout(fn, ms);
    if (phase === 'in') {
      const id = at(SKY_MS.in, () => setPhase('up'));
      return () => window.clearTimeout(id);
    }
    if (phase === 'up') {
      const id = at(SKY_MS.up, () => { setPhase('hold'); cbs.current.onCovered(); });
      return () => window.clearTimeout(id);
    }
    if (phase === 'hold') {
      // 도착지를 아직 모르거나, 흰 전환이 넘길 차례(`cut`)면 하늘에 머문다
      if (to === null || to === 'cut') return undefined;
      const id = at(SKY_MS.hold, () => {
        if (to === 'none') { setPhase('out'); cbs.current.onLand(); return; }
        setGround(to);
        // 땅 그림을 바꾼 다음 프레임에 내려간다 — 같은 프레임이면 옛 그림이 한 번 올라온다
        requestAnimationFrame(() => requestAnimationFrame(() => setPhase('down')));
      });
      return () => window.clearTimeout(id);
    }
    if (phase === 'down') {
      const id = at(SKY_MS.down, () => { setPhase('out'); cbs.current.onLand(); });
      return () => window.clearTimeout(id);
    }
    const id = at(SKY_MS.out, () => cbs.current.onDone());
    return () => window.clearTimeout(id);
  }, [phase, to]);

  const art = { backgroundImage: `url(${ground})` };
  return (
    <div className="sky-enter" data-modal="enterSky" data-phase={phase} data-band={band} onClick={(e) => e.stopPropagation()}>
      <div className="sky-track">
        <div className="sky-plate" style={{ backgroundImage: `url(${skyBackdrop(band)})` }} />
        <div className="sky-ground">
          <div className="sky-ground-art" style={art} />
        </div>
        <div className="sky-ground sky-ground-solid">
          <div className="sky-ground-art" style={art} />
        </div>
      </div>
    </div>
  );
}
