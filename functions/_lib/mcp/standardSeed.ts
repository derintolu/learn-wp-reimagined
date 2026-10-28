// "Continue in your agent" on the standard: a practice copy placed at the learner's lesson, with their files,
// made by the standard's own engine (placement session, `placed`, then the cursor at the lesson), so the
// reference server continues it like any copy it wrote. Only placement and files are seeded (ruling R-B8).
import { PRACTICE_HOMEPAGE, PRACTICE_LABEL } from '../../../vendor/course-xapi-mcp/core/constants.ts';
import { LIMITS } from '../../../vendor/course-xapi-mcp/core/learner-text.ts';
import type { CourseModel } from '../../../vendor/course-xapi-mcp/core/model.ts';
import { PRACTICE_FORMAT, PRACTICE_VERSION, type PracticeRecord } from '../../../vendor/course-xapi-mcp/core/practice-record.ts';
import type { XapiAgent } from '../../../vendor/course-xapi-mcp/core/xapi/types.ts';
import { choosePlacement, startPlacement, type Env } from '../../../vendor/course-xapi-mcp/core/session/index.ts';
import { SEED_REASON } from './seed';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Every file a lesson of this path works on: starter files, the planted bug's file and checkpoint files. */
export function pathFiles(course: CourseModel, pathKey: string): Set<string> {
  const names = new Set<string>();
  for (const key of course.paths[pathKey]?.lessons ?? []) {
    const l = course.lessons[key];
    if (!l) continue;
    for (const f of Object.keys(l.starterFiles ?? {})) names.add(f);
    if (l.bug) names.add(l.bug.file);
    if (l.checkpoint?.file) names.add(l.checkpoint.file);
  }
  return names;
}

export function seedPractice(
  course: CourseModel,
  lessonKey: unknown,
  files: unknown,
  o: { now: () => string; uuid: () => string; platform?: string },
): { ok: true; record: PracticeRecord } | { ok: false; error: string } {
  if (typeof lessonKey !== 'string' || !has(course.lessons, lessonKey)) return { ok: false, error: 'That lesson does not exist.' };
  const lesson = course.lessons[lessonKey]!;
  const path = course.paths[lesson.pathKey];
  if (path?.status !== 'live' || !path.lessons.includes(lessonKey)) return { ok: false, error: 'That lesson is not open yet.' };
  const account = { homePage: PRACTICE_HOMEPAGE, name: o.uuid() };
  const actor: XapiAgent = { objectType: 'Agent', account };
  const env: Env = { now: o.now, uuid: o.uuid, actor, custody: 'practice', practice: true, ...(o.platform ? { platform: o.platform } : {}) };
  const started = startPlacement(course, undefined, env);
  if (!started.ok) return started;
  const placed = choosePlacement(course, started.state, { pathKey: path.key, startLessonKey: lessonKey, skip: [], reason: SEED_REASON }, env);
  if (!placed.ok) return placed;
  const allowed = pathFiles(course, path.key);
  const kept: Record<string, string> = {};
  if (files !== null && typeof files === 'object' && !Array.isArray(files)) {
    for (const [name, content] of Object.entries(files as Record<string, unknown>)) {
      if (Object.keys(kept).length >= LIMITS.files) break;
      if (allowed.has(name) && typeof content === 'string' && content.length <= LIMITS.file) kept[name] = content;
    }
  }
  const state = { ...placed.state, files: kept };
  return {
    ok: true,
    record: {
      format: PRACTICE_FORMAT,
      version: PRACTICE_VERSION,
      official: false,
      label: PRACTICE_LABEL,
      courseId: course.id,
      actor: { objectType: 'Agent', account },
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      state,
      statements: [...started.statements, ...placed.statements],
    },
  };
}
