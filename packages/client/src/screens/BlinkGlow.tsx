/**
 * 섬광 후광 — 장수 · 병기 · 시장 아이템 그림 뒤에 앉는 별빛 (2026-10-23 기획자 지정).
 *
 * 예전에는 대장간의 둥근 후광(`blacksmith/lightEffect_lv{1..5}_{색}.png`)을 레벨 · 등급 색에 맞춰 돌렸는데 어색해 보여서,
 * **가입 오프닝의 장수 등장 섬광**(`.ngo-member::after` — `ui/glow-blink.png`)을 그대로 빌렸다. 꼴은 셋뿐이다:
 *
 * | 색 | 장수 | 병기 · 시장 아이템 |
 * |---|---|---|
 * | 금(`glow-blink-gold`) | E급(황제) | 최고 레벨 |
 * | 자주(`glow-blink-purple`) | S급 | 최고 레벨 바로 아래(지금 Lv4) |
 * | 흰 별빛(`glow-blink`) | 나머지 전부 | 나머지 전부 |
 *
 * 최고 레벨은 숫자로 적지 않고 데이터(`EQUIPMENT` · `MARKET_ITEMS`의 `unlockLevel`)에서 낸다 — 표가 늘면 따라온다.
 * 그림은 `tools/build_ui.py`의 `GLOWS`가 `assets/icons/blink*.{jpg,png}`를 밝기 = 투명도로 굽는다.
 *
 * 움직임은 오프닝을 따른다 — 천천히 한 바퀴(14초) 돌면서 커졌다 작아졌다(2.8초). `burst`면 나타나는 순간 한 번 크게 번쩍
 * (`.ngo-member::before`와 같은 `ngo-glint`). **목록 칸도 돈다**(2026-10-23 — 2026-09-09의 「목록은 정지」를 뒤집었다).
 * 부하는 섬광 31개 · CPU 6배 감속에서도 60fps였다 — 회전 · 맥동을 `transform` 한 애니메이션으로 합친 이유는 `style.css`의 `.blink-halo`.
 *
 * 자리 · 크기는 부르는 쪽의 클래스(`className`)가 정한다 — 그 상자의 한가운데에 섬광이 서고, 폭은 `--blink-w`(상자 폭의 배수)다.
 */

import { EQUIPMENT, MARKET_ITEMS } from '@samchess/data';
import type { Grade } from '@samchess/rules';

export type BlinkTone = 'plain' | 'purple' | 'gold';

const FILE: Record<BlinkTone, string> = {
  plain: 'ui/glow-blink.png', purple: 'ui/glow-blink-purple.png', gold: 'ui/glow-blink-gold.png',
};

/** 장수 등급 → 색. E급(황제)만 금, S급만 자주, 나머지는 흰 별빛 */
export const officerBlink = (grade: Grade | string): BlinkTone =>
  grade === 'E' ? 'gold' : grade === 'S' ? 'purple' : 'plain';

const EQUIP_MAX = Math.max(...EQUIPMENT.map((e) => e.unlockLevel));
const ITEM_MAX = Math.max(...MARKET_ITEMS.map((m) => m.unlockLevel));

const levelBlink = (level: number, max: number): BlinkTone =>
  level >= max ? 'gold' : level === max - 1 ? 'purple' : 'plain';

/** 대장간 병기 — 최고 레벨 금, 그 아래 한 칸 자주 */
export const equipBlink = (unlockLevel: number): BlinkTone => levelBlink(unlockLevel, EQUIP_MAX);
/** 시장 아이템 — 최고 레벨 금, 그 아래 한 칸 자주 */
export const itemBlink = (unlockLevel: number): BlinkTone => levelBlink(unlockLevel, ITEM_MAX);

export function BlinkGlow({ tone, className, burst = false }: {
  tone: BlinkTone;
  /** 자리 · 크기를 정하는 상자 클래스 */
  className: string;
  /** 나타나는 순간 한 번 번쩍 — 공개 연출 */
  burst?: boolean;
}): React.JSX.Element {
  const art = { backgroundImage: `url(${FILE[tone]})` };
  return (
    <span className={`blink-box ${className}`} data-blink={tone} aria-hidden>
      {burst && <span className="blink-burst" style={art} />}
      <span className="blink-halo" style={art} />
    </span>
  );
}
