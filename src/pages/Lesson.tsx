import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { useAiStatus } from '../ai/useAiStatus';
import { Checkpoint, type Resolution } from '../components/Checkpoint';
import { preloadCodeEditor } from '../components/LazyCodeEditor';
import { CompletedSummary } from '../components/CompletedSummary';
import { RESTORED_EVENT, SaveWarning } from '../components/RecordPanel';
import { content } from '../content';
import { getEventClient } from '../record/eventClient';
import { useRecord } from '../record/useRecord';
import { nextLessonId } from '../shared/engine';
import type { Lesson as LessonT } from '../shared/types';
import { BugCard } from '../studio/BugCard';
import { CourseBar } from '../studio/CourseBar';
import { Feed } from '../studio/Feed';
import { NARROW, scrollBehavior, useMedia } from '../studio/media';
import { Outline } from '../studio/Outline';
import { StudioProvider, useStudio, type Pane } from '../studio/StudioContext';
import { Workspace } from '../studio/WorkspacePane';
import { NotFound } from './routes';
import { usePageTitle } from '../usePageTitle';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** /learn/:lessonId. Remounts the lesson on a new id, a restore, or "go through it again". */
export function Lesson() {
  const { params } = useRoute();
  const [round, setRound] = useState(0);
  useEffect(() => {
    const bump = () => setRound((r) => r + 1);
    window.addEventListener(RESTORED_EVENT, bump);
    return () => window.removeEventListener(RESTORED_EVENT, bump);
  }, []);
  if (!has(content.lessons, params.lessonId)) return <NotFound />;
  const lesson = content.lessons[params.lessonId];
  return <LessonView key={`${lesson.id}:${round}`} lesson={lesson} onRestart={() => setRound((r) => r + 1)} />;
}

