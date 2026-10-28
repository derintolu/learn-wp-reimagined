// A record today's server (learning-mcp) wrote, read as the standard's practice copy, so a learner holding an
// `lr_` handle continues on the reference server at the same lesson, beat and phase, with the same files.
// Pure. Only the course state carries over: the legacy statements follow the learning-mcp profile, which a
// practice copy may not hold (parsePracticeRecord refuses them), so they stay in the legacy row, untouched.
import { PRACTICE_HOMEPAGE, PRACTICE_LABEL } from '../../../vendor/course-xapi-mcp/core/constants.ts';
import type { CourseModel } from '../../../vendor/course-xapi-mcp/core/model.ts';
import { PRACTICE_FORMAT, PRACTICE_VERSION, type PracticeRecord } from '../../../vendor/course-xapi-mcp/core/practice-record.ts';
import type { AuProgress, Cursor, LearnerState } from '../../../vendor/course-xapi-mcp/core/state.ts';
import { EXT, VERBS, iri, parseRecord, type CourseState, type LearningRecord } from '../../../vendor/learning-mcp/core/index.ts';
import { COURSE_ID } from '../../../src/shared/course-meta';
import { currentIri } from '../../../src/shared/xapi';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Failed fix attempts at a lesson's planted bug: failed file checks on the bug's file, recorded without per-check results. */
function fixAttempts(rec: LearningRecord, course: CourseModel, lessonKey: string): number {
  const bug = course.lessons[lessonKey]?.bug;
  if (!bug) return 0;
  // learning-mcp's activity base is the standard course IRI (standardCourse.ts); older records use the legacy host.
  const id = iri(course.id, ['lessons', lessonKey, 'files', bug.file]);
  return rec.statements.filter((s) => {
    const checks = s.result?.extensions?.[EXT.checks];
    return s.verb.id === VERBS.failed.id && currentIri(s.object.id) === id && Array.isArray(checks) && checks.length === 0;
  }).length;
}

function progressOf(course: CourseModel, st: CourseState, rec: LearningRecord): Record<string, AuProgress> {
  const au: Record<string, AuProgress> = {};
  const get = (k: string) => (au[k] ??= { completed: false, passed: false, failed: false, carriedOver: false, fixAttempts: 0 });
  for (const k of st.completedLessons) {
    if (!has(course.lessons, k)) continue;
    // learning-mcp completes a checkpoint lesson only on a success branch: completed and passed here.
    Object.assign(get(k), { completed: true, passed: Boolean(course.lessons[k]!.checkpoint) });
  }
  for (const caught of st.caughtBugs) {
    const k = caught.split('/')[0]!;
    if (has(course.lessons, k)) get(k).bug = 'caught';
  }
  // The standard waives skipped lessons when placing; learning-mcp only listed them.
  for (const k of st.placement?.skip ?? []) if (has(course.lessons, k) && !get(k).completed) get(k).waived = 'Tested Out';
  const c = st.cursor;
  if (c && has(course.lessons, c.lessonId)) {
    // At the checkpoint, the standard has already recorded the lesson completed (its beats and bug are done).
    if (c.phase === 'checkpoint' || c.phase === 'branch') get(c.lessonId).completed = true;
    if (c.phase === 'bug') get(c.lessonId).fixAttempts = fixAttempts(rec, course, c.lessonId);
  }
  return au;
}

function cursorOf(st: CourseState): Cursor | undefined {
  const c = st.cursor;
  if (!c) return undefined;
  return { pathKey: c.pathId, lessonKey: c.lessonId, beat: c.beat, phase: c.phase, ...(c.awaitingReply ? { awaitingReply: true } : {}) };
}

/** The learner state for a legacy record's course state; a record never placed in this course gets an empty one. */
export function legacyState(rec: LearningRecord, course: CourseModel, registration: () => string): LearnerState {
  const st = has(rec.courses, COURSE_ID) ? rec.courses[COURSE_ID]! : undefined;
  const state: LearnerState = {
    v: 1,
    courseVersion: st?.courseVersion ?? course.version,
    registration: st?.registration ?? registration(),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    au: st ? progressOf(course, st, rec) : {},
    satisfied: { blocks: [], course: false },
    files: { ...(st?.files ?? {}) },
    outbox: [],
    awards: [],
  };
  if (st?.placement) {
    const p = st.placement;
    state.placement = { pathKey: p.pathId, startLessonKey: p.startLessonId, skip: [...p.skip], reason: p.reason };
  }
  const cursor = st && cursorOf(st);
  if (cursor) state.cursor = cursor;
  if (st?.pending) {
    const p = st.pending;
    state.pending = { lessonKey: p.lessonId, checkpointKey: p.checkpointId, checksPassed: p.checksPassed, allowed: [...p.allowed] };
  }
  return state;
}

/**
 * Converts a stored legacy record (raw JSON) to a practice copy of `course`, or returns undefined when it is
 * not a valid learning-mcp record. The learner keeps their learnerId as the practice actor's account name.
 */
export function convertLegacyRecord(raw: unknown, course: CourseModel, registration: () => string = () => crypto.randomUUID()): PracticeRecord | undefined {
  const parsed = parseRecord(raw);
  if (!parsed.ok) return undefined;
  const rec = parsed.record;
  const state = legacyState(rec, course, registration);
  return {
    format: PRACTICE_FORMAT,
    version: PRACTICE_VERSION,
    official: false,
    label: PRACTICE_LABEL,
    courseId: course.id,
    actor: { objectType: 'Agent', account: { homePage: PRACTICE_HOMEPAGE, name: rec.learnerId } },
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    state,
    statements: [],
  };
}
