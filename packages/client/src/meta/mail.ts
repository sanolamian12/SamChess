/**
 * 우편함 — 화면이 그리는 우편 한 통의 모양과 읽어 오는 자리 (2026-10-21, 화면만 먼저).
 *
 * ★ **서버 쪽 우편함은 아직 없다.** 일괄 보상(관리자)을 우편함 위에 얹기로 했고(2026-10-21 기획자), 우편 표 · 받기 ·
 * 언어 · 기한 · 첨부는 정하는 중이다. 그래서 여기는 **화면이 그리는 데 필요한 것만** 적는다 — 서버가 붙으면
 * `loadMail()` 하나만 쿼리로 갈면 화면이 안 바뀐다(`recentMatches()`와 같은 자리).
 *
 * **유저끼리 글을 주고받는 우편은 없다**(기획자 확정) — 글을 쓰는 것은 운영(관리자)뿐이다. 유저 사이의 일은
 * 궁성 > 외교 같은 정해진 행동으로만 오간다(향후 기획).
 *
 * `?mail=demo`면 시험 우편을 띄운다 — 서버 없이 패널 · 쪽 넘김 · 긴 본문의 스크롤을 눈으로 보기 위한 통로다
 * (전투의 `?late=1`과 같은 결). 우편이 없으면 빈 목록이다.
 */

export interface MailItem {
  id: string;
  /** 보낸 시각(ms) */
  at: number;
  title: string;
  body: string;
  read: boolean;
}

/** 받은 우편 — 최신부터 */
export async function loadMail(): Promise<MailItem[]> {
  if (new URLSearchParams(location.search).get('mail') === 'demo') return demoMail();
  return [];
}

function demoMail(): MailItem[] {
  const day = 86_400_000;
  const now = Date.now();
  const long = Array.from({ length: 14 }, (_, i) =>
    `${i + 1}. 서버 점검 동안 접속하지 못하셨던 시간을 모두 헤아려, 군량과 금화를 함께 보내 드립니다. `
    + '앞으로도 더 안정된 전장을 마련하겠습니다.').join('\n\n');
  return Array.from({ length: 19 }, (_, i) => ({
    id: `demo-${i + 1}`,
    at: now - i * day * 1.5,
    title: i === 0 ? '서버 점검이 길어진 것을 사과드립니다 — 보상 안내' : `시험 우편 ${i + 1}`,
    body: i === 0 ? long : `시험 우편 ${i + 1}의 본문입니다.\n줄바꿈도 그대로 보입니다.`,
    read: i > 2,
  }));
}
