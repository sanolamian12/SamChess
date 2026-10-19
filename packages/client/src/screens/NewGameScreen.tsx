/**
 * 새 계정 — 도시 이름을 정하고 초기 장수를 받는다 (GDD §8 온보딩 4번)
 *
 * 지급은 **S·A·B·C·D 각 1명**이고, 누가 나올지는 도시 이름에서 뽑은 시드가 정한다.
 * 같은 이름이면 같은 다섯 명이 나온다 — 화면을 눈으로 비교할 때 편하다.
 *
 * **`ScreenChrome`을 두른다** (2026-08-24) — 원래는 배경 그림이 없는 맨 화면이었다.
 * 간판 화면(`TitleScreen`)과 짝을 이루는 새벽 배경(`new-city.jpg`, `npm run ui`가
 * `assets/icons/create_city.png`에서 굽는다)을 얹어 **입장(황혼) → 도시를 지음(새벽)**
 * 으로 시간대가 이어지게 했다. 입력창·시작 버튼도 같은 목판/두루마리 프레임을
 * 쓴다 — `style.css`의 `.scr-title`·`.scr-new` 공용 절 참조.
 *
 * ────────────────────────────────────────────────────────────────
 * 이름을 지은 뒤 — 가입 오프닝 (2026-10-19 기획자 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * 서버가 도시를 받아 주면 곧장 메인으로 가지 않고, 이 화면 그대로 석양 위에 첫 대사(「{id}는 구국제민의
 * 뜻을 받들어 … 다섯 인재가 모였나니」)가 뜨는 동안 다섯 장수가 다가오는 그림 일곱 장
 * (`opening/signup-2~8.jpg`, `npm run opening`)이 0.5초마다 겹쳐 넘어가다 8에서 멈춘다. 이어서 판
 * (`slot-first`, 2:1) 위 W 대형 자리에 처음 받은 다섯이 **한 명씩 「팡」 튀어나오고**(D → S, 섬광 없이 —
 * 기획자 지정), 그림자 위에 둘째 대사, 그 뒤 [성 안으로 들어가기].
 * `{id}`는 로그인 이메일의 @ 앞이다 — 이 게임에 따로 지은 이름이 없고, 계정을 가리키는 것은 그것뿐이다.
 * 누르면 8번 장면으로 파고들며 하얗게 번쩍하고(여기), 크게 뜬 메인이 줄어들며 제자리를 잡는다
 * (`App.tsx`의 `arrive` — 이 화면은 그때 이미 내려가 있다). 입장 영상은 안 튼다.
 *
 * **그림은 배경과 같은 층(`artOverlay`)에 겹친다.** 배경 `new-city.jpg`가 곧 1번 장면이라 2부터
 * 그 위에 얹으면 되는데, 층을 따로 두면 배경만 드리프트로 흔들려 겹치는 순간 그림이 어긋난다.
 * 계정은 이미 서버에 있다 — 여기서 창을 닫아도 다음 [입장]은 메인으로 간다(오프닝은 다시 안 뜬다).
 */

import { useEffect, useMemo, useState } from 'react';
import type { Grade, OfficerId } from '@samchess/rules';
import { officerById } from '@samchess/data';
import { normalizeCityName } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { GradeBadge } from './GradeBadge.tsx';
import { OfficerActionArt } from './OfficerArt.tsx';
import { pickOfficerName } from '../i18n/story.ts';
import { createProfileOnServer, startProfile } from '../meta/storage.ts';
import { currentSession } from '../meta/auth.ts';
import { playSfx } from '../audio/sfx.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { backdropStyle } from './backdrop.ts';
import { t } from '../i18n/index.ts';
import { copulaOf, josaOf } from '../ui/eventText.ts';
import { useLang } from '../i18n/useLang.ts';

/** 겹쳐 넘기는 그림 번호 — 1은 이 화면의 배경이다 */
const FRAMES = [2, 3, 4, 5, 6, 7, 8] as const;
const frameSrc = (n: number): string => `opening/signup-${n}.jpg`;
/** 한 장씩 넘기는 간격(겹침 길이도 같다 — `.ngo-frame`의 전환) */
export const OPENING_STEP_MS = 500;
/** 첫 대사 한 줄씩 떠오르는 간격 — 줄이 길어 둘째 대사보다 넉넉하다 */
const LINE_MS = 1300;
/** 둘째 대사 한 줄씩 떠오르는 간격 */
const LINE2_MS = 1100;
/** 첫 장을 얹기 전 — 입력칸이 걷히는 시간 */
const LEAD_MS = 400;
/** 첫 대사를 다 띄운 뒤 판이 뜨기까지 — 대사를 읽을 틈 */
const READ_MS = 1500;
/** 판이 뜬 뒤 첫 장수가 튀어나오기까지 */
const POP_LEAD_MS = 500;
/** 장수가 하나씩 튀어나오는 간격 (`.ngo-member`의 「팡」은 .45s) */
const POP_MS = 650;
/** 다섯째가 선 뒤 둘째 대사까지 */
const AFTER_POP_MS = 900;
/** 8번 장면으로 파고들며 하얗게 번쩍하는 길이 — `.scr-new.ngo-leaving`의 애니메이션과 같은 값 */
export const OPENING_ZOOM_MS = 700;