function LessonView({ lesson, onRestart }: { lesson: LessonT; onRestart: () => void }) {
  const { manager, record } = useRecord();
  const { ai } = useAiStatus();
  usePageTitle(lesson.title);
  const n = lesson.beats.length;
  const [step, setStepState] = useState<number | null>(null);
  // Mirrors step synchronously, so a double click on Next can't advance (and record) twice.
  const stepRef = useRef<number | null>(null);
  const setStep = (v: number) => {
    stepRef.current = v;
    setStepState(v);
  };
  /** R22: decided once on open. A completed lesson's checkpoint and bug hunt are read-only. */
  const [readOnly, setReadOnly] = useState(false);
  const [bugSolved, setBugSolved] = useState(false);
  const completed = useRef(false);
  const focusNext = useRef(false);
  const postRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lesson.bug || lesson.checkpoint?.kind === 'code') preloadCodeEditor().catch(() => {});
  }, []);

  // Decide where to start once the saved record has loaded.
  useEffect(() => {
    let live = true;
    const begin = () => {
      if (!live) return;
      const r = manager.record;
      if (r.completedLessons.includes(lesson.id)) {
        setReadOnly(true);
        setStep(n);
      } else if (r.current?.lessonId === lesson.id) {
        setStep(Math.max(0, Math.min(n - 1, r.current.beatIndex)));
      } else {
        setStep(0);
        manager.dispatch({ type: 'beatViewed', lessonId: lesson.id, beatIndex: 0 }).catch(() => {});
      }
    };
    manager.init().then(begin, begin);
    return () => {
      live = false;
    };
  }, []);

  // Leaving the lesson sends any beats still waiting.
  useEffect(() => () => void getEventClient().flush(), []);

  // Keyboard and screen-reader users land on the cards after the last section (the feed handles sections).
  useEffect(() => {
    if (!focusNext.current || step === null) return;
    focusNext.current = false;
    if (step < n) return;
    const el = postRef.current;
    // The first card's heading (the bug's title, the checkpoint's question), not the unlabelled wrapper.
    (el?.querySelector<HTMLElement>('h2') ?? el)?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'start', behavior: scrollBehavior() });
  }, [step]);

  function complete() {
    if (completed.current) return;
    completed.current = true;
    manager.dispatch({ type: 'lessonCompleted', lessonId: lesson.id }).catch(() => {});
  }

  function next() {
    const step = stepRef.current;
    if (step === null || step >= n) return;
    focusNext.current = true;
    if (step < n - 1) {
      setStep(step + 1);
      manager.dispatch({ type: 'beatViewed', lessonId: lesson.id, beatIndex: step + 1 }).catch(() => {});
    } else {
      setStep(n);
      if (!lesson.bug && !lesson.checkpoint) complete();
    }
  }

  async function onResolved(r: Resolution) {
    try {
      await manager.dispatch({ type: 'checkpointAnswered', lessonId: lesson.id, response: r.response, outcome: r.outcome, to: r.branch.to, decisionId: r.decisionId, files: r.files });
    } catch {
      // the moment still shows; saving problems surface in the record panel
    }
    if (r.outcome !== 'review') complete();
  }

  function onBugSolved() {
    setBugSolved(true);
    if (!lesson.checkpoint) complete();
  }

  if (step === null) {
    return (
      <StudioProvider lesson={lesson} key={lesson.id}>
        <StudioLayout lesson={lesson} step={0} bugSolved={false}>
          <div class="stage" aria-busy="true">
            <div class="feed" id="feed" tabIndex={-1}>
              <div class="feed__inner" role="status">
                <span class="visually-hidden">Opening your lesson…</span>
                <span class="feed__skeleton" aria-hidden="true" />
              </div>
            </div>
          </div>
        </StudioLayout>
      </StudioProvider>
    );
  }

  const label = step === n - 1 ? (lesson.bug ? 'On to the bug hunt' : lesson.checkpoint ? 'On to the checkpoint' : 'Finish the lesson') : 'Next';
  const showBug = step >= n && !!lesson.bug;
  const showCheckpoint = step >= n && !!lesson.checkpoint && (!lesson.bug || bugSolved);
  const finishedNoCheckpoint = step >= n && !lesson.checkpoint && (!lesson.bug || bugSolved);
  const path = content.paths[lesson.pathId];
  const skip = record.placement?.pathId === lesson.pathId ? record.placement.skip : [];
  const after = nextLessonId(content, lesson.pathId, lesson.id, skip);

  return (
    <StudioProvider lesson={lesson} key={lesson.id}>
      <StudioLayout lesson={lesson} step={step} bugSolved={bugSolved}>
        <Feed lesson={lesson} step={step} readOnly={readOnly} nextLabel={label} onNext={next}>
          {step >= n && (
            <div class="feed__post" ref={postRef} tabIndex={-1}>
              {readOnly && <CompletedSummary lesson={lesson} record={record} />}
              {!readOnly && showBug && <BugCard lesson={lesson} ai={ai} onSolved={onBugSolved} />}
              {!readOnly && showCheckpoint && <Checkpoint lesson={lesson} ai={ai} onResolved={onResolved} onRestart={onRestart} />}
              {!readOnly && finishedNoCheckpoint && (
                <section class="lesson-done" aria-labelledby="done-title">
                  <p class="lesson-done__kicker">Lesson complete</p>
                  <h2 class="lesson-done__title" id="done-title" tabIndex={-1}>
                    {after ? 'Nicely done. On to the next one.' : `That's the ${path.title} path, done.`}
                  </h2>
                  <a class="button" href={after ? `/learn/${after}` : `/finale/${lesson.pathId}`}>
                    {after ? `Continue to “${content.lessons[after].title}”` : 'Continue to the finale'}
                    <span aria-hidden="true">→</span>
                  </a>
                </section>
              )}
            </div>
          )}
        </Feed>
      </StudioLayout>
    </StudioProvider>
  );
}

/**
 * The studio's frame: the course bar over three panes (outline, the lesson's conversation, the
 * workspace). The page never scrolls; each pane does. At 960px and below, one pane shows at a time.
 */
function StudioLayout({ lesson, step, bugSolved, children }: { lesson: LessonT; step: number; bugSolved: boolean; children: ComponentChildren }) {
  const { pane, setPane } = useStudio();
  const narrow = useMedia(NARROW);
  const hide = (p: Pane) => narrow && pane !== p;
  const focusFeed = useRef(false);
  useEffect(() => {
    if (!focusFeed.current || pane !== 'lesson') return;
    focusFeed.current = false;
    document.getElementById('feed')?.focus();
  }, [pane]);
  // On phones the conversation may sit in a hidden pane: show it, then land on it.
  function skip(e: MouseEvent) {
    if (!narrow || pane === 'lesson') return;
    e.preventDefault();
    focusFeed.current = true;
    setPane('lesson');
  }
  return (
    <div class="studio-page">
      <a class="skip-link" href="#feed" onClick={skip}>
        Skip to content
      </a>
      <CourseBar lesson={lesson} narrow={narrow} />
      <SaveWarning />
      <div class="studio">
        <div class="studio__pane studio__pane--outline" data-pane-id="outline" hidden={hide('outline')}>
          <Outline lesson={lesson} step={step} bugSolved={bugSolved} />
        </div>
        <main class="studio__pane studio__pane--lesson" id="main" tabIndex={-1} data-pane-id="lesson" hidden={hide('lesson')}>
          {children}
        </main>
        <div class="studio__pane studio__pane--workspace" data-pane-id="workspace" hidden={hide('workspace')}>
          <Workspace />
        </div>
      </div>
    </div>
  );
}
