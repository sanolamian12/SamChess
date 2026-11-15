#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""꼬마 애니메이션 작업판(assets/CharsAnim/index.html)을 http://127.0.0.1:5180/ 로 띄운다.

    python tools/serve_anim_page.py        (npm run anim:page · assets/CharsAnim/열기.bat)

파일로 바로 열면(file://) 브라우저가 그림을 클립보드에 넣지 못하게 막는다 — 같은 출처의 그림을
읽어 PNG로 복사하려면 http여야 하고, 클립보드 API는 localhost를 안전한 출처로 쳐 준다.
이 컴퓨터(127.0.0.1)에서만 들린다. 이미 떠 있으면 브라우저만 연다. 끄려면 창을 닫거나 Ctrl+C.
"""

from __future__ import annotations

import functools
import http.server
import socket
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "assets" / "CharsAnim"
PORT = 5180
URL = f"http://127.0.0.1:{PORT}/"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # 새로 저장한 생성 결과가 바로 보이게
        super().end_headers()

    def log_message(self, *args):
        pass


def main() -> int:
    if not (ROOT / "index.html").exists():
        print("assets/CharsAnim/index.html이 없다 — 먼저 python tools/build_anim_prompts.py", file=sys.stderr)
        return 1
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", PORT)) == 0:
            print(f"이미 떠 있다 — {URL}")
            webbrowser.open(URL)
            return 0
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(ROOT)))
    print(f"작업판: {URL}  (끄려면 Ctrl+C)")
    webbrowser.open(URL)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
