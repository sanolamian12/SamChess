/**
 * 레벨업 고르기 — 장수 카드(`OfficerCardModal`) 위에 겹쳐 뜨는 판 (2026-09-02)
 *
 * ★ **2026-11-20 기획자 — 카드의 [레벨/스킬 관리]가 [강화]가 되며 「관리」 걸음을 걷었다.** [강화]는 올릴 수 있을 때만
 * 켜지고, 누르면 곧장 아래 「고르기」(`Picker`)다 — 오르면 카드로 돌아간다. 보유 카드 수는 [강화] 오른쪽 끝, 도시 상한은
 * 카드 위의 사람이 말한다(`OfficerDetailModal`). 보유 책략은 카드가 이미 보여 준다. 아래 옛 기록의 「관리」 몸통 이야기는 그때의 것이다.
 *
 * ★ **같은 날 고르기 판도 다시 그렸다** — 금테 두 절 · 캡슐 줄(체크 나무판 걷음) · 책략 토글 둘 + 설명 판 하나 ·
 * [확정] 아래 [뒤로 가기]. 아래 「두루마리 두 장」 이야기는 그때의 것이다. 자세한 것은 `Picker`의 머리말, 눈 확인은 `tools/levelup_ux.ts`.
 *
 * 장수 일람의 「보기」 카드에서 [레벨/스킬 관리]를 누르면 예전에는 전면 화면
 * (`LevelUpScreen`)으로 넘어갔다 — 카드가 이미 보여 준 그림·능력치·책략·인물
 * 소개를 다시 보여줄 뿐인 화면으로, 디자인도 궁궐 나머지와 다른 옛 평면
 * 화풍이었다. 이 패널은 **전면 전환 없이** 카드 위에 겹쳐 뜬다 — [뒤로]는
 * 곧 [X]이고, 닫으면 그 자리(카드)로 돌아온다. [전적 보기]로 가는 길은 없다
 * (카드 자체의 [전적 보기]가 이미 있다).
 *
 * ────────────────────────────────────────────────────────────────
 * 「관리」 몸통을 다시 그렸다 — HP·MP·AT·스탯 찍은 횟수·지원책/환술 갈라 적기
 * 대신 「보유 책략」 한 목록
 * ────────────────────────────────────────────────────────────────
 *
 * 카드가 이미 HP·MP·AT를 보여준다(`OfficerCard`의 `.ofcard-bar-lv`) — 여기서
 *또 적으면 같은 화면 안에 같은 숫자가 두 번 뜬다. 지원책·환술을 줄로 가르던
 * 것도 「목록 하나, 학파는 색으로만」로 접었다 — 지원책은 초록,
 * 환술은 보라(GDD의 학파 색과 같다, `.ofc-tactics .chip`이 이미 쓰던 색).
 *
 * **2026-09-03 재지정 — 두루마리 한 장에 흘려 담는다.** 한 책략이 한 줄씩
 * 먹던 버튼형 목록을 접고, 두 줄 높이의 두루마리(`ui/field-frame.png`) 안에
 * 「이름+아이콘」을 나열한다(`.lvp-tactic-field`). 아이콘 그림은 **아직
 * 없다** — `TacticIcon`이 없으면 조용히 빼므로 파일만 나중에 놓으면 뜬다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「고르기」·재설계 확인은 새로 안 그린다
 * ────────────────────────────────────────────────────────────────
 *
 * [레벨 업]을 누르면 여는 능력·책략 선택 UI(`Picker`)는 이 파일 끝에 있다 —
 * 예전 전면 화면(`LevelUpScreen.tsx`)이 내보내던 것을 그 화면을 지우며(2026-10-06) 옮겨 왔다.
 *
 * ★ **[재설계]는 여기서 지웠다** (2026-09-24, pptx 88쪽 — 기획자 확정). 둔갑천서는 이제
 * **장터 [도시 물자]에서 사고 그 자리에서 쓴다**(`MarketScreen`의 재설계). 두 곳에 두면
 * 값·설명이 한쪽만 낡는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 이중 모달 — 뒤 패널(카드)은 눌리지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * `.lvp-back`이 화면 전체를 덮는 두 번째 가리개다(`.modal-back`보다 `z-index`가
 * 높다) — 카드의 [X]를 포함해 뒤에 있는 모든 것이 이 가리개 아래 깔려 클릭을
 * 받지 못한다. **앞에 뜬 패널만** 조작된다.
 *
 * **판의 윗변은 카드 그림(`.ofcard-art`)이 끝나는 바로 그 지점이다**
 * (2026-09-02 두 번째 지정 — "캐릭터 이미지가 끝나는 바로 끝지점으로"). 재는
 * 자리는 `useOfficerCardOverlayPos()`(`RankingCommon.tsx`) 하나다.
 *
 * ────────────────────────────────────────────────────────────────
 * 세 번째 지정 — 개발용은 상점으로, 글자 크기 통일, 버튼 화풍 통일
 * ────────────────────────────────────────────────────────────────
 *
 * **개발용 카드·금화 지급은 지웠다** — 상점(`MarketScreen`)이 생겨 그리로
 * 옮겼다(장수를 고를 수 있게 목록으로 늘렸다, 여긴 한 명뿐이라 못 하던 것).
 * **[레벨 업]은 옥색 목판**(`ui/btn-primary.png`, 2026-10-23 — 궁궐 [변경]과 같은 값),
 * [재설계]는 참나무 목판(`.scr-officers .btn:not(.ghost):not(.primary)`)이다. **작은 안내 글자 셋**(보유 카드 줄·
 * 「보유 책략」 이름표·빈 상태 "없음")은 전부 `.lvp-line`(.72rem, 옅은 잿빛) —
 * 예전엔 각자 다른 클래스(`.row`·`.cap`·`.dim`)를 썼다가 크기가 제각각으로
 * 보였다. **재설계 잠김 이유 문구는 지웠다** — "Lv1은 아직 올린 적이 없다"
 * 처럼 뻔한 이유까지 늘 띄워 둘 필요는 없다는 피드백이다(단, 그 판단은 이
 * 패널에 한정한다 — 전면 화면 `LevelUpScreen`은 원래 방침대로 그대로 보여준다).
 */

