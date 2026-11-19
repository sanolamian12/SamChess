"""
글자 크기 점검판 — 화면을 하나씩 손으로 보며 메모하고 체크하는 진도판(HTML)을 만든다 (2026-11-18)

    python tools/build_font_board.py --shots ko=<순회 폴더> --shots en=<순회 폴더> … (열 언어)

`tools/font_audit.ts`를 `SHOTS=1`로 돌린 폴더(`portrait_<장면>.jpg`)에서 화면마다 **언어별 캡처**를 줄여 `Design/글자크기점검/shots/<언어>/<id>.jpg`로 옮기고,
로드맵(아래)과 함께 `Design/글자크기점검/점검판.html` 하나로 쓴다. 한국어 폴더에 가로 캡처(`landscape_<장면>.jpg`)가 있으면 「한국어 · 가로」도 한 장 더.
틀은 `tools/font_board.template.html`. 판은 단원 버튼 일곱 개 → 그 단원의 화면 카드(캡처를 ◀ ▶로 언어별로 넘김 · 메모 · 완료 체크).
메모 · 체크는 브라우저의 localStorage에 남는다(열쇠가 화면 id라 판을 다시 만들어도 그대로).
캡처(`shots/`, 열 언어 × 55장)는 git에 안 올린다 — 이 도구로 다시 만든다.
"""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "Design" / "글자크기점검" / "점검판.html"
SHOTS_DIR = OUT.parent / "shots"
# 캡처 폭(px) — 순회는 세로 700 × 1400, 가로 1920 × 1080으로 찍는다. 크게 볼 때 작은 글자가 읽혀야 해서 세로는 원본 그대로
SHOT_W = 700
SHOT_W_LAND = 1280
# 언어 — 게임의 `LANGS`(i18n/index.ts)와 같은 차례 · 같은 이름
LANGS = [("ko", "한국어"), ("en", "English"), ("es_419", "Español"), ("it", "Italiano"), ("ja", "日本語"),
         ("mn", "Монгол"), ("pt_BR", "Português (BR)"), ("pt_PT", "Português (PT)"), ("zh_Hans", "简体中文"), ("zh_Hant", "繁體中文")]
SHORT = {"ko": "KR", "en": "EN", "es_419": "ES", "it": "IT", "ja": "JA", "mn": "MN", "pt_BR": "BR", "pt_PT": "PT", "zh_Hans": "CN", "zh_Hant": "TW"}

# 점검이 끝난 화면 — 캡처를 지우고 다시 만들지 않는다. 판에서는 「완료」로 굳는다 (2026-11-19 기획자, 1단원)
CLOSED = {"main", "main-ext", "settings", "mail", "info", "logout", "title", "newgame"}

# 지난 캡처 뒤로 바뀐 화면 — 판에서 「바뀜」 표지와 함께 무엇이 바뀌었는지 보인다(새로 짠 판이라 지금은 비었다)
CHANGED: dict[str, str] = {}

# 판에 올리는 단원 — **메인 건물 하나씩** 만들고 · 보고 · 고치고 · 끝낸다 (2026-11-19 기획자, 판을 새로 짰다). 다음 건물은 여기에 더한다
ACTIVE = ["palace"]

