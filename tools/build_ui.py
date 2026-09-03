#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""icons/ 의 UI 소재(입력 필드·버튼 프레임·아이콘·간판 배경)를 웹용으로 굽는다.

    python tools/build_ui.py [--force] [--sheet 대조.png]

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `textfield.png` | `public/ui/field-frame.png` | `.field` 배경 (두루마리 프레임) |
| `button_primary.png` | `public/ui/btn-primary.png` | `.btn.primary` 배경 (옥색 목판) |
| `button_secondary.png` | `public/ui/btn-secondary.png` | `.btn`(기본) 배경 (참나무 목판) |
| `button_ghost.png` | `public/ui/btn-ghost.png` | `.btn.ghost` 배경 (대나무 테두리) |
| `button_settings.png` 등 6종 | `public/icons/{id}.png` 128² | 아이콘 버튼 — `settings`만 화면에 붙었다(아래 참조) |
| `panel_settings.png`·`plate_settings.png`·`chip_*.png` | `public/ui/…` | 환경설정 팝업 (2026-08-25) |
| `panel_skill_a_b.png`·`panel_skill_s_e.png` | `public/ui/panel-skill-{ab,se}.png` | 고유기술 팝업 배경 — 등급별 차등(2026-09-03) |
| `panel_ledger.png`·`plate_wide.png` | `public/ui/panel-ledger.png`·`plate-wide.png` | 랭킹 표·「내 정보」 패널 · 화면 제목 바 (2026-08-27) |
| `medal_*.png`·`seal_mine2.png`·`tab_*.png`·`icon_search.png` | `public/icons/{id}.png` 128² | 랭킹 1·2·3위 메달 · 「내 정보」 인장 · 랭킹 메뉴 3아이콘 · 검색 (2026-08-27) |
| `create_city.png`/`.jpg` | `public/backgrounds/new-city.jpg` | 도시 이름 짓기 화면 배경 |
| `stamp2.png`(3프레임 스프라이트) | `public/icons/levelup-stamp.png` | 레벨업 대상 도장 애니메이션 — `.ofc-levelup-seal` (2026-09-02, `stamp.png`에서 교체) |

프레임 3종·필드 1종은 `assets/market/`의 아이콘류와 같은 이유로 **알파 경계상자로
트리밍만** 한다(9분할은 안 한다) — `build_frames.py`의 카드 액자와 달리 이 그림들은
이미 그 자체로 독립된 완성 에셋(양피지·목판이 캔버스에 꽉 차 있다)이라 자를 조각이
따로 없다. **9분할은 CSS 쪽(`border-image`)이 그림을 그대로 받아서 한다** — 카드
액자처럼 Python이 미리 아홉 조각으로 잘라 붙일 필요가 없다(원본에 카드 액자의
`person.png`처럼 무관한 요소가 섞여 있지 않다).

아이콘 6종은 `assets/market/`의 아이콘과 같은 방식(알파 경계상자 → 정사각 채움 →
축소)으로 굽는다. **`settings`만 화면에 붙었다** (2026-08-26, `ScreenChrome`의
기어 버튼) — `<img src="icons/settings.png">`가 404면 예전의 인라인 SVG
(`GearIcon`)로 물러난다(에셋을 못 받은 사람 화면에서 설정 버튼 자체가 사라지면
안 되므로, 이유는 `ScreenChrome.tsx`의 주석 참조). 나머지 다섯(뒤로·확인·닫기·
전투·기록)은 아직 들어갈 자리가 없다 — 나중에 화면이 생기면 `public/icons/`에서
가져다 쓴다.

배경(`create_city`)은 다른 배경 그림들처럼 JPG로 굽는다 — 세로로 긴 그림이라
PNG로 두면 용량이 크다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "icons"
OUT_UI = ROOT / "packages" / "client" / "public" / "ui"
OUT_ICONS = ROOT / "packages" / "client" / "public" / "icons"
OUT_BG = ROOT / "packages" / "client" / "public" / "backgrounds"

ALPHA_FLOOR = 8
"""경계상자를 잡을 때 무시할 알파. 그림자·번짐이 1~2로 깔려 있다(`build_market.py`와 같다)."""

ICON_SIZE = 128
"""아이콘 한 변(px). 작은 버튼 안에 얹을 크기라 재화 아이콘(160)보다 조금 작게 잡았다."""

