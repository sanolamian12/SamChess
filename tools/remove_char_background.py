# -*- coding: utf-8 -*-
"""장수 이미지에서 양피지 배경을 지운다.

**이 작업은 2026-08-07에 이미 끝났고 결과가 `assets/Chars/`를 대신하고 있다.**
그때는 `Chars`(배경 있음) → `Chars-noback`(배경 없음)이었는데, 기획자가 결과물을
`Chars`로 이름을 바꿔 원본 자리에 놓았다. 그래서 **기본 `--src`인 `assets/Chars/`에는
이제 지울 배경이 없다.** 그 상태로 돌리면 알파를 보고 멈춘다(아래 참고).

배경이 붙어 있던 예전 `Chars/`는 기획자가 별도 백업으로 옮겼다(지운 게 아니다).
파라미터를 바꿔 다시 돌릴 일이 생기면 백업에서 꺼내 `--src`로 그 폴더를 직접 준다.


원본은 「양피지 지도 위에 픽셀아트 장수 1명」 구도다. 배경은 밝은 황갈색 바탕 +
갈색 등고선 + 회색 자갈이고, 위쪽(또는 아래쪽)에 이름 현판이 붙기도 한다.
장수는 항상 어두운 외곽선으로 둘러싸여 있다. 이 세 가지 성질을 그대로 쓴다.

    1) 색상 게이트 — 테두리 4px 띠에서 배경 색을 표본으로 뽑고, 밝기를 정규화한
       색도(chromaticity)가 그 표본 중 하나에라도 가까우면서 충분히 밝은 픽셀만
       배경 후보다. 밝기를 나눠버리므로 밝은 바탕과 어두운 갈색 등고선이 같은
       후보로 묶인다.
    2) 연결성 — 후보 중에서 「이미지 테두리에서 인접 픽셀 색차 LOCAL_TOL 이내로
       이어지는」 것만 배경이다. 얼굴·황갈색 갑옷처럼 색이 배경과 겹치는 부분은
       어두운 외곽선이 길을 막아 살아남는다. 외곽선이 한두 픽셀 끊긴 곳으로 새는
       것은 열림 연산(_seal_leaks)으로 되돌린다.
    3) 최대 덩어리 — 남은 전경 중 가장 큰 연결 요소만 장수다. 이름 현판, 멀리
       떨어진 자갈, 등고선 조각은 여기서 떨어져 나간다.

마지막으로 경계 BAND px 는 p = a·F + (1−a)·B 로 보고 a 를 최소자승으로 풀어
반투명 알파와 원래 색을 복원한다(matting). 이걸 안 하면 어두운 UI 위에 올렸을 때
실루엣 둘레에 황갈색 테가 1px 남는다.

사용법:
    python tools/remove_char_background.py                 # 260장 전부
    python tools/remove_char_background.py --dry-run       # 저장 없이 진단만
    python tools/remove_char_background.py --only 관우 장비 # 일부만
    python tools/remove_char_background.py --skip-existing # 이미 있는 건 건너뜀

260장 중 손이 필요한 건 여포 하나다. 깃털 장식과 방천화극이 배경을 가둬서
테두리에서 닿지 않으므로, 갇힌 영역을 시작점으로 찍어준다:

    python tools/remove_char_background.py --only 여포 --seed 192,100 --seed 135,300
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

# --- 조절값 ---------------------------------------------------------------
BORDER_BAND = 4      # 배경 색 표본을 뽑을 테두리 띠 두께(px)
CHROMA_TOL = 0.12    # 색도 L1 거리 허용치. 예제 5건 기준 배경의 98%가 통과한다
CHROMA_BIN = 0.01    # 색도 히스토그램 격자 크기
MIN_VALUE = 110      # 이보다 어두우면 배경 후보에서 제외 (장수의 외곽선이 여기 걸린다)
LOCAL_TOL = 40       # 이웃 픽셀로 번져갈 때 허용하는 채널별 최대 색차
NECK_RADIUS = 3      # 이 반지름보다 좁은 통로로 새어 들어간 배경은 무효로 본다
MATTE_BAND = 2       # 알파를 부드럽게 풀 경계 폭(px)
MIN_ALPHA = 0.15     # 색 복원 시 0으로 나누지 않게 두는 하한

# 진단: 살아남은 넓이가 이 범위를 벗어나면 사람이 확인해야 한다
AREA_LO, AREA_HI = 0.08, 0.55

EXTS = {".png", ".webp", ".bmp", ".jpg", ".jpeg"}


def _chroma(a: np.ndarray) -> np.ndarray:
    """밝기를 나눠 색상 비율만 남긴다. 밝은 바탕과 어두운 등고선이 같은 값이 된다."""
    a = a.astype(np.float32) + 1e-6
    return a / a.sum(axis=-1, keepdims=True)


def _border_ring(rgb: np.ndarray) -> np.ndarray:
    band = BORDER_BAND
    return np.concatenate([
        rgb[:band].reshape(-1, 3), rgb[-band:].reshape(-1, 3),
        rgb[:, :band].reshape(-1, 3), rgb[:, -band:].reshape(-1, 3)])


def _background_gate(rgb: np.ndarray, sample: np.ndarray) -> np.ndarray:
    """sample 에 나타난 색상들 중 하나에라도 가까우면서 충분히 밝은 픽셀.

    배경은 양피지 한 가지가 아니다. 원본 3인 이미지에서 잘라온 탓에 하늘색·연녹색
    띠가 섞여 들어온 컷이 많다. 그래서 대표색 하나를 쓰지 않고, 표본의 색도를
    2차원 히스토그램에 찍은 뒤 허용치만큼 부풀려 「본 적 있는 색조」 집합으로 쓴다.
    """
    bins = int(round(1.0 / CHROMA_BIN))
    hist = np.zeros((bins, bins), bool)
    sc = _chroma(sample)
    si = np.clip((sc[:, :2] / CHROMA_BIN).astype(int), 0, bins - 1)
    hist[si[:, 0], si[:, 1]] = True
    # L1 허용치를 격자 칸수로 환산해 부풀린다 (r,g 두 축만 봐도 b 는 종속이다)
    grow = max(1, int(round(CHROMA_TOL / 2 / CHROMA_BIN)))
    hist = ndimage.binary_dilation(hist, ndimage.generate_binary_structure(2, 1),
                                   iterations=grow)

    pc = _chroma(rgb)
    pi = np.clip((pc[..., :2] / CHROMA_BIN).astype(int), 0, bins - 1)
    return hist[pi[..., 0], pi[..., 1]] & (rgb.max(axis=2) >= MIN_VALUE)


def _flood_from_border(rgb: np.ndarray, gate: np.ndarray,
                       extra: list[tuple[int, int]] | None = None) -> np.ndarray:
    """테두리에서 gate 안쪽으로 번져 닿는 픽셀만 배경으로 인정한다.

    인접 픽셀 색차가 LOCAL_TOL 이하인 간선만 잇고 연결 요소를 구한다.
    픽셀 하나씩 BFS 하는 것보다 이 편이 한 자릿수 빠르다.

    extra 는 추가 시작점 (x, y) 목록. 여포의 깃털 장식처럼 배경이 장수에게
    완전히 둘러싸여 테두리에서 닿지 않는 컷을 손으로 구제할 때 쓴다.
    """
    h, w = gate.shape
    f = rgb.astype(np.int16)
    idx = np.arange(h * w).reshape(h, w)

    pairs = [
        (gate[:, :-1], gate[:, 1:], f[:, :-1], f[:, 1:], idx[:, :-1], idx[:, 1:]),  # 가로
        (gate[:-1], gate[1:], f[:-1], f[1:], idx[:-1], idx[1:]),                    # 세로
    ]
    rows, cols = [], []
    for ga, gb, ca, cb, ia, ib in pairs:
        link = ga & gb & (np.abs(ca - cb).max(axis=2) <= LOCAL_TOL)
        rows.append(ia[link])
        cols.append(ib[link])

    n = h * w
    r = np.concatenate(rows)
    c = np.concatenate(cols)
    graph = coo_matrix((np.ones(len(r), np.int8), (r, c)), shape=(n, n))
    _, comp = connected_components(graph, directed=False)
    comp = comp.reshape(h, w)

    edge = np.zeros_like(gate)
    edge[0], edge[-1], edge[:, 0], edge[:, -1] = True, True, True, True
    seeds = list(np.unique(comp[edge & gate]))
    for x, y in extra or []:
        if 0 <= y < h and 0 <= x < w and gate[y, x]:
            seeds.append(comp[y, x])
    return gate & np.isin(comp, seeds)


def _disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def _seal_leaks(bg: np.ndarray, extra: list[tuple[int, int]] | None = None) -> np.ndarray:
    """좁은 틈으로 얼굴·옷 안까지 새어 들어간 배경을 되돌린다.

    피부색은 양피지와 색도가 거의 같아서, 머리카락과 어깨 사이처럼 외곽선이
    한두 픽셀 끊긴 곳이 있으면 얼굴 전체가 배경으로 빨려 들어간다. 그래서
    NECK_RADIUS 로 침식해 가는 통로를 끊고, 그러고도 테두리에 남아 있는
    덩어리만 다시 부풀려 원래 배경과 교집합을 취한다(열림 연산).
    """
    r = NECK_RADIUS
    core = ndimage.binary_erosion(bg, _disk(r))
    lab, _ = ndimage.label(core, np.ones((3, 3)))
    edge = np.zeros_like(bg)
    edge[:r + 1], edge[-r - 1:], edge[:, :r + 1], edge[:, -r - 1:] = True, True, True, True
    seeds = set(np.unique(lab[edge & core]).tolist())
    h, w = bg.shape
    for x, y in extra or []:                 # 손으로 찍은 시작점도 테두리와 같이 취급
        if 0 <= y < h and 0 <= x < w:
            seeds |= set(np.unique(lab[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]).tolist())
    seeds.discard(0)
    if not seeds:
        return bg
    return ndimage.binary_dilation(np.isin(lab, list(seeds)), _disk(r)) & bg


def _largest_blob(fg: np.ndarray) -> np.ndarray:
    lab, k = ndimage.label(fg, np.ones((3, 3)))
    if k == 0:
        return fg
    sizes = ndimage.sum(fg, lab, range(1, k + 1))
    return lab == int(np.argmax(sizes)) + 1


def _nearest(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """mask 밖의 좌표를 가장 가까운 mask 안 픽셀 색으로 채운다."""
    idx = ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
    return rgb[tuple(idx)]


def remove_background(im: Image.Image,
                      seeds: list[tuple[int, int]] | None = None) -> tuple[Image.Image, float]:
    """배경을 지운 RGBA 이미지와, 남은 넓이 비율을 돌려준다."""
    rgb = np.array(im.convert("RGB"))

    # 손으로 찍은 시작점은 그 주변 색도 배경 색 표본에 넣는다(매직완드처럼).
    sample = [_border_ring(rgb)]
    for x, y in seeds or []:
        sample.append(rgb[max(0, y - 2):y + 3, max(0, x - 2):x + 3].reshape(-1, 3))
    gate = _background_gate(rgb, np.concatenate(sample))
    bg = _seal_leaks(_flood_from_border(rgb, gate, seeds), seeds)
    keep = _largest_blob(~bg)

    core = ndimage.binary_erosion(keep, np.ones((3, 3)), iterations=MATTE_BAND)
    if not core.any():                      # 실루엣이 너무 얇으면 matting 생략
        core = keep
    fringe = keep & ~core

    f = rgb.astype(np.float32)
    back = _nearest(f, bg) if bg.any() else np.zeros_like(f)
    front = _nearest(f, core)
    d = front - back
    a = np.clip(((f - back) * d).sum(axis=2) / ((d * d).sum(axis=2) + 1e-6), 0.0, 1.0)

    alpha = np.where(core, 1.0, np.where(fringe, a, 0.0))
    est = back + (f - back) / np.maximum(alpha, MIN_ALPHA)[..., None]
    out = np.where(fringe[..., None], np.clip(est, 0, 255), f)

    rgba = np.dstack([out.astype(np.uint8), (alpha * 255).round().astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA"), float(keep.mean())


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    assets = Path(__file__).resolve().parent.parent / "assets"
    ap = argparse.ArgumentParser(description="장수 이미지의 양피지 배경 제거")
    ap.add_argument("--src", type=Path, default=assets / "Chars", help="원본 폴더")
    ap.add_argument("--dst", type=Path, default=assets / "Chars-noback", help="출력 폴더")
    ap.add_argument("--only", nargs="+", metavar="PATTERN",
                    help="파일명에 이 문자열이 들어간 것만 처리")
    ap.add_argument("--skip-existing", action="store_true",
                    help="출력 폴더에 이미 있는 파일은 건드리지 않는다")
    ap.add_argument("--dry-run", action="store_true", help="저장하지 않고 진단만 출력")
    ap.add_argument("--seed", action="append", metavar="X,Y", default=[],
                    help="배경 시작점을 손으로 추가한다. 장수에게 완전히 둘러싸여 "
                         "테두리에서 닿지 않는 배경을 지울 때 (--only 와 같이 쓴다)")
    args = ap.parse_args()

    try:
        seeds = [tuple(int(v) for v in s.split(",")) for s in args.seed]
        assert all(len(s) == 2 for s in seeds)
    except (ValueError, AssertionError):
        print("[오류] --seed 는 X,Y 형식이어야 합니다 (예: --seed 192,100)")
        return 1

    if not args.src.is_dir():
        print(f"[오류] 원본 폴더가 없습니다: {args.src}")
        return 1

    files = sorted(p for p in args.src.iterdir()
                   if p.is_file() and p.suffix.lower() in EXTS)
    if args.only:
        files = [p for p in files if any(pat in p.stem for pat in args.only)]
    if not files:
        print(f"[오류] {args.src} 에 처리할 이미지가 없습니다.")
        return 1

    # 이미 배경이 지워진 폴더에 다시 돌리면 알고리즘이 헛돈다 — 테두리에서 뽑는 배경
    # 색 표본이 「투명 픽셀 밑에 남은 색」이라 무엇이든 될 수 있고, 결과는 조용히 망가진다.
    # 2026-08-07 이후 `assets/Chars/`가 바로 그런 상태라 실수하기 쉬운 자리다.
    probe = [p for p in files[:5]]
    transparent = 0
    for p in probe:
        with Image.open(p) as im:
            if im.mode in ("RGBA", "LA") and np.array(im.convert("RGBA"))[..., 3].min() == 0:
                transparent += 1
    if transparent == len(probe):
        print(f"[중단] {args.src} 의 이미지에 이미 투명 배경이 있습니다 "
              f"(표본 {len(probe)}장 전부).")
        print("       배경 제거는 2026-08-07에 끝났고 결과가 이 폴더입니다.")
        print("       배경이 남아 있는 원본에 돌리려면 --src 로 그 폴더를 지정하세요.")
        return 1

    if not args.dry_run:
        args.dst.mkdir(parents=True, exist_ok=True)

    made = skipped = 0
    suspect: list[str] = []

    for i, path in enumerate(files, 1):
        out = args.dst / f"{path.stem}.png"
        if args.skip_existing and out.exists():
            skipped += 1
            continue

        with Image.open(path) as im:
            im.load()
            cut, area = remove_background(im, seeds)

        flag = "" if AREA_LO <= area <= AREA_HI else "  ← 확인 필요"
        if flag:
            suspect.append(f"{path.stem} (남은 넓이 {area:.1%})")
        print(f"[{i:3d}/{len(files)}] {path.stem}  남은 넓이 {area:5.1%}{flag}")

        if not args.dry_run:
            cut.save(out)
        made += 1

    verb = "예정" if args.dry_run else "저장"
    print(f"\n{verb} {made}개 / 건너뜀 {skipped}개 → {args.dst}")
    if suspect:
        print(f"\n[확인 필요] 남은 넓이가 {AREA_LO:.0%}~{AREA_HI:.0%} 밖입니다:")
        for s in suspect:
            print(" -", s)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