# 로드맵 — (id, 화면, 가는 길, 볼 것, 순회 장면 이름들). 장면이 없으면 순회가 못 연 화면이다(손으로만 본다).
ROADMAP: list[tuple[str, str, list[tuple[str, str, str, str, list[str]]]]] = [
    ("main", "1. 메인 · 공용 팝업", [
        ("main", "메인 (성 안)", "로그인 뒤 첫 화면", "건물 밑 설명 글자 · 머리 통계", ["10-main"]),
        ("main-ext", "산 너머 전경", "메인 → 산 너머", "건물 밑 설명 글자(그림 위에 얹은 글)", ["11-main-ext"]),
        ("settings", "설정 팝업", "메인 → 설정", "계정 ID · 「음성 더빙」 · 음량 숫자", ["12-main-settings"]),
        ("mail", "우편함", "머리의 우편 아이콘", "보관함 칸 이름(0.45 → 0.8rem) · 받은 시각 · 선물 목록 · 오류 — 우편이 있어야 보인다", ["13-main-mail"]),
        ("info", "사용 안내", "머리의 안내 아이콘", "안내 줄 · 쪽 표시(0.55 → 0.8rem)", ["14-main-info"]),
        ("logout", "로그아웃 확인", "설정 → [로그아웃]", "확인 문구", ["15-main-logout"]),
        ("title", "간판 · 로그인", "로그아웃 상태", "간판 · 로그인 팝업", ["00-title", "01-login"]),
        ("newgame", "새 계정 — 도시 이름 · 오프닝", "새 계정 가입", "이름 입력 · 오프닝 대사", ["02-newgame", "03-opening-a", "03-opening-b"]),
        # ↓ 순회가 못 여는 것 — 손으로 본다 (2026-11-19, 1단원의 나머지는 기획자가 점검을 끝냈다)
        ("raid-alert", "도적떼 출몰 알림 팝업", "도적떼가 처음 나타난 순간의 메인 · 남은 1분(어느 화면에서든) · 마감이 지나 항복 정산된 뒤",
         "갈래 셋(출몰 · 곧 마감 · 항복 정산)의 제목 · 본문 · 단추 [항복] [전투 준비] [지금 전투] / [확인]", []),
        ("raid-button", "메인 — 도적떼 단추", "도적떼가 있는 동안 메인(성 안)", "[토벌] · [이어 싸우기] 단추와 그 밑 남은 시간", []),
        ("raid-result", "도적떼 방어전 결과", "도적떼 방어전을 끝낸 뒤", "결과 제목 · 보상 · 잃은 것 글자", []),
        ("steward", "내관 안내 말풍선", "새 계정의 첫 입장 · 건물에 처음 들어갈 때", "내관 대사 · [다음] 단추 — 순회는 안내를 꺼 두고 돈다", []),
        ("mail-list", "우편함 — 우편이 여러 통 있을 때", "머리의 우편 아이콘(우편 · 선물이 와 있을 때)",
         "목록 · 선물 칸 · 받기 결과 — 판 디자인을 다시 이야기하기로 함", []),
    ]),
    ("palace", "궁궐", [
        ("palace-status", "궁궐 현황", "메인 → 궁궐", "붉은 옻칠 판 · 도시 / 궁궐 레벨 배지와 후광 · 장수 수 · 황제(E 마크 · 금빛 후광) · 아래 단추 둘", ["20-palace"]),
        ("palace-rename", "도시 이름 변경 팝업", "메인 → 도시 이름 오른쪽 붓 배지(궁궐에서 옮겼다)", "제목 · 입력칸 · 금화 · 단추", ["20b-palace-rename"]),
        ("officers", "장수 일람", "궁궐 → [장수 일람]", "총원 줄 · 검색 · 열 머리 정렬(네온) · 이름 칸(등급 · 레벨) · 한 쪽 여덟 명 · 쪽 넘김 · [뒤로 가기]", ["21-officers"]),
        ("officer-card", "장수 상세", "장수 일람 → 아무 장수",
         "이름 줄(금빛 획 · 등급 광택 · 레벨 · 자) · 능력치 판(장수 · 후광 · 여섯 값 · 밑줄) · 책략 두루마리 · 고유 기술 · 열전 · [아이템] · [레벨/스킬 관리] · [뒤로 가기]", ["22-officer-detail"]),
        ("officer-noskill", "장수 상세 — 고유 기술 없는 장수", "장수 일람 → C · D급 장수", "「고유 기술 없음」 명패", ["22e-officer-noskill"]),
        ("officer-levelup", "장수 상세 — 레벨/스킬 관리", "장수 상세 → [레벨/스킬 관리]", "제목의 레벨 배지 · 책략 조건문 · 능력 선택 줄", ["22b-officer-levels"]),
        ("officer-skill", "장수 상세 — 고유기술 팝업", "장수 상세 → 고유기술 배너", "기술 설명 · SP", ["22c-officer-skill"]),
        ("officer-items", "장수 상세 — 아이템", "장수 상세 → [아이템]", "병기 · 아이템 고르기(병영 부대 편집과 같은 것)", ["22d-officer-items"]),
        ("officer-injured", "장수 상세 — 부상 장수", "장수 일람 → 부상 표시가 있는 장수 → [부상]", "부상 · 남은 시간 · [입원]", []),
        ("city", "도시 관리", "궁궐 → [도시 관리]", "자재 줄 · 건물 일곱 줄(레벨 배지) · 증축 조건", ["23-city"]),
        ("buildings", "건물 관리", "도시 관리 → [건물 관리]", "건물 줄(레벨 배지 → 배지) · [증축] · [도시 증축]", ["24-buildings"]),
        ("buildings-confirm", "건물 관리 — 짓기 확인 · 완료 팝업", "건물 관리 → [짓기]/[증축]", "확인 · 완료 팝업(이름 + 큰 레벨 배지)", ["24b-buildings-build"]),
    ]),
    ("barracks", "3. 병영", [
        ("barracks", "병영", "메인 → 병영", "명령 단추 · 안내문", ["30-barracks"]),
        ("squads", "부대 관리", "병영 → [부대 관리]", "돌격대 · 수성군 줄 · 전적 칸", ["32-squads"]),
        ("squad-edit-def", "부대 편집 (수비대)", "부대 관리 → 수비대 칸", "레벨 열이 없어지고 이름 옆 배지 · 표 머리 · 「자리 없음」 획", ["35-squad-edit"]),
        ("squad-edit-atk", "부대 편집 (공격대)", "부대 관리 → 공격대 칸", "위와 같음", ["35b-squad-edit-atk"]),
        ("squad-pick", "부대 편집 — 장수 고르기", "부대 편집 → 빈 줄/장수 바꾸기", "고르기 표(레벨 배지)", ["35e-squad-pick"]),
        ("squad-swap", "부대 편집 — 기물 바꾸기", "부대 편집 → 기물 아이콘", "기물 이름 단추", ["35d-squad-swap"]),
        ("squad-deploy", "부대 배치 편집", "부대 편집 → [배치]", "판 좌표 눈금(0.54 → 0.8rem) · 장수 카드 띠 · 두루마리 안내(자동 축소 하한)", ["35c-squad-deploy"]),
        ("garrison-policy", "수비군 설정", "부대 편집(수비대) → [수비군 설정]", "방침 설명문(0.6 → 0.8rem) · 탭 · 선택지 보조문", ["36-garrison-policy"]),
        ("sortie", "출정", "병영 → [출정하기]", "표 머리 · 부대원 이름 · 군량 · 쪽 넘김", ["37-sortie"]),
        ("sortie-peek", "출정 — 부대 보기 팝업", "출정 → 부대 줄의 보기", "레벨 열이 없어지고 이름 옆 배지 · 표 머리", ["37b-sortie-peek"]),
        ("siege", "공성전 — 칠 도시 고르기", "출정 → 공성전", "도시 줄 · 자동 매칭 안내", ["38-siege"]),
        ("match", "매칭", "출정 → 야전/자동 매칭", "상대 표 머리 · 안내문", ["39-match"]),
        ("tutorials", "튜토리얼 목록", "병영 → [튜토리얼]", "목록 · 소개", ["31-tutorials"]),
    ]),
    ("market", "4. 장터", [
        ("market", "장터 첫 화면", "메인 → 장터", "명령 단추", ["40-market"]),
        ("market-shop", "상점", "장터 → [상점]", "상품 카드 글자", ["41-market-openShop"]),
        ("market-merc", "상점 — 용병(가챠)", "상점 → [용병]", "뽑기 안내 · 결과 카드", ["42-market-openMerc"]),
        ("market-items", "상점 — 아이템", "상점 → [아이템]", "효과 설명(0.64 → 0.8rem) · 표 머리 · 종류 · 쪽 넘김", ["42-market-openItems"]),
        ("market-goods", "상점 — 물자", "상점 → [물자]", "효과 · 「되돌릴 연구가 없다」 · 제조/보유 칸", ["42-market-openGoods"]),
        ("market-gold", "금화", "장터 → [금화]", "묶음 가격 · 안내문", ["41-market-openGold"]),
    ]),
    ("ext", "5. 산 너머 (확장 도시)", [
        ("academy", "태학", "산 너머 → 태학", "연구 줄 · 레벨 표기", ["60-academy"]),
        ("academy-pick", "태학 — 연구 고르기", "태학 → [연구]", "책략 엠블럼 「+」 · 개량 설명", ["60b-academy-pick"]),
        ("farm", "농지", "산 너머 → 농지", "보초병 표(레벨 열 → 이름 옆 배지) · 잠긴 줄 획", ["61-farm"]),
        ("hospital", "병원", "산 너머 → 병원", "부상 장수 줄(이름 옆 배지 · 페널티 줄)", ["62-hospital"]),
        ("hospital-admit", "병원 — 입원시킬 장수 고르기", "병원 → [입원]", "고르기 표", ["62b-hospital-admit"]),
        ("forge", "대장간", "산 너머 → 대장간", "병기 표 머리 · 제조/보유 칸 · 해설", ["63-forge"]),
        ("forge-craft", "대장간 — 제조", "대장간 → [제조]", "제조 팝업", ["63b-forge-craft"]),
    ]),
    ("board", "6. 대자보", [
        ("board", "대자보", "메인 → 대자보", "명령 단추", ["50-board"]),
        ("ranking", "랭킹 메뉴", "대자보 → [랭킹]", "요약 판", ["51-ranking"]),
        ("ranking-city", "도시 랭킹", "랭킹 → 도시", "표 머리 · 줄", ["52-ranking-city"]),
        ("ranking-squad", "부대 랭킹", "랭킹 → 부대 → 줄 펼치기", "[구성 보기](0.56 → 0.8rem) · 구성 표(레벨 열 → 이름 옆 배지)", ["53-ranking-squad"]),
        ("ranking-officer", "장수 랭킹", "랭킹 → 장수", "레벨 열 → 이름 옆 배지 · [구성 보기]", ["54-ranking-officer"]),
        ("collection", "컬렉션", "대자보 → [컬렉션]", "시대 띠(0.6 → 0.8rem) · 줄 설명 · [랭킹 보기] · 쪽 넘김", ["55-collection"]),
        ("collection-ranking", "컬렉션 랭킹 팝업", "컬렉션 → [랭킹 보기]", "순위 줄", ["55b-collection-ranking"]),
        ("defense", "방어 기록", "대자보 → [방어 기록]", "안내문 · 기록 줄(새 기록 · 낡음 표시)", ["56-defense"]),
    ]),
    ("battle", "7. 전투", [
        ("battle-deploy", "배치", "출정 → 매칭 → 전투 (데모: ?demo=1&deploy=1)", "「자동 포커싱」(0.6 → 0.8rem) · 배치 판 · 고유기술 목록", ["80-battle-deploy"]),
        ("battle-3v3", "전투 3v3", "데모: ?demo=1&sp=25", "게임 정보 · 대화창 [...] · 순서 판 · 명령 판", ["81-battle-3v3"]),
        ("battle-5v5", "전투 5v5", "데모: ?demo=1&mode=5v5&sp=25", "SP MAX 안내 · 맥락 판", ["82-battle-5v5"]),
        ("battle-popup", "전투 — 장수 팝업", "판의 장수를 누름", "레벨 배지(등급 배지 옆) · 능력치 · 책략 칩 — 순회가 못 여는 화면", []),
        ("battle-tip", "전투 — 툴팁 · 정찰 · 책략 확인", "아이콘에 손가락 · [책략 확인]", "툴팁 본문 · 정찰 표 — 순회가 못 여는 화면", []),
        ("battle-siege", "수성전", "데모: ?demo=1&siege=1&mode=3v3", "성채 · 게임 정보", ["83-battle-siege"]),
        ("battle-duel", "일기토 · 설전", "데모: ?demo=1&duel=1", "물음 · 합 · 받는 팝업", ["84-battle-duel"]),
        ("battle-tutorial", "튜토리얼 전투", "?tutorial=basic-1", "대사 판 · 목표 표", ["85-tutorial"]),
        ("result", "결과 (승 · 패)", "전투가 끝나면", "보상 칸 · 전적", ["70-result-win", "71-result-lose"]),
        ("replay", "방어 기록 리플레이", "방어 기록 → [다시 보기]", "관전 화면 — 순회가 못 여는 화면", []),
    ]),
]