/**
 * 오프닝의 걸음 — 그림 넘김(첫 대사) → 판 위로 장수가 한 명씩 → 둘째 대사 → [성 안으로 들어가기] → 파고들기.
 * 파고든 뒤 메인이 줄어들며 자리 잡는 쪽은 `App.tsx`(`arrive`)가 잇는다 — 이 화면은 그때 이미 없다.
 */
type Step = 'frames' | 'roster' | 'say2' | 'enter' | 'leaving';

const GRADE_RANK: Record<Grade, number> = { E: 5, S: 4, A: 3, B: 2, C: 1, D: 0 };

/**
 * W 대형 (2026-10-19 기획자 지정) — 왼쪽부터 D · B · S · A · C, 위 줄 B · A, 아래 줄 D · S · C.
 * 크기는 C · D가 1, A · B가 1.1, S가 1.2배. `x`는 판 안쪽 폭의 %(가운데)다.
 */
const FORMATION: readonly { grade: Grade; x: number; top: boolean; scale: number }[] = [
  { grade: 'D', x: 10, top: false, scale: 1 },
  { grade: 'B', x: 30, top: true, scale: 1.1 },
  { grade: 'S', x: 50, top: false, scale: 1.2 },
  { grade: 'A', x: 70, top: true, scale: 1.1 },
  { grade: 'C', x: 90, top: false, scale: 1 },
];

