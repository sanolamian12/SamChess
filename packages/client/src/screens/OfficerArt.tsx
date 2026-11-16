/**
 * 장수 그림 한 장 — 기본은 수묵화 → 타일 초상화 → 빈자리 순으로 물러난다.
 *
 * 대체 규칙은 `ui/art.ts` 한 곳에 있고 여기서는 그걸 React에 붙일 뿐이다.
 * 수묵화(`assets/CharsInBattle/`)는 260명 중 일부만 있어서, 없는 장수가 더 흔하다.
 *
 * `primary="portrait"`를 주면 **순서를 뒤집어** 타일 초상화(`assets/Chars/`,
 * 전투에서 기물로 쓰는 그 그림)를 먼저 보여준다 — 장수 카드(pptx 53쪽) 전용.
 */

import { useEffect, useState } from 'react';
import { actionSheetHdUrl, actionSheetUrl, ACTION_FRAME_COUNT, animSheetHdUrl, hasArt, setOfficerArt } from '../ui/art.ts';
import { ANIM, FRAME_COUNT, FRAME_H, FRAME_SIZE, POSE } from '../battle/animSheet.ts';

export function OfficerArt({ officer, className, primary }: {
  officer: string;
  className?: string;
  primary?: 'battle' | 'portrait';
}): React.JSX.Element {
  return (
    <img
      className={className ?? 'art'}
      alt=""
      // key를 두어 장수가 바뀌면 img를 새로 만든다 — onerror 사슬이 남아 있으면
      // 이전 장수의 대체 경로로 흘러간다
      key={officer}
      ref={(el) => { if (el) setOfficerArt(el, officer, primary); }}
    />
  );
}

/** 평상 자세로 서 있는 시간 — 처음에도, 동작이 끝날 때마다도 (2026-11-16 기획자) */
const STAND_MS = 5000;
/**
 * 처음 서 있는 시간에만 더하는 어긋남(0 ~ 이만큼, 장수마다 무작위) — 한 화면에 여럿이 함께 뜨면(결과 화면 · 오프닝) 다 같은 박자로
 * 움직여 기계 같았다(2026-11-16 기획자). 그 뒤는 동작 길이가 저마다 달라 저절로 어긋난다.
 */
const START_SPREAD_MS = 1500;
const FLOURISH_FRAME_MS = 220;   // 전투 판의 평상 동작과 같은 박자
const WINDUP_FRAME_MS = 150;
const ATTACK_HOLD_MS = 900;
const CAST_FRAME_MS = 160;       // 전투 판의 책략 · 명상과 같은 박자
const CAST_LOOPS = 2;

/** 한 걸음 — 이 칸을 이만큼 */
type Step = { frame: number; ms: number };
/** 고를 수 있는 동작 — 피격 · 이동은 뺐다(2026-11-16 기획자 — 메뉴의 장수가 얻어맞거나 걷는 그림은 뜻이 없다) */
type Motion = 'flourish' | 'attack' | 'cast';
const MOTIONS: readonly Motion[] = ['flourish', 'attack', 'cast'];

/**
 * 시트 한 벌 — 칸 수, 칸의 높이(정사각 대비, 머리 위 여백이 있으면 1보다 크다), 동작마다 걸음.
 * 18칸 애니메이션 시트가 정본이고, 아직 안 구운 사람(assets 방침: 없으면 건너뛴다)은 옛 다섯 칸 시트의 자세로 물러난다.
 */
type Sheet = { url: string; frames: number; tall: number; motions: Record<Motion, readonly Step[]> };

function animSheet(officer: string): Sheet {
  const each = (frames: readonly number[], ms: number): Step[] => frames.map((frame) => ({ frame, ms }));
  return {
    url: animSheetHdUrl(officer),
    frames: FRAME_COUNT,
    tall: FRAME_H / FRAME_SIZE,
    motions: {
      flourish: each(ANIM.flourish, FLOURISH_FRAME_MS),
      attack: [...each(ANIM.windup, WINDUP_FRAME_MS), { frame: POSE.attack, ms: ATTACK_HOLD_MS }],
      cast: Array.from({ length: CAST_LOOPS }, () => each(ANIM.cast, CAST_FRAME_MS)).flat(),
    },
  };
}

/** 옛 다섯 칸 시트(평상 · 이동 · 공격 · 책략 · 피격) — 사이 칸이 없어 자세만 잠깐 띄운다. 평상 동작은 없다(서 있는 그대로) */
function poseSheet(url: string): Sheet {
  return {
    url,
    frames: ACTION_FRAME_COUNT,
    tall: 1,
    motions: { flourish: [], attack: [{ frame: 2, ms: 1200 }], cast: [{ frame: 3, ms: 1200 }] },
  };
}

