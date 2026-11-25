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
 * **도입부(`intro`)는 갈래마다 바꿀 수 있다** (2026-11-21 기획자) — 기본은 위의 세 빛 나선(`swirl`), 대장간 제작 완료는
 * 모루 위 망치질 세 번(`forge` — 1.5 · 3.0 · 4.5초에 「깡」, 앞의 둘은 맞는 자리에서 화면 절반까지 번쩍, 셋째는 끝까지 커져 하얘진다),
 * 태학 연구 완료는 별의 번짐(`academy`, 2026-11-22 — 뒷짐 진 선비가 밤하늘을 올려다보고, 시선이 치솟아 칠성의 별이 하나둘 이어지다
 * 급속히 번져 거의 다 이어지며 화면이 확 밝아진다). 먼저 만든 북두칠성(`academyDipper`) · 거미줄(`academyWeb`)은 기획자가 백업으로 남겼다(쓰는 자리 없음).
 * 도시 증축은 용머리 올리기(`city`, 2026-11-22 — 거중기 기어에 바짝 붙어 시작해 궁궐 공사장 전체로 물러나며 짐이 올라가고, 용마루 끝으로 다가가
 * 용머리가 「쿵」 놓이자 곧바로 햇빛에 「쨍」 빛나 화면이 빛으로 찬다).
 * 길이(5초) · 하얘지는 끝 · 그 뒤 무대는 어느 도입부든 같다. 그림은 `tools/build_celebrate_intro.py`가 굽는다.
 *
 * **급은 둘이다** (2026-11-22 기획자 — 「7초가 큰 급, 2초가 작은 급」): 큰 급(`tier="big"`, 기본)은 위의 5초 모음 + 무대(약 2초) — 강화 · 도시 증축 ·
 * 대장간 제작 · 태학 연구. 작은 급(`small`)은 모음이 0.9초(세 빛이 빠르게 돌며 모여 번쩍)이고 축하음은 「쾅」 4.1초 앞부터 튼다 — 건물 짓기 · 증축 · 금화 구매.
 * 작은 급은 도입부 갈래(`intro`)를 안 쓴다. 모음만 따로 쓰는 자리(장터 아이템 구매 · 8연 뽑기)는 `CelebrateCharge`.
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
import type { RecruitWalker } from './market/recruitSeats.ts';

/** 닫히는 연출의 길이 — CSS의 `cel-out`(.36초)과 같다 */
const LEAVE_MS = 360;
/**
 * 섬광을 모으는 길이 — 이 뒤에 무대가 열린다. 축하음(`celebrate.mp3`, 7.4초)이 4.5초부터 차오르는 그 끝에 맞췄다(2026-11-20 기획자 — 「5초 즈음 하얘지고 쾅」).
 * CSS의 `cel-swirl` · `cel-flare` · `cel-whiteout`(5초)과 같은 값이다 — 바꾸면 셋을 함께.
 */
const CHARGE_MS = 5000;
/** 축하의 급 — 큰 급(7초) · 작은 급(2초) */
export type CelebrateTier = 'big' | 'small';
/** 급마다 모으는 길이(ms) — 작은 급은 CSS의 `.cel-back[data-tier="small"]`(.9초)과 같은 값 */
export const CHARGE_MS_OF: Record<CelebrateTier, number> = { big: CHARGE_MS, small: 900 };
/** 축하음을 어디서부터 트나(초) — 「쾅」이 5.0초에 있으니 작은 급은 4.1초부터 틀어 0.9초에 「쾅」 */
const SOUND_FROM: Record<CelebrateTier, number> = { big: 0, small: 4.1 };
/** 도입부 — 모으는 5초 동안 무엇을 보여 주나 */
export type CelebrateIntro = 'swirl' | 'forge' | 'academy' | 'academyDipper' | 'academyWeb' | 'city' | 'recruit';
/**
 * 망치가 칼날을 치는 시각 — CSS의 `cin-hammer` 열쇠틀(30 · 60 · 90%)과 `cin-hit[data-n]`의 늦춤(1.5 · 3.0 · 4.5초)이 같은 값이다.
 * 셋째가 축하음이 차오르기 시작하는 4.5초에 떨어지고, 그 섬광이 5초에 화면을 덮는다.
 */