export function NewGameScreen({ onStart }: { onStart: (p: PlayerProfile) => void }): React.JSX.Element {
  useLang();
  const [name, setName] = useState('');
  // 계정을 처음 만들어 이 화면에 온 순간 한 번 — 도시를 짓기 시작한다는 신호음
  useEffect(() => { playSfx('build_city'); }, []);

  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  /** 서버가 받아 준 계정 — 있으면 오프닝 중이다 */
  const [made, setMade] = useState<PlayerProfile | null>(null);
  /** 지금 얹힌 마지막 그림(1 = 배경만) */
  const [frame, setFrame] = useState(1);
  const [step, setStep] = useState<Step>('frames');
  /** 판 위에 튀어나온 장수 수(낮은 등급부터) */
  const [popped, setPopped] = useState(0);
  const id = (currentSession()?.email ?? '').split('@')[0] ?? '';
  const city = made?.cityName ?? '';
  const lines = t('newgame.say', { id, j: josaOf(id, '은는'), city, ira: copulaOf(city) }).split('\n');
  const lines2 = t('newgame.say2').split('\n');

  /** 처음 받은 다섯 — 낮은 등급부터 튀어나온다(마지막이 S) */
  const starters = useMemo(() => (made ? Object.keys(made.roster) as OfficerId[] : [])
    .map((officer) => ({ officer, grade: officerById.get(officer)?.grade ?? 'D' }))
    .sort((a, b) => GRADE_RANK[a.grade] - GRADE_RANK[b.grade]), [made]);

  // 그림은 이 화면에 들어오자마자 받아 둔다 — 이름을 짓는 동안 다 받는다
  useEffect(() => { for (const n of FRAMES) new Image().src = frameSrc(n); }, []);

  useEffect(() => {
    if (!made) return;
    const timers = FRAMES.map((n, i) => setTimeout(() => setFrame(n), LEAD_MS + i * OPENING_STEP_MS));
    // 판은 그림이 8에 서고 첫 대사가 다 뜬 뒤에
    const done = Math.max(LEAD_MS + FRAMES.length * OPENING_STEP_MS, LEAD_MS + lines.length * LINE_MS) + READ_MS;
    timers.push(setTimeout(() => setStep('roster'), done));
    return () => timers.forEach(clearTimeout);
  }, [made]);

  // 판이 뜨면 한 명씩 「팡」, 다섯이 다 서면 둘째 대사, 둘째 대사가 다 뜨면 단추
  useEffect(() => {
    if (step === 'roster') {
      const timers = starters.map((_, i) => setTimeout(() => {
        setPopped(i + 1);
        playSfx('battle_collection_open');
      }, POP_LEAD_MS + i * POP_MS));
      timers.push(setTimeout(() => setStep('say2'), POP_LEAD_MS + starters.length * POP_MS + AFTER_POP_MS));
      return () => timers.forEach(clearTimeout);
    }
    if (step === 'say2') {
      const timer = setTimeout(() => setStep('enter'), lines2.length * LINE2_MS + 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [step]);

  const enter = (): void => {
    if (!made || step !== 'enter') return;
    setStep('leaving');
    setTimeout(() => onStart(made), OPENING_ZOOM_MS);
  };
  /*
   * **서버가 받아 줘야 들어간다** (2026-09-19) — 도시 이름이 계정 사이에 고유해졌다.
   * 겹치면 「이미 있는 이름」을 말하고 입력칸에 그대로 둔다. 빈 이름은 단추가 잠긴다 —
   * 예전엔 「무명성」으로 물러났는데, 고유해진 뒤로는 그 이름도 한 도시만 가질 수 있다.
   */
  const empty = normalizeCityName(name) === '';
  const start = (): void => {
    if (busy || empty) return;
    const profile = startProfile(name);
    setBusy(true);
    setWhy(null);
    void createProfileOnServer(profile).then((r) => {
      setBusy(false);
      if (r === 'ok') setMade(profile);
      else setWhy(t(r === 'taken' ? 'city.nameTaken' : 'server.offline'));
    });
  };

  return (
    <ScreenChrome
      backdrop="backgrounds/new-city.jpg"
      className={!made ? 'scr-new' : step === 'leaving' ? 'scr-new ngo-playing ngo-leaving' : 'scr-new ngo-playing'}
      account={currentSession()?.email ?? null}
      artOverlay={made && FRAMES.map((n) => (
        <div key={n} className="ngo-frame" data-on={frame >= n ? '' : undefined} style={backdropStyle(frameSrc(n))} />
      ))}
    >
      {/* `<h1>`은 여기 안 둔다 — `ScreenChrome`이 이미 브랜드 제목을 띄운다.
          다른 `.scr-bg` 화면(`TitleScreen` 등)도 안에서 따로 제목을 안 띄운다.

          안내 글은 그림 속 반석보다 위에 오도록 별도 블록(`.newgame-guide`)으로
          뗐다 — 입력칸·버튼(`.newgame-form`)은 그대로 아래(`margin-top: auto`)에
          붙잡아 둔다(2026-08-25 피드백, 위치는 그대로 두고 글만 위로). */}
      <div className="newgame-guide">
        <p className="lede">
          {t('newgame.lede1')}<br />
          {t('newgame.lede2')}
        </p>
        <p className="hint">{t('newgame.rename')}</p>
      </div>
      <div className="newgame-form">
        <input
          className="field"
          value={name}
          maxLength={12}
          placeholder={t('newgame.namePlaceholder')}
          onChange={(e) => { setName(e.target.value); setWhy(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
          autoFocus
        />
        <button className="btn primary" data-action="startCity" onClick={start} disabled={busy || empty}>
          {t('newgame.start')}
        </button>
        {why && <p className="note" data-field="why">{why}</p>}
      </div>
      {made && (
        <div className="ngo-stage" data-modal="signupOpening" data-frame={frame} data-step={step}>
          <div className="ngo-say">
            {lines.map((line, i) => (
              <p key={i} style={{ animationDelay: `${LEAD_MS + i * LINE_MS}ms` }}>{line}</p>
            ))}
          </div>
          {step !== 'frames' && (
            <div className="ngo-roster" data-field="starters" data-popped={popped}>
              {FORMATION.map((slot) => {
                const rank = starters.findIndex((s) => s.grade === slot.grade);
                const who = starters[rank];
                if (!who || rank >= popped) return null;
                const o = officerById.get(who.officer);
                return (
                  <div
                    key={slot.grade}
                    className="ngo-member"
                    data-grade={slot.grade}
                    data-officer={who.officer}
                    data-row={slot.top ? 'top' : 'bottom'}
                    style={{ left: `${slot.x}%`, '--s': slot.scale } as React.CSSProperties}
                  >
                    <OfficerActionArt officer={who.officer} className="ngo-member-art" />
                    <span className="ngo-member-name">
                      <GradeBadge grade={slot.grade} />
                      <span className="nm">{o ? pickOfficerName(o) : who.officer}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {/* 아래 칸 — 둘째 대사(장수들의 그림자 위) + 단추. 칸은 처음부터 자리를 잡아 둔다 —
              내용이 들어올 때 칸이 생기면 가운데의 W 대형 판이 위로 밀려 올라간다 */}
          <div className="ngo-foot">
            {(step === 'say2' || step === 'enter' || step === 'leaving') && (
              <div className="ngo-say ngo-say2" data-field="say2">
                {lines2.map((line, i) => (
                  <p key={i} style={{ animationDelay: `${i * LINE2_MS}ms` }}>{line}</p>
                ))}
              </div>
            )}
            {(step === 'enter' || step === 'leaving') && (
              <button className="btn primary ngo-enter" data-action="openingEnter" onClick={enter}>
                {t('newgame.enter')}
              </button>
            )}
          </div>
          {step === 'leaving' && <div className="ngo-flash" />}
        </div>
      )}
    </ScreenChrome>
  );
}
