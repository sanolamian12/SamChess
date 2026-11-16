/**
 * 애니메이션 시트(18칸)의 칸 번호 · 칸 크기 — 전투 판(`poses.ts` · `BattleScene`)과 메뉴의 장수 그림(`OfficerActionArt`)이 함께 읽는다.
 * 의존이 없는 파일이다 — 메뉴 화면이 이것을 읽으려고 전투 연출 모듈을 끌어오지 않게(2026-11-16 `poses.ts`에서 뗐다).
 * `tools/build_anim_frames.py`의 `ANIM`과 같은 순서다.
 */

/**
 * 시트의 칸 번호 (왼→오) — **애니메이션 시트 18칸**(`public/anims/{id}.png`, `tools/build_anim_frames.py`의 `ANIM`과 같은 순서,
 * 2026-11-16). 다섯 자세는 0 · 4 · 9 · 10 · 14칸이고 그 사이가 Gemini로 받은 사이 칸이다. 사이 칸이 아직 없는 장수는
 * 굽는 도구가 지금 자세를 되풀이해 채워 두므로(stub) 화면은 장수를 가리지 않고 같은 칸을 읽는다.
 */
export const POSE = {
  idle: 0,
  move: 4,
  attack: 9,
  cast: 10,
  hurt: 14,
} as const;

/** 자세 사이를 잇는 칸들 — `ANIM` 표와 같은 자리 */
export const ANIM = {
  /** 차례가 와 장수를 비출 때 한 번 — 평상 → 이것 → 평상 */
  flourish: [1, 2, 3],
  /**
   * 걷기 — 이동 자세 → 사이 → 반대 발 → 사이, 되풀이. **판 한 칸에 닿을 때마다 한 칸씩** 넘긴다(2026-11-16 기획자 —
   * 부드럽게 미끄러지는 이동은 안 한다. 장수는 칸을 뛰고, 뛸 때마다 걸음이 한 칸 나아간다)
   */
  walk: [4, 5, 6, 5],
  /** 평상에서 공격 자세로 — 이 둘 뒤에 공격 자세(9) */
  windup: [7, 8],
  /** 책략 · 명상 — 되풀이 */
  cast: [10, 11, 12, 13],
  /** 퇴각 — 피격 자세 뒤에 쓰러진다. 마지막 칸으로 점멸한다 */
  fall: [15, 16, 17],
} as const;

export const FRAME_SIZE = 110;
/**
 * 애니메이션 시트 한 칸의 높이 — 아래 110²가 지금 자세의 칸이고 위 33px은 **머리 위 여백**이다(2026-11-16 기획자).
 * 치켜든 무기가 칸 위로 나가도 되게 — 판은 아래 정사각을 지금 자리에 두고 여백을 칸 위로 내밀어 그린다(`FRAME_ORIGIN_Y`).
 * `tools/build_anim_frames.py`의 `HEAD`(240 해상도에서 72 = 1.3배)와 짝이다.
 */
export const FRAME_H = 143;
/** 시트 칸의 원점 y — 아래 정사각의 가운데. 여기에 맞추면 칸이 길어져도 서 있는 자리는 옛 그대로다 */
export const FRAME_ORIGIN_Y = (FRAME_H - FRAME_SIZE / 2) / FRAME_H;
export const FRAME_COUNT = 18;
