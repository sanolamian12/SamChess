/**
 * 안내 내관을 화면에 세우는 자리 — 띄울 안내를 받아 **물러날 때까지 붙들고**, 마지막 마디에서 「들었다」고 적는다 (2026-10-22).
 *
 * 메인(`MainScreen` — 성 안 · 산 너머 · [사용 안내] 다시 듣기)과 앱의 나머지 화면(`App`의 `ScreenGuide`)이 같은 규칙을 쓴다.
 * - **붙든다** — 마지막 마디에서 「들었다」고 적으면 계정이 바뀌어 `pendingGuide()`가 다음 것을 가리키는데, 그대로 따라가면
 *   읽던 말풍선이 그 자리에서 갈린다. 물러나면 비우고, 밀린 것이 있으면 다음 것이 들어온다.
 * - **`resetKey`가 바뀌면 비운다** — 화면(또는 성 안 ↔ 산 너머)을 옮기면 앞 화면의 말을 들고 가지 않는다.
 * - 다시 듣기(`replay`)는 「들었다」를 다시 적지 않는다.
 */

import { useCallback, useEffect, useState } from 'react';
import { guideHonor, markGuideSeen, stewardTier } from '@samchess/meta';
import type { GuideId, PlayerProfile } from '@samchess/meta';
import { Steward } from './Steward.tsx';
import { guideLines, guidesEnabled } from './guideScript.ts';

export function useGuide(
  profile: PlayerProfile,
  onChange: (next: PlayerProfile) => void,
  pending: GuideId | null,
  resetKey: string,
): { node: React.JSX.Element | null; replay: (id: GuideId) => void } {
  const [on] = useState(guidesEnabled);
  const [guide, setGuide] = useState<{ id: GuideId; replay: boolean } | null>(null);
  const want = on ? pending : null;
  useEffect(() => { setGuide(null); }, [resetKey]);
  useEffect(() => {
    if (!guide && want) setGuide({ id: want, replay: false });
  }, [guide, want]);
  const read = useCallback(() => {
    if (!guide || guide.replay) return;
    const next = markGuideSeen(profile, guide.id);
    if (next !== profile) onChange(next);
  }, [guide, profile, onChange]);
  const done = useCallback(() => setGuide(null), []);
  const replay = useCallback((id: GuideId) => setGuide({ id, replay: true }), []);

  const node = guide && (
    <Steward
      key={`${guide.id}${guide.replay ? '-replay' : ''}`}
      id={guide.id}
      tier={stewardTier(profile.cityLevel)}
      honor={guideHonor(profile)}
      lines={guideLines(guide.id, profile)}
      delayMs={guide.replay ? 150 : 700}
      onRead={read}
      onDone={done}
    />
  );
  return { node: node || null, replay };
}

/** 메인이 아닌 화면의 안내 — `App`이 지금 화면을 안내 화면으로 옮겨 넘긴다(`null`이면 아무것도 안 띄운다) */
export function ScreenGuide({ profile, onChange, pending, screenKey }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
  pending: GuideId | null;
  screenKey: string;
}): React.JSX.Element | null {
  return useGuide(profile, onChange, pending, screenKey).node;
}
