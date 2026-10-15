"""
컬렉션 라벨 그림 → 웹용 (2026-10-13).

| 원본 | 출력 | 쓰는 곳 |
|---|---|---|
| `assets/Collections/{타이틀}.jpg` 3584×1184 | `packages/client/public/collections/{id}.jpg` 폭 1200 | 컬렉션 두루마리 하단의 워터마크 |

- **파일 이름 끝의 확장자가 겹쳐 온다**(`도원결의.jpg.jpg` · `반동탁 연합군.jp.jpg`, 생성 도구가 그렇게
  내보낸다). 타이틀은 `extract_data.py`의 `collection_art_title()`과 **같은 규칙**으로 떼어 낸다.
- 타이틀 → id는 추출 결과(`packages/data/generated/collections.json`)에서 찾는다 — 먼저 `npm run extract`.
- 그림이 아직 다 오지 않았다(그리는 중). 없는 것은 세기만 하고, 화면은 빈 종이로 둔다.
- 예전에는 다 편 두루마리(`_scroll.png`)도 여기서 구웠는데, 상세가 죽간 판(`ui/panel-detail-bamboo.png`, 2026-10-14)으로
  바뀌며 아무도 안 쓰게 돼 2026-10-15에 걷었다.

    python tools/build_collections.py [--force]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
from extract_data import collection_art_title  # noqa: E402

SRC = ROOT / "assets" / "Collections"
DATA = ROOT / "packages" / "data" / "generated" / "collections.json"
OUT = ROOT / "packages" / "client" / "public" / "collections"
WIDTH = 1200


def main() -> int:
    force = "--force" in sys.argv
    if not SRC.is_dir():
        print(f"  · 컬렉션 — {SRC} 없음, 건너뛴다")
        return 0
    if not DATA.is_file():
        print(f"  · 컬렉션 — {DATA.name} 없음 — 먼저 npm run extract", file=sys.stderr)
        return 1
    by_title = {c["title"]: c["id"] for c in json.loads(DATA.read_text(encoding="utf-8"))}
    OUT.mkdir(parents=True, exist_ok=True)

    made = skipped = 0
    unmatched: list[str] = []
    for src in sorted(SRC.iterdir()):
        if not src.is_file():
            continue
        cid = by_title.get(collection_art_title(src.name))
        if cid is None:
            unmatched.append(src.name)
            continue
        dst = OUT / f"{cid}.jpg"
        if dst.is_file() and not force and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        with Image.open(src) as im:
            im = im.convert("RGB")
            h = max(1, round(im.height * WIDTH / im.width))
            im.resize((WIDTH, h), Image.LANCZOS).save(dst, "JPEG", quality=84, optimize=True, progressive=True)
        made += 1

    have = {p.stem for p in OUT.glob("*.jpg")}
    total = sum(p.stat().st_size for p in OUT.glob("*.jpg"))
    print(f"  · 컬렉션 라벨 폭 {WIDTH} — 생성 {made}장, 기존 {skipped}장, "
          f"합계 {len(have)}/{len(by_title)}장 ({total / 1024 / 1024:.1f} MB)")
    if unmatched:
        print(f"    타이틀을 못 찾은 파일 {len(unmatched)}건: {', '.join(unmatched[:5])}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
