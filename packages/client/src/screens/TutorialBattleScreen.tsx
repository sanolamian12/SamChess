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
 * 적은 허수아비(`idleTurn`)이거나 기준 AI다(판이 정한 「자리를 지키는 적」은 제자리에서 치기만 한다 — `tutorialEnemyTurn`). 계정을 안 건드린다 — 참가비 · 전적 · 보상 · 부상이 없다. 마지막 판을 이기면
 * 서버에 완료만 적는다(`POST /tutorial/complete`).
 *
 * 기본 1은 판이 여섯이다(기물마다 1:1) — 한 판이 끝나면 다음 판을 **새로 띄운다**. 엔진은 한 판에 한 번 배치하므로
 * 판 안에서 유닛을 갈아 세우는 대신 평범한 전투 여섯 개를 잇는다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBattle } from '@samchess/rules';
import type { Vec2 } from '@samchess/rules';
import { TUTORIAL_HUMAN_SIDE, finaleOfficers, isSay, lineKey, tutorialEnemyTurn, tutorialSceneHook, tutorialStages } from '@samchess/meta';
import type { GuideLine, PlayerProfile, TutorialId } from '@samchess/meta';
import { bootBattle } from '../battle/boot.ts';
import type { BattleHandle } from '../battle/boot.ts';
import type { BattleScene } from '../battle/BattleScene.ts';
import { LocalTransport } from '../battle/transport.ts';
import { completeTutorialOnServer } from '../meta/city.ts';
import { battleArtUrl, hasArt, tutorialMapUrl } from '../ui/art.ts';
import { pickOfficerNameById, setOfficerAliases } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { BattleStage } from './BattleStage.tsx';

/** 떠 있는 안내 창 — 문장들을 한 장씩 넘기고, 마지막 장의 단추가 `then`을 부른다 */
interface Guide {
  /** 한 장씩 — 문구 열쇠는 안내 창, 대사(`GuideSay`)는 대사 패널 */
  keys: readonly GuideLine[];
  /** 마지막 장의 단추 — 없으면 [확인] */
  ok?: StringKey;
  then: () => void;
  /** 둘째 단추 (진 판의 [목록으로]) */
  alt?: { label: StringKey; act: () => void };
}

/** 사람 차례를 살피는 간격 — 연출이 멎는 것을 기다리는 일이라 프레임마다 볼 까닭이 없다 */
const WATCH_MS = 120;

