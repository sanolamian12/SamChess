#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""assets/blacksmith/ 의 장비 그림을 웹용으로 굽는다 (2026-09-09).

    python tools/build_blacksmith.py [--force]

| 원본 | 출력 |
|---|---|
| `LV{해금레벨}_{무기\|방어구}_{이름}.png` (693×378, 물건 하나를 중앙에 놓은 사진) | `public/blacksmith/{id}.png` 폭 480 |
| `level.png` (1314×300, Lv1~5 다섯 칸 스프라이트, 옛 버전) | `public/blacksmith/level.png` 그대로 |
| `level2.png` (1403×314, Lv1~5 다섯 칸 스프라이트, 상세 패널 모서리용) | `public/blacksmith/level2.png` 그대로 |
| `frame_item.png` (금테 액자 — 안쪽에 **검정 캔버스가 이미 그려져 있다**) | `public/blacksmith/frame_item.png` 알파 경계상자로 트리밍 + 폭 1000로 축소 |
| `frame_item_list.png` (927×672, 제작 목록 카드용 금테 액자 — 캔버스는 짙은 회색) | `public/blacksmith/frame_item_list.png` 그대로(여백이 거의 없다) |
| `assets/icons/chip_neutral.png` (600×398, 나무 명패) | `public/blacksmith/nameplate.png` 실측 경계상자로 트리밍 |
| `weapon.png`·`shield.png`·`timer.png` (381² 아이콘) | `public/blacksmith/{같은 이름}` 그대로 |
| `lightEffect_lv{1..5}_{silver,green,blue,purple,gold}.png` (401² 안팎, 낱장 후광 한 장) | `public/blacksmith/{같은 이름}` 그대로 |

`level.png`·`level2.png`·`lightEffect_*`·아이콘 셋은 품목 사진이 아니라
**UI 스프라이트**라 나머지와 다르게 다룬다 — RGB로 접지 않고(투명 배경이
통짜 배경으로 메워진다) 그대로 복사한다. 무기 상세 패널(`ForgeScreen.tsx`의
`DetailModal`)의 왼쪽 위 모서리 레벨 배지도, 제작 목록 카드(`.frg-tile`)
이름 앞 배지도 **둘 다 `level2.png`를 쓴다**(2026-09-09 열일곱 번째 팔로업
— "이 화면에서도 레벨 아이콘을 level2.png로". `level.png`는 이제 안 쓰지만
파일은 남겨 둔다 — 되돌릴 수도 있는 자리라 지우지 않는다). `lightEffect_*`는
낱장 그림 하나를
`transform: rotate()`로 15°씩 돌려 쓴다(`.frg-item-glow`) — **더는 회전
프레임을 그림 안에 그려 넣지 않는다**(2026-09-09 여섯 번째 팔로업 — 6×4=24칸
스프라이트 시트였던 이전 버전을 CSS 회전으로 대체했다. 스프라이트 격자를
`background-position`으로 돌리려던 버전이 대각선으로 미끄러지는 버그를
냈던 자리라, 회전을 그림이 아니라 CSS 쪽에 맡기는 지금 방식이 더 간단하고
확실하다).