const FORGE_STRIKES_MS = [1500, 3000, 4500] as const;
/** 「깡」 — 망치가 칼날을 맞는 소리(`assets/Audio/new/망치질.mp3`) */
const FORGE_CLANG: SfxId = 'forge_clang';
/**
 * 도시 증축 도입부의 공사 소리 — [소리, 트는 시각 ms]. 대장간의 「깡」처럼 장면에 얹는다(2026-11-23 기획자, `assets/Audio/new/construction_*.mp3`).
 * 톱질은 기어에 붙은 처음부터(0~2.2초), 못질 · 해머질이 물러나며 짐이 오르는 동안 이어 치고, 큰못질은 둘째 「쾅」(소리 안 0.6초)이
 * 용머리가 앉는 3.4초(`cic-cam` 68%)에 떨어지게 2.8초에 튼다.
 */
const CITY_SOUNDS: readonly (readonly [SfxId, number])[] = [
  ['construction_saw', 0], ['construction_nail', 600], ['construction_hammer', 1400], ['construction_bignail', 2800],
];
/**
 * 태학 도입부 — 별과 빛줄의 계획. 좌표는 화면 비율(가로 0~100 · 세로 0~200, 세로 판 1:2)이고, 별 그림은 퍼센트 자리 · 빛줄은 같은 좌표의 SVG라
 * 둘이 같은 자리에 선다. 빛줄마다 언제(`at`) · 얼마 동안(`dur`) 그어지고 얼마나 옅은지(`op`)를 적고, 별은 처음 빛줄에 닿는 순간 한 단계 밝아진다.
 * 세 벌이다 — 지금 쓰는 **번짐**(`academy`)과 기획자가 백업으로 남긴 **북두칠성**(`academyDipper`) · **거미줄**(`academyWeb`).
 */
type StarEdge = { a: number; b: number; at: number; dur: number; op: number };
type StarPlan = {
  stars: readonly (readonly [number, number])[];
  edges: readonly StarEdge[];
  /** 별이 뜨는 시각 */
  onMs: (i: number) => number;
  /** 별 크기 — `data-dipper`(큰 별) · `data-size`(0~2) */
  big: (i: number) => boolean;
  size?: (i: number) => number;
  /** 마지막에 별빛이 터지는 별 */
  bursts: readonly number[];
  /** 빛줄 꼴 — `cia-lines`(북두칠성, 맥동) · `ciw-lines`(가는 줄, 차오르는 번짐) */
  lines: 'cia-lines' | 'ciw-lines';
  /** 화면 가운데에서 빛이 차오르는가 — 언제부터(`early` 2.7초 · `late` 3.3초) */
  glow?: 'early' | 'late';
  /** 빛줄 굵기 — `ciw-lines`일 때 */
  weight?: 'thin' | 'bold';
};
const dist = (s: readonly (readonly [number, number])[], a: number, b: number): number =>
  Math.hypot(s[a]![0] - s[b]![0], s[a]![1] - s[b]![1]);
/** 별 k가 처음 빛줄에 닿는 시각 — 줄이 떠나는 별은 떠날 때, 닿는 별은 다 그어졌을 때 */
const litMs = (plan: StarPlan, k: number): number | null => {
  let at: number | null = null;
  for (const e of plan.edges) {
    const when = k === e.a ? e.at : k === e.b ? e.at + e.dur : null;
    if (when !== null && (at === null || when < at)) at = when;
  }
  return at;
};
const ms = (n: number): string => `${n}ms`;
const STAR_ON = 1400;

