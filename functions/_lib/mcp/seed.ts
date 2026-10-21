// "Continue in your agent": a fresh agent record placed at the learner's lesson, with their files.
// Only placement and files are seeded (ruling R-B8); the site's own statements stay in the site record.
import {
  LIMITS,
  choosePlacement,
  startPlacement,
  type Course,
  type Ctx,
  type LearningRecord,
} from '../../../vendor/learning-mcp/core/index.ts';
import { COURSE_ID } from '../../../src/shared/course-meta';

export const SEED_REASON = 'Continued from the Learn WordPress, reimagined site.';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Every file a lesson of this path works on: starter files, the planted bug's file and checkpoint files. */
export function pathFileNames(course: Course, pathId: string): Set<string> {
  const names = new Set<string>();
  for (const id of course.paths[pathId]?.lessons ?? []) {
    const l = course.lessons[id];
    for (const f of Object.keys(l.starterFiles ?? {})) names.add(f);
    if (l.bug) names.add(l.bug.file);
    if (l.checkpoint?.file) names.add(l.checkpoint.file);
  }
  return names;
}

export function seedRecord(
  course: Course,
  lessonId: unknown,
  files: unknown,
  ctx: Ctx,
): { ok: true; record: LearningRecord } | { ok: false; error: string } {
  if (typeof lessonId !== 'string' || !has(course.lessons, lessonId)) return { ok: false, error: 'That lesson does not exist.' };
  const lesson = course.lessons[lessonId];
  const path = course.paths[lesson.pathId];
  if (path?.status !== 'live' || !path.lessons.includes(lessonId)) return { ok: false, error: 'That lesson is not open yet.' };
  const start = startPlacement(course, undefined, ctx);
  const placed = choosePlacement(course, start.record, { pathId: path.id, startLessonId: lessonId, skip: [], reason: SEED_REASON }, ctx);
  if (!placed.ok) return { ok: false, error: placed.error };
  const allowed = pathFileNames(course, path.id);
  const kept: Record<string, string> = {};
  if (files !== null && typeof files === 'object' && !Array.isArray(files)) {
    for (const [name, content] of Object.entries(files as Record<string, unknown>)) {
      if (Object.keys(kept).length >= LIMITS.files) break;
      if (allowed.has(name) && typeof content === 'string' && content.length <= LIMITS.file) kept[name] = content;
    }
  }
  const record = placed.record;
  record.courses[COURSE_ID] = { ...record.courses[COURSE_ID], files: kept };
  return { ok: true, record };
}
