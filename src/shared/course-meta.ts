import type { Outcome } from './types';
import { XAPI_BASE } from './xapi';

/** The course id in learning-mcp records (`courses[COURSE_ID]`). */
export const COURSE_ID = 'learn-wp-reimagined';
export const COURSE_VERSION = '0.1.0';
/** Activity IRIs of MCP statements. Distinct from the site's `${XAPI_BASE}/activities/…`. */
export const COURSE_ACTIVITY_BASE = `${XAPI_BASE}/course`;
/** The connector URL learners paste into their agent (plan B, ruling R-B1). */
export const MCP_URL = `${XAPI_BASE}/api/mcp`;

/** A branch counts as a pass unless it sends the learner back to review. */
export const BRANCH_SUCCESS: Record<Outcome, boolean> = { advance: true, review: false, skip: true };

/** The `when` text an agent judges against. Same wording as judgePrompt (ruling R-c). */
export const BRANCH_WHEN: Record<Outcome, string> = {
  advance: 'The answer meets the rubric.',
  review: 'The learner should revisit the material.',
  skip: 'The answer clearly shows mastery beyond the lesson.',
};

/** What the learner pastes into their agent after "Continue in your agent". */
export const agentHandlePrompt = (handle: string): string =>
  `Continue my "Learn WordPress, reimagined" course with the learn-wp-reimagined tools. My record handle is ${handle}. Call start_placement with that handle, then next_beat. Keep the handle private.`;

/** What the learner pastes into their agent when the agent signs them in itself (no handle). */
export const agentPrompt = (lessonTitle: string): string =>
  `Continue my "Learn WordPress, reimagined" course with the learn-wp-reimagined tools. I'm on the lesson "${lessonTitle}". I'll sign in when you ask. Then pick up at that lesson.`;

/** Estimated AI cost per 1000 learners at the chosen model mix (docs/model-eval.md, October 2026). */
export const COST_PER_1000_LEARNERS_USD = 4.97;

/** The Sensei LMS version the prototype's WordPress runs. The pages that name Sensei read it from here. */
export const SENSEI_VERSION = '4.26.4';
/** The app-rendered backend view of the block-theme course in Sensei (ruling R13; the course slug is the path id). */
export const BACKEND_VIEW_PATH = '/backend/block-theme';