/** 북두칠성(백업) — 앞의 일곱이 칠성(국자 손잡이 끝부터 요광 · 개양 · 옥형 · 천권 · 천기 · 천선 · 천추), 뒤의 넷은 흩어진 별 */
const DIPPER_STARS: readonly (readonly [number, number])[] = [
  [16, 74], [31, 83], [45, 89], [58, 98], [60, 117], [84, 124], [87, 102],
  [22, 52], [74, 60], [30, 144], [80, 156],
];
/** 칠성의 빛줄 일곱 — 마지막 줄(천추 → 천권)이 국자의 바닥을 닫는다 */
const DIPPER_EDGES: readonly (readonly [number, number])[] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]];
const DIPPER_PLAN: StarPlan = {
  stars: DIPPER_STARS,
  edges: DIPPER_EDGES.map(([a, b], i) => ({ a, b, at: 2000 + i * 310, dur: 260, op: 1 })),
  onMs: (i) => STAR_ON + i * 50,
  big: (i) => i < 7,
  bursts: [0, 1, 2, 3, 4, 5, 6],
  lines: 'cia-lines',
};

/**
 * 번짐(지금, 2026-11-22 기획자 — 「칠성 별에 두세 개만 더해, 처음엔 하나둘 이어지다 급속히 번지며 화면이 확 밝아지게」).
 * 별 열넷(칠성 + 흩어진 넷 + 셋). 처음 세 줄은 칠성을 따라 천천히(2.0 · 2.42 · 2.78초) — 그 뒤 거리 70 미만의 나머지 58줄이 3.05초부터
 * **점점 좁아지는 간격**(√ 꼴)으로 천권에서 가까운 것부터 몰아쳐 4.3초쯤 거의 다 이어진다. 빛은 3.3초부터 가파르게 차오른다.
 */
const SPREAD_STARS: readonly (readonly [number, number])[] = [...DIPPER_STARS, [48, 40], [12, 118], [56, 162]];
const SPREAD_EDGES = ((): StarEdge[] => {
  const first: StarEdge[] = [[0, 1], [1, 2], [2, 3]].map(([a, b], i) => ({ a: a!, b: b!, at: [2000, 2420, 2780][i]!, dur: 300, op: 1 }));
  const taken = new Set(first.map((e) => `${e.a}-${e.b}`));
  const hub = 3;   // 천권 — 처음 세 줄이 닿은 자리에서 번져 나간다
  const rest: { a: number; b: number; d: number; from: number }[] = [];
  for (let a = 0; a < SPREAD_STARS.length; a += 1) {
    for (let b = a + 1; b < SPREAD_STARS.length; b += 1) {
      const d = dist(SPREAD_STARS, a, b);
      if (d >= 70 || taken.has(`${a}-${b}`)) continue;
      const near = dist(SPREAD_STARS, hub, a) <= dist(SPREAD_STARS, hub, b);
      const mid = Math.hypot((SPREAD_STARS[a]![0] + SPREAD_STARS[b]![0]) / 2 - SPREAD_STARS[hub]![0], (SPREAD_STARS[a]![1] + SPREAD_STARS[b]![1]) / 2 - SPREAD_STARS[hub]![1]);
      rest.push({ a: near ? a : b, b: near ? b : a, d, from: mid + d * 0.35 });
    }
  }
  rest.sort((x, y) => x.from - y.from);
  const n = rest.length;
  return [...first, ...rest.map((r, k) => ({
    a: r.a, b: r.b,
    at: Math.round(3050 + 1250 * Math.sqrt(k / n)),
    dur: Math.round(300 - 140 * (k / n)),
    op: r.d < 40 ? 0.95 : r.d < 55 ? 0.7 : 0.45,
  }))];
})();
const SPREAD_PLAN: StarPlan = {
  stars: SPREAD_STARS,
  edges: SPREAD_EDGES,
  onMs: (i) => STAR_ON + i * 45,
  big: (i) => i < 7,
  bursts: [0, 1, 2, 3, 4, 5, 6, 7, 9, 13],
  lines: 'ciw-lines',
  glow: 'late',
  weight: 'bold',
};

/**
 * 거미줄(백업) — 별 서른(서로 19 이상 떨어지게 한 번 뽑아 적은 고정 값). 빛줄은 거리로 세 물결 — 30 미만(2.0초~) · 45 미만(2.7초~) · 70 미만(3.4초~) —
 * 이고 물결마다 가운데 별(13번)에서 바깥으로 번진다(줄의 가운데가 멀수록 늦게). 먼 줄일수록 옅다. 약 240줄.
 */
