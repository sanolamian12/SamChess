/**
 * 튜토리얼 전투 — 기본 1 · 2 · 3 (G3, `Design/튜토리얼_시나리오_초안.md`, 2026-10-22 기획자).
 *
 * ────────────────────────────────────────────────────────────────
 * 판은 데이터가 짠다 · 안내 층은 읽기만 한다
 * ────────────────────────────────────────────────────────────────
 *
 * 판 짜임과 안내 대본은 `@samchess/meta`의 `tutorialStages()`다 — 회귀(`tutorialBattles.test.ts`)가 **그 대본 그대로**
 * 두어 이기는지 본다. 이 화면은 대본을 화면에 옮길 뿐이다:
 *
 *  1. 사람 차례가 오면(연출이 멎고 입력을 기다릴 때) 그 차례의 첫 단계를 연다 — 안내 창을 띄우고, 닫으면
 *     그 단계가 켠 명령 · 칸 · 대상만 누를 수 있게 잠근다(`BattleScene.setCommandLimit` → `CommandFlow`).
 *  2. `until: 'moved'` 단계는 이동을 마치는 순간 다음 단계로 넘어간다. 나머지는 차례가 끝날 때까지 간다.
 *  3. 대본이 끝난 차례는 잠금을 푼다(기본 3의 마무리 — 적이 움직여 칸을 정할 수 없다).
 *
 * **수는 언제나 사람이 낸다** — 안내 층은 의도를 보내지 않는다. 판정 주체는 AI 대전 · 도적떼와 같은 `LocalTransport`이고,
 * 적은 허수아비(`idleTurn`)이거나 기준 AI다. 계정을 안 건드린다 — 참가비 · 전적 · 보상 · 부상이 없다. 마지막 판을 이기면
 * 서버에 완료만 적는다(`POST /tutorial/complete`).
 *
 * 기본 1은 판이 여섯이다(기물마다 1:1) — 한 판이 끝나면 다음 판을 **새로 띄운다**. 엔진은 한 판에 한 번 배치하므로
 * 판 안에서 유닛을 갈아 세우는 대신 평범한 전투 여섯 개를 잇는다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBattle, idleTurn, takeTurn } from '@samchess/rules';
import { TUTORIAL_HUMAN_SIDE, tutorialStages } from '@samchess/meta';
import type { PlayerProfile, TutorialId } from '@samchess/meta';
import { bootBattle } from '../battle/boot.ts';
import type { BattleHandle } from '../battle/boot.ts';
import type { BattleScene } from '../battle/BattleScene.ts';
import { LocalTransport } from '../battle/transport.ts';
import { completeTutorialOnServer } from '../meta/city.ts';
import { tutorialMapUrl } from '../ui/art.ts';
import { pickOfficerNameById } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { BattleStage } from './BattleStage.tsx';

/** 떠 있는 안내 창 — 문장들을 한 장씩 넘기고, 마지막 장의 단추가 `then`을 부른다 */
interface Guide {
  keys: readonly string[];
  /** 마지막 장의 단추 — 없으면 [확인] */
  ok?: StringKey;
  then: () => void;
  /** 둘째 단추 (진 판의 [목록으로]) */
  alt?: { label: StringKey; act: () => void };
}

/** 사람 차례를 살피는 간격 — 연출이 멎는 것을 기다리는 일이라 프레임마다 볼 까닭이 없다 */
const WATCH_MS = 120;

const sceneOf = (handle: BattleHandle): BattleScene | null =>
  (handle.game.scene.getScene('battle') as BattleScene | null) ?? null;