import { useRef, useState } from 'react';
import { officerById, tacticById } from '@samchess/data';
import { isTerrainTactic } from '@samchess/rules';
import type { OfficerId, TacticId } from '@samchess/rules';
import {
  cardsToLevelUp, growthPreview, tacticChoices,
} from '@samchess/meta';
import type { OfficerInstance, PlayerProfile, StatPick, StatPreview } from '@samchess/meta';
import { Say } from './Steward.tsx';
import { levelUpOnServer } from '../meta/city.ts';
import { stripBackArrow, useOfficerCardOverlayPos } from './RankingCommon.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName, pickTacticName, pickTacticText } from '../i18n/story.ts';
import { GradeBadge } from './GradeBadge.tsx';
import { TacticIcon } from './TacticIcon.tsx';
import { BusyVeil } from './BusyVeil.tsx';
import { Celebrate } from './Celebrate.tsx';
import { LevelBadge } from './LevelBadge.tsx';

/** HP · MP · AT 칸의 아이콘 — 글자(`HP`)는 올리면 보인다 */
/** HP · MP · AT 줄 앞의 금테 메달(`build_icons_composed.py`의 `ic_stat_*_badge`, 도적 메달과 같은 테) — 2026-11-20 기획자 */
const STAT_ICON: Record<StatPick, string> = {
  hp: 'icons/stat/stat-hp-badge.png', mp: 'icons/stat/stat-mp-badge.png', at: 'icons/stat/stat-at-badge.png',
};