const WEB_STARS: readonly (readonly [number, number])[] = [
  [15, 156], [89, 39], [7, 41], [73, 119], [86, 148], [35, 62], [36, 39], [82, 65], [88, 171], [33, 126],
  [53, 138], [17, 112], [89, 83], [61, 101], [55, 48], [33, 96], [84, 103], [61, 170], [18, 82], [70, 80],
  [11, 176], [39, 157], [9, 62], [91, 128], [6, 139], [37, 179], [53, 69], [53, 118], [69, 35], [67, 152],
];
const WEB_WAVES = [
  { max: 30, start: 2000, span: 1000, dur: 320, op: 0.95 },
  { max: 45, start: 2700, span: 1000, dur: 360, op: 0.55 },
  { max: 70, start: 3400, span: 900, dur: 380, op: 0.28 },
] as const;
const WEB_PLAN: StarPlan = {
  stars: WEB_STARS,
  edges: ((): StarEdge[] => {
    const o = 13;
    const [ox, oy] = WEB_STARS[o]!;
    const far = Math.max(...WEB_STARS.map(([x, y]) => Math.hypot(x - ox, y - oy)));
    const out: StarEdge[] = [];
    for (let a = 0; a < WEB_STARS.length; a += 1) {
      for (let b = a + 1; b < WEB_STARS.length; b += 1) {
        const w = WEB_WAVES.find((v) => dist(WEB_STARS, a, b) < v.max);
        if (!w) continue;
        // 가운데 별에 가까운 끝에서 그어 나간다 — 거미줄이 바깥으로 자라는 것처럼
        const near = dist(WEB_STARS, o, a) <= dist(WEB_STARS, o, b);
        const mid = Math.hypot((WEB_STARS[a]![0] + WEB_STARS[b]![0]) / 2 - ox, (WEB_STARS[a]![1] + WEB_STARS[b]![1]) / 2 - oy);
        out.push({ a: near ? a : b, b: near ? b : a, at: Math.round(w.start + (mid / far) * w.span), dur: w.dur, op: w.op });
      }
    }
    return out;
  })(),
  onMs: (i) => STAR_ON + i * 25,
  big: () => false,
  size: (i) => i % 3,
  bursts: [13, 5, 3, 11, 7, 17, 25, 1],
  lines: 'ciw-lines',
  glow: 'early',
  weight: 'thin',
};
const STAR_PLANS = { academy: SPREAD_PLAN, academyDipper: DIPPER_PLAN, academyWeb: WEB_PLAN } as const;

/** 태학 도입부 — 선비 · 하늘(같은 그림)에 계획대로 별 · 빛줄 · 빛을 얹는다 */
function StarIntro({ intro, plan }: { intro: keyof typeof STAR_PLANS; plan: StarPlan }): React.JSX.Element {
  const { stars } = plan;
  return (
    <div className="modal-back cel-back" data-phase="charge" data-intro={intro} aria-hidden>
      <div className="cel-charge cin-academy">
        <div className="cia-scene">
          <img className="cia-sky" src="ui/intro-academy-sky.jpg" alt="" />
          <div className="cia-ground">
            <img className="cia-terrace" src="ui/intro-academy-terrace.png" alt="" />
            <img className="cia-scholar" src="ui/intro-academy-scholar.png" alt="" />
          </div>
        </div>
        <svg className={plan.lines} data-weight={plan.weight} viewBox="0 0 100 200" preserveAspectRatio="none">
          {plan.edges.map((e, i) => (
            <line key={i} x1={stars[e.a]![0]} y1={stars[e.a]![1]} x2={stars[e.b]![0]} y2={stars[e.b]![1]}
              pathLength={1} style={{ opacity: e.op, animationDelay: ms(e.at), animationDuration: ms(e.dur) }} />
          ))}
        </svg>
        {plan.glow && <span className="ciw-glow" data-ramp={plan.glow} />}
        {stars.map(([x, y], i) => {
          const lit = litMs(plan, i);
          return (
            <i key={i} className="cia-star" data-dipper={plan.big(i) ? '' : undefined} data-size={plan.size?.(i)}
              style={{ left: `${x}%`, top: `${y / 2}%`, animationDelay: `${ms(plan.onMs(i))}, ${lit === null ? '9999s' : ms(lit)}` }}>
              <img src={`ui/intro-academy-star-${(i % 2) + 1}.jpg`} alt="" style={{ animationDelay: `${-(i * 0.37).toFixed(2)}s, 0s` }} />
            </i>
          );
        })}
        {plan.bursts.map((k, i) => (
          <img key={`b${k}`} className="cia-burst" src="ui/intro-academy-flash.jpg" alt=""
            style={{ left: `${stars[k]![0]}%`, top: `${stars[k]![1] / 2}%`, animationDelay: ms(4450 + i * 30) }} />
        ))}
        <span className="cin-whiteout" />
      </div>
    </div>
  );
}

