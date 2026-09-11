/**
 * 병기 그림 한 장 — **액자 → 후광 → 사진** 세 겹을 쌓은 상자.
 *
 * 세 화면이 **같은 그림**을 쓴다(2026-09-11): 대장간 제작 목록 카드
 * (`.frg-tile`, 큰 액자), 장수 카드의 「낀 병기」 줄(`ofcard-bar-equip`,
 * 얇은 액자). 두 자리에 따로 적으면 품목별 크기 보정
 * (`.frg-tile-photo[data-item=…]`, 여섯 그림을 재서 잡은 값)이 한쪽에만
 * 남는다 — 클래스를 그대로 물려주므로 그 보정이 저절로 따라온다.
 *
 * **화면(`screens/`) 밖으로 뺀 이유** — `RankingCommon`이 `ForgeScreen`을
 * 부르면 `ForgeScreen → OfficerListScreen → RankingCommon`이 고리가 된다.
 * 그림 한 장은 어느 화면의 것도 아니므로 제 파일에 둔다.
 */
import type { EquipmentData } from '@samchess/data';

/** 해금 레벨 → 회전 스프라이트 색(기획 지정, `assets/blacksmith/lightEffect_lv*.png`
    파일명 그대로 — 등급처럼 값을 새로 매기지 않고 이미 있는 매핑을 읽는다). */
const GLOW_COLOR: Record<number, string> = { 1: 'silver', 2: 'green', 3: 'blue', 4: 'purple', 5: 'gold' };

/**
 * 무기 그림 뒤로 앉는 후광 — `assets/blacksmith/lightEffect_lv{1..5}_{색}.png`
 * (2026-09-09 열여덟 번째 팔로업부터 낱장 그림 한 장이다 — 6×4 격자 스프라이트
 * 시트였던 옛 버전은 CSS `transform: rotate()`로 대체했다, `style.css`의
 * `.frg-item-glow` 참조). 상세 패널에서는 계속 돌고, 제작 목록 카드에서는
 * `.frg-tile-glow`로 **회전 없이 정지 이미지**로 쓴다(열여덟 번째 팔로업 —
 * "이 화면에서는 애니메이션처럼 안 움직이고 정지 이미지를") — `className`으로
 * 어느 상자·회전 여부를 쓸지 가른다.
 */
export function GlowLayer({ level, className = 'frg-item-glow' }: { level: number; className?: string }): React.JSX.Element {
  const color = GLOW_COLOR[level] ?? 'silver';
  return <div className={className} style={{ backgroundImage: `url(blacksmith/lightEffect_lv${level}_${color}.png)` }} />;
}

/**
 * 품목 그림 한 장 — **액자 → 후광(정지) → 사진** 세 겹을 쌓은 상자.
 *
 * 제작 목록 카드(`.frg-tile`)와 장수 카드의 「낀 병기」 줄이 **같은 그림**을
 * 쓴다. 두 자리에 따로 적으면 품목별 크기 보정
 * (`.frg-tile-photo[data-item=…]`, 여섯 그림을 재서 잡은 값)이 한쪽에만 남는다 —
 * 클래스를 그대로 물려주므로 그 보정이 저절로 따라온다. 크기는 바깥 상자가
 * 정한다(`.frg-tile-frame`은 `width: 100%`, 줄에서는 `.frg-thumb`가 좁힌다).
 */
export function ItemThumb({ item, variant = 'card' }: { item: EquipmentData; variant?: 'card' | 'row' }): React.JSX.Element {
  const photo = (
    <img
      src={`blacksmith/${item.id}.png`}
      alt=""
      className="frg-tile-photo"
      data-kind={item.kind}
      data-item={item.id}
    />
  );
  /*
   * 줄용은 **액자 그림이 없다**(2026-09-11 — "아주 얇은 걸 적용해야겠어,
   * `stat_frame_raw.png`"). `frame_item_list.png`는 검정 캔버스까지 그려진
   * 한 장이라 3:1로 눕히면 캔버스째 늘어난다 — 얇은 테두리는 9분할
   * (`border-image`)이라야 모서리가 안 뭉개진다. 그래서 검정은 **상자의
   * 배경색**이 지고 테두리만 그림이 진다(`.frg-thumb`, `style.css`).
   * 사진·후광 클래스는 카드와 **같은 것을 그대로 쓴다** — 품목별 크기 보정
   * (`.frg-tile-photo[data-item=…]`)이 따라오게 하려는 것이고, 자리·크기만
   * `.frg-thumb` 안에서 덮어쓴다.
   */
  if (variant === 'row') {
    return (
      <span className="frg-thumb">
        <GlowLayer level={item.unlockLevel} className="frg-tile-glow" />
        {photo}
      </span>
    );
  }
  return (
    <span className="frg-tile-frame">
      <img src="blacksmith/frame_item_list.png" alt="" className="frg-tile-frame-art" />
      <GlowLayer level={item.unlockLevel} className="frg-tile-glow" />
      {photo}
    </span>
  );
}