/**
 * 메뉴의 장수 그림 — 상점 장수 뽑기 · 가입 오프닝 · 장수 카드(상세) · 결과 화면이 함께 쓴다.
 * **평상 자세 5초(처음만 장수마다 0~1.5초 더) → 평상 동작 · 공격 · 마법 중 하나 → 평상 자세 5초 → …** (2026-11-16 기획자 — 예전에는 대기 3초 뒤
 * 다섯 자세 중 하나를 좌우 무작위로 1~2초 띄웠다). 동작은 전투 판과 같은 18칸 시트의 사이 칸(`battle/animSheet.ts`의
 * `ANIM`)을 돈다. 좌우는 뒤집지 않는다 — 사이 칸은 오른쪽을 보는 한 벌뿐이라 뒤집으면 동작 중간에 돌아선다.
 * 칸 위 머리 위 여백은 상자 위로 내민다(전투 판과 같다 — 치켜든 무기가 잠깐 나가도 된다). 상자 크기 · 자리는 옛 그대로다.
 * 시트가 없는 장수는 18칸(`anims-hd/`) → 다섯 칸(`actions-hd/` → `actions/`) → 초상화(`OfficerArt`)로 조용히 물러난다.
 */
export function OfficerActionArt({ officer, className }: {
  officer: string;
  className?: string;
}): React.JSX.Element {
  const [sheet, setSheet] = useState<Sheet | null>(() => animSheet(officer));
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const chain = [animSheet(officer), poseSheet(actionSheetHdUrl(officer)), poseSheet(actionSheetUrl(officer))];
    let at = 0;
    let current = chain[0]!;
    setSheet(current);
    setFrame(0);
    let alive = true;
    const probe = new Image();
    probe.onerror = () => {
      if (!alive) return;
      at += 1;
      const next = chain[at];
      if (!next) { setSheet(null); return; }
      current = next;
      setSheet(next);
      probe.src = next.url;
    };
    probe.src = current.url;

    let timer: number;
    const stand = (extra = 0): void => {
      setFrame(0);
      timer = window.setTimeout(play, STAND_MS + extra);
    };
    const play = (): void => {
      const steps = current.motions[MOTIONS[Math.floor(Math.random() * MOTIONS.length)]!];
      const next = (i: number): void => {
        const step = steps[i];
        if (!step) { stand(); return; }
        setFrame(step.frame);
        timer = window.setTimeout(() => next(i + 1), step.ms);
      };
      next(0);
    };
    stand(Math.random() * START_SPREAD_MS);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [officer]);

  if (sheet === null) {
    return <OfficerArt officer={officer} className={className ?? 'art'} primary="portrait" />;
  }

  return (
    <div className={`${className ?? 'art'} ofc-action-art`} data-frame={frame}>
      <div
        className="ofc-action-frame"
        style={{
          height: `${sheet.tall * 100}%`,
          backgroundImage: `url(${sheet.url})`,
          backgroundSize: `${sheet.frames * 100}% 100%`,
          backgroundPosition: `${(frame / (sheet.frames - 1)) * 100}% 0`,
        }}
      />
    </div>
  );
}

/**
 * 꼬마 장수 — 서 있는 자세 한 칸(전투 액션 시트의 0번 칸, `actions/{id}.png`). 움직이지 않는다.
 * 부대 목록의 명단처럼 **언어와 상관없이 같은 폭**이어야 하는 자리에 쓴다(2026-11-13 기획자 — 이름 글자는 언어마다 길이가 달랐다).
 * 이름은 `title`로 남는다. 그림이 없는 장수(`hasArt`)는 빈 칸으로 자리만 지킨다.
 */
/**
 * 꼬마 그림의 장수별 크기 보정 (2026-11-14 기획자 — 「주유만 다른 캐릭터보다 조금 더 크다」, 이어 면적 상위 넷). 서 있는 칸(110²)의
 * 불투명 면적이 269명 중앙값보다 훨씬 큰 장수는 옆으로 넓은 자세라 커 보인다 — 면적이 중앙값과 같아지게 1/√면적비. 발 자리(아래 가운데)는 그대로 둔다.
 * 1.26배까지(송비 · 조휴 · 장포) 넣었다 — 그 아래(조홍 1.25 · 공손찬 1.24 · 엄안 1.22 …)는 아직. 전투 판 시트를 다시 그리면 다시 잰다(`Design/꼬마그림_크기보정_전달.md`).
 * 다른 장수를 더할 때도 같은 셈(1/√면적비)으로 — 잰 표는 `history/2026-11-14c_부대개편_공격대수비대.md`.
 */
const STAND_SCALE: Readonly<Record<string, number>> = {
  // 면적비(중앙값 대비) → 1/√ — 큰 차례
  'mun-chu': 0.84,   // 문추 1.43
  'ju-yu': 0.85,     // 주유 1.38
  'ma-yeon': 0.86,   // 마연 1.36
  'jo-jo': 0.88,     // 조조 1.30
  'song-bi': 0.89,   // 송비 1.26
  'jo-hyu': 0.89,    // 조휴 1.26
  'jang-po': 0.89,   // 장포 1.26
};

export function OfficerStand({ officer, title, className }: {
  officer: string;
  title?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={`ofc-stand${className ? ` ${className}` : ''}`}
      title={title}
      data-officer={officer}
      style={hasArt(officer) ? {
        backgroundImage: `url(${actionSheetUrl(officer)})`,
        backgroundSize: `${ACTION_FRAME_COUNT * 100}% 100%`,
        backgroundPosition: '0 0',
        ...(STAND_SCALE[officer] ? { transform: `scale(${STAND_SCALE[officer]})`, transformOrigin: '50% 100%' } : {}),
      } : undefined}
    />
  );
}
