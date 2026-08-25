/**
 * 환경설정 팝업 — 헤더 오른쪽 기어를 누르면 뜬다 (pptx 33쪽 오른쪽)
 *
 * ```
 * 환 경 설 정
 *   ID        ⟨ID⟩ / [로그인 안 함]
 *   Language  한국어
 *             KR EN ES IT / JA MN BR PT / CN TW  (한 줄에 넷, 다음 줄로)
 *   음성 더빙  한국어
 *             KR EN BR JA CN  (다섯 — 텍스트 언어의 자동 매칭을 사람이 덮어쓴다)
 *   배경음악   끔 | 켬
 *   화면 모드  가로 | 세로
 * ```
 *
 * **어느 화면에서 열든 같은 팝업이다.** 간판·메인·궁궐·병영·장터가 전부 `ScreenChrome`을
 * 통해 이걸 연다 — 화면마다 따로 두면 항목이 하나 늘 때 다섯 군데를 고치게 된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 지금 실제로 동작하는 것과 자리만 잡아 둔 것
 * ────────────────────────────────────────────────────────────────
 *
 * | 항목 | 지금 |
 * |---|---|
 * | Language | **동작한다** — 고르면 곧바로 바뀌고 새로고침해도 남는다 |
 * | 음성 더빙 | **동작한다** — 안 고르면 Language의 자동 매칭(`DUB_FOR`)을 쓰고,
 *   고르면 그 값이 저장돼 화면 언어를 바꿔도 남는다. `playSkillVoice()`가 읽는다 |
 * | 배경음악 | **동작한다** — `M` 키와 같은 스위치다(HANDOFF 「음소거 단추를 어디에 둘지」) |
 * | ID · ID 기억 | **자리만.** 계정·로그인은 별도 세션에서 붙인다(기획자 지정) |
 * | 화면 모드 | **세로 고정.** 프레임이 1:2라 지금은 고를 것이 없다 |
 *
 * 자리만 잡아 둔 것을 「눌리는데 아무 일도 없는 스위치」로 두지 않는다 — 잠가 두고
 * 왜 잠겼는지 한 줄로 적는다. 「왜 안 되지」를 남기지 않기 위해서다.
 */

import { useLayoutEffect, useRef } from 'react';
import { bgmMuted, setBgmMuted } from '../audio/bgm.ts';
import { DUB_LANGS, LANGS, setDubLang, setLang, t } from '../i18n/index.ts';
import { useDubLang } from '../i18n/useDubLang.ts';
import { useLang } from '../i18n/useLang.ts';

/**
 * 배경음악·화면 모드 네 칩(끔/켬/가로/세로)의 공통 크기(2026-08-25 네 번째
 * 피드백). 언어마다 어느 쪽 낱말이 더 긴지가 뒤집힌다 — 한국어는 화면 모드
 * 쪽("가로"·"세로")이 더 길고, 스페인어는 거꾸로 배경음악 쪽("Desactivado")이
 * 더 길다. 고정된 `rem` 값으로는 언어마다 다시 잴 수 없어 실제 렌더된 폭을
 * 재서 맞춘다 — **가장 긴 것 하나를 기준으로 넷 다** 맞추는 게 요청이었다.
 * 자리가 모자라면(긴 번역이 두 칩을 나란히 못 넣으면) 폭 대신 글자 크기를 줄인다.
 */
