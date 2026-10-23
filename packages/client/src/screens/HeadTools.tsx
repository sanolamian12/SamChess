/**
 * 머리 줄의 우편함 · 사용 안내 — **기어 옆에 늘 떠 있다** (2026-10-23 기획자 지정 — 그 전에는 메인 화면에만 있었다)
 *
 * ```
 *  만인의 삼국지                 [우편] [안내] [기어]
 * ```
 *
 * 어느 화면이든 머리 줄은 `ScreenChrome` 하나가 그린다. 그래서 두 단추도 거기에 선다 — 화면마다 따로 달면 하나가 빠진다.
 * 다만 **우편 목록 · 팝업 · 지난 설명은 화면을 넘어 살아야** 한다(안 읽음 점이 화면을 옮길 때마다 깜빡이면 안 된다).
 * 그래서 `App`이 이 층(`HeadToolsLayer`)을 한 번 두르고, 단추는 문맥(`HeadToolsContext`)으로 `ScreenChrome`에 내려 준다.
 *
 * 안 서는 곳 — 간판 · 도시 이름 짓기(계정이 없다) · 전투 셋 · 매칭 · 결과(`TOOLS_OFF`). 전투와 그 앞뒤는 시선을 뺏으면 안 된다.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { guideHonor, guideShelves, stewardTier } from '@samchess/meta';
import type { GuideChapter, GuideId, PlayerProfile } from '@samchess/meta';
import { loadMail } from '../meta/mail.ts';
import type { MailView } from '../meta/mail.ts';
import { t } from '../i18n/index.ts';
import { MailModal } from './MailModal.tsx';
import { GuideReplay, Steward } from './Steward.tsx';
import { guideLines, guideTitle } from './guideScript.ts';

/** `ScreenChrome`이 머리 줄 기어 왼쪽에 세울 단추들 — 없으면(`null`) 안 세운다 */
export const HeadToolsContext = createContext<React.ReactNode>(null);
export const useHeadTools = (): React.ReactNode => useContext(HeadToolsContext);

export function HeadToolsLayer({ profile, onChange, on, refreshKey, chapter, children }: {
  profile: PlayerProfile | null;
  onChange: (next: PlayerProfile) => void;
  /** 이 화면에 단추를 세우나 — 계정이 있고 전투 · 매칭 · 결과가 아닐 때 */
  on: boolean;
  /** 바뀌면 우편을 다시 읽어 온다 — 메인으로 돌아올 때(예전에 메인이 들어올 때마다 읽던 것과 같은 때) */
  refreshKey: string;
  /** 지금 화면이 「지난 설명」의 어느 1단인가 — 열면 그 칸이 펼쳐져 있다 */
  chapter: GuideChapter | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const signedIn = profile !== null;
  const [mailOpen, setMailOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  /** 다시 듣는 안내 — 「들었다」를 다시 적지 않는다 */
  const [replayId, setReplayId] = useState<GuideId | null>(null);
  /** 받은 우편 — 단추의 「안 읽음」 점과 팝업이 **같은 목록**을 본다. `null`이면 읽어 오는 중 */
  const [mails, setMails] = useState<MailView[] | null>(null);
  useEffect(() => {
    if (!signedIn) { setMails(null); return; }
    let alive = true;
    void loadMail().then((m) => { if (alive) setMails(m); });
    return () => { alive = false; };
  }, [signedIn, refreshKey]);
  // 단추가 사라지는 화면으로 옮기면 떠 있던 팝업도 접는다
  useEffect(() => { if (!on) { setMailOpen(false); setReplayOpen(false); } }, [on]);
  const unread = mails?.filter((m) => !m.read).length ?? 0;

  const tools = on && profile ? (
    <>
      <button className="head-tool" data-action="mail" data-unread={unread} aria-label={t('mail.open')} onClick={() => setMailOpen(true)}>
        <img src="icons/mail.png" alt="" />
        {unread > 0 && <span className="head-dot" aria-hidden="true" />}
      </button>
      {/* 사용 안내 — 안내 내관이 한 지난 설명을 골라 다시 듣는다 (2026-10-22, pptx 114쪽) */}
      <button className="head-tool" data-action="info" aria-label={t('info.open')} title={t('info.open')}
        onClick={() => setReplayOpen(true)}>
        <img src="icons/info.png" alt="" />
      </button>
    </>
  ) : null;

  return (
    <HeadToolsContext.Provider value={tools}>
      {children}
      {profile && replayOpen && (
        <GuideReplay
          // 3단 분류(2026-10-23 기획자) — 메인 화면 · 건물 → (메인만) 여덟 갈래 → 안내. 들은 것만, 대본 차례로
          shelves={guideShelves(profile)}
          initial={chapter}
          titleOf={guideTitle}
          onPick={(id) => { setReplayOpen(false); setReplayId(id); }}
          onClose={() => setReplayOpen(false)}
        />
      )}
      {profile && mailOpen && (
        <MailModal
          profile={profile}
          mails={mails}
          onMail={(mail) => setMails((cur) => cur?.map((m) => (m.id === mail.id ? mail : m)) ?? cur)}
          onProfile={onChange}
          onClose={() => setMailOpen(false)}
        />
      )}
      {profile && replayId && (
        <Steward
          key={`${replayId}-replay`}
          id={replayId}
          tier={stewardTier(profile.cityLevel)}
          honor={guideHonor(profile)}
          lines={guideLines(replayId, profile)}
          delayMs={150}
          onRead={() => { /* 다시 듣기는 「들었다」를 다시 적지 않는다 */ }}
          onDone={() => setReplayId(null)}
        />
      )}
    </HeadToolsContext.Provider>
  );
}
