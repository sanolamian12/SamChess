/**
 * 격언 두루마리 — 긴 로딩 화면의 가운데 (pptx 74쪽, 2026-09-18)
 *
 * ```
 *   ┌═╗                         ╔═┐
 *   │ ║  몽매함으로 바름을 기른다, ║ │
 *   │ ║  현명한 지혜를 감추고 …    ║ │
 *   │ ║        – 주역, 몽괘  [印] ║ │
 *   └═╝                         ╚═┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 펴지는 0.6초 — 세 칸을 0.2초씩, 점점 짙게 (기획자 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * | 칸 | 그림 | 투명도 | 불투명도 |
 * |---|---|---|---|
 * | 0.0~0.2초 | `scroll-open-1` | 75% | .25 |
 * | 0.2~0.4초 | `scroll-open-2` | 50% | .5 |
 * | 0.4~0.6초 | `scroll-open-3` | 25% | .75 |
 * | 0.6초~ | `scroll` (다 편 것) | 0% | 1 |
 *
 * 「투명도」는 파워포인트의 뜻(얼마나 **비치는가**)으로 읽었다 — 그래야 펴질수록
 * 짙어져 끝에 온전한 두루마리로 닿는다. 네 장은 **같은 캔버스에 겹쳐 두고** 시간표만
 * CSS가 쥔다(`style.css`의 `.srl` 절). `src`를 갈아 끼우면 칸마다 디코딩이 한 박자
 * 늦어 빈 칸이 비친다 — 고유기술 두루마리(`ui/skillFx.ts`)가 같은 이유로 겹쳐 둔다.
 *
 * ────────────────────────────────────────────────────────────────
 * 글은 8초에 한 번, 페이드 인·아웃
 * ────────────────────────────────────────────────────────────────
 *
 * 문장마다 `key`가 바뀌어 **새로 붙으므로** CSS 애니메이션(8초: 들어오고·머물고·
 * 나간다)이 처음부터 다시 돈다 — 시계와 화면이 따로 도는 두 타이머가 아니다.
 * 문장이 **하나뿐이면 돌리지 않는다**(같은 글이 8초마다 깜빡이기만 한다).
 */
import { useEffect, useState } from 'react';
import { LOADING_QUOTES, QUOTE_MS, quoteAt } from './loadingQuotes.ts';

export function QuoteScroll(): React.JSX.Element {
  const quotes = LOADING_QUOTES;
  /** 시작 문장 — 한 번 굴린다(`quoteAt` 머리말) */
  const [start] = useState(() => Math.floor(Math.random() * Math.max(1, quotes.length)));
  const [step, setStep] = useState(0);
  const cycle = quotes.length > 1;

  useEffect(() => {
    if (!cycle) return undefined;
    const id = setInterval(() => setStep((s) => s + 1), QUOTE_MS);
    return () => clearInterval(id);
  }, [cycle]);

  const quote = quoteAt(quotes, start, step);

  return (
    <figure className="srl" data-field="quoteScroll" aria-live="polite">
      <img className="srl-open" data-n="1" src="ui/scroll-open-1.png" alt="" />
      <img className="srl-open" data-n="2" src="ui/scroll-open-2.png" alt="" />
      <img className="srl-open" data-n="3" src="ui/scroll-open-3.png" alt="" />
      <img className="srl-full" src="ui/scroll.png" alt="" />
      <div className="srl-paper">
        {quote && (
          <blockquote key={step} className="srl-quote" data-cycle={cycle ? '1' : '0'} data-field="quote">
            <p className="srl-text">{quote.text}</p>
            <cite className="srl-src">– {quote.source}</cite>
          </blockquote>
        )}
      </div>
      {/* 붉은 도장 — 「내 정보」 인장과 같은 그림(`icons/seal-mine.png` ← `seal_mine2.png`) */}
      <img className="srl-seal" src="icons/seal-mine.png" alt="" />
    </figure>
  );
}
