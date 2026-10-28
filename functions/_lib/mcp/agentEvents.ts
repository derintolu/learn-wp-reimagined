// Option 2 has one write path (design §7.2): what the reference engine did in a tool call becomes the studio's
// events, and the course server decides and records those (decideEvents), exactly as for POST /api/events. The
// engine's own statements are read here and never sent anywhere. Each event's id is the id of the engine
// statement it comes from, so a redelivery decides the same event again and records the same official statements.
//
// Not mapped, because the studio has no such event or the course server derives them itself: initialized,
// waived, satisfied, abandoned, defined passed and failed, caught (from the bug check), revealed, beat replies
// (answered on a beat) and the checkpoint answer alone (its response goes with the branch, below).
import { ADL_VERBS, CMI5, CXM_ACTIVITY_TYPES, CXM_EXT, CXM_VERBS, activityIds } from '../../../vendor/course-xapi-mcp/core/constants.ts';
import type { CourseModel, LessonModel } from '../../../vendor/course-xapi-mcp/core/model.ts';
import type { XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types.ts';
import type { ServerEvent } from '../../../src/shared/events';
import type { Outcome, PathId } from '../../../src/shared/types';

const isDefined = (s: XapiStatement) => (s.context?.contextActivities?.category ?? []).some((c) => c.id === CMI5.categoryCmi5);
const typeOf = (s: XapiStatement) => (s.object as { definition?: { type?: string } }).definition?.type;

/** The lesson an activity belongs to: its AU (`{au@id}/au`) or anything under `{au@id}/`. */
function lessonOf(course: CourseModel, id: string): LessonModel | undefined {
  return Object.values(course.lessons).find((l) => id === activityIds.au(l.auId) || id.startsWith(l.auId + '/'));
}
const keyOfAu = (course: CourseModel, auId: unknown) => Object.values(course.lessons).find((l) => l.auId === auId)?.key;

/** The learner's checkpoint answers in these statements, by lesson key: the response the branch is judged on. */
export function checkpointAnswers(course: CourseModel, statements: XapiStatement[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of statements) {
    if (s.verb.id !== ADL_VERBS.answered || typeOf(s) !== CXM_ACTIVITY_TYPES.checkpoint) continue;
    const l = lessonOf(course, s.object.id);
    if (l && typeof s.result?.response === 'string') out[l.key] = s.result.response;
  }
  return out;
}

/**
 * A planted-bug check: the engine records no per-check results for one (they would point at the bug), while a code
 * checkpoint's file check lists them.
 */
function isBugCheck(l: LessonModel, file: string, s: XapiStatement): boolean {
  const atBug = l.bug?.file === file;
  const atCheckpoint = l.checkpoint?.kind === 'code' && l.checkpoint.file === file;
  if (atBug && atCheckpoint) return (s.result?.extensions?.[CXM_EXT.checks] as unknown[] | undefined)?.length === 0;
  return atBug;
}

/**
 * The studio events for a batch of engine statements. `files` are the learner's files as the engine holds them
 * after the call; `answers` the checkpoint responses known to this call.
 */
export function eventsFor(course: CourseModel, statements: XapiStatement[], ctx: { files: Record<string, string>; answers: Record<string, string> }): ServerEvent[] {
  const out: ServerEvent[] = [];
  for (const s of statements) {
    const eventId = s.id;
    const verb = s.verb.id;
    if (verb === CXM_VERBS.placed) {
      const path = Object.values(course.paths).find((p) => p.blockId === s.object.id);
      const ext = s.result?.extensions ?? {};
      const start = keyOfAu(course, ext[CXM_EXT['start-lesson']]);
      const skip = Array.isArray(ext[CXM_EXT.skipped]) ? (ext[CXM_EXT.skipped] as unknown[]).map((a) => keyOfAu(course, a)) : [];
      if (path && start && skip.every((k) => k !== undefined)) {
        out.push({ eventId, type: 'placed', placement: { pathId: path.key as PathId, startLessonId: start, skip: skip as string[], reason: s.result?.response ?? '' } });
      }
      continue;
    }
    const l = lessonOf(course, s.object.id);
    if (!l) continue;
    if (isDefined(s)) {
      if (verb === ADL_VERBS.completed) out.push({ eventId, type: 'lessonCompleted', lessonId: l.key });
      else if (verb === ADL_VERBS.launched) out.push({ eventId, type: 'lessonOpened', lessonId: l.key });
      else if (verb === ADL_VERBS.terminated) out.push({ eventId, type: 'lessonLeft', lessonId: l.key });
      continue;
    }
    const type = typeOf(s);
    if (verb === ADL_VERBS.experienced && type === CXM_ACTIVITY_TYPES.beat) {
      const beatIndex = l.beats.findIndex((b) => activityIds.beat(l.auId, b.key) === s.object.id);
      if (beatIndex >= 0) out.push({ eventId, type: 'beatViewed', lessonId: l.key, beatIndex });
    } else if ((verb === ADL_VERBS.passed || verb === ADL_VERBS.failed) && type === CXM_ACTIVITY_TYPES.file) {
      const file = decodeURIComponent(s.object.id.slice(`${l.auId}/files/`.length));
      const content = ctx.files[file];
      if (content === undefined) continue;
      out.push({ eventId, type: 'codeSubmitted', lessonId: l.key, target: isBugCheck(l, file, s) ? 'bug' : 'checkpoint', file, files: { [file]: content } });
    } else if (verb === CXM_VERBS.branched) {
      const outcome = s.result?.extensions?.[CXM_EXT.branch];
      if (outcome !== 'advance' && outcome !== 'review' && outcome !== 'skip') continue;
      const cp = l.checkpoint;
      const files = cp?.kind === 'code' && cp.file && ctx.files[cp.file] !== undefined ? { files: { [cp.file]: ctx.files[cp.file]! } } : {};
      out.push({ eventId, type: 'checkpointAnswered', lessonId: l.key, response: ctx.answers[l.key] ?? '', outcome: outcome as Outcome, ...files });
    }
  }
  return out;
}