export function LevelUpPanel({ profile, officer, onChange, onClose }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onChange: (p: PlayerProfile) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  useLang();
  /** 레벨업을 서버가 거절했거나 못 닿았다 — 그 말을 그대로 적는다 (2026-09-14, A1) */
  const [respecNote, setRespecNote] = useState<string | null>(null);
  /** 레벨업을 서버에 보내는 중 — [확정]을 두 번 눌러도 한 번만 나간다 (2026-09-14, A2) */
  const committing = useRef(false);
  /** 같은 사실을 화면에 — 왕복이 길면 가리개가 뜬다(`BusyVeil`, 2026-10-23). 「멈춘 것」과 「기다리는 것」은 다르다 */
  const [busy, setBusy] = useState(false);
  /** 올랐다 — 축하 판(`Celebrate`)을 띄운다. [확인]에 카드로 (2026-11-20 기획자 — 「레벨을 올리는 중」 뒤 그냥 닫혀 밋밋했다) */
  const [done, setDone] = useState<{ level: number; row: StatPreview; tactics: TacticId[] } | null>(null);
  // 'top' — 카드(`.ofcard`) 시작점과 같은 y에서 뜬다(2026-09-03 재지정 — "장수정보 패널과 똑같이")
  const { backRef, backStyle, modalStyle } = useOfficerCardOverlayPos('top');

  const inst = profile.roster[officer];
  const data = officerById.get(officer);

  if (done && data) {
    // 축하 — 팔뚝 위에 **오른 레벨** 배지(서버가 준 계정의 값)가 내려찍히고, 아래는 장수 · 고른 능력의 오름 · 새 책략.
    // 숫자는 고르기 판이 보여 준 것과 같은 엔진 값(`growthPreview`)이다
    return (
      <Celebrate
        modal="levelUpDone"
        className="lvd"
        title={t('levelup.done.title')}
        art={<img className="cel-art-img" src="ui/cel-levelup.png" alt="" />}
        badge={<LevelBadge level={done.level} className="cel-badge-img" />}
        big={(
          <span className="lvd-who" data-level={done.level}>
            <GradeBadge grade={data.grade} />
            <span className="lvd-name">{pickOfficerName(data)}</span>
          </span>
        )}
        onClose={onClose}
      >
        <p className="lvd-row" data-field="doneStat" data-stat={done.row.key}>
          <img className="lvd-medal" src={STAT_ICON[done.row.key]} alt="" />
          <b>{done.row.key.toUpperCase()}</b>
          <span>{show(done.row, 'now')}</span>
          <img className="lvd-arrow" src="ui/turn/arrowhead.png" alt="→" />
          <b className="lvd-next">{show(done.row, 'next')}</b>
        </p>
        {done.tactics.length > 0 && (
          <p className="lvd-row" data-field="doneTactic" data-school={tacticById.get(done.tactics[0]!)?.school}>
            <img className="lvd-medal" src="icons/control/cmd-tactic-badge.png" alt="" />
            <span className="lvd-k">{t('levelup.tactic')}</span>
            {done.tactics.map((id) => tacticById.get(id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => (
              <span key={x.id} className="lvd-tac"><TacticIcon id={x.id} className="lvd-tac-icon" />{pickTacticName(x)}</span>
            ))}
          </p>
        )}
      </Celebrate>
    );
  }

  // 카드의 [강화]는 올릴 수 있을 때만 켜진다 — 정상 경로로는 안 온다, 방어만 해 둔다
  if (!inst || !data || cardsToLevelUp(inst.level) === null) return null;

  return (
    <div
      className="lvp-back"
      ref={backRef}
      data-modal="levelup"
      onClick={onClose}
      style={backStyle}
    >
      <div
        className="place-panel lvp-modal"
        data-screen="levelup-panel"
        data-officer={officer}
        data-step="levelup"
        data-growth={inst.growth.length}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ofcard-close" data-action="closeLevelUp" onClick={onClose} aria-label={t('ranking.card.close')}>
          <img className="ofcard-close-icon" src="icons/close.png" alt="" />
        </button>

        <h3 className="lvp-title">
          <GradeBadge grade={data.grade} />
          {' '}{pickOfficerName(data)}{' '}
          {/* **올라갈 레벨**을 보여준다 */}
          <LevelBadge level={inst.level + 1} className="lv" />
        </h3>

        <Picker
          inst={inst}
          onBack={onClose}
          onCommit={(stat, school) => {
            /*
             * **레벨업은 서버가 한다** (2026-09-14, A2) — `roster`·`cards`가 서버 소유라 로컬로
             * 올려 `PUT`하면 되돌아간다. **결과가 올 때까지 닫지 않고**, 그 사이 [확정]을 또
             * 눌러도 한 번만 나간다. 오르면 축하 판(`Celebrate`) → [확인]에 카드로 — 카드가 넉넉하면 [강화]를 다시 누른다.
             */
            if (committing.current) return;
            committing.current = true;
            // 축하 판에 실을 것 — 고르기 판이 보여 준 그 값(엔진)을 보내기 전에 잡는다
            const row = growthPreview(inst, stat).find((r) => r.key === stat)!;
            const gained = tacticChoices(inst.level + 1)[school];
            setBusy(true);
            setRespecNote(null);
            void (async () => {
              try {
                const fromServer = await levelUpOnServer(officer, stat, school);
                if (fromServer) {
                  onChange(fromServer);
                  // 오른 레벨은 서버가 준 계정에서 읽는다(+1로 짐작하지 않는다 — 도시 증축 축하와 같은 규약)
                  setDone({ level: fromServer.roster[officer]?.level ?? inst.level + 1, row, tactics: gained });
                }
                else setRespecNote(t('server.offline'));
              } catch (err) {
                setRespecNote(err instanceof Error ? err.message : String(err));
              } finally {
                committing.current = false;
                setBusy(false);
              }
            })();
          }}
        />
        <Say text={respecNote} name="respecNote" repeat />
      </div>

      {/* 레벨업은 서버 왕복이다 — `.lvp-back`(z 55) 안에서 판까지 덮는다. 클릭은 가리개가 먹어
          가리개 뒤의 「바깥 누르면 닫기」도 안 걸린다 */}
      {busy && <BusyVeil label={t('levelup.busy')} />}
    </div>
  );
}

// ── 고르기 (예전 `LevelUpScreen.tsx`에서 옮겨 왔다, 2026-10-06) ──

type School = 'support' | 'illusion';

/** `2.5` → `2.5`, `2` → `2`. 소수점 뒤 0을 남기면 「+2.0」처럼 어수선하다 */
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * 「고르기」 — 능력 택1 + 책략 택1 (2026-11-20 기획자 개편).
 *
 * - **두 절을 제 판에 담는다**(`.lvu-sec`) — 「전투력」은 고유기술 판(`panel-battle-skill`), 「새 책략」은 전투 명령 판
 *   (`panel-battle-command`). 절 이름은 판 밖 왼쪽 벽에, 앞에 금테 메달(전투 명령 판의 [공격] · [책략] 그림을 도적 메달과 같은
 *   입체 금테에 담은 것, `SecHead`). 「택1」은 뺐다 — 토글이 그렇게 이끈다.
 * - **능력 줄은 붓 획 한 줄**(`.lv-stat-row`) — 장수 상세의 숫자 밑줄과 같은 붓 획 · 같은 색(HP 옥색 · MP 청회색 · AT 쪽빛).
 *   앞에 금테 메달 + 「HP」 이름, 화살표는 내 차례 표지의 화살촉이 좌우로. 고른 줄은 제 색의 네온이 천천히 들어왔다 빠진다(장수 일람 정렬 머리와 같은 결).
 * - **책략은 토글 둘 + 설명 판 하나** — 토글은 병기 | 아이템 토글과 같은 속판(지원책 비취 · 환술 보라), 테만 붉은 옻칠 대사 판(`dialog-line`)의 테.
 *   설명 판은 둘을 **같은 칸에 겹쳐** 두고 고른 쪽만 보인다. 높이는 **고정**
 *   (열 언어 × 모든 레벨 중 가장 긴 것, `tools/levelup_ux.ts`의 `MEASURE=1`).
 * - 단추는 [확정] 아래 [뒤로 가기](카드의 [뒤로 가기]와 같은 판).
 */
function Picker({ inst, onCommit, onBack }: {
  inst: OfficerInstance;
  onCommit: (stat: StatPick, school: School) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [stat, setStat] = useState<StatPick>('hp');
  const [school, setSchool] = useState<School>('support');

  const level = inst.level + 1;
  // **「보여주는 증분」과 「실제 결과」는 다른 값이다** (2026-09-03 다섯·여섯 번째 지정).
  //
  // | 칸 | 뜻 | 예 (HP를 골랐을 때 MP 줄) |
  // |---|---|---|
  // | `now`  | 지금 값 | `5` |
  // | `add`  | **고르면** 오를 양 — 흐리게, 실제로는 안 더해진다 | `+2` |
  // | `next` | **실제로** 적용될 값 — 안 고른 줄은 `now` 그대로 | `5` |
  //
  // 그래서 `next`·`range`는 「지금 고른 것」 기준(`growthPreview(inst, stat)`)을
  // 그대로 두고, `add`만 줄마다 제 것을 골라 따로 물어 얹는다. 흐린 증분까지
  // 오른쪽 결과에 반영하면 「MP가 7이 된다」는 거짓말이 된다 — 실제로 오르는 건
  // 고른 하나뿐이다. 어느 쪽이든 숫자를 내는 것은 언제나 엔진이다.
  const gains = new Map((['hp', 'mp', 'at'] as StatPick[]).map(
    (key) => [key, growthPreview(inst, key).find((r) => r.key === key)!.add] as const,
  ));
  const rows = growthPreview(inst, stat).map((row) => ({ ...row, add: gains.get(row.key)! }));
  const choices = tacticChoices(level);
  // 그 레벨에 지원이 없으면(지금 데이터에는 없지만) 고를 수 있는 쪽으로 물러난다
  const pickedSchool: School = choices[school].length > 0 ? school : (school === 'support' ? 'illusion' : 'support');
  const schools = (['support', 'illusion'] as School[]).map((s) => ({
    s,
    list: choices[s].map((id: TacticId) => tacticById.get(id)).filter((x): x is NonNullable<typeof x> => !!x),
  }));

  return (
    <>
      {/* 절 이름은 판 밖, 왼쪽 벽에 붙여 — 아이콘은 동그란 금테 배지 (2026-11-20 기획자) */}
      <SecHead icon="icons/control/cmd-attack-badge.png" text={t('levelup.physical')} sec="physical" />
      <section className="lvu-sec" data-sec="physical" data-picker={level}>
        <div className="lv-stats">
          {rows.map((row) => (
            <button
              key={row.key}
              className={`opt lv-stat-row${stat === row.key ? ' on' : ''}`}
              data-stat={row.key}
              data-add={fmt(row.add)}
              aria-pressed={stat === row.key}
              onClick={() => setStat(row.key)}
            >
              <span className="lv-stat">
                <span className="c-k">
                  {/* 광택(`.lvu-shine`)은 고른 줄의 메달에만 — CSS가 `.on`으로 가른다 */}
                  <span className="lvu-shine lvu-stat-shine"><img className="lvu-stat-medal" src={STAT_ICON[row.key]} alt="" /></span>
                  {/* 「HP」 · 「MP」 · 「AT」 — 번역 없이 그대로 쓰는 약어 */}
                  <span className="lvu-stat-name">{row.key.toUpperCase()}</span>
                </span>
                <span className="c-now">{show(row, 'now')}</span>
                <span className="c-add">+{fmt(row.add)}</span>
                {/* 화살촉 — 내 차례 표지(`battle_myturn`) 둘째 칸을 오른쪽으로 눕혀 좌우로 흔든다 */}
                <span className="c-arrow" aria-label="→"><img src="ui/turn/arrowhead.png" alt="" /></span>
                <span className="c-next">{show(row, 'next')}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <SecHead icon="icons/control/cmd-tactic-badge.png" text={t('levelup.tactic')} sec="tactic" />
      <section className="lvu-sec" data-sec="tactic">
        {/* 토글 둘 — 지원책 | 환술. Lv6·7의 지원은 「화계 + 진화」처럼 **한 쌍이 한 선택지**라 엠블럼 · 이름이 둘이다 */}
        <div className="lvu-tabs" role="tablist">
          {schools.map(({ s, list }) => (
            <button
              key={s}
              className={`lvu-tab${pickedSchool === s ? ' on' : ''}`}
              role="tab"
              aria-selected={pickedSchool === s}
              data-school={s}
              data-on={pickedSchool === s ? '1' : '0'}
              disabled={list.length === 0}
              onClick={() => setSchool(s)}
            >
              {/* 옛 붓 획 칸 — 지금은 `display: contents`라 상자가 없다(기획자가 토글의 붓 획을 걷었다) */}
              <span className="lvu-tab-ink">
                <span className="lvu-tab-icons">
                  {list.map((x) => <TacticIcon key={x.id} id={x.id} className="lvu-tab-icon" />)}
                </span>
                <span className="lvu-tab-txt">
                  <span className="lvu-tab-name" data-field="tacticName">
                    {list.length === 0 ? t('levelup.none') : list.map((x) => pickTacticName(x)).join(' + ')}
                  </span>
                  <span className="lvu-tab-school">{t(s === 'support' ? 'academy.school.support' : 'academy.school.illusion')}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
        {/* 설명 판 하나 — 두 학파의 설명을 같은 칸에 겹쳐 두고 고른 쪽만 보인다(판 높이는 긴 쪽). 안의 꼴은 책략 두루마리
            (`TacticModal`)와 같은 `.lv-tactic-*` — 이름 + 소모 MP, 효과문, 발동 조건 */}
        <div className="lvu-desc" data-field="tacticDesc" data-school={pickedSchool}>
          {schools.map(({ s, list }) => (
            <div key={s} className="lvu-desc-item" data-school={s} data-on={pickedSchool === s ? '1' : '0'} aria-hidden={pickedSchool !== s}>
              {list.map((x) => (
                <div key={x.id} className="lvu-desc-one">
                  <span className="lv-tactic-label">
                    {pickTacticName(x)}{' '}
                    {/* 「MP」는 `HP`/`AT`처럼 번역 없이 그대로 쓰는 약어다 */}
                    <span className="lv-tactic-mp">(MP: {x.mpCost})</span>
                  </span>
                  <span className="lv-tactic-text">{pickTacticText(x)}</span>
                </div>
              ))}
              {/* 발동 조건 — `FORMULA.supportRate`·`illusionRate`·`terrainRate`를 말로 옮긴 문구(`levelup.trigger.*`).
                  **학파가 아니라 책략이 정한다** — 칸에 거는 화계·진화는 엔진의 `isTerrainTactic()`에 묻는다 */}
              {list.length > 0 && (
                <span className="lv-tactic-cond">
                  {t(list.every((x) => isTerrainTactic(x))
                    ? 'levelup.trigger.terrain'
                    : s === 'support' ? 'levelup.trigger.support' : 'levelup.trigger.illusion')}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="lv-acts">
        <button className="btn primary wide" data-action="confirm" onClick={() => onCommit(stat, pickedSchool)}>
          <span className="lbl">{t('levelup.confirm')}</span>
        </button>
        {/* [뒤로 가기] — 카드의 [뒤로 가기]와 같은 판 · 같은 글자. 누르면 [X]처럼 카드로 */}
        <button className="btn wide lvu-back" data-action="stepBack" onClick={onBack}>
          <span className="lbl">{stripBackArrow(t('match.back'))}</span>
        </button>
      </div>
    </>
  );
}

/** 절 이름 — 판 밖 왼쪽, 앞에 금테 메달(전투 명령 판의 [공격] · [책략] 그림, `ic_cmd_*_badge`) */
function SecHead({ icon, text, sec }: { icon: string; text: string; sec: string }): React.JSX.Element {
  return (
    <h4 className="lvu-head" data-sec={sec}>
      <span className="lvu-shine lvu-head-shine" aria-hidden="true"><img className="lvu-medal" src={icon} alt="" /></span>
      <span className="lvu-head-txt">{text}</span>
    </h4>
  );
}

/** 한 칸의 표시. **`AT`만 범위다** — 데미지가 매 타격 내림이라 `2.5`는 평타 2 · 크리티컬 5 */
function show(row: StatPreview, when: 'now' | 'next'): string {
  if (!row.range) return fmt(row[when]);
  const r = row.range[when];
  return `${r.min}-${r.max}`;
}