export function TutorialBattleScreen({ id, onDone, onExit, save = completeTutorialOnServer }: {
  id: TutorialId;
  /** 마지막 판을 이기고 서버에 완료를 적었다 — 받은 계정 */
  onDone: (profile: PlayerProfile) => void;
  /** 끝내지 않고 목록으로 */
  onExit: () => void;
  /** 완료를 적는 곳 — 기본은 서버. 로그인 없이 보는 통로(`?tutorial=`)만 바꿔 끼운다 */
  save?: (id: TutorialId) => Promise<PlayerProfile | null>;
}): React.JSX.Element {
  useLang();
  const stages = useMemo(() => tutorialStages(id), [id]);
  const [stageIdx, setStageIdx] = useState(0);
  /** 진 판을 다시 할 때마다 오른다 — 같은 판을 새로 띄운다 */
  const [attempt, setAttempt] = useState(0);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [page, setPage] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const exit = useRef(onExit);
  exit.current = onExit;
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const stage = stages[stageIdx]!;
    const last = stageIdx === stages.length - 1;
    const transport = new LocalTransport(createBattle(stage.config), TUTORIAL_HUMAN_SIDE, {
      ai: stage.enemy === 'idle' ? idleTurn : takeTurn,
    });
    let finished = false;

    const show = (g: Guide): void => {
      if (g.keys.length === 0) { g.then(); return; }
      setPage(0);
      setGuide(g);
    };
    const close = (): void => setGuide(null);

    const complete = (): void => {
      void save(id).then((profile) => {
        if (profile) done.current(profile);
        else setSaveFailed(true);
      });
    };

    const handle = bootBattle({
      transport,
      // S급 판은 제 지도를 깐다 · 끝 장면에 나타날 장수의 그림을 미리 불러 둔다
      ...(stage.map ? { boardMap: tutorialMapUrl(stage.map) } : {}),
      ...(stage.finale ? { extraOfficers: stage.finale.appear.map((a) => a.officer) } : {}),
      onFinish: (state) => {
        finished = true;
        const scene = sceneOf(handle);
        scene?.setCommandLimit({ allow: new Set() });
        if (state.winner === TUTORIAL_HUMAN_SIDE) {
          const outro = (): void => show({ keys: stage.outro, ok: last ? 'tut.ok' : 'tut.next', then: () => {
            close();
            if (last) complete(); else setStageIdx((i) => i + 1);
          } });
          // 끝 장면이 있으면 먼저 돌리고 그 위에 끝맺음을 띄운다(여포 판 — 유비 · 관우가 나타나고 여포가 물러난다)
          if (stage.finale && scene) void scene.playFinale(stage.finale).then(outro);
          else outro();
        } else {
          // 졌다(항복 포함) — 같은 판을 처음부터. 기본 1이면 그 기물의 판만 다시다
          show({
            keys: ['tut.lost'], ok: 'tut.retry', then: () => { close(); setAttempt((a) => a + 1); },
            alt: { label: 'tut.exit', act: () => exit.current() },
          });
        }
      },
    });

    // ── 안내 층 — 사람 차례를 살펴 대본의 단계를 연다 ──
    let turn = -1;
    let phase = 0;
    let turnKey = '';
    const enter = (scene: BattleScene): void => {
      const step = stage.guide[turn]?.phases[phase];
      if (!step) { scene.setCommandLimit(null); return; }   // 대본이 끝났다 — 모든 명령이 켜진다
      // 안내 창이 떠 있는 동안에는 아무것도 못 누른다
      scene.setCommandLimit({ allow: new Set() });
      show({ keys: step.lines, then: () => {
        close();
        scene.setCommandLimit({ allow: new Set(step.allow), moveTo: step.moveTo, target: step.target });
      } });
    };
    const timer = setInterval(() => {
      if (finished) return;
      const scene = sceneOf(handle);
      // 씬이 아직 안 섰으면 재생기도 없다
      const playback = scene?.sys.isActive() ? scene.debugPlayback : null;
      if (!scene || !playback || playback.phase !== 'awaitingInput' || playback.busy) return;
      const state = scene.currentState;
      const key = `${state.activeUnit ?? ''}|${state.time}`;
      if (key !== turnKey) { turnKey = key; turn++; phase = 0; enter(scene); return; }
      const step = stage.guide[turn]?.phases[phase];
      // 단계가 끝나는 때 — 이동을 마쳤다 · 고유기술을 썼다(쓴 뒤에도 그 차례에 이동 · 공격이 남는다)
      if ((step?.until === 'moved' && state.activeTurn?.moved)
        || (step?.until === 'skill' && state.activeTurn?.usedUniqueSkill)) { phase++; enter(scene); }
    }, WATCH_MS);

    return () => { clearInterval(timer); setGuide(null); handle.destroy(); };
    // 판 하나는 한 번 띄우면 끝까지 간다 — 다음 판 · 다시 하기만 새로 띄운다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIdx, attempt]);

  const lastPage = guide ? page >= guide.keys.length - 1 : false;
  return (
    <>
      <BattleStage />
      {guide && (
        <div className="modal-back gi-ask-back tut-back" data-modal="tutorialGuide" data-key={guide.keys[page]}>
          <div className="modal gi-ask tut-guide">
            <p className="modal-ttl">{id.startsWith('s-')
              ? t('tut.s', { name: pickOfficerNameById(id.slice(2), id.slice(2)) })
              : t(`tut.${id}` as StringKey)}</p>
            <p className="gi-ask-q tut-guide-q" data-field="line">{t(guide.keys[page] as StringKey)}</p>
            <div className="gi-ask-acts">
              {lastPage && guide.alt && (
                <button data-action="tutorialAlt" onClick={guide.alt.act}>{t(guide.alt.label)}</button>
              )}
              <button
                data-action="tutorialNext"
                onClick={() => (lastPage ? guide.then() : setPage((n) => n + 1))}
              >
                {t(lastPage ? guide.ok ?? 'tut.ok' : 'tut.next')}
              </button>
            </div>
          </div>
        </div>
      )}
      {saveFailed && (
        <div className="modal-back gi-ask-back tut-back" data-modal="tutorialSaveFailed">
          <div className="modal gi-ask tut-guide">
            <p className="gi-ask-q tut-guide-q">{t('tut.saveFailed')}</p>
            <div className="gi-ask-acts">
              <button data-action="tutorialExit" onClick={() => exit.current()}>{t('tut.exit')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