`frame_item.png`는 **안쪽 캔버스가 이미 불투명한 검정으로 그려져 있다**
(2026-09-09 여덟 번째 팔로업 — "검정색 배경이 내장되어 있어서 다시 씌울
필요가 없다"는 지정으로 새로 받았다). 그래서 이 화면은 더는 액자와 검정
캔버스를 따로 겹치지 않는다 — `frame_item.png` 한 장이 액자+캔버스 몫을
전부 한다. 원본에 얇은 투명 여백이 있어 그만큼 잘라내고(같은 렌더 폭에서
액자가 더 커 보인다), 원본이 3098×1689로 커서(4.5MB) 폭 1000으로도
줄인다. 액자를 맨 처음(맨 아래)에 깔고 후광·품목 사진을 그 위(DOM 순서로
나중)에 얹는 것은 그대로다 — 안쪽 캔버스가 뚫린 창이 아니라 그 자체로
불투명한 검정이라, 순서가 바뀌면 액자가 위의 것들을 통째로 가린다(합성해서
확인, `ForgeScreen.tsx` 참조).

`nameplate.png`은 `assets/blacksmith/`가 아니라 **`assets/icons/chip_neutral.png`**가
원본이다(제작 목록 카드의 이름표, `.frg-tile-nameplate` — 2026-09-09 스무 번째
팔로업). 이 그림은 `tools/build_ui.py`가 이미 `public/ui/chip-neutral.png`로
굽고 있지만 **거긴 일부러 안 자른다** — `chip_selected.png`와 같은 캔버스·
같은 여백으로 짝이 맞아야(`build_ui.py`의 `FRAME_NO_TRIM` 참조) 환경설정
팝업의 두 칩 높이가 안 어긋난다. 하지만 그 짝이 아닌 여기서는 `getbbox()`가
그림 위쪽에 붙은 작은 점 하나(장식 오타로 보인다)까지 상자에 넣어 버려서,
**「50px 넘는 이어진 폭/높이」 조건으로 진짜 명패 몸통만 실측**했다(좌
62 · 상 53 · 우 533 · 하 344, 600×398 원본 기준) — 그만큼 잘라내면 좌우에
버려지던 여백이 없어져 같은 렌더 폭에서 글자 자리가 넓어진다.

원본 파일명은 엑셀에서 온 한글 이름이라 화면 코드가 그대로 쓰기 번거롭다 —
`packages/data/generated/equipment.json`(정본)의 로마자 `id`로 옮겨 적는다.
그래서 이 도구는 **레벨·종류·이름 세 값으로 원본을 찾고 `id`로 저장**한다 —
매핑표를 손으로 한 벌 더 적지 않고 정본을 그대로 읽는다.

품목 사진은 물건 둘레가 **진짜 알파 컷아웃**이다(`getpixel()`로 직접 재서
확인 — 모서리는 알파 0, 물건이 있는 자리만 불투명). 검게 보이는 것은 그
알파를 못 살리는 뷰어 탓이다. 그런데 이 도구가 여태 `im.convert("RGB")`로
접어 저장해 **정작 그 알파를 스스로 지우고 있었다**(RGBA→RGB 변환은 투명한
자리를 검정으로 메운다) — 무기 상세 패널이 사진을 후광(`.frg-item-glow`)
위에 얹었을 때 "후광이 무기 뒤에서도 안 보인다"로 나타난 사고였다
(2026-09-09 일곱 번째 팔로업). **RGBA로 그대로 낸다** — `build_market.py`의
아이콘과 달리 알파 경계상자로 자르지 않고 **비율만 유지한 채 폭을
줄인다**(`market-sign.png`·배너와 같은 결, 물건 사진은 카드처럼 꽉 채울
자리가 아니라서다).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
SRC = ROOT / "assets" / "blacksmith"
OUT = ROOT / "packages" / "client" / "public" / "blacksmith"
EQUIPMENT_JSON = ROOT / "packages" / "data" / "generated" / "equipment.json"

MAX_WIDTH = 480
KIND_KO = {"weapon": "무기", "armor": "방어구"}
FRAME_MAX_WIDTH = 1000

# `assets/icons/chip_neutral.png`(600×398)에서 명패 몸통만 실측한 값 — 위
# 파일 머리말 참조. `assets/blacksmith/`가 아니라 `assets/icons/`가 원본이라
# 절대 경로로 따로 잡는다.
NAMEPLATE_SRC = ROOT / "assets" / "icons" / "chip_neutral.png"
NAMEPLATE_BOX = (62, 53, 533, 344)

# 그대로 복사하는 고정 UI 그림 — 크기가 이미 작아 줄일 이유가 없다. `frame_item`은
# 트리밍·축소가 필요해 아래 별도로 다룬다. `lightEffect_*`는 이제 낱장이라(위 파일
# 머리말 참조) 나머지 고정 그림과 같은 자리에 둔다. `frame_item_list.png`(927×672,
# 제작 목록 카드용 액자 — 캔버스는 회색)는 여백이 거의 없어(`getbbox()`로 확인,
# 927×672 중 실제 그림이 926×669) 트리밍 없이 그대로 둔다.
FIXED_COPY = (
    "level.png", "level2.png", "weapon.png", "shield.png", "timer.png",
    "frame_item_list.png",
    "lightEffect_lv1_silver.png", "lightEffect_lv2_green.png", "lightEffect_lv3_blue.png",
    "lightEffect_lv4_purple.png", "lightEffect_lv5_gold.png",
)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"{SRC} 가 없어 건너뛴다 — 그림 없이도 빌드는 정상이다")
        return 0

    equipment = json.loads(EQUIPMENT_JSON.read_text(encoding="utf-8"))

    OUT.mkdir(parents=True, exist_ok=True)
    made: list[str] = []
    skipped = 0
    missing: list[str] = []

    for item in equipment:
        stem = f"LV{item['unlockLevel']}_{KIND_KO[item['kind']]}_{item['name']}"
        src = SRC / f"{stem}.png"
        if not src.exists():
            missing.append(f"{stem}.png (← {item['id']})")
            continue
        dst = OUT / f"{item['id']}.png"
        if dst.exists() and not args.force and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        with Image.open(src) as im:
            rgba = im.convert("RGBA")
            if rgba.width > MAX_WIDTH:
                ratio = MAX_WIDTH / rgba.width
                rgba = rgba.resize((MAX_WIDTH, round(rgba.height * ratio)), Image.LANCZOS)
            rgba.save(dst, optimize=True)
        made.append(f"{item['id']}.png (← {stem}.png)")

    # 고정 UI 스프라이트/액자/아이콘 — 품목이 아니라 위 루프(RGB 접기)를 안
    # 탄다. 투명 배경을 그대로 지키려고 그냥 복사한다.
    for fixed_name in FIXED_COPY:
        fixed_src = SRC / fixed_name
        fixed_dst = OUT / fixed_name
        if not fixed_src.exists():
            missing.append(f"{fixed_name} (← 고정 UI 그림)")
            continue
        if args.force or not fixed_dst.exists() or fixed_dst.stat().st_mtime < fixed_src.stat().st_mtime:
            shutil.copy2(fixed_src, fixed_dst)
            made.append(f"{fixed_name} (그대로 복사)")
        else:
            skipped += 1

    # 액자 — 얇은 투명 여백을 알파 경계상자로 잘라내고, 원본이 커서 폭도
    # 줄인다(위 파일 머리말 참조).
    frame_src = SRC / "frame_item.png"
    frame_dst = OUT / "frame_item.png"
    if not frame_src.exists():
        missing.append("frame_item.png (← 고정 UI 그림)")
    elif args.force or not frame_dst.exists() or frame_dst.stat().st_mtime < frame_src.stat().st_mtime:
        with Image.open(frame_src) as im:
            rgba = im.convert("RGBA")
            bbox = rgba.getbbox()
            if bbox:
                rgba = rgba.crop(bbox)
            if rgba.width > FRAME_MAX_WIDTH:
                ratio = FRAME_MAX_WIDTH / rgba.width
                rgba = rgba.resize((FRAME_MAX_WIDTH, round(rgba.height * ratio)), Image.LANCZOS)
            rgba.save(frame_dst, optimize=True)
        made.append("frame_item.png (여백 트리밍 + 축소)")
    else:
        skipped += 1

    # 나무 명패 — `assets/icons/chip_neutral.png`에서 실측 상자로 몸통만
    # 잘라낸다(위 파일 머리말 참조). 공용 `build_ui.py`의 `chip-neutral.png`
    # (트리밍 안 함, `chip_selected`와 짝)와는 다른 별개 산출물이다.
    nameplate_dst = OUT / "nameplate.png"
    if not NAMEPLATE_SRC.exists():
        missing.append("nameplate.png (← assets/icons/chip_neutral.png)")
    elif args.force or not nameplate_dst.exists() or nameplate_dst.stat().st_mtime < NAMEPLATE_SRC.stat().st_mtime:
        with Image.open(NAMEPLATE_SRC) as im:
            im.convert("RGBA").crop(NAMEPLATE_BOX).save(nameplate_dst, optimize=True)
        made.append("nameplate.png (← chip_neutral.png, 실측 트리밍)")
    else:
        skipped += 1

    print(f"출력 → {OUT}")
    print(f"  구운 것 {len(made)}종" + (f" (그대로 둔 것 {skipped}개)" if skipped else ""))
    if made:
        print(f"  {' · '.join(made)}")
    if missing:
        print(f"  ! 못 찾은 원본: {' · '.join(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