FRAME_MAX_WIDTH = 960
"""필드·버튼 프레임의 폭 상한(px). 화면 폭(320~700)보다 넉넉히 커서 대부분 원본 그대로 나간다."""

BG_MAX_WIDTH = 1080
"""도시 이름 짓기 배경의 폭 상한. `backgrounds/`의 다른 화면 배경과 같은 자릿수다."""

JPEG_QUALITY = 88
"""`build_backgrounds.py`와 같은 화질 — 수채화풍이라 이 값이면 손실이 눈에 안 띈다."""

# 원본 stem(확장자 없이) → 출력 파일명. 프레임류는 그대로 트리밍만 한다.
FRAMES: dict[str, str] = {
    "textfield": "field-frame.png",
    "button_primary": "btn-primary.png",
    "button_secondary": "btn-secondary.png",
    "button_ghost": "btn-ghost.png",
    # 환경설정 팝업 전용 넷(2026-08-25 자리만 마련) — `assets/icons/`에 아직 없어도
    # 빌드는 그대로 된다(위 SRC 없을 때와 같은 「없으면 건너뛴다」). 받으면
    # `style.css`의 `.modal[data-modal="settings"]` 절에서 연결한다.
    "panel_settings": "panel-settings.png",
    "plate_settings": "plate-settings.png",
    "chip_neutral": "chip-neutral.png",
    "chip_selected": "chip-selected.png",
    # 고유기술 팝업 배경(2026-09-03, `docs/PROMPT.md`의 프롬프트로 사용자가
    # 생성해 넣는다) — `panel_settings`와 같은 자리·같은 9분할 기법
    # (`style.css`의 `.ofc-skill-modal[data-tier-group]` 절). 등급별로 두
    # 장(S+E급 / A+B급)이라 스킬의 `tier`에 따라 갈라 쓴다 — 안 받았으면
    # 여느 프레임과 같이 그냥 건너뛴다.
    "panel_skill_a_b": "panel-skill-ab.png",
    "panel_skill_s_e": "panel-skill-se.png",
    # 랭킹 3화면·장수 카드 화풍 확장(2026-08-27) — `style.css`의 「랭킹 3화면 ·
    # 장수 카드 화풍 확장」절. `panel_ledger`가 그 절의 `panel_settings.png`
    # 임시 배선을 대체하고, `plate_wide`는 `place-nm`(화면 제목 바)에 새로 붙는다.
    "panel_ledger": "panel-ledger.png",
    "plate_wide": "plate-wide.png",
    # 뒤로가기 화살표 원본을 **정사각으로 눌러 깎지 않고** 원래 비율 그대로도
    # 낸다(2026-08-27 세 번째 피드백) — 랭킹의 뒤로 버튼이 목판 배경 없이 이
    # 화살표 그림 하나로만 서는 자리라, 아래 `ICONS`의 `back`(128² 정사각,
    # 다른 화면에서 작은 아이콘으로 쓸 자리)과는 별개로 필요하다.
    "button_backarrow": "btn-backarrow.png",
    # 장수 일람의 레벨업 대상 줄 테두리 — 네 차례 돌고 **처음 그림으로
    # 되돌아왔다**(2026-09-02). `levelup_frame.png`(얇다) → `_frame2.png`
    # (`background: … 100% 100%`로 늘려 씌우다 뭉개짐) → `_frame3.png`(네
    # 귀퉁이 대칭, `border-image`로 안 뭉개지게 고쳤지만 "안 예쁘다") →
    # 다시 `levelup_frame.png`, 이번엔 `_frame3`에서 정착한 `border-image`
    # 9분할 기법 그대로(코너를 안 늘리고 테두리 선만 늘린다 — `_frame2` 때
    # 겪은 뭉개짐은 그림이 아니라 기법 탓이었다). 출력 파일명
    # (`levelup-frame.png`)은 늘 그대로다, `style.css`가 그 이름을 참조한다.
    "levelup_frame": "levelup-frame.png",
    # 레벨업 「고르기」의 HP·MP·AT 칸 테두리(2026-09-03) — 기존 목판 버튼을
    # 그대로 씌우니 가독성이 떨어진다는 피드백으로 전용 액자를 새로 받았다.
    "stat_frame_raw": "stat-frame.png",
}

