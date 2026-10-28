// The studio's ContentBundle as a course-xapi-mcp package (cmi5.xml + cxm/course.json + cxm/lessons/<key>.json),
// and back. Everything the standard has a slot for goes in its slot; the studio-only fields (preview, landing,
// previewFiles, checkpoint fallback, coming-soon hints) live under one namespaced extension in course.json.
// The path's finalFiles are a reference solution: they live only in the secret referenceSolution slot (R27).
import { CMI5_XML_NS, CXM_XML_NS, SPEC_VERSION } from '../../vendor/course-xapi-mcp/core/constants.ts';
import { loadPackage } from '../../vendor/course-xapi-mcp/core/package/index.ts';
import { BRANCH_SUCCESS, BRANCH_WHEN, COURSE_VERSION, MCP_URL } from './course-meta';
import type { Beat, Branch, Check, ContentBundle, Lesson, Outcome, Path, PathId, PlantedBug, Preview, Source } from './types';
import { XAPI_BASE, activityId } from './xapi';

/** The namespaced extension that carries what the standard has no field for. */
export const STUDIO_EXT = `${XAPI_BASE}/cxm/studio/v1`;
export const COURSE_IRI = activityId(['course']);
const PLACEMENT_IRI = activityId(['placement']);
const blockIri = (pathId: string) => activityId(['paths', pathId]);
const auIri = (lessonId: string) => activityId(['lessons', lessonId]);
/** Where the cmi5 AU urls point. Nothing launches them; they name the studio. */
const LAUNCH_BASE = `${XAPI_BASE}/learn`;
const CLAIM_PAGE = `${XAPI_BASE}/claim`;
/** The bug's hint opens after this many attempts; the studio has no setting for it. */
const REVEAL_AFTER = 3;

/** Package files by path, as text. */
export type PackageFiles = Record<string, string>;

const COURSE_TITLE = 'Learn WordPress, reimagined';
const PLACEMENT_INTRO =
  'Ask the learner what they want to build with WordPress and what they have tried so far (for example, editing a theme, writing code or using AI to write it). ' +
  'Then place them on the path and lesson that fit, skipping only lessons they clearly know.';
const COURSE_RULES = [
  'These lessons are adapted from Learn WordPress (learn.wordpress.org) and have not been reviewed by the WordPress Training Team. Say so when it matters, and link the lesson\'s sources.',
  'When you are unsure about a WordPress fact, say so and point to one of the lesson\'s sources instead of guessing.',
  'The learner edits their files by hand. Never write a whole file for them; explain, hint and let them type it.',
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lang = (tag: string, text: string, pad: string) => `${pad}<${tag}><langstring lang="en">${esc(text)}</langstring></${tag}>`;
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

function courseDescription(liveTitles: string[]): string {
  const list = liveTitles.length > 1 ? `${liveTitles.slice(0, -1).join(', ')} and ${liveTitles[liveTitles.length - 1]}` : liveTitles[0] ?? 'WordPress';
  return `An unofficial concept course adapted from Learn WordPress. Build something real, one hand edit at a time. Paths: ${list}.`;
}

interface StudioPath { placementHints?: string; preview?: Preview; previewFiles?: Record<string, string> }
interface StudioLesson { landing?: string; fallback?: { label: string; outcome: Outcome }[] }
interface StudioExt { paths: Record<string, StudioPath>; lessons: Record<string, StudioLesson> }

/** The path's reference files this lesson's checks and bug run on: the authoring package's secret reference solution. */
function referenceSolution(l: Lesson, final: Record<string, string> | undefined, first: boolean): Record<string, unknown> | undefined {
  if (!final) return undefined;
  // The path's first lesson carries every final file, so the whole set survives in the secret slot (and only there).
  if (first) return { files: final, ...(l.bug && Object.hasOwn(final, l.bug.file) ? { bugFix: final[l.bug.file] } : {}) };
  if (!(l.bug || l.checkpoint?.kind === 'code')) return undefined;
  const used = new Set((l.checkpoint?.checks ?? []).map((c) => c.file));
  if (l.checkpoint?.file) used.add(l.checkpoint.file);
  const files = Object.fromEntries([...used].filter((f) => Object.hasOwn(final, f)).map((f) => [f, final[f]!]));
  const bugFix = l.bug && Object.hasOwn(final, l.bug.file) ? final[l.bug.file] : undefined;
  return { files, ...(bugFix !== undefined ? { bugFix } : {}) };
}

function lessonJson(l: Lesson, final: Record<string, string> | undefined, first: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    minutes: l.minutes,
    sources: l.sources,
    ...(l.starterFiles ? { starterFiles: l.starterFiles } : {}),
    beats: l.beats.map(({ id, ...rest }) => ({ key: id, ...rest })),
  };
  if (l.bug) {
    const { id, ...rest } = l.bug;
    out.bug = { key: id, ...rest, revealAfter: REVEAL_AFTER };
  }
  if (l.checkpoint) {
    const { id, kind, question, rubric, file, checks, branches } = l.checkpoint;
    out.checkpoint = {
      key: id,
      kind,
      question,
      rubric,
      ...(file ? { file } : {}),
      ...(checks ? { checks } : {}),
      branches: branches.map((b) => ({ key: b.outcome, when: BRANCH_WHEN[b.outcome], success: BRANCH_SUCCESS[b.outcome], to: b.to, message: b.message })),
    };
  }
  const solution = referenceSolution(l, final, first);
  if (solution) out.referenceSolution = solution;
  return out;
}

