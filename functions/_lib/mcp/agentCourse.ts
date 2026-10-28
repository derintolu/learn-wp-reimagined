// The course /api/mcp teaches with SERVER_FLAGS.agentOnStandard: the full (authoring) package built from the
// course the server serves now (the course cache, Task 19, or the baked bundle) by bundleToPackage (Task 15),
// loaded with the standard's own loader. The authoring flavour holds the bug explanations, fix checks and
// reference solution; the reference server keeps them from the agent until the rules allow. Memoised per bundle.
import { loadPackage } from '../../../vendor/course-xapi-mcp/core/package/index.ts';
import type { CourseModel } from '../../../vendor/course-xapi-mcp/core/model.ts';
import { bundleToPackage } from '../../../src/shared/package';
import { XAPI_BASE } from '../../../src/shared/xapi';
import type { ContentBundle } from '../../../src/shared/types';
import { getContent } from '../content';

/** The studio's claim page (Task 49): it mints a claim link for the signed-in learner. Never a claim link itself. */
export const CLAIM_PAGE_URL = `${XAPI_BASE}/badges/claim`;

export function buildAgentCourse(bundle: ContentBundle): CourseModel {
  const enc = new TextEncoder();
  const loaded = loadPackage(Object.fromEntries(Object.entries(bundleToPackage(bundle)).map(([k, v]) => [k, enc.encode(v)])));
  if (!loaded.ok) throw new Error(`course package: ${loaded.issues.map((i) => `${i.code} ${i.file}: ${i.message}`).join('; ')}`);
  const course = loaded.course;
  return course.badgeIssuer ? { ...course, badgeIssuer: { ...course.badgeIssuer, claimPage: CLAIM_PAGE_URL } } : course;
}

let cached: { src: ContentBundle; course: CourseModel } | null = null;

export function getAgentCourse(): CourseModel {
  const src = getContent();
  if (cached?.src !== src) cached = { src, course: buildAgentCourse(src) };
  return cached.course;
}
