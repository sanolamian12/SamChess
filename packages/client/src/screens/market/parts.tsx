/**
 * 장터의 공용 조각 (2026-09-24, pptx 75~88쪽).
 *
 * - **섬광**(`BurstStage`) — 뽑기 직후 등급색으로 터진다. 그림은 `tools/build_burst.py`가
 *   그려 굽는 24칸 시트다(옛 `reveal-*.png` 4칸을 대신한다 — 그 도구 머리말 참조).
 * - **후광**(`Halo`) — A·S·E만. 대장간의 후광 그림을 빌리고 **돌면서 부풀었다 줄어든다**.
 * - **판 둘** — 「이뤘다」는 붉은 금박 판(`panel-done`, 도시 증축 축하와 같은 그림),
 *   「확정할까」는 중립 판(`panel-settings`, 대장간 확인과 같은 그림). 같은 뜻이면 같은 그림이다.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Grade } from '@samchess/rules';
import { RECYCLE_CARDS_IN, recyclableCards, recycleSources } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { t } from '../../i18n/index.ts';

// ── 팝업 층 ────────────────────────────────────────────────────

/**
 * 팝업이 뜨는 자리 — **화면(`.scr`)의 바로 밑**이다.
 *
 * ★ 판들은 `.place-body` 안에서 그려지는데, 배경 화면 규칙(`.scr-bg > *`)이 그 몸통에
 * `position: relative`를 걸어 **가리개(`.modal-back`)가 화면이 아니라 몸통만 덮었다** —
 * 제목 바가 안 어두워지고 팝업이 몸통 가운데에 앉았다(`smoke:meta`의 「화면을 덮는가」가
 * 잡았다, CLAUDE.md의 「배경 위 팝업」 절과 같은 자리). 대장간은 팝업을 화면의 직계 자식으로
 * 두어 피하는데, 장터는 판이 파일 셋으로 갈려 있어 **포털**로 같은 자리에 올린다.
 */
export const LayerContext = createContext<HTMLElement | null>(null);

export function Layer({ children }: { children: React.ReactNode }): React.JSX.Element {
  const el = useContext(LayerContext);
  return el ? createPortal(children, el) : <>{children}</>;
}

// ── 섬광 ───────────────────────────────────────────────────────

/** `tools/build_burst.py`의 `COLS`·`ROWS`와 같은 값이어야 칸이 안 밀린다 */
const BURST_COLS = 6;
const BURST_ROWS = 4;
const BURST_FRAMES = BURST_COLS * BURST_ROWS;
/** 한 칸의 시간 — 24칸 × 46ms ≈ 1.1초. 도구와 공유하지 않는다(순전히 화면의 느낌이다) */
const BURST_FRAME_MS = 46;
/** 여덟 섬광이 차례로 터지는 간격 */
const BURST_STAGGER_MS = 120;

/** 가챠 등급 → 시트 글자. 가챠에는 C·D가 없다(`gachaGrades`) — 혹시 오면 가장 수수한 B로 */
const burstKey = (grade: Grade): string => (grade === 'S' || grade === 'A' || grade === 'E' ? grade.toLowerCase() : 'b');

/** 여덟 섬광의 자리(화면 비율) — 겹치되 한곳에 몰리지 않게 손으로 흩었다 (79쪽 가운데) */
const SCATTER: readonly [number, number, number][] = [
  [30, 24, 1.0], [70, 20, .95], [50, 42, 1.15], [24, 55, 1.0],
  [76, 52, 1.05], [38, 74, .95], [66, 78, 1.0], [50, 62, .9],
];

