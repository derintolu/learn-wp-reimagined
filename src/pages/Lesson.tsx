import { useEffect, useRef, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { useAiStatus } from '../ai/useAiStatus';
import { BeatView } from '../components/BeatView';
import { CatchTheBug } from '../components/CatchTheBug';
import { Checkpoint, type Resolution } from '../components/Checkpoint';
import { preloadCodeEditor } from '../components/LazyCodeEditor';
import { CompletedSummary } from '../components/CompletedSummary';
import { RESTORED_EVENT, SaveWarning } from '../components/RecordPanel';
import { Tutor } from '../components/Tutor';
import { content } from '../content';
import { useFileEdits } from '../record/useFileEdits';
import { useRecord } from '../record/useRecord';
import { nextLessonId } from '../shared/engine';
import type { Lesson as LessonT } from '../shared/types';
import { NotFound } from './routes';

export const REVIEW_DISCLAIMER = 'Adapted from Learn WordPress, not reviewed by the Training Team';

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

function LessonHeader({ lesson, reached: raw }: { lesson: LessonT; reached: number }) {
  const path = content.paths[lesson.pathId];
  const n = path.lessons.indexOf(lesson.id) + 1;
  const stops = lesson.beats.length + (lesson.bug ? 1 : 0) + (lesson.checkpoint ? 1 : 0);
  const reached = Math.min(stops, raw);
  return (
    <header class="band band--dark lesson-head">
      <div class="wrap">
        <p class="lesson-head__crumbs">
          <a href={`/path/${path.id}`}>{path.title}</a>
          <span aria-hidden="true"> / </span>
          <span>
            Lesson {n} of {path.lessons.length}
          </span>
          <span aria-hidden="true"> · </span>
          <span>{lesson.minutes} min</span>
        </p>
        <h1 class="lesson-head__title">{lesson.title}</h1>
        <div class="lesson-head__credit">
          <p class="lesson-head__sources">
            <span class="lesson-head__label">Adapted from</span>{' '}
            {lesson.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && ', '}
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                  <span class="visually-hidden"> (opens in a new tab)</span>
                </a>
              </span>
            ))}
          </p>
          <p class="lesson-head__disclaimer">{REVIEW_DISCLAIMER}</p>
        </div>
        <div
          class="progress"
          role="progressbar"
          aria-label="Lesson progress"
          aria-valuemin={0}
          aria-valuemax={stops}
          aria-valuenow={reached}
          aria-valuetext={`${reached} of ${stops} steps`}
        >
          {Array.from({ length: stops }, (_, i) => (
            <span key={i} class={`progress__seg${i < reached ? ' is-on' : ''}${i === reached - 1 && reached < stops ? ' is-now' : ''}`} />
          ))}
        </div>
      </div>
    </header>
  );
}

function LessonView({ lesson, onRestart }: { lesson: LessonT; onRestart: () => void }) {
  const { manager, record } = useRecord();
  const ai = useAiStatus();
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
  const activeHeading = useRef<HTMLHeadingElement>(null);
  const postRef = useRef<HTMLDivElement>(null);
  const { edit, flush } = useFileEdits();

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

  // Keyboard and screen-reader users land on each new step.
  useEffect(() => {
    if (!focusNext.current || step === null) return;
    focusNext.current = false;
    const el = step < n ? activeHeading.current : postRef.current;
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [step]);

  const lessonFiles = (): Record<string, string> => {
    const out: Record<string, string> = { ...(lesson.starterFiles ?? {}) };
    for (const f of [lesson.checkpoint?.file, ...Object.keys(lesson.starterFiles ?? {})]) {
      if (f && has(record.files, f)) out[f] = record.files[f];
    }
    return out;
  };

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
      await manager.dispatch({ type: 'checkpointAnswered', lessonId: lesson.id, response: r.response, outcome: r.outcome, to: r.branch.to });
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
      <>
        <LessonHeader lesson={lesson} reached={0} />
        <div class="wrap lesson" aria-busy="true">
          <div class="lesson__read" role="status">
            <span class="visually-hidden">Opening your lesson…</span>
            <span class="placement__skeleton lesson__skeleton" aria-hidden="true" />
          </div>
        </div>
      </>
    );
  }

  const label = step === n - 1 ? (lesson.bug ? 'On to the bug hunt' : lesson.checkpoint ? 'On to the checkpoint' : 'Finish the lesson') : 'Next';
  const showBug = step >= n && !!lesson.bug;
  const showCheckpoint = step >= n && !!lesson.checkpoint && (!lesson.bug || bugSolved);
  const finishedNoCheckpoint = step >= n && !lesson.checkpoint && (!lesson.bug || bugSolved);
  const path = content.paths[lesson.pathId];
  const skip = record.placement?.pathId === lesson.pathId ? record.placement.skip : [];
  const after = nextLessonId(content, lesson.pathId, lesson.id, skip);
  const reached = step < n ? step + 1 : n + (showBug ? 1 : 0) + (showCheckpoint ? 1 : 0);

  return (
    <>
      <LessonHeader lesson={lesson} reached={reached} />
      <div class="wrap lesson">
        <div class="lesson__read">
          <SaveWarning />
          {lesson.beats.slice(0, Math.min(step + 1, n)).map((_, i) => (
            <BeatView
              key={i}
              lesson={lesson}
              index={i}
              active={i === step}
              done={i < step}
              ai={ai}
              nextLabel={label}
              onNext={next}
              headingRef={i === step ? activeHeading : undefined}
            />
          ))}

          <div class="lesson__post" ref={postRef} tabIndex={-1}>
            {readOnly && <CompletedSummary lesson={lesson} record={record} />}
            {!readOnly && showBug && (
              <CatchTheBug
                lesson={lesson}
                ai={ai}
                saved={record.files[lesson.bug!.file]}
                onEdit={edit}
                flush={flush}
                onSolved={onBugSolved}
              />
            )}
            {!readOnly && showCheckpoint && (
              <Checkpoint
                lesson={lesson}
                ai={ai}
                files={lessonFiles()}
                onEdit={edit}
                flush={flush}
                onResolved={onResolved}
                onRestart={onRestart}
              />
            )}
            {!readOnly && finishedNoCheckpoint && (
              <section class="lesson-done" aria-labelledby="done-title">
                <p class="lesson-done__kicker">Lesson complete</p>
                <h2 class="lesson-done__title" id="done-title">
                  {after ? 'Nicely done. On to the next one.' : `That's the ${path.title} path, done.`}
                </h2>
                <a class="button" href={after ? `/learn/${after}` : '/finale'}>
                  {after ? `Continue to “${content.lessons[after].title}”` : 'Continue to the finale'}
                  <span aria-hidden="true">→</span>
                </a>
              </section>
            )}
          </div>
        </div>
        <Tutor lesson={lesson} beatIndex={Math.min(step, n - 1)} ai={ai} />
      </div>
    </>
  );
}
