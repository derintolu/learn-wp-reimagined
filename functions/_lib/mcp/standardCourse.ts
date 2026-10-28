// The site's content as a course-xapi-mcp course model, for /api/mcp on the reference server.
// Minimal bundle -> package conversion, local to this host until Task 15 publishes the content as a package:
// today's learning-mcp course object (course.ts toCourse) goes through the standard's own legacy converter
// (validator/convert.ts) into cmi5.xml + cxm/*.json, which the standard's loader reads. Memoised per isolate.
import { convertLegacyCourse } from '../../../vendor/course-xapi-mcp/validator/convert.ts';
import { loadPackage } from '../../../vendor/course-xapi-mcp/core/package/index.ts';
import type { CourseModel } from '../../../vendor/course-xapi-mcp/core/model.ts';
import { COURSE_ACTIVITY_BASE, MCP_URL } from '../../../src/shared/course-meta';
import { XAPI_BASE } from '../../../src/shared/xapi';
import type { ContentBundle } from '../../../src/shared/types';
import { getContent } from '../content';
import { toCourse } from './course';

/**
 * The course IRI: the activity base today's MCP statements use, so lesson, beat, file and checkpoint IRIs keep
 * their shape (`<base>/lessons/<id>/...`) and the studio import reads both eras' statements.
 */
export const STANDARD_COURSE_IRI = COURSE_ACTIVITY_BASE;
/** Where the cmi5 AU urls point. Nothing launches them (practice custody has no LMS); they name the studio. */
export const LAUNCH_BASE = `${XAPI_BASE}/learn`;

/** The package files for a content bundle. Throws `course: <errors>` if the content no longer converts. */
export function toPackageFiles(bundle: ContentBundle): Record<string, Uint8Array> {
  const r = convertLegacyCourse(toCourse(bundle), { courseIri: STANDARD_COURSE_IRI, mcpUrl: MCP_URL, launchBase: LAUNCH_BASE, custody: 'practice' });
  if (!r.ok) throw new Error(`course: ${r.errors.join('; ')}`);
  const enc = new TextEncoder();
  return Object.fromEntries(Object.entries(r.files).map(([name, text]) => [name, enc.encode(text)]));
}

/** Converts and loads; throws `course package: <issues>` if the standard's loader refuses it. */
export function buildStandardCourse(bundle: ContentBundle): CourseModel {
  const loaded = loadPackage(toPackageFiles(bundle));
  if (!loaded.ok) throw new Error(`course package: ${loaded.issues.map((i) => `${i.code} ${i.file}: ${i.message}`).join('; ')}`);
  return loaded.course;
}

let cached: { src: ContentBundle; course: CourseModel } | null = null;

export function getStandardCourse(): CourseModel {
  const src = getContent();
  if (cached?.src !== src) cached = { src, course: buildStandardCourse(src) };
  return cached.course;
}