# 레벨업 도장 애니메이션(2026-09-02, `stamp2.png`로 교체) — 원본 한 장에 가로로 3프레임이
# 나란히 있다("맨 왼쪽부터 순서대로 0.5초씩 재생하면 자연스러운 도장"). 프레임을
# 각자 알파 경계상자로 트리밍하면 프레임마다 잘리는 여백이 달라져 애니메이션 중에
# 도장이 미세하게 흔들린다(지터) — 그래서 `build_sprite()`는 **세 프레임의
# 합집합 상자**로 셋을 동시에 자른다(개별 트리밍이 아니다). 출력은 정사각
# 프레임 3장을 가로로 이어 붙인 한 장(`ICON_SIZE * 3` 너비) — CSS가
# `background-size: 300% 100%` + `steps(3)`로 되감는다(`style.css`의
# `.ofc-levelup-seal` 참조). id는 `.ofc-levelup-seal`이 참조하는 이름 그대로
# `levelup-stamp`로 둔다(기존 정적 `seal-mine`과는 별개 파일 — 그건 "내 정보"
# 인장으로 여전히 그대로 쓴다).
SPRITES: dict[str, tuple[str, int]] = {
    "stamp2": ("levelup-stamp", 3),
}

# **한 쌍으로 겹쳐 그린 프레임은 따로 안 자른다.** `chip_neutral`·`chip_selected`는
# 같은 600×398 캔버스에, 같은 자리에, 같은 여백으로 그려져 있다(포토샵에서 겹쳐
# 확인됨, 2026-08-25) — 즉 원본이 이미 짝이 맞는다. 그런데 알파 경계상자로 각자
# 따로 트리밍하면 옥색 칩 바깥의 은은한 빛번짐(glow)이 알파 8보다 높아 상자에
# 걸리는 정도가 그림마다 달라지고, 그 결과 두 PNG의 최종 크기·종횡비가 달라져서
# 화면에서 배경음악·화면 모드 줄의 두 칩 높이가 어긋났다(처음엔 「번짐만 문턱값을
# 높여 잘라내면 된다」고 고쳤는데, 그러면 원본이 이미 맞춰 둔 짝을 다시 깨뜨린다 —
# 트리밍 자체를 건너뛰는 게 맞다). `FRAMES`의 나머지(필드·버튼·패널·명패)는
# 하나씩 독립된 그림이라 여전히 알파 경계상자로 여백을 접는다.
FRAME_NO_TRIM: set[str] = {"chip_neutral", "chip_selected"}

# 원본 stem → 아이콘 id. `_justicon`처럼 남은 접미사도 여기서 흡수한다.
ICONS: dict[str, str] = {
    "button_settings": "settings",
    "button_backarrow": "back",
    "button_close": "close",
    "button_confirm": "confirm",
    "button_sword-cross": "battle",
    "button_scroll_justicon": "records",
    # 랭킹 3화면·장수 카드 화풍 확장(2026-08-27) — `style.css`의 「랭킹 3화면 ·
    # 장수 카드 화풍 확장」절이 이 여덟(위 둘 + 이 여섯)을 배선한다.
    "medal_gold": "medal-gold",
    "medal_silver": "medal-silver",
    "medal_bronze": "medal-bronze",
    # 원본이 `seal_mine.png` → `seal_mine2.png`로 이름이 바뀌었다(2026-08-27,
    # 사용자가 "파일명이 헷갈릴 수 있다"며 새 이름으로 다시 올렸다) — 출력
    # id(`seal-mine`)는 그대로 둔다, `style.css`가 그 이름을 참조한다.
    "seal_mine2": "seal-mine",
    "tab_city": "tab-city",
    "tab_squad": "tab-squad",
    "tab_officer": "tab-officer",
    "icon_search": "search",
    # 장수 카드의 삼능력 줄(무력·지력·통솔) — 번역마다 낱말 길이가 달라 줄바꿈이
    # 들쭉날쭉하던 것을 언어 중립적인 아이콘으로 바꾼다(2026-08-27 열일곱 번째
    # 지정). 검은 배경이 박혀 있던 첫 시도를 알파 있는 금테 프레임과 합성해
    # 고쳤었는데(`stat_might.png` 등, `stat_frame_raw` 합성본), **테두리가
    # 그림 자리를 너무 먹어 물체가 작아 보인다**는 열여덟 번째 피드백으로
    # 프레임 없이 원본(`_raw`)을 그대로 쓴다 — 정사각 캔버스 안에서 물체가
    # 차지하는 비율이 더 크다. 프레임 합성본(`stat_might.png` 등)은 이제 이
    # 매핑에서 안 쓰지만 자산 폴더에는 남아 있다(다시 필요해지면 되돌리기 쉽게).
    "stat_might_raw": "stat-might",
    "stat_intellect_raw": "stat-intellect",
    "stat_leadership_raw": "stat-leadership",
}

