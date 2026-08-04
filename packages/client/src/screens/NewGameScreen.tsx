/**
 * 새 계정 — 도시 이름을 정하고 초기 장수를 받는다 (GDD §8 온보딩 4번)
 *
 * 지급은 **S·A·B·C·D 각 1명**이고, 누가 나올지는 도시 이름에서 뽑은 시드가 정한다.
 * 같은 이름이면 같은 다섯 명이 나온다 — 화면을 눈으로 비교할 때 편하다.
 */

import { useState } from 'react';
import type { PlayerProfile } from '@samchess/meta';
import { startProfile } from '../meta/storage.ts';

export function NewGameScreen({ onStart }: { onStart: (p: PlayerProfile) => void }): React.JSX.Element {
  const [name, setName] = useState('');

  const start = (): void => onStart(startProfile(name));

  return (
    <div className="scr scr-new">
      <h1 className="title">삼국 약식 체스</h1>
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
  );
}