/**
 * 장수 모집 도입부 (2026-11-25 기획자, `Design/장수모집연출/시나리오.html`) — 4:3 창 안에서 석양을 등진 실루엣(뽑는 수만큼)이
 * 지평선에서 다가오고, 해가 점점 커지다 4.6초에 번쩍 → 5초 「쾅」. 높은 등급(A · S · E)이 가운데부터 서고 등 뒤에서 그 등급의 섬광이 비친다.
 * 시각은 전부 CSS(`.cir-*`)에 있고 늦춤은 `calc(… - var(--cir-skip))`로 적었다 — 건너뛰면 열쇠를 바꿔 다시 그리며 `--cir-skip`을 4.6초로 둔다.
 */
/** 다가오는 정지 장면 넷 — 크기 · 시각은 CSS(`.cir-walker[data-stage]`, `cir-stage-*`) */
const RECRUIT_STAGES = [0, 1, 2, 3] as const;
/** 걷는 중에 누르면 이 시각(번쩍이 시작하는 자리)으로 건너뛴다 */
const RECRUIT_SKIP_TO_MS = 4600;
/** 건너뛸 수 있는 구간 — 창이 열린 뒤부터 번쩍 전까지 */
const RECRUIT_SKIP_FROM_MS = 400;
/** 무대가 열린 뒤 이만큼은 누름을 받지 않는다 — 건너뛰려던 누름이 무대를 닫지 않게 */
const RECRUIT_OPEN_GUARD_MS = 600;
/**
 * 발걸음 — 한 사람 걸음(`walking_edit`, 8.6초, 약 0.85초마다 한 걸음)을 시간차로 겹친다: 1명 하나 · 3명 둘 · 5명 셋(기획자 — 「2개, 3개를 들면 다 커버」).
 * [트는 시각 ms, 크기, 빠르기] — 빠르기를 조금씩 달리해 같은 소리가 겹친 티가 덜 나게
 */
const RECRUIT_STEPS: Record<number, readonly (readonly [number, number, number])[]> = {
  1: [[400, 0.95, 1]],
  3: [[400, 0.8, 1], [720, 0.7, 0.96]],
  5: [[400, 0.72, 1], [640, 0.62, 0.96], [900, 0.55, 1.04]],
};
/** 발걸음이 잦아드는 때 · 길이 — 번쩍 직전에 걷힌다 */
const RECRUIT_STEPS_FADE_AT = 4300;
const RECRUIT_STEPS_FADE_MS = 500;

/** 소리를 `ms` 동안 줄이다 멈춘다 */
function fadeOut(el: HTMLAudioElement, msLen: number): number {
  const from = el.volume;
  const t0 = performance.now();
  const id = window.setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / msLen);
    el.volume = Math.max(0, from * (1 - k));
    if (k >= 1) { el.pause(); window.clearInterval(id); }
  }, 40);
  return id;
}

