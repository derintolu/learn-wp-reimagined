// The site's content as a learning-mcp course. Converted at runtime (memoised per isolate) rather than
// written to a second generated file, so new paths flow through with no pipeline change (ruling R-B3).
// Content is authored once, in content/paths/**.yaml.
import { parseCourse, type Course } from '../../../vendor/learning-mcp/core/index.ts';
import { BRANCH_SUCCESS, BRANCH_WHEN, COURSE_ACTIVITY_BASE, COURSE_ID, COURSE_VERSION } from '../../../src/shared/course-meta';
import type { ContentBundle } from '../../../src/shared/types';
import { getContent } from '../content';

const PLACEMENT_INTRO =
  'Ask the learner what they want to build with WordPress and what they have tried so far (for example, editing a theme, writing code or using AI to write it). ' +
  'Then place them on the path and lesson that fit, skipping only lessons they clearly know.';

const COURSE_RULES = [
  'These lessons are adapted from Learn WordPress (learn.wordpress.org) and have not been reviewed by the WordPress Training Team. Say so when it matters, and link the lesson\'s sources.',
  'When you are unsure about a WordPress fact, say so and point to one of the lesson\'s sources instead of guessing.',
  'The learner edits their files by hand. Never write a whole file for them; explain, hint and let them type it.',
];

function courseDescription(liveTitles: string[]): string {
  const list = liveTitles.length > 1 ? `${liveTitles.slice(0, -1).join(', ')} and ${liveTitles[liveTitles.length - 1]}` : liveTitles[0] ?? 'WordPress';
  return `An unofficial concept course adapted from Learn WordPress. Build something real, one hand edit at a time. Paths: ${list}.`;
}

/** The learning-mcp course object for a content bundle (not yet validated). */
export function toCourse(bundle: ContentBundle): unknown {
  const paths = Object.fromEntries(
    Object.values(bundle.paths).map((p) => [
      p.id,
      { id: p.id, title: p.title, tagline: p.tagline, status: p.status, lessons: [...p.lessons], placementHints: p.placementHints },
    ]),
  );
  const lessons = Object.fromEntries(
    Object.values(bundle.lessons).map((l) => {
      const cp = l.checkpoint;
      return [
        l.id,
        {
          id: l.id,
          pathId: l.pathId,
          title: l.title,
          minutes: l.minutes,
          sources: l.sources,
          beats: l.beats,
          ...(l.starterFiles ? { starterFiles: l.starterFiles } : {}),
          ...(l.bug ? { bug: l.bug } : {}),
          ...(cp
            ? {
                checkpoint: {
                  id: cp.id,
                  kind: cp.kind,
                  question: cp.question,
                  rubric: cp.rubric,
                  ...(cp.file ? { file: cp.file } : {}),
                  ...(cp.checks ? { checks: cp.checks } : {}),
                  branches: cp.branches.map((b) => ({
                    id: b.outcome,
                    when: BRANCH_WHEN[b.outcome],
                    success: BRANCH_SUCCESS[b.outcome],
                    to: b.to,
                    message: b.message,
                  })),
                },
              }
            : {}),
        },
      ];
    }),
  );
  return {
    id: COURSE_ID,
    title: 'Learn WordPress, reimagined',
    description: courseDescription(Object.values(bundle.paths).filter((p) => p.status === 'live').map((p) => p.title)),
    version: COURSE_VERSION,
    language: 'en',
    activityBase: COURSE_ACTIVITY_BASE,
    license: 'CC BY-SA 4.0',
    rules: COURSE_RULES,
    placement: { intro: PLACEMENT_INTRO, maxQuestions: 4 },
    paths,
    lessons,
  };
}

/** Converts and validates; throws `course: <errors>` if the content no longer fits learning-mcp. */
export function buildCourse(bundle: ContentBundle): Course {
  const r = parseCourse(toCourse(bundle));
  if (!r.ok) throw new Error(`course: ${r.errors.join('; ')}`);
  return r.course;
}

let cached: { src: ContentBundle; course: Course } | null = null;
let override: Course | null = null;

export function getCourse(): Course {
  if (override) return override;
  const src = getContent();
  if (cached?.src !== src) cached = { src, course: buildCourse(src) };
  return cached.course;
}

/** Test-only: swap the course (pass null to restore the converted one). */
export function setCourseForTests(c: Course | null): void {
  override = c;
  cached = null;
}