function useTwoChipSize(lang: string): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    // **폭을 React state로 들고 `style` prop으로 내려주지 않는다.** 그렇게
    // 했을 때(2026-08-25 다섯 번째 피드백 — CN↔TW를 오가면 가끔 어긋남)
    // 진짜 원인은 이거였다: 잴 때마다 `c.style.width`를 먼저 지워서
    // 자연스러운 폭을 보는데, 다시 잰 값이 **직전에 React가 이미 적용해 둔
    // 값과 우연히 같으면** React의 style diff가 "바뀐 게 없다"고 보고
    // DOM을 다시 안 건드린다 — 그 사이 내가 지운 값이 그대로 남는다.
    // React는 자기가 마지막으로 그린 값과 내가 그 뒤에 DOM을 직접 건드린
    // 것을 모른다. 그래서 여기서는 처음부터 끝까지 DOM을 직접 쓴다 —
    // `useFitText`와 같은 방식이다.
    const measure = (): void => {
      const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('.two-chip'));
      if (chips.length === 0) return;
      // 먼저 강제 크기를 지우고 「제 글자만큼」 자연스러운 폭부터 잰다.
      for (const c of chips) { c.style.width = ''; c.style.fontSize = ''; }
      const baseFontSize = parseFloat(getComputedStyle(chips[0]!).fontSize) || 16;
      const naturalMax = Math.max(...chips.map((c) => c.getBoundingClientRect().width));
      const pairGap = parseFloat(getComputedStyle(chips[0]!.parentElement!).columnGap) || 0;

      // 두 칩이 나란히 들어갈 자리 — 각 줄의 폭에서 이름표(`.k`)와 그 사이
      // 간격을 뺀다. 두 줄의 이름표 길이가 다를 수 있어 더 좁은 쪽을 기준으로
      // 삼는다.
      const rows = Array.from(root.querySelectorAll<HTMLElement>('.opt-row'));
      const available = Math.min(...rows.map((row) => {
        const k = row.querySelector('.k');
        const rowGap = parseFloat(getComputedStyle(row).columnGap) || 0;
        return row.getBoundingClientRect().width - (k?.getBoundingClientRect().width ?? 0) - rowGap;
      }));

      let width = naturalMax;
      let fontSize = baseFontSize;
      if (Number.isFinite(available) && width * 2 + pairGap > available) {
        const scale = available / (width * 2 + pairGap);
        width *= scale;
        fontSize *= scale;
      }
      // 계산이 어긋나(예: 아직 자리 잡기 전이라 폭이 0) 값이 안 쓸 만하면
      // 차라리 손대지 않는다 — CSS 기본값이 유효하지 않은 값보다는 낫다.
      if (!Number.isFinite(width) || !Number.isFinite(fontSize) || width <= 0) return;
      for (const c of chips) {
        c.style.width = `${width}px`;
        c.style.fontSize = `${fontSize}px`;
      }
    };

    measure();
    // 한자 글꼴처럼 늦게 도착하는 글꼴이 있으면 그 직후 한 번 더 잰다.
    document.fonts?.ready.then(measure).catch(() => { /* 못 재도 첫 값으로 돈다 */ });
    // **여기 `ResizeObserver`를 달지 않는다** — `root` 안의 버튼 크기를 이
    // 함수 자신이 바꾸는데, 그 변화를 `root` 스스로 관찰하면 「자연 크기로
    // 지운다 → 리사이즈 감지 → 다시 잰다 → 통일된 크기를 입힌다 → (자연
    // 크기와 다르니) 또 리사이즈 감지 → …」로 끝없이 돈다. `[lang]`이 이미
    // 모든 진짜 변경 시점을 잡는다.
  }, [lang]);

  return ref;
}

/**
 * 한 줄로 있어야 할 글자가 번역이 길어 두 줄로 접힐 때, 줄바꿈 대신 글자를
 * 줄여 한 줄에 맞춘다(2026-08-25 여섯 번째 피드백 — 명패 제목·ID 상태·언어
 * 이름이 포르투갈어·몽골어·스페인어에서 두 줄이 됐다). `dep`이 바뀔 때마다
 * (그 안의 글자가 바뀔 때) 다시 잰다.
 */
function useFitText<T extends HTMLElement>(dep: unknown): React.RefObject<T | null> {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (): void => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize) || 16;
      // `.fit`(아래 CSS)가 이미 `white-space: nowrap; overflow: hidden`이라,
      // 줄바꿈 없이 쟀을 때의 실제 폭(`scrollWidth`)과 눈에 보이는 자리
      // (`clientWidth`)를 그대로 비교할 수 있다.
      const natural = el.scrollWidth;
      const avail = el.clientWidth;
      if (natural > avail && avail > 0) {
        el.style.fontSize = `${base * (avail / natural)}px`;
      }
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => { /* 못 재도 첫 값으로 돈다 */ });
    // **여기도 `ResizeObserver`를 안 단다** — `useTwoChipSize`와 같은 이유
    // (바로 위 그 주석 참조). 글자 크기를 줄이면 줄 높이가 바뀌어 `el` 자신의
    // 세로 크기가 변하고, 그걸 스스로 관찰하면 같은 끝없는 루프가 된다.
  }, [dep]);

  return ref;
}

