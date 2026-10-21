/**
 * 우편함 팝업 — 메인 머리의 우편 단추(죽간 서신)를 누르면 뜬다 (2026-10-21 기획자 지정)
 *
 * ```
 *        우 편 함
 *  ┌──────┬─────────────────┐
 *  │● 제목 │ 제목              │
 *  │  날짜 │ 날짜              │
 *  │ 제목  │ 본문 …            │  ← 본문만 스크롤
 *  │  …   │                  │
 *  │‹ 1/3 ›│                  │  ← 목록은 쪽 넘김
 *  └──────┴─────────────────┘
 *           [닫기]
 * ```
 *
 * 목록 : 본문 = **1 : 3**. 화풍은 환경설정과 같은 목판(`.mod-plank`)이다 — 같은 머리 줄의 이웃이라 같은 판이어야
 * 한 벌로 읽힌다. 목록이 프레임 폭의 1/5쯤이라 쪽 넘김 단추는 이 팝업에서만 **글자 없는 화살 판**으로 줄인다
 * (`style.css`의 「우편함」절) — 읽어 주는 이름(`aria-label`)은 그대로다.
 *
 * **목록은 메인 화면이 들고 있다** — 우편 단추의 「안 읽음」 점이 같은 목록을 본다. 팝업이 따로 읽어 오면 둘이
 * 갈라진다. **읽음은 지금 화면에서만 남는다** — 서버 우편함이 아직 없다(`meta/mail.ts`). 붙으면 고른 순간 서버에 알린다.
 */

import { useMemo, useState } from 'react';
import type { MailItem } from '../meta/mail.ts';
import { t } from '../i18n/index.ts';
import { formatMade } from './ForgeScreen.tsx';
import { Pager } from './PagerButton.tsx';
import { useFitText } from './useFitText.ts';

/** 한 쪽의 우편 수 — 목록 칸 높이(`.mail-list`)에 맞춘 값이다. 바꾸면 그 높이도 함께 본다 */
export const MAIL_PAGE_SIZE = 7;

export function MailModal({ mails, onRead, onClose }: {
  /** 받은 우편 — 최신부터. `null`이면 아직 읽어 오는 중 */
  mails: MailItem[] | null;
  onRead: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const titleRef = useFitText<HTMLHeadingElement>(t('mail.title'));

  const list = mails ?? [];
  const pageCount = Math.max(1, Math.ceil(list.length / MAIL_PAGE_SIZE));
  const shown = useMemo(() => list.slice(page * MAIL_PAGE_SIZE, (page + 1) * MAIL_PAGE_SIZE), [list, page]);
  const open = list.find((m) => m.id === openId) ?? null;

  const pick = (id: string): void => {
    setOpenId(id);
    onRead(id);
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
                    onClick={() => pick(m.id)}
                  >
                    <span className="mail-row-ttl">{m.title}</span>
                    <span className="mail-row-at">{formatMade(m.at)}</span>
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
                <h3 className="mail-body-ttl">{open.title}</h3>
                <div className="mail-body-at">{formatMade(open.at)}</div>
                <p className="mail-body-txt">{open.body}</p>
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
