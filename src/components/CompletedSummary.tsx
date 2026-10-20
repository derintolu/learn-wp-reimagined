import { content } from '../content';
import { nextLessonId, resolveBranch } from '../shared/engine';
import type { LearningRecord } from '../shared/record';
import type { Lesson, Outcome } from '../shared/types';
import { activityId, EXT_FROM_LESSON, EXT_OUTCOME, VERBS } from '../shared/xapi';
import { OUTCOME_LABEL } from './BranchMoment';

const OUTCOMES: Outcome[] = ['advance', 'review', 'skip'];

/** The outcome this lesson's checkpoint last branched with, read back from the xAPI history. */
export function pastOutcome(r: LearningRecord, lessonId: string): Outcome | null {
  const from = activityId(['lessons', lessonId]);
  for (let i = r.statements.length - 1; i >= 0; i--) {
    const s = r.statements[i];
    const ext = s.result?.extensions;
    if (s.verb.id === VERBS.branched.id && ext?.[EXT_FROM_LESSON] === from) {
      const o = ext[EXT_OUTCOME];
      return OUTCOMES.includes(o as Outcome) ? (o as Outcome) : null;
    }
  }
  return null;
}

/**
 * R22: a completed lesson's checkpoint and bug hunt are read-only. This shows what the
 * learner got and where to go next, and dispatches nothing, so the record gains no duplicates.
 */
export function CompletedSummary({ lesson, record }: { lesson: Lesson; record: LearningRecord }) {
  const outcome = lesson.checkpoint ? pastOutcome(record, lesson.id) : null;
  let branchTo: string | null = null;
  let message: string | null = null;
  if (outcome && outcome !== 'review') {
    try {
      const b = resolveBranch(content, lesson.id, outcome);
      branchTo = b.to;
      message = b.message;
    } catch {
      // an outcome the content no longer has: fall back to the path order
    }
  }
  const skip = record.placement?.pathId === lesson.pathId ? record.placement.skip : [];
  const to = branchTo ?? nextLessonId(content, lesson.pathId, lesson.id, skip);
  const title = to && Object.prototype.hasOwnProperty.call(content.lessons, to) ? content.lessons[to].title : null;

  return (
    <section class="lesson-done" aria-labelledby={`done-${lesson.id}`} data-testid="completed-summary">
      <p class="lesson-done__kicker">Lesson complete</p>
      <h2 class="lesson-done__title" id={`done-${lesson.id}`}>
        You've finished this one.
      </h2>
      {lesson.checkpoint && (
        <p class="lesson-done__answer">
          You answered this: <strong>{outcome ? OUTCOME_LABEL[outcome] : 'Completed'}</strong>
          {message && <> — {message}</>}
        </p>
      )}
      {lesson.bug && <p class="lesson-done__answer">You caught the planted bug.</p>}
      <a class="button" href={to ? `/learn/${to}` : '/finale'}>
        {title ? `Continue to “${title}”` : 'Continue to the finale'}
        <span aria-hidden="true">→</span>
      </a>
    </section>
  );
}