export function SettingsModal({ signedIn, onClose }: {
  signedIn: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const lang = useLang();
  const dub = useDubLang();
  const muted = bgmMuted();
  const twoChip = useTwoChipSize(lang);
  const idValue = signedIn ?? `[${t('settings.signedOut')}]`;
  const langLabel = LANGS.find((l) => l.id === lang)?.label ?? '';
  const dubLabel = DUB_LANGS.find((d) => d.id === dub)?.label ?? '';
  const titleRef = useFitText<HTMLHeadingElement>(t('settings.title'));
  const idRef = useFitText<HTMLSpanElement>(idValue);
  const langRef = useFitText<HTMLSpanElement>(langLabel);
  const dubRef = useFitText<HTMLSpanElement>(dubLabel);

  return (
    <div className="modal-back" onClick={onClose}>
      {/* 안쪽을 누르는 것은 닫기가 아니다 — 바깥을 눌러야 닫힌다 */}
      <div className="modal" data-modal="settings" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-ttl fit" ref={titleRef}>{t('settings.title')}</h2>

        {/* 로그인 안 한 계정도 한 줄이다(2026-08-25 피드백) — 예전엔 「ID ⟨값⟩」줄과
            「로그인 됨/안 함」줄을 따로 뒀는데, 값이 없을 때 대괄호로 그 자리를
            대신하면 한 줄로 충분하다. */}
        <div className="opt-row">
          <span className="k">{t('settings.account')}</span>
          <span className="v dim fit" ref={idRef}>{idValue}</span>
        </div>

        {/* 지금 언어 이름은 「Language」와 같은 줄, 칩 열 개는 그 아래 한 줄로
            (2026-08-25 피드백) — 예전엔 이름이 칩 아래(`.hint`)에 따로 떨어져
            있었다. */}
        <div className="opt-row">
          <span className="k">{t('settings.language')}</span>
          <span className="v dim fit" ref={langRef}>{langLabel}</span>
        </div>
        <div className="langs">
          {LANGS.map((l) => (
            <button
              key={l.id}
              className={`opt${lang === l.id ? ' on' : ''}`}
              data-lang={l.id}
              onClick={() => setLang(l.id)}
            >{l.short}</button>
          ))}
        </div>

        {/* 음성 더빙 — 화면 문구는 열 언어인데 더빙은 다섯 뿐이라 기본은 문화권이
            가장 가까운 쪽으로 자동으로 맞춰 두되(`i18n`의 `DUB_FOR`), 그 매칭에
            동의하지 않는 사람도 있을 수 있어 언어 칩과 같은 모양으로 직접 고르게
            둔다(2026-08-26). 값은 `localStorage`에 따로 저장되고 화면 언어를
            바꿔도 유지된다 — `setDubLang()` 참조. */}
        <div className="opt-row">
          <span className="k">{t('settings.voice')}</span>
          <span className="v dim fit" ref={dubRef}>{dubLabel}</span>
        </div>
        <div className="langs">
          {DUB_LANGS.map((d) => (
            <button
              key={d.id}
              className={`opt${dub === d.id ? ' on' : ''}`}
              data-dub={d.id}
              onClick={() => setDubLang(d.id)}
            >{d.short}</button>
          ))}
        </div>

        {/* 배경음악·화면 모드 — 언어 칩과 같은 「둘 중 하나를 고른다」 모양으로
            통일한다(2026-08-25 피드백). 끔/가로가 왼쪽, 켬/세로가 오른쪽.
            네 칩의 크기는 `useTwoChipSize`가 실제로 재서 맞춘다(DOM을 직접
            건드린다 — 훅 주석 참조) — 이 `ref`가 둘 다 감싸야 「가장 긴 것」을
            넷 중에서 고를 수 있다. */}
        <div ref={twoChip}>
          <div className="opt-row">
            <span className="k">{t('settings.sound')}</span>
            <div className="v two">
              <button className={`opt two-chip${muted ? ' on' : ''}`} data-action="mute-off" onClick={() => setBgmMuted(true)}>{t('settings.soundOff')}</button>
              <button className={`opt two-chip${muted ? '' : ' on'}`} data-action="mute-on" onClick={() => setBgmMuted(false)}>{t('settings.soundOn')}</button>
            </div>
          </div>

          <div className="opt-row">
            <span className="k">{t('settings.orientation')}</span>
            {/* 프레임이 1:2 고정이라 가로는 고를 게 없다(pptx 20쪽) — 그래서 잠가
                두되, 「눌리는데 아무 일도 없는 스위치」가 되지 않게 세로만 실제로
                선택된 상태로 보여 준다. */}
            <div className="v two">
              <button className="opt two-chip" disabled>{t('settings.landscape')}</button>
              <button className="opt two-chip on" disabled>{t('settings.portrait')}</button>
            </div>
          </div>
        </div>

        <button className="btn primary wide" onClick={onClose}>{t('settings.close')}</button>
      </div>
    </div>
  );
}
