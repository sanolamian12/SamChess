"""꼬마 그림 크기 보정표를 다시 잴 때 — 서 있는 칸의 불투명 면적 ÷ 중앙값과 권장 배율(1/√면적비).

    python tools/measure_stand_area.py                # public/actions/*.png (110² × 5칸, 첫 칸 = 서 있는 자세)
    python tools/measure_stand_area.py --dir public/actions-hd --frames 5 --top 20

배율표의 정본은 `packages/client/src/screens/OfficerArt.tsx`의 `STAND_SCALE`이다 — 이 도구는 값을 **찍어 줄 뿐** 그 표를 고치지 않는다
(전투력 계수와 같은 결: 잰 값을 손으로 옮겨 적고, 다시 재는 것은 의도된 변경이어야 한다). 2026-11-14 기준 · `Design/꼬마그림_크기보정_전달.md`.
"""
import argparse
import math
import os
import statistics

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser()
ap.add_argument('--dir', default='packages/client/public/actions')
ap.add_argument('--frames', type=int, default=5, help='시트 한 장의 칸 수(가로로 나란히)')
ap.add_argument('--frame', type=int, default=0, help='잴 칸(0 = 서 있는 자세)')
ap.add_argument('--top', type=int, default=15)
ap.add_argument('--alpha', type=int, default=128, help='이 값보다 진한 픽셀만 센다')
args = ap.parse_args()

d = os.path.join(ROOT, args.dir)
area: dict[str, int] = {}
for f in sorted(os.listdir(d)):
    if not f.lower().endswith(('.png', '.webp')):
        continue
    im = Image.open(os.path.join(d, f)).convert('RGBA')
    w = im.width // args.frames
    a = im.crop((w * args.frame, 0, w * (args.frame + 1), im.height)).getchannel('A')
    area[os.path.splitext(f)[0]] = sum(1 for p in a.tobytes() if p > args.alpha)

med = statistics.median(area.values())
rows = sorted(((v / med, k) for k, v in area.items()), reverse=True)
print(f'{len(area)}장 · 중앙값 {med:.0f}px')
for ratio, key in rows[:args.top]:
    print(f'  {key:16s} {ratio:4.2f}배  → 권장 {1 / math.sqrt(ratio):.2f}')