function Burst({ grade, delay, style }: { grade: Grade; delay: number; style?: React.CSSProperties }): React.JSX.Element {
  const [frame, setFrame] = useState(-1);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number): void => {
      const f = Math.floor((now - start) / BURST_FRAME_MS);
      setFrame(f < 0 ? -1 : Math.min(f, BURST_FRAMES));
      if (f < BURST_FRAMES) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [delay]);
  if (frame < 0 || frame >= BURST_FRAMES) return <span className="mkt-burst" style={{ ...style, visibility: 'hidden' }} />;
  const col = frame % BURST_COLS;
  const row = Math.floor(frame / BURST_COLS);
  return (
    <span
      className="mkt-burst"
      data-grade={grade}
      data-frame={frame}
      style={{
        ...style,
        backgroundImage: `url(market/burst-${burstKey(grade)}.webp)`,
        backgroundPosition: `${(col * 100) / (BURST_COLS - 1)}% ${(row * 100) / (BURST_ROWS - 1)}%`,
      }}
    />
  );
}

/**
 * 섬광 무대 — 한 장이면 가운데 하나를 크게(78쪽), 여러 장이면 **장마다 제 등급색으로**
 * 흩어져 터진다(79쪽). 다 터지면 `onDone`. 눌러서 건너뛸 수 있다 — 같은 연출을 매번
 * 끝까지 보게 하면 두 번째부터는 기다림이다. 효과음은 무대가 아니라 부르는 쪽이 튼다
 * (단발·8연이 서로 다른 소리다) — 무대는 `lead`로 소리와 박자만 맞춘다.
 */
export function BurstStage({ grades, onDone, lead = 0 }: {
  grades: readonly Grade[];
  onDone: () => void;
  /**
   * 첫 섬광까지 기다리는 ms — 소리를 먼저 틀고 그 뒤에 터지게 할 때(단발: 효과음 1.5초 뒤,
   * 2026-09-24 지정). 그동안 무대는 어둡게 깔려 있고, 눌러서 건너뛸 수 있다.
   */
  lead?: number;
}): React.JSX.Element {
  const done = useRef(onDone);
  done.current = onDone;
  const total = lead + (grades.length - 1) * BURST_STAGGER_MS + BURST_FRAMES * BURST_FRAME_MS + 120;
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), total);
    return () => window.clearTimeout(id);
  }, [total]);
  const one = grades.length === 1;
  return (
    <Layer>
    <div className="mkt-burst-stage" data-modal="burst" data-count={grades.length} onClick={() => done.current()}>
      {/* 첫 섬광이 가장 밝은 순간(t≈0.16)에 화면이 하얗게 한 번 번쩍인다 */}
      {/* 번쩍임도 첫 섬광에 맞춰 민다 — CSS의 `.12s`(가장 밝은 순간)에 `lead`를 더한다 */}
      <span className="mkt-flash" style={lead ? { animationDelay: `${lead + 120}ms` } : undefined} />
      {one
        ? <Burst grade={grades[0]!} delay={lead} style={{ left: '50%', top: '46%', width: 'min(92%, 26rem)' }} />
        : grades.map((g, i) => {
          const [x, y, s] = SCATTER[i % SCATTER.length]!;
          return <Burst key={i} grade={g} delay={lead + i * BURST_STAGGER_MS} style={{ left: `${x}%`, top: `${y}%`, width: `min(${56 * s}%, ${14 * s}rem)` }} />;
        })}
    </div>
    </Layer>
  );
}

// ── 후광 ───────────────────────────────────────────────────────

/** 등급 → 대장간 후광 그림(기획자 지정 2026-09-24). B 이하는 후광이 없다 */
const HALO: Partial<Record<Grade, string>> = {
  A: 'lightEffect_lv3_blue', S: 'lightEffect_lv4_purple', E: 'lightEffect_lv5_gold',
};

/** 장수 그림 뒤의 후광 — 돌면서 부풀었다 줄어든다(대장간 상세는 돌기만 한다) */
export function Halo({ grade }: { grade: Grade }): React.JSX.Element | null {
  const art = HALO[grade];
  if (!art) return null;
  return <span className="mkt-halo" data-grade={grade} style={{ backgroundImage: `url(blacksmith/${art}.png)` }} />;
}

// ── 판 둘 ──────────────────────────────────────────────────────

