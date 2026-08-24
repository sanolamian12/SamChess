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
 */

import { useState } from 'react';
import type { PlayerProfile } from '@samchess/meta';
import { startProfile } from '../meta/storage.ts';
import { ScreenChrome } from './ScreenChrome.tsx';

export function NewGameScreen({ onStart }: { onStart: (p: PlayerProfile) => void }): React.JSX.Element {
  const [name, setName] = useState('');

  const start = (): void => onStart(startProfile(name));

  return (
    <ScreenChrome backdrop="backgrounds/new-city.jpg" className="scr-new" account={null}>
      <div className="newgame-form">
        {/* `<h1>`은 여기 안 둔다 — `ScreenChrome`이 이미 브랜드 제목을 띄운다.
            다른 `.scr-bg` 화면(`TitleScreen` 등)도 안에서 따로 제목을 안 띄운다. */}
        <p className="lede">
          체스 기물의 이동 규칙을 빌린 삼국지 장수 260명의 전술 대전.<br />
          먼저 도시 이름을 정한다.
        </p>
        <input
          className="field"
          value={name}
          maxLength={12}
          placeholder="도시 이름"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
          autoFocus
        />
        <button className="btn primary" onClick={start}>시작하기</button>
        <p className="hint">
          시작하면 S·A·B·C·D 등급 장수를 한 명씩 받는다.
          같은 이름으로 시작하면 늘 같은 다섯 명이 나온다.
        </p>
      </div>
    </ScreenChrome>
  );
}