/** 안내가 비추라는 칸 — 카메라가 닿았는지 보는 간격과, 닿은 뒤 창을 띄우기까지 쉬는 시간 */
const FOCUS_POLL_MS = 50;
const FOCUS_BEAT_MS = 150;
/** 칸을 비추는 안내가 그 차례의 부표를 세울 때 — 부표가 떠오르는 것을 보여 주고 창을 띄우기까지 */
const BUOY_SHOW_MS = 600;

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
  /** 띄운 판 — 안내가 카메라를 옮길 때 씬을 찾는다 */
  const handleRef = useRef<BattleHandle | null>(null);
  /** 안내가 비추라는 칸에 카메라가 닿았는가 — 닿기 전에는 창을 안 띄운다 */
  const [focusReady, setFocusReady] = useState(true);
  /** 아직 안 세운 부표 — 그 칸을 비추는 안내가 뜰 때 세운다(`GuideTurn.buoys`) */
  const pendingBuoys = useRef<Vec2[]>([]);
  done.current = onDone;

  useEffect(() => {
    const stage = stages[stageIdx]!;
    const last = stageIdx === stages.length - 1;
    // 판 도중의 장면(방통 판의 화계) — 그 차례가 끝난 통 뒤에 한 번
    const after = tutorialSceneHook(stage);
    // 안내 층의 걸음 — 몇째 대본 차례인가 · 그 안의 몇째 단계인가(아래 시계가 민다)
    let turn = -1;
    let phase = 0;
    let turnKey = '';
    /** 차례 뒤 안내(`GuideTurn.after`)를 이미 띄운 대본 차례 */
    const afterShown = new Set<number>();
    /**
     * 대본 차례가 끝나고 판이 다음으로 가려는 순간 — 그 차례의 `after`가 있으면 판을 세워 두고 띄운다. 닫으면 `ready()`로 잇는다
     * (2026-11-10 기획자, 유비 판: 유비가 치고 나서 유비가 말한다)
     */
    let opened = false;
    const hold = (): boolean => {
      // 판을 여는 안내(`opening`) — 적이 먼저 움직이는 판에서 첫 수 앞에 한 번(2026-11-10 기획자, 장비 판)
      if (!opened && stage.opening?.length) {
        opened = true;
        sceneOf(handle)?.setCommandLimit({ allow: new Set() });
        show({ keys: stage.opening, then: () => { close(); transport.ready(); } });
        return true;
      }
      opened = true;
      const lines = stage.guide[turn]?.after;
      if (!lines?.length || afterShown.has(turn)) return false;
      afterShown.add(turn);
      const scene = sceneOf(handle);
      scene?.setCommandLimit({ allow: new Set() });
      show({ keys: lines, then: () => { close(); transport.ready(); } });
      return true;
    };
    // 이 판에서만 쓰는 이름(채중 → 장간) — 판을 떠나면 비운다
    setOfficerAliases(stage.alias ? new Map(Object.entries(stage.alias).map(([id, key]) => [id, () => t(key as StringKey)])) : null);
    const transport = new LocalTransport(createBattle(stage.config), TUTORIAL_HUMAN_SIDE, {
      ai: tutorialEnemyTurn(stage),
      ...(after ? { after } : {}),
      hold,
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
      ...(stage.finale ? { extraOfficers: finaleOfficers(stage.finale) } : {}),
      ...(stage.buoys ? { buoys: stage.buoys } : {}),
      ...(stage.guide.some((t) => t.buoys?.length) ? { buoyArt: true } : {}),
      ...(stage.hidden ? { hiddenUnits: stage.hidden } : {}),
      onFinish: (state) => {
        finished = true;
        const scene = sceneOf(handle);
        scene?.setCommandLimit({ allow: new Set() });
        if (state.winner === TUTORIAL_HUMAN_SIDE) {
          const finish = (): void => {
            close();
            if (last) complete(); else setStageIdx((i) => i + 1);
          };
          const outro = (keys: readonly GuideLine[]): void => show({ keys, ok: last ? 'tut.ok' : 'tut.next', then: finish });
          const f = stage.finale;
          // 끝 장면이 있으면 먼저 돌리고 그 위에 끝맺음을 띄운다. `retreatAfter`가 있으면 나타남 → 그 줄들 → 물러남 → 나머지
          // (여포 판 — 유비 · 관우가 나타나 대사를 주고받은 뒤 여포가 물러난다)
          if (f?.steps && scene) {
            // 단계로 짠 끝 장면 — 나타남 → 대사 → 물러남을 단계마다 차례로, 끝나면 끝맺음(2026-11-10 제갈량 판)
            const run = (i: number): void => {
              const st = f.steps![i];
              if (!st) { outro(stage.outro); return; }
              void scene.playAppear({ appear: st.appear ?? [] }).then(() => show({ keys: st.lines ?? [], ok: 'tut.next', then: () => {
                close();
                void scene.playRetreat({ retreat: st.retreat ?? [] }, !!st.leave)
                  .then(() => scene.playVanish(st.vanish ?? []))
                  .then(() => run(i + 1));
              } }));
            };
            run(0);
          } else if (f && scene && f.retreatAfter !== undefined) {
            const n = f.retreatAfter;
            void scene.playAppear(f).then(() => show({ keys: stage.outro.slice(0, n), ok: 'tut.next', then: () => {
              close();
              void scene.playRetreat(f).then(() => outro(stage.outro.slice(n)));
            } }));
          } else if (f && scene) void scene.playFinale(f).then(() => outro(stage.outro));
          else outro(stage.outro);
        } else if (state.outcome === 'surrender') {
          // [나가기](튜토리얼의 [항복]) — 물음은 이미 거쳤다. 진 판의 창 없이 목록으로
          exit.current();
        } else {
          // 졌다 — 같은 판을 처음부터. 기본 1이면 그 기물의 판만 다시다
          show({
            keys: ['tut.lost'], ok: 'tut.retry', then: () => { close(); setAttempt((a) => a + 1); },
            alt: { label: 'tut.exit', act: () => exit.current() },
          });
        }
      },
    });

    handleRef.current = handle;
    // ── 안내 층 — 사람 차례를 살펴 대본의 단계를 연다 ──
    const enter = (scene: BattleScene): void => {
      const step = stage.guide[turn]?.phases[phase];
      if (!step) { scene.setCommandLimit(null); scene.holdTurnVoice(false); return; }   // 대본이 끝났다 — 모든 명령이 켜진다
      // 안내 창이 떠 있는 동안에는 아무것도 못 누른다
      scene.setCommandLimit({ allow: new Set() });
      show({ keys: step.lines, then: () => {
        close();
        scene.setCommandLimit({ allow: new Set(step.allow), moveTo: step.moveTo, target: step.target, bitter: step.bitter });
        // 이 차례의 안내가 닫혔다 — 카메라가 그 장수에게 돌아오고 그 장수가 말한다(2026-11-10 기획자, 「모든 것은 계산대로」)
        scene.holdTurnVoice(false);
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
      if (key !== turnKey) {
        turnKey = key; turn++; phase = 0;
        // 이 차례에 세우는 부표 — 이야기의 그 때에(`GuideTurn.buoys`)
        const more = stage.guide[turn]?.buoys ?? [];
        // 이 차례의 안내가 그 칸을 비추면 그때 세우고(부표가 떠오르는 것을 보인다), 아니면 지금 세운다
        const noted = new Set(stage.guide[turn]?.phases.flatMap((p) => p.lines).flatMap((l) => (typeof l !== 'string' && !isSay(l) ? [`${l.focus.x},${l.focus.y}`] : [])));
        pendingBuoys.current = more.filter((b) => noted.has(`${b.x},${b.y}`));
        const now = more.filter((b) => !noted.has(`${b.x},${b.y}`));
        if (now.length) scene.placeBuoys(now);
        enter(scene);
        return;
      }
      const step = stage.guide[turn]?.phases[phase];
      // 단계가 끝나는 때 — 이동을 마쳤다 · 고유기술을 썼다(쓴 뒤에도 그 차례에 이동 · 공격이 남는다)
      if ((step?.until === 'moved' && state.activeTurn?.moved)
        || (step?.until === 'skill' && state.activeTurn?.usedUniqueSkill)) { phase++; enter(scene); }
    }, WATCH_MS);

    return () => { clearInterval(timer); setGuide(null); handle.destroy(); setOfficerAliases(null); };
    // 판 하나는 한 번 띄우면 끝까지 간다 — 다음 판 · 다시 하기만 새로 띄운다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIdx, attempt]);

  const lastPage = guide ? page >= guide.keys.length - 1 : false;
  const line = guide?.keys[page];
  // 안내가 비추라는 칸 — 말하는 장수(대사의 `focus`) · 칸(`GuideNote`). 창이 닫히면 비운다 → 차례인 장수로 돌아간다
  useEffect(() => {
    const scene = handleRef.current ? sceneOf(handleRef.current) : null;
    if (!scene) return;
    let cell: Vec2 | null = null;
    if (line !== undefined && typeof line !== 'string') {
      if (isSay(line)) {
        if (line.focus) cell = Object.values(scene.currentState.units).find((u) => u.officer === line.by && u.alive)?.pos ?? null;
      } else cell = line.focus;
    }
    scene.setGuideFocus(cell);
    // 고육지책의 물음은 안내가 닫힌 뒤에(2026-11-10 기획자 — 대사가 오가는 동안 아래 칸에 이미 떠 있었다)
    scene.holdBitterAsk(line !== undefined);
    // 비출 칸이 있으면 카메라가 닿고 한 박자 쉰 뒤에 창을 띄운다 — 「주유를 먼저 비추고 대사」(2026-11-10 기획자)
    if (!cell) { setFocusReady(true); return; }
    setFocusReady(false);
    let arrived = 0;
    let later: ReturnType<typeof setTimeout> | null = null;
    const timer = setInterval(() => {
      if (!scene.guideFocusNear) { arrived = 0; return; }
      arrived += FOCUS_POLL_MS;
      if (arrived < FOCUS_BEAT_MS) return;
      clearInterval(timer);
      // 이 안내가 비추는 칸에 세울 부표 — 카메라가 닿은 뒤 떠오르고, 그것을 본 뒤에 창이 뜬다(창이 화면 가운데를 덮는다)
      const due = pendingBuoys.current.filter((b) => b.x === cell!.x && b.y === cell!.y);
      if (due.length) {
        pendingBuoys.current = pendingBuoys.current.filter((b) => !due.includes(b));
        scene.placeBuoys(due);
        later = setTimeout(() => setFocusReady(true), BUOY_SHOW_MS);
      } else setFocusReady(true);
    }, FOCUS_POLL_MS);
    return () => { clearInterval(timer); if (later) clearTimeout(later); };
  }, [line]);
  const next = (): void => { if (guide) { if (lastPage) guide.then(); else setPage((n) => n + 1); } };
  // 대사의 진영 — 판에 선 장수는 그 진영, 없으면(끝 장면에 나타나는 장수) 대본이 적은 대로. 아군 · 적군은 같은 그림이고 이름 색만 다르다
  const foe = (by: string, said?: boolean): boolean =>
    stages.some((st) => st.config.rosters.P2.some((r) => r.officer === by)) || !!said;
  return (
    <>
      <BattleStage />
      {guide && focusReady && line !== undefined && isSay(line) && (
        // 등장인물의 대사 (2026-10-26 기획자) — 왼쪽 초상 액자 · 오른쪽 대사 판. 판 아무 데나 눌러도 넘어간다
        <div className="modal-back gi-ask-back tut-back tut-say-back" data-modal="tutorialGuide" data-key={line.say}
          data-say={line.by} data-side={foe(line.by, line.foe) ? 'foe' : 'ally'} onClick={next}>
          <div className="tut-say" key={`${page}-${line.say}`}>
            <div className="tut-say-face">
              {hasArt(line.by) && <img src={battleArtUrl(line.by)} alt="" draggable={false} />}
            </div>
            <div className="tut-say-line">
              <p className="tut-say-name" data-field="name">{pickOfficerNameById(line.by, line.by)}</p>
              <p className="tut-say-text" data-field="line">{t(line.say as StringKey)}</p>
              <button className="tut-say-next" data-action="tutorialNext" aria-label={t(lastPage ? guide.ok ?? 'tut.ok' : 'tut.next')}
                onClick={(e) => { e.stopPropagation(); next(); }} />
            </div>
          </div>
        </div>
      )}
      {guide && focusReady && line !== undefined && !isSay(line) && (
        <div className="modal-back gi-ask-back tut-back" data-modal="tutorialGuide" data-key={lineKey(line)}>
          <div className="modal gi-ask tut-guide">
            <p className="modal-ttl">{id.startsWith('s-')
              ? t('tut.s', { name: pickOfficerNameById(id.slice(2), id.slice(2)) })
              : t(`tut.${id}` as StringKey)}</p>
            <p className="gi-ask-q tut-guide-q" data-field="line">{t(lineKey(line) as StringKey)}</p>
            <div className="gi-ask-acts">
              {lastPage && guide.alt && (
                <button data-action="tutorialAlt" onClick={guide.alt.act}>{t(guide.alt.label)}</button>
              )}
              {/* 단추가 둘인 창(진 판 — [목록으로] · [다시 하기])은 진행하는 쪽을 옥색 두루마리로(2026-10-27 기획자) */}
              <button
                data-action="tutorialNext"
                className={lastPage && guide.alt ? 'go' : undefined}
                onClick={next}
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