def shrink(src: Path, dst: Path, width: int) -> None:
    from PIL import Image
    im = Image.open(src).convert("RGB")
    h = round(im.height * width / im.width)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.resize((width, h), Image.LANCZOS).save(dst, quality=70, optimize=True)


def shots_of(dirs: dict[str, Path], iid: str, scenes: list[str]) -> list[dict]:
    """화면의 언어별 캡처 — 첫 장면부터 캡처가 있는 것을 쓴다. 이번에 못 찍었어도 지난번 캡처가 남아 있으면 그것을 쓴다"""
    out: list[dict] = []
    order = [(lang, label, "portrait", SHOT_W, lang, SHORT[lang]) for lang, label in LANGS]
    order.append(("ko", "한국어 · 가로", "landscape", SHOT_W_LAND, "ko-land", "KR 가로"))
    for lang, label, orient, width, folder, short in order:
        dst = SHOTS_DIR / folder / f"{iid}.jpg"
        if lang in dirs:
            for sc in scenes:
                src = dirs[lang] / f"{orient}_{sc}.jpg"
                if src.exists():
                    shrink(src, dst, width)
                    break
        if dst.exists():
            out.append({"lang": folder, "label": label, "short": short, "src": f"shots/{folder}/{iid}.jpg"})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", action="append", default=[], help="언어=순회 폴더(SHOTS=1로 돈 font_audit.ts의 OUT)")
    args = ap.parse_args()
    dirs = {lang: Path(path) for lang, _, path in (a.partition("=") for a in args.shots)}
    sections = []
    for sid, title, items in ROADMAP:
        if sid not in ACTIVE:
            continue
        sections.append({"id": sid, "title": title, "items": [
            {"id": iid, "title": name, "path": path, "focus": focus, "manual": not scenes, "closed": iid in CLOSED, "changed": CHANGED.get(iid, ""),
             "shots": shots_of(dirs, iid, scenes) if scenes and iid not in CLOSED else []}
            for iid, name, path, focus, scenes in items
        ]})
    for iid in CLOSED:
        for f in SHOTS_DIR.glob(f"*/{iid}.jpg"):
            f.unlink()
    data = {"made": date.today().isoformat(), "sections": sections}
    html = TEMPLATE.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8", newline="\n")
    n = sum(len(s["items"]) for s in sections)
    shots = sum(len(it["shots"]) for s in sections for it in s["items"])
    print(f"→ {OUT.relative_to(ROOT)} — 화면 {n}개, 캡처 {shots}장")
    return 0


TEMPLATE = (Path(__file__).resolve().parent / "font_board.template.html").read_text(encoding="utf-8")

if __name__ == "__main__":
    raise SystemExit(main())