/** 장수 모집 도입부 — 걷는 창. 자리 · 시각은 CSS(`.cir-*`) */
function RecruitIntro({ walkers, skipped, onSkip }: {
  walkers: readonly RecruitWalker[];
  skipped: boolean;
  onSkip: () => void;
}): React.JSX.Element {
  const n = walkers.length;
  return (
    <div className="modal-back cel-back" data-phase="charge" data-intro="recruit" data-skipped={skipped ? '1' : undefined}
      onClick={onSkip}>
      <button type="button" className="cel-hit" data-action="recruitSkip" aria-label={t('celebrate.tap')} />
      {/* 열쇠를 바꿔 다시 그린다 — 애니메이션이 처음부터, 늦춤에서 `--cir-skip`만큼 빼고 돈다 */}
      <div key={skipped ? 'skip' : 'run'} className="cel-charge cin-recruit" data-count={n}
        style={{ '--cir-skip': skipped ? `${RECRUIT_SKIP_TO_MS}ms` : '0ms' } as React.CSSProperties}>
        {/* 창 틀(4:3) — 창은 가장자리가 번지게 가리고(`mask`), 번쩍은 그 가림 밖까지 터지도록 틀에 따로 */}
        <div className="cir-frame">
        <div className="cir-window">
          <div className="cir-world">
            <img className="cir-bg" src="ui/intro-recruit-bg.jpg" alt="" />
            <img className="cir-sun" src="ui/intro-recruit-sun.jpg" alt="" />
            <img className="cir-dust" data-n="1" src="ui/intro-recruit-dust-1.jpg" alt="" />
            {/* 오프닝 영상처럼 정지 장면 넷이 부드럽게 넘어간다(2026-11-25 기획자 — 「연속으로 다가오기보다」) — 자리마다 크기가 다른 넷을 겹쳐 두고 투명도만 넘긴다 */}
            {RECRUIT_STAGES.map((stage) => walkers.map((w, seat) => (
              <div key={`${stage}-${seat}`} className="cir-walker" data-seat={seat} data-stage={stage} data-art={w.art} data-glow={w.glow ?? undefined}>
                <i className="cir-shadow" />
                {w.glow && <BlinkGlow tone={w.glow} className="cir-glow" />}
                <img className="cir-body" src={`ui/intro-recruit-walker-${w.art}.png`} alt="" />
              </div>
            )))}
            <img className="cir-dust" data-n="2" src="ui/intro-recruit-dust-2.jpg" alt="" />
          </div>
        </div>
        <img className="cir-flash" src="ui/intro-recruit-flash.jpg" alt="" />
        </div>
        <span className="cin-whiteout" />
      </div>
    </div>
  );
}

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
  sound = 'celebrate', intro: introAsked = 'swirl', tier = 'big', walkers, cast, onClose, className = '', children }: {
  /** `data-modal` — 검사가 이 화면을 찾는 이름 */
  modal: string;
  /** 큰 제목(「강화 완료」) — 언제나 한 줄, 안 들면 그 글만 줄인다(`FitLine`). 빈 글이면 제목 줄이 없다(장수 모집) */
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
  /** 모으는 5초의 도입부 — 기본은 세 빛 나선. 작은 급은 언제나 세 빛 나선이다 */
  intro?: CelebrateIntro;
  /** 급 — 큰 급(기본, 7초) · 작은 급(2초) */
  tier?: CelebrateTier;
  /** 장수 모집 도입부(`intro='recruit'`)의 걷는 사람 — 왼쪽부터 자리 순(`recruitWalkers()`) */
  walkers?: readonly RecruitWalker[];
  /** 무대 그림 위에 서는 것(장수 모집의 장수들) — 배지와 달리 내려찍지 않는다 */
  cast?: ReactNode;
  onClose: () => void;
  /** 갈래 클래스(글자 꼴 · 크기) — 예: 도시 증축의 `cty-done` */
  className?: string;
  /** 큰 글씨 아래 줄들 */
  children?: ReactNode;
}): React.JSX.Element {
  const intro: CelebrateIntro = tier === 'small' ? 'swirl' : introAsked;
  const chargeMs = CHARGE_MS_OF[tier];
  const [leaving, setLeaving] = useState(false);
  const [charging, setCharging] = useState(true);
  const chargingRef = useRef(true);
  const recruit = intro === 'recruit' && (walkers?.length ?? 0) > 0;
  // 장수 모집 — 건너뛰기 · 걸음 소리 · 무대가 열린 시각
  const [skipped, setSkipped] = useState(false);
  const skipRef = useRef<() => void>(() => {});
  const openedAt = useRef(0);
  const left = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const leave = useCallback((): void => {
    if (left.current || chargingRef.current) return;   // 두 번 눌러도 한 번만 · 모으는 동안은 안 닫힌다
    // 장수 모집은 무대가 열린 직후의 누름을 넘긴다 — 걷는 중에 건너뛰려고 누른 손이 무대를 곧장 닫지 않게
    if (openedAt.current > 0 && performance.now() - openedAt.current < RECRUIT_OPEN_GUARD_MS) return;
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
    const t0 = performance.now();
    const main = sound ? playSfx(sound, { from: SOUND_FROM[tier] }) : null;
    const fades: number[] = [];
    // 장수 모집 — 걸음 소리를 시간차로 겹치고, 번쩍 직전에 잦아들게
    const steps: HTMLAudioElement[] = [];
    const stepTimers = recruit ? (RECRUIT_STEPS[walkers!.length] ?? RECRUIT_STEPS[1]!).map(([at, volume, rate]) => window.setTimeout(() => {
      const el = playSfx('walking_edit', { volume, rate });
      if (el) { steps.push(el); }
    }, at)) : [];
    const stepFade = recruit ? window.setTimeout(() => steps.forEach((el) => fades.push(fadeOut(el, RECRUIT_STEPS_FADE_MS))), RECRUIT_STEPS_FADE_AT) : 0;
    const clangs = intro === 'forge' ? FORGE_STRIKES_MS.map((ms) => window.setTimeout(() => playSfx(FORGE_CLANG), ms))
      : intro === 'city' ? CITY_SOUNDS.map(([id, ms]) => window.setTimeout(() => playSfx(id, { volume: 0.85 }), ms)) : [];
    const open = (): void => { chargingRef.current = false; openedAt.current = recruit ? performance.now() : 0; setCharging(false); };
    let shown = window.setTimeout(open, chargeMs);
    // 걷는 중에 누르면 곧장 번쩍으로 — 걸음은 끊고, 축하음은 그 자리(4.6초)부터 다시 튼다. 한 번만
    let skippedOnce = false;
    skipRef.current = (): void => {
      const at = performance.now() - t0;
      if (!recruit || skippedOnce || at < RECRUIT_SKIP_FROM_MS || at >= RECRUIT_SKIP_TO_MS) return;
      skippedOnce = true;
      window.clearTimeout(shown);
      shown = window.setTimeout(open, chargeMs - RECRUIT_SKIP_TO_MS);
      stepTimers.forEach((c) => window.clearTimeout(c));
      window.clearTimeout(stepFade);
      steps.forEach((el) => fades.push(fadeOut(el, 120)));
      main?.pause();
      if (sound) playSfx(sound, { from: RECRUIT_SKIP_TO_MS / 1000 });
      setSkipped(true);
    };
    // 아무 키나 — 무대가 열리고 한 박자 뒤부터 듣는다(열리는 순간 눌려 있던 키는 넘긴다)
    let on = false;
    const arm = window.setTimeout(() => { on = true; }, chargeMs + 250);
    const onKey = (e: KeyboardEvent): void => {
      if (!on || e.repeat) return;
      e.preventDefault();
      leave();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(shown); window.clearTimeout(arm); clangs.forEach((c) => window.clearTimeout(c));
      stepTimers.forEach((c) => window.clearTimeout(c)); window.clearTimeout(stepFade);
      fades.forEach((f) => window.clearInterval(f)); steps.forEach((el) => el.pause());
      skipRef.current = () => {};
      window.removeEventListener('keydown', onKey);
    };
    // 걷는 사람(`walkers`)은 열린 동안 같은 판이라 다시 돌리지 않는다
  }, [sound, intro, tier, chargeMs, leave, recruit]);

  if (charging && intro === 'forge') {
    return (
      <div className="modal-back cel-back" data-phase="charge" data-intro="forge" aria-hidden>
        <div className="cel-charge cin-forge">
          <div className="cin-stage">
            <div className="cin-rig">
              <img className="cin-anvil" src="ui/intro-forge-anvil.png" alt="" />
              <img className="cin-hammer" src="ui/intro-forge-hammer.png" alt="" />
            </div>
            {FORGE_STRIKES_MS.map((_, i) => (
              <i key={i} className="cin-hit" data-n={i + 1}>
                <img className="cin-sparks" src="ui/intro-forge-sparks.jpg" alt="" />
                <img className="cin-flash" src={`ui/intro-forge-flash-${i + 1}.jpg`} alt="" />
              </i>
            ))}
          </div>
          <span className="cin-whiteout" />
        </div>
      </div>
    );
  }

  if (charging && intro === 'city') {
    // 자리 · 시각은 전부 CSS(`.cic-*`)에 있다 — 그림 안의 비율로 잰 값이라 그쪽 주석에 함께 적었다
    return (
      <div className="modal-back cel-back" data-phase="charge" data-intro="city" aria-hidden>
        <div className="cel-charge cin-city">
          <div className="cic-world">
            <div className="cic-shake">
              <img className="cic-bg" src="ui/intro-city-bg.jpg" alt="" />
              <div className="cic-drop">
                <i className="cic-drop-rope" />
                <img className="cic-dragon" src="ui/intro-city-dragon.png" alt="" />
              </div>
              <i className="cic-dust" />
              <img className="cic-crane" src="ui/intro-city-crane.png" alt="" />
              <img className="cic-gear" src="ui/intro-city-gear.png" alt="" />
              <div className="cic-hang">
                <i className="cic-rope" />
                <img className="cic-load" src="ui/intro-city-load.png" alt="" />
              </div>
              <img className="cic-glint" src="ui/intro-city-glint.jpg" alt="" />
              <img className="cic-rays" src="ui/intro-city-rays.jpg" alt="" />
            </div>
          </div>
          <span className="cic-sun" />
          <span className="cin-whiteout" />
        </div>
      </div>
    );
  }

  if (charging && recruit) {
    return <RecruitIntro walkers={walkers!} skipped={skipped} onSkip={() => skipRef.current()} />;
  }

  if (charging && (intro === 'academy' || intro === 'academyDipper' || intro === 'academyWeb')) {
    return <StarIntro intro={intro} plan={STAR_PLANS[intro]} />;
  }

  if (charging) return <SwirlCharge tier={tier} />;

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
        {(art || badge || cast) && (
          <div className="cel-stage">
            <BlinkGlow tone={tone} className="cel-rays" burst />
            {art && <div className="cel-art">{art}</div>}
            {badge && <div className="cel-badge">{badge}</div>}
            {cast && <div className="cel-cast">{cast}</div>}
          </div>
        )}
        {title && <FitLine className="modal-ttl cel-ttl" field="doneTitle" text={title} />}
        {typeof big === 'string'
          ? <FitLine className="cty-done-lv cel-big" field={bigField} text={big} />
          : big != null && <div className="cel-big cel-big-node" data-field={bigField}>{big}</div>}
        {children}
        <p className="cel-tap">{t('celebrate.tap')}</p>
      </div>
    </div>
  );
}