export function bundleToPackage(b: ContentBundle): PackageFiles {
  const paths = Object.values(b.paths);
  const files: PackageFiles = {};
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<courseStructure xmlns="${CMI5_XML_NS}" xmlns:cxm="${CXM_XML_NS}">`,
    `  <course id="${esc(COURSE_IRI)}">`,
    lang('title', COURSE_TITLE, '    '),
    lang('description', courseDescription(paths.filter((p) => p.status === 'live').map((p) => p.title)), '    '),
    `    <cxm:course src="cxm/course.json" specVersion="${SPEC_VERSION}" mcp="${esc(MCP_URL)}"/>`,
    '  </course>',
    `  <au id="${esc(PLACEMENT_IRI)}" cxm:key="placement" cxm:role="placement" moveOn="NotApplicable" launchMethod="OwnWindow">`,
    lang('title', 'Placement', '    '),
    lang('description', 'Find out where to start.', '    '),
    `    <url>${esc(`${LAUNCH_BASE}?au=placement`)}</url>`,
    '  </au>',
  ];
  const courseJsonPaths: Record<string, unknown> = {};
  const studio: StudioExt = { paths: {}, lessons: {} };
  for (const p of paths) {
    const sp: StudioPath = {};
    if (p.status === 'live') {
      courseJsonPaths[p.id] = { tagline: p.tagline, placementHints: p.placementHints };
      if (p.preview) sp.preview = p.preview;
      if (p.previewFiles) sp.previewFiles = p.previewFiles;
      lines.push(`  <block id="${esc(blockIri(p.id))}" cxm:key="${esc(p.id)}">`, lang('title', p.title, '    '), lang('description', p.tagline, '    '));
      for (const lk of p.lessons) {
        const l = b.lessons[lk]!;
        lines.push(
          `    <au id="${esc(auIri(lk))}" cxm:key="${esc(lk)}" moveOn="${l.checkpoint ? 'CompletedAndPassed' : 'Completed'}" launchMethod="OwnWindow">`,
          lang('title', l.title, '      '),
          lang('description', l.title, '      '),
          `      <url>${esc(`${LAUNCH_BASE}?au=${encodeURIComponent(lk)}`)}</url>`,
          `      <cxm:lesson src="cxm/lessons/${esc(lk)}.json"/>`,
          '    </au>',
        );
        files[`cxm/lessons/${lk}.json`] = json(lessonJson(l, p.finalFiles, lk === p.lessons[0]));
        const sl: StudioLesson = {};
        if (l.landing) sl.landing = l.landing;
        if (l.checkpoint) sl.fallback = l.checkpoint.fallback;
        if (Object.keys(sl).length) studio.lessons[lk] = sl;
      }
      lines.push(`    <cxm:path src="cxm/course.json#/paths/${esc(p.id)}"/>`, '  </block>');
    } else {
      courseJsonPaths[p.id] = { status: 'coming-soon', title: p.title, tagline: p.tagline };
      sp.placementHints = p.placementHints;
    }
    if (Object.keys(sp).length) studio.paths[p.id] = sp;
  }
  lines.push('</courseStructure>', '');
  files['cmi5.xml'] = lines.join('\n');
  // One badge per live path, earned when the block is satisfied, waived lessons counting (section 7.5).
  // No per-lesson or course badge. Badges need a custody that keeps a record, so this is server-kept.
  const badges = paths
    .filter((p) => p.status === 'live')
    .map((p) => ({
      id: `${XAPI_BASE}/badges/${p.id}`,
      name: p.title,
      description: p.tagline,
      criteria: { narrative: `Satisfy every lesson of the ${p.title} path: pass its checkpoints, or be placed past a lesson by a skip.` },
      achievementType: 'Certificate',
      awardOn: 'block-satisfied',
      for: p.id,
      countWaived: true,
      includeScore: false,
    }));
  files['cxm/course.json'] = json({
    specVersion: SPEC_VERSION,
    flavour: 'authoring',
    version: COURSE_VERSION,
    language: 'en',
    license: 'CC BY-SA 4.0',
    rules: COURSE_RULES,
    placement: { intro: PLACEMENT_INTRO, maxQuestions: 4 },
    custody: 'server-kept',
    allowPractice: false,
    paths: courseJsonPaths,
    badges,
    badgeIssuer: { signer: 'course-server', claimPage: CLAIM_PAGE },
    extensions: { [STUDIO_EXT]: studio },
  });
  return files;
}

/** Reads a package back into a bundle. Throws `package: <issues>` if the standard's loader refuses it. */
export function packageToBundle(files: PackageFiles): ContentBundle {
  const enc = new TextEncoder();
  const loaded = loadPackage(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc.encode(v)])));
  if (!loaded.ok) throw new Error(`package: ${loaded.issues.map((i) => `${i.code} ${i.file}: ${i.message}`).join('; ')}`);
  const c = loaded.course;
  const studio = (c.extensions?.[STUDIO_EXT] ?? { paths: {}, lessons: {} }) as StudioExt;
  const paths = {} as Record<PathId, Path>;
  for (const pm of Object.values(c.paths)) {
    const sp = studio.paths[pm.key] ?? {};
    // finalFiles are the reference solution: they live only in the lessons' secret referenceSolution.files.
    const finalFiles: Record<string, string> = {};
    for (const lk of pm.lessons) Object.assign(finalFiles, c.lessons[lk]?.referenceSolution?.files);
    const path: Path = {
      id: pm.key as PathId,
      title: pm.title,
      tagline: pm.tagline,
      status: pm.status,
      lessons: [...pm.lessons],
      placementHints: pm.placementHints ?? sp.placementHints ?? '',
      ...(Object.keys(finalFiles).length ? { finalFiles } : {}),
      ...(sp.previewFiles ? { previewFiles: sp.previewFiles } : {}),
      ...(sp.preview ? { preview: sp.preview } : {}),
    };
    paths[path.id] = path;
  }
  const lessons: Record<string, Lesson> = {};
  for (const lm of Object.values(c.lessons)) {
    const sl = studio.lessons[lm.key] ?? {};
    const lesson: Lesson = {
      id: lm.key,
      pathId: lm.pathKey as PathId,
      title: lm.title,
      minutes: lm.minutes,
      ...(sl.landing ? { landing: sl.landing } : {}),
      sources: lm.sources as Source[],
      beats: lm.beats.map(({ key, ...rest }) => ({ id: key, ...rest }) as Beat),
      ...(lm.starterFiles ? { starterFiles: lm.starterFiles } : {}),
    };
    if (lm.checkpoint) {
      const cp = lm.checkpoint;
      lesson.checkpoint = {
        id: cp.key,
        question: cp.question,
        kind: cp.kind,
        rubric: cp.rubric,
        ...(cp.file ? { file: cp.file } : {}),
        ...(cp.checks ? { checks: cp.checks as Check[] } : {}),
        branches: cp.branches.map((br) => ({ outcome: br.key as Outcome, to: br.to ?? '', message: br.message }) as Branch),
        fallback: sl.fallback ?? [],
      };
    }
    if (lm.bug) {
      const { key, file, code, explanation, fixChecks } = lm.bug;
      lesson.bug = { id: key, file, code, explanation, fixChecks: fixChecks as Check[] } satisfies PlantedBug;
    }
    lessons[lesson.id] = lesson;
  }
  return { paths, lessons };
}

// ---- comparison -------------------------------------------------------------------------------------------

/** Keys whose strings are compared exactly: file contents and check values. Everything else is prose. */
const EXACT = new Set(['starterFiles', 'previewFiles', 'finalFiles', 'checks', 'fixChecks']);
/** The standard trims a planted bug's code, so its surrounding whitespace is not compared; its inside is. */
const TRIMMED = new Set(['code']);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const show = (s: string) => JSON.stringify(s.length > 80 ? `${s.slice(0, 77)}...` : s);

function walk(a: unknown, b: unknown, at: string, exact: boolean, out: string[]): void {
  if (typeof a === 'string' && typeof b === 'string') {
    const trimmed = TRIMMED.has(at.split('.').pop()!);
    const [x, y] = trimmed ? [a.trim(), b.trim()] : [a, b];
    if (exact || trimmed ? x !== y : squash(x) !== squash(y)) out.push(`${at}: ${show(x)} != ${show(y)}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at}: ${a.length} items != ${b.length} items`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${at}.${i}`, exact, out);
    return;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of [...keys].sort()) {
      const av = ao[k];
      const bv = bo[k];
      if (av === undefined && bv === undefined) continue;
      if (av === undefined || bv === undefined) out.push(`${at}.${k}: ${av === undefined ? 'missing in first' : 'missing in second'}`);
      else walk(av, bv, `${at}.${k}`, exact || EXACT.has(k), out);
    }
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

/**
 * Differences between two bundles; empty when they are semantically identical: same ids, beats, checks,
 * branches and files, and prose that matches once whitespace is collapsed. Each line starts with where it is,
 * for example `lessons.bt-patterns.checkpoint.checks.0.value`.
 */
export function compareBundles(a: ContentBundle, b: ContentBundle): string[] {
  const out: string[] = [];
  walk(a, b, '', false, out);
  return out.map((s) => s.replace(/^\./, ''));
}
