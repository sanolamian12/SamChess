/**
 * 우편함 팝업 — 메인 머리의 우편 단추(죽간 서신)를 누르면 뜬다 (2026-10-21 기획자 지정)
 *
 * ```
 *        우 편 함
 *  ┌──────┬─────────────────┐
 *  │● 제목 │ 제목              │
 *  │  날짜 │ 날짜 · ~기한까지   │
 *  │ 제목  │ 본문 …            │  ← 본문만 스크롤
 *  │  …   │ ┌ 보상 ────────┐ │
 *  │      │ │ 금화 100 …   │ │
 *  │‹ 1/3 ›│ └──── [받기] ──┘ │  ← 목록은 쪽 넘김
 *  └──────┴─────────────────┘
 *           [닫기]
 * ```
 *
 * 목록 : 본문 = **1 : 3**. 화풍은 환경설정과 같은 목판(`.mod-plank`)이다 — 같은 머리 줄의 이웃이라 같은 판이어야
 * 한 벌로 읽힌다. 목록이 프레임 폭의 1/5쯤이라 쪽 넘김 단추는 이 팝업에서만 **글자 없는 화살 판**으로 줄인다
 * (`style.css`의 「우편함」절) — 읽어 주는 이름(`aria-label`)은 그대로다.
 *
 * **목록은 메인 화면이 들고 있다** — 우편 단추의 「안 읽음」 점이 같은 목록을 본다. 팝업이 따로 읽어 오면 둘이 갈라진다.
 *
 * **받기는 서버가 셈한다** — 화면은 받은 뒤 서버가 고친 계정으로 갈아 끼울 뿐이다. 군량이 창고 상한을 넘어 버려질 양은
 * 엔진(`mailGrainLoss`)이 내고, 그 양이 있으면 받기 전에 묻는다(「화면이 미리 보여 주는 숫자는 엔진이 낸다」).
 */

import { useMemo, useState } from 'react';
import { EQUIPMENT, marketItemById } from '@samchess/data';
import { mailGrainLoss, mailText } from '@samchess/meta';
import type { MailReward, PlayerProfile } from '@samchess/meta';
import { claimMailOnServer, readMailOnServer } from '../meta/mail.ts';
import type { MailView } from '../meta/mail.ts';
import { currentLang, t } from '../i18n/index.ts';
import { pickEquipName, pickMarketItemName, pickOfficerNameById } from '../i18n/story.ts';
import { formatMade } from './ForgeScreen.tsx';
import { Pager } from './PagerButton.tsx';
import { useFitText } from './useFitText.ts';

/** 한 쪽의 우편 수 — 목록 칸 높이(`.mail-list`)에 맞춘 값이다. 바꾸면 그 높이도 함께 본다 */
export const MAIL_PAGE_SIZE = 7;

/** 보상 한 줄 — 언어와 무관한 꼴(「이름 수」 · 「이름 ×수」). 이름만 그 언어로 */
function rewardText(r: MailReward): string {
  switch (r.kind) {
    case 'gold': return `${t('market.gold')} ${r.delta.toLocaleString()}`;
    case 'grain': return `${t('main.grain')} ${r.delta.toLocaleString()}`;
    case 'materials': return `${t('city.materials')} ${r.delta.toLocaleString()}`;
    case 'cards': return `${pickOfficerNameById(r.officer, r.officer)} ×${r.delta}`;
    case 'item': {
      const item = marketItemById.get(r.item);
      return `${item ? pickMarketItemName(item) : r.item} ×${r.delta}`;
    }
    case 'equipmentGrant': {
      const eq = EQUIPMENT.find((e) => e.id === r.equipmentId);
      return `${eq ? pickEquipName(eq) : r.equipmentId} ×${r.count}`;
    }
  }
}