/** 세 빛 나선 모음 — 큰 급은 5초, 작은 급은 0.9초(`data-tier`) */
function SwirlCharge({ tier }: { tier: CelebrateTier }): React.JSX.Element {
  return (
    <div className="modal-back cel-back" data-phase="charge" data-tier={tier} aria-hidden>
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

/**
 * 모음만 — 무대 대신 제 판을 띄우는 자리가 앞에 붙인다(2026-11-22 기획자): 장터 아이템 구매(작은 급, 0.9초 뒤 「구매 완료」 판) ·
 * 8연 뽑기(큰 급, 5초 뒤 섬광 여덟). 축하음을 같은 박자로 틀고(작은 급은 「쾅」 앞부터), 다 모으면 `onDone`. 배경 음악은 건드리지 않는다.
 */
export function CelebrateCharge({ tier, onDone, sound = 'celebrate' }: {
  tier: CelebrateTier;
  onDone: () => void;
  sound?: SfxId | null;
}): React.JSX.Element {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (sound) playSfx(sound, { from: SOUND_FROM[tier] });
    const id = window.setTimeout(() => done.current(), CHARGE_MS_OF[tier]);
    return () => window.clearTimeout(id);
  }, [tier, sound]);
  return <SwirlCharge tier={tier} />;
}
