/**
 * 우편함 팝업 — 메인 머리의 우편 단추(죽간 서신)를 누르면 뜬다 (2026-10-21 기획자 지정, 2026-10-23 다시 짰다)
 *
 * ```
 *   ┌ 죽간 위의 종이 ─────────┐          ┌ 대자보 종이 ─────────┐
 *   │       우 편 함         │   누르면   │ 제목                │
 *   │ ● 제목         날짜 ◆  │  ──────▶  │ 날짜 · ~기한까지      │
 *   │   ~~읽은 제목~~  날짜   │           │ 본문 …   ← 본문만 스크롤 │
 *   │ …                     │           │ ┌ 보상 ──── [받기] ┐ │
 *   │      ‹ 1 / 3 ›        │           │ └─────────────────┘ │
 *   │       [닫기]          │           │      [목록으로]       │
 *   └──────────────────────┘           └────────────────────┘
 * ```
 *
 * **처음 열면 목록만**이다 — 판은 컬렉션 상세의 죽간 종이(`ui/panel-detail-bamboo.png` ← `assets/icons/ui/detail-paper.png.jpg`).
 * 줄을 누르면 그 위에 **대자보 종이**(`ui/panel-board-paper.png` ← `assets/icons/ui/대자보 패널.jpg`)로 우편 한 통이 뜬다.
 * 읽은 우편은 제목에 **먹줄(취소선)**이 그어진다 — 막 읽은 것은 상세를 닫고 목록으로 돌아올 때 줄이 그어지는 것이 보인다
 * (상세가 떠 있는 동안은 목록이 그 밑에 가려 있어, 그때 그으면 아무도 못 본다). 목록은 다섯 통씩 쪽을 넘긴다.
 * 옛 두 칸 목판은 [사용 안내]의 「지난 설명」 판이 물려받았다(`Steward.tsx`의 `GuideReplay`).
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

/** 한 쪽의 우편 수 — 다섯 (2026-10-23 기획자 「5개나 8개 단위」). 종이 높이는 이 수의 줄에 맞춘다(`.mail-list`) */
export const MAIL_PAGE_SIZE = 5;

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

  const close = (): void => { setOpenId(null); setAskLoss(null); setError(null); };

  return (
    <div className="modal-back" onClick={onClose}>
      {/* 안쪽을 누르는 것은 닫기가 아니다 — 바깥을 눌러야 닫힌다(`SettingsModal`과 같다) */}
      <div className="modal mail-modal" data-modal="mail" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-ttl fit" ref={titleRef}>{t('mail.title')}</h2>

        <div className="mail-side">
          {list.length === 0 ? (
            <p className="mail-body-none">{mails ? t('mail.empty') : ''}</p>
          ) : (
            <ul className="mail-list" data-field="mailList">
              {shown.map((m) => {
                // 지금 펼친 우편은 상세를 닫을 때 줄이 그어진다 — 그 순간이 보이게 펼쳐 둔 동안은 아직 안 그는다
                const struck = m.read && m.id !== openId;
                return (
                  <li key={m.id}>
                    <button
                      className="mail-row"
                      data-mail={m.id}
                      data-read={m.read ? '1' : '0'}
                      data-struck={struck ? '1' : '0'}
                      data-gift={m.rewards.length > 0 && !m.claimed ? '1' : '0'}
                      onClick={() => pick(m)}
                    >
                      <span className="mail-row-ttl"><span className="mail-row-ink">{mailText(m.title, lang)}</span></span>
                      <span className="mail-row-at">{formatMade(m.sentAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list.length > MAIL_PAGE_SIZE && (
            <Pager page={page} pageCount={pageCount} onPage={setPage} actionPrefix="mail" field="mailPager" />
          )}
        </div>

        <button className="btn primary wide" data-action="mailClose" onClick={onClose}>{t('settings.close')}</button>
      </div>
      {/* 우편 한 통 — 대자보 종이. 바깥(어두운 바탕)이나 [목록으로]를 누르면 목록으로.
          ★ 판(`.mail-modal`) **밖**에 둔다 — 판의 `filter: drop-shadow`가 안쪽 절대 위치의 기준이 되어, 안에 두면 가리개가 판만 덮었다 */}
      {open && (
        <div className="mail-detail-back" onClick={(e) => { e.stopPropagation(); close(); }}>
          <div className="mail-detail mail-body" data-field="mailBody" data-mail={open.id} onClick={(e) => e.stopPropagation()}>
            <h3 className="mail-body-ttl">{mailText(open.title, lang)}</h3>
            <div className="mail-body-at">
              {formatMade(open.sentAt)}
              {open.rewards.length > 0 && !open.claimed && <> · {t('mail.until', { date: formatMade(open.expiresAt) })}</>}
            </div>
            <div className="mail-body-scroll">
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
            </div>
            <button className="btn wide mail-back" data-action="mailBack" onClick={close}>{t('mail.back')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