export function MailModal({ profile, mails, onMail, onProfile, onClose }: {
  profile: PlayerProfile;
  /** 받은 우편 — 최신부터. `null`이면 아직 읽어 오는 중 */
  mails: MailView[] | null;
  /** 한 통이 바뀌었다(읽음 · 받음) */
  onMail: (mail: MailView) => void;
  /** 서버가 고친 계정 — 받기 뒤 */
  onProfile: (profile: PlayerProfile) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [askLoss, setAskLoss] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useFitText<HTMLHeadingElement>(t('mail.title'));
  const lang = currentLang();

  const list = mails ?? [];
  const pageCount = Math.max(1, Math.ceil(list.length / MAIL_PAGE_SIZE));
  const shown = useMemo(() => list.slice(page * MAIL_PAGE_SIZE, (page + 1) * MAIL_PAGE_SIZE), [list, page]);
  const open = list.find((m) => m.id === openId) ?? null;

  const pick = (mail: MailView): void => {
    setOpenId(mail.id);
    setAskLoss(null);
    setError(null);
    if (mail.read) return;
    // 읽음은 화면에 먼저 — 서버가 못 받아도 읽기를 막지 않는다(다음에 열면 다시 안 읽음으로 보일 뿐이다)
    onMail({ ...mail, read: true });
    void readMailOnServer(mail);
  };

  const claim = async (mail: MailView): Promise<void> => {
    setBusy(true);
    setAskLoss(null);
    setError(null);
    const r = await claimMailOnServer(mail);
    setBusy(false);
    if (!r.ok) {
      setError(t(`mail.err.${r.code}`));
      if (r.code === 'claimed') onMail({ ...mail, read: true, claimed: true });
      return;
    }
    onMail(r.mail);
    if (r.profile) onProfile(r.profile);
  };

  const onClaim = (mail: MailView): void => {
    const loss = mailGrainLoss(profile, mail);
    if (loss > 0) setAskLoss(loss);
    else void claim(mail);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      {/* 안쪽을 누르는 것은 닫기가 아니다 — 바깥을 눌러야 닫힌다(`SettingsModal`과 같다) */}
      <div className="modal mod-plank mail-modal" data-modal="mail" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-ttl fit" ref={titleRef}>{t('mail.title')}</h2>

        <div className="mail-cols">
          <div className="mail-side">
            <ul className="mail-list" data-field="mailList">
              {shown.map((m) => (
                <li key={m.id}>
                  <button
                    className={`mail-row${m.id === openId ? ' on' : ''}`}
                    data-mail={m.id}
                    data-read={m.read ? '1' : '0'}
                    data-gift={m.rewards.length > 0 && !m.claimed ? '1' : '0'}
                    onClick={() => pick(m)}
                  >
                    <span className="mail-row-ttl">{mailText(m.title, lang)}</span>
                    <span className="mail-row-at">{formatMade(m.sentAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length > MAIL_PAGE_SIZE && (
              <Pager page={page} pageCount={pageCount} onPage={setPage} actionPrefix="mail" field="mailPager" />
            )}
          </div>

          <div className="mail-body" data-field="mailBody">
            {open ? (
              <>
                <h3 className="mail-body-ttl">{mailText(open.title, lang)}</h3>
                <div className="mail-body-at">
                  {formatMade(open.sentAt)}
                  {open.rewards.length > 0 && !open.claimed && <> · {t('mail.until', { date: formatMade(open.expiresAt) })}</>}
                </div>
                <p className="mail-body-txt">{mailText(open.body, lang)}</p>
                {open.rewards.length > 0 && (
                  <div className="mail-gift" data-field="mailGift" data-claimed={open.claimed ? '1' : '0'}>
                    <div className="mail-gift-head">{t('mail.rewards')}</div>
                    <ul className="mail-gift-list">
                      {open.rewards.map((r, i) => <li key={i}>{rewardText(r)}</li>)}
                    </ul>
                    {askLoss !== null ? (
                      <div className="mail-ask" data-field="mailGrainLoss">
                        <p>{t('mail.grainLoss', { n: askLoss.toLocaleString() })}</p>
                        <div className="mail-ask-btns">
                          <button className="btn primary" data-action="mailClaimConfirm" disabled={busy} onClick={() => void claim(open)}>{t('mail.claim')}</button>
                          <button className="btn" data-action="mailClaimCancel" onClick={() => setAskLoss(null)}>{t('city.rename.cancel')}</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="btn primary mail-claim"
                        data-action="mailClaim"
                        disabled={open.claimed || busy}
                        onClick={() => onClaim(open)}
                      >{open.claimed ? t('mail.claimed') : t('mail.claim')}</button>
                    )}
                    {error && <p className="mail-err" data-field="mailError">{error}</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="mail-body-none">{mails && mails.length === 0 ? t('mail.empty') : mails ? t('mail.pick') : ''}</p>
            )}
          </div>
        </div>

        <button className="btn primary wide" data-action="mailClose" onClick={onClose}>{t('settings.close')}</button>
      </div>
    </div>
  );
}