/** 「이뤘다」 판 — 붉은 금박(`panel-done`). 가리개를 눌러도 닫힌다. `title`이 없으면 제목 줄도 없다 */
export function DoneModal({ title, field, onClose, children, actions }: {
  title: React.ReactNode | null;
  field: string;
  onClose: () => void;
  children: React.ReactNode;
  actions: React.ReactNode;
}): React.JSX.Element {
  return (
    <Layer>
    <div className="modal-back" data-modal={field} onClick={onClose}>
      <div className="modal mkt-done" onClick={(e) => e.stopPropagation()}>
        {title !== null && <p className="modal-ttl">{title}</p>}
        <div className="mkt-done-body">{children}</div>
        <div className="mkt-done-acts">{actions}</div>
      </div>
    </div>
    </Layer>
  );
}

/** 「확정할까」 판 — 중립(`panel-settings`). [확정]이 위, [뒤로 가기]가 아래(대장간 확인과 같은 순서) */
export function ConfirmModal({ title, field, onConfirm, onClose, okLabel, disabled, className, children }: {
  title: string;
  field: string;
  onConfirm: () => void;
  onClose: () => void;
  okLabel?: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Layer>
    <div className="modal-back" data-modal={field} onClick={onClose}>
      <div className={`modal mkt-confirm${className ? ` ${className}` : ''}`} onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{title}</p>
        <div className="mkt-confirm-body">{children}</div>
        <div className="mkt-confirm-acts">
          <button className="btn primary wide" data-action="confirmOk" disabled={disabled} onClick={onConfirm}>
            {okLabel ?? t('market.confirm.ok')}
          </button>
          <button className="btn wide" data-action="confirmCancel" onClick={onClose}>{t('market.backHome')}</button>
        </div>
      </div>
    </div>
    </Layer>
  );
}

/**
 * 금화 한 닢 + 값 — 「🪙10냥」처럼 글자 사이에 끼운다. `times`면 「🪙 × 10」 —
 * 단위 글자 없이 닢 그림이 단위 노릇을 한다([다시 뽑기], 2026-09-24 지정).
 */
export function GoldCost({ gold, times }: { gold: number; times?: boolean }): React.JSX.Element {
  return (
    <span className="mkt-gold">
      <img src="market/gold.png" alt={t('market.gold')} />
      {times ? ` × ${gold}` : t('market.pull.cost', { gold })}
    </span>
  );
}

// ── 장수 카드 셈 ───────────────────────────────────────────────

/**
 * 「합 n장 · 정리 가능 m장」 — 장터 현황판과 용병 시장 머리 판이 **함께** 부른다.
 * 정리 가능은 규칙(`recycleSources()`·`recyclableCards()`)이 정한 것을 단위(3장)로 내려
 * 더한다. 화면이 「3장 이상」을 다시 세거나 두 판이 따로 세면 한쪽만 낡는다.
 */
export function cardTally(profile: PlayerProfile): { held: number; recyclable: number } {
  const held = Object.values(profile.cards).reduce<number>((n, c) => n + (c ?? 0), 0);
  const recyclable = recycleSources(profile).reduce(
    (n, id) => n + Math.floor(recyclableCards(profile, id) / RECYCLE_CARDS_IN) * RECYCLE_CARDS_IN, 0,
  );
  return { held, recyclable };
}

// ── 서버 왕복 ──────────────────────────────────────────────────

/**
 * 서버 왕복 한 번 — **두 번 못 누르게** 막고(누르면 금화를 두 번 낸다), 못 닿으면
 * **로컬로 물러나지 않고 말한다**(장터가 쓰는 것은 전부 서버 소유 필드다 — 물러나면
 * 금화만 사라진다). 거절한 말은 규칙이 한 말 그대로 올린다.
 */
export type ServerCall = (
  call: () => Promise<PlayerProfile | null>,
  after?: (next: PlayerProfile) => void,
) => void;

export function useServerCall(onChange: (next: PlayerProfile) => void): {
  busy: boolean; note: string | null; setNote: (n: string | null) => void; run: ServerCall;
} {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inFlight = useRef(false);
  const run: ServerCall = (call, after) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    void (async () => {
      try {
        const next = await call();
        if (!next) { setNote(t('server.offline')); return; }
        onChange(next);
        after?.(next);
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  };
  return { busy, note, setNote, run };
}