# 배경 원본은 확장자가 오갈 수 있어(png→jpg로 다시 받는 식) 둘 다 찾아본다.
BACKGROUND_CANDIDATES = ["create_city.png", "create_city.jpg"]


def load(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.array(im.convert("RGBA"))


def bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    """`(top, left, bottom, right)` — 알파가 있는 최소 사각형. 끝은 배타적이다."""
    rows = np.where(alpha.max(axis=1) > ALPHA_FLOOR)[0]
    cols = np.where(alpha.max(axis=0) > ALPHA_FLOOR)[0]
    if rows.size == 0 or cols.size == 0:
        return 0, 0, alpha.shape[0], alpha.shape[1]
    return int(rows[0]), int(cols[0]), int(rows[-1]) + 1, int(cols[-1]) + 1


def square(rgba: np.ndarray, box: tuple[int, int, int, int]) -> Image.Image:
    """경계상자로 자르고 가운데 정렬한 정사각형으로 채운다(`build_market.py`와 같다)."""
    top, left, bottom, right = box
    crop = rgba[top:bottom, left:right]
    h, w = crop.shape[:2]
    side = max(h, w)
    canvas = np.zeros((side, side, 4), dtype=np.uint8)
    y = (side - h) // 2
    x = (side - w) // 2
    canvas[y:y + h, x:x + w] = crop
    return Image.fromarray(canvas, "RGBA")


def resize_alpha(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """`RGBa`(프리멀티플라이)를 거쳐 반투명 가장자리에 검은 테가 안 생기게 줄인다."""
    if im.width <= size[0] and im.height <= size[1]:
        return im
    return im.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def fit_resize(im: Image.Image, max_width: int) -> Image.Image:
    """비율을 유지한 채 폭만 줄인다. 키우지는 않는다."""
    if im.width <= max_width:
        return im
    ratio = max_width / im.width
    return im.resize((max_width, round(im.height * ratio)), Image.LANCZOS)


def build_frame(path: Path, trim: bool = True) -> Image.Image:
    """경계상자로 트리밍하고(9분할은 CSS가 한다) 폭 상한에 맞춰 줄인다.

    `trim=False`면 자르지 않고 원본 캔버스 그대로 쓴다 — `FRAME_NO_TRIM` 참조."""
    rgba = load(path)
    if trim:
        top, left, bottom, right = bbox(rgba[:, :, 3])
        rgba = rgba[top:bottom, left:right]
    im = Image.fromarray(rgba, "RGBA")
    return resize_alpha(im, (min(im.width, FRAME_MAX_WIDTH),
                              round(im.height * min(1, FRAME_MAX_WIDTH / im.width))))


def build_icon(path: Path) -> Image.Image:
    rgba = load(path)
    return resize_alpha(square(rgba, bbox(rgba[:, :, 3])), (ICON_SIZE, ICON_SIZE))


def build_sprite(path: Path, frames: int) -> Image.Image:
    """가로로 나란한 `frames`장을 **같은 상자**로 잘라 정사각 프레임을 잇는다.

    프레임마다 따로 경계상자를 잡으면(=`build_icon`을 프레임별로 부르면) 잘리는
    여백이 미세하게 달라져 재생 중 그림이 흔들린다 — 그래서 상자는 프레임들의
    합집합 하나만 쓴다."""
    rgba = load(path)
    h, w = rgba.shape[:2]
    fw = w // frames
    cols = [rgba[:, i * fw:(i + 1) * fw] for i in range(frames)]
    boxes = [bbox(c[:, :, 3]) for c in cols]
    top = min(b[0] for b in boxes)
    left = min(b[1] for b in boxes)
    bottom = max(b[2] for b in boxes)
    right = max(b[3] for b in boxes)
    ch, cw = bottom - top, right - left
    side = max(ch, cw)
    sheet = Image.new("RGBA", (ICON_SIZE * frames, ICON_SIZE), (0, 0, 0, 0))
    for i, col in enumerate(cols):
        crop = col[top:bottom, left:right]
        canvas = np.zeros((side, side, 4), dtype=np.uint8)
        y, x = (side - ch) // 2, (side - cw) // 2
        canvas[y:y + ch, x:x + cw] = crop
        frame = resize_alpha(Image.fromarray(canvas, "RGBA"), (ICON_SIZE, ICON_SIZE))
        sheet.paste(frame, (i * ICON_SIZE, 0), frame)
    return sheet


def find_background() -> Path | None:
    for name in BACKGROUND_CANDIDATES:
        p = SRC / name
        if p.is_file():
            return p
    return None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    ap.add_argument("--sheet", help="눈으로 볼 대조 시트를 이 경로에 쓴다(아이콘류만)")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0

    OUT_UI.mkdir(parents=True, exist_ok=True)
    OUT_ICONS.mkdir(parents=True, exist_ok=True)
    OUT_BG.mkdir(parents=True, exist_ok=True)

    made_frames: list[str] = []
    made_icons: list[tuple[str, Image.Image]] = []
    made_bg: str | None = None
    skipped = 0
    missing: list[str] = []

    def up_to_date(dst: Path, src: Path) -> bool:
        return dst.exists() and not args.force and dst.stat().st_mtime >= src.stat().st_mtime

    # ── 필드·버튼 프레임 ──
    for stem, out_name in FRAMES.items():
        src = SRC / f"{stem}.png"
        if not src.exists():
            missing.append(f"{stem}.png")
            continue
        dst = OUT_UI / out_name
        if up_to_date(dst, src):
            skipped += 1
            continue
        build_frame(src, trim=stem not in FRAME_NO_TRIM).save(dst)
        made_frames.append(out_name)

    # ── 아이콘 6종 ──
    for stem, icon_id in ICONS.items():
        src = SRC / f"{stem}.png"
        if not src.exists():
            missing.append(f"{stem}.png")
            continue
        dst = OUT_ICONS / f"{icon_id}.png"
        if up_to_date(dst, src):
            skipped += 1
            continue
        im = build_icon(src)
        im.save(dst)
        made_icons.append((icon_id, im))

    # ── 레벨업 도장 스프라이트 ──
    made_sprites: list[str] = []
    for stem, (icon_id, frames) in SPRITES.items():
        src = SRC / f"{stem}.png"
        if not src.exists():
            missing.append(f"{stem}.png")
            continue
        dst = OUT_ICONS / f"{icon_id}.png"
        if up_to_date(dst, src):
            skipped += 1
            continue
        build_sprite(src, frames).save(dst)
        made_sprites.append(icon_id)

    # ── 도시 이름 짓기 배경 ──
    bg_src = find_background()
    if bg_src is None:
        missing.append(" / ".join(BACKGROUND_CANDIDATES))
    else:
        dst = OUT_BG / "new-city.jpg"
        if not up_to_date(dst, bg_src):
            with Image.open(bg_src) as im:
                fit_resize(im.convert("RGB"), BG_MAX_WIDTH).save(dst, quality=JPEG_QUALITY, optimize=True, progressive=True)
            made_bg = "new-city.jpg"
        else:
            skipped += 1

    print(f"출력 → {OUT_UI} · {OUT_ICONS} · {OUT_BG}")
    print(f"  프레임 {len(made_frames)}종 · 아이콘 {len(made_icons)}종 · 스프라이트 {len(made_sprites)}종 · "
          f"배경 {'1종' if made_bg else '0종'}"
          + (f" (그대로 둔 것 {skipped}개)" if skipped else ""))
    if made_frames:
        print(f"  구운 프레임: {' '.join(made_frames)}")
    if made_icons:
        print(f"  구운 아이콘: {' '.join(n for n, _ in made_icons)}")
    if made_sprites:
        print(f"  구운 스프라이트: {' '.join(made_sprites)}")
    if made_bg:
        print(f"  구운 배경: {made_bg}")
    if missing:
        print(f"  ! 못 찾은 원본: {' · '.join(missing)}")

    if args.sheet and made_icons:
        cols = max(im.width for _, im in made_icons)
        sheet = Image.new("RGBA", (cols, sum(im.height for _, im in made_icons)), (24, 26, 30, 255))
        y = 0
        for _, im in made_icons:
            sheet.alpha_composite(im, (0, y))
            y += im.height
        sheet.save(args.sheet)
        print(f"  대조 시트 → {args.sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
