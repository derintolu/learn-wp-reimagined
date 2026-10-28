import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { COURSE_IRI, STUDIO_EXT, bundleToPackage, compareBundles, packageToBundle } from '../../src/shared/package';
import { XAPI_BASE } from '../../src/shared/xapi';
import { loadPackage } from '../../vendor/course-xapi-mcp/core/package/index.ts';
import { behaviourIssues } from '../../vendor/course-xapi-mcp/validator/behaviour.ts';
import { secretPointers } from '../../vendor/course-xapi-mcp/validator/behaviour.ts';
import { lintIssues } from '../../vendor/course-xapi-mcp/validator/lint.ts';
import type { ContentBundle } from '../../src/shared/types';

const bundle = (): ContentBundle => buildContent();
const enc = new TextEncoder();
const bytes = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, enc.encode(v)]));

describe('package adapter', () => {
  it('uses the course identity base for its IRIs', () => {
    expect(STUDIO_EXT).toBe(`${XAPI_BASE}/cxm/studio/v1`);
    expect(COURSE_IRI).toBe(`${XAPI_BASE}/activities/course`);
    const f = bundleToPackage(bundle());
    expect(f['cmi5.xml']).toContain(`id="${XAPI_BASE}/activities/paths/block-theme"`);
    expect(f['cmi5.xml']).toContain(`id="${XAPI_BASE}/activities/lessons/bt-patterns"`);
  });

  it('the 18 live lessons round-trip with no differences', () => {
    const b = bundle();
    expect(Object.keys(b.lessons)).toHaveLength(18);
    expect(compareBundles(b, packageToBundle(bundleToPackage(b)))).toEqual([]);
  });

  it('the package passes the standard\'s validator with no errors', () => {
    // XSD checks (CXM-PKG-002/003) read schema files that are not vendored; every other check runs here.
    const files = bytes(bundleToPackage(bundle()));
    const loaded = loadPackage(files);
    expect(loaded.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const lessons = Object.values(loaded.course.lessons).map((l) => ({ key: l.key, file: `cxm/lessons/${l.key}.json`, base: '', lesson: JSON.parse(new TextDecoder().decode(files[`cxm/lessons/${l.key}.json`]!)) }));
    const course = { file: 'cxm/course.json', base: '', rules: loaded.course.rules };
    const issues = [...behaviourIssues(lessons, 'authoring'), ...lintIssues(course, lessons)];
    // Every check fails on the starter files and every fix check on the bug code (CXM-PKG-022/024).
    const errors = issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.file} ${i.pointer}`).sort();
    expect(errors).toEqual([]);
  });

  it('compareBundles reports a changed check value by lesson id', () => {
    const a = bundle();
    const b = packageToBundle(bundleToPackage(a));
    const id = Object.values(b.lessons).find((l) => l.bug?.fixChecks.some((c) => c.type === 'notContains'))!.id;
    const check = b.lessons[id]!.bug!.fixChecks.find((c) => c.type === 'notContains')! as { value: string };
    check.value += ' changed';
    const diffs = compareBundles(a, b);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain(id);
    expect(diffs[0]).toContain('value');
  });

  it('compareBundles ignores whitespace in prose but not in files', () => {
    const a = bundle();
    const b = structuredClone(a);
    const l = Object.values(b.lessons)[0]!;
    l.beats[0]!.content = `  ${l.beats[0]!.content.replace(/ /g, '  ')}\n`;
    expect(compareBundles(a, b)).toEqual([]);
    const withFiles = Object.values(b.lessons).find((x) => x.starterFiles)!;
    const file = Object.keys(withFiles.starterFiles!)[0]!;
    withFiles.starterFiles![file] += ' ';
    expect(compareBundles(a, b)).toHaveLength(1);
  });

  it('studio fields live only under STUDIO_EXT', () => {
    const b = bundle();
    const f = bundleToPackage(b);
    const course = JSON.parse(f['cxm/course.json']!);
    expect(Object.keys(course.extensions)).toEqual([STUDIO_EXT]);
    const studio = course.extensions[STUDIO_EXT];
    expect(studio.paths['block-theme'].preview).toEqual(b.paths['block-theme'].preview);
    expect(studio.paths['block-theme'].previewFiles).toEqual(b.paths['block-theme'].previewFiles);
    expect(studio.paths['block-theme'].finalFiles).toBeUndefined();
    const landing = Object.values(b.lessons).find((l) => l.landing)!;
    expect(studio.lessons[landing.id].landing).toBe(landing.landing);
    const outside = JSON.stringify({ ...course, extensions: undefined }) + Object.entries(f).filter(([k]) => k.startsWith('cxm/lessons/')).map(([, v]) => v).join('');
    for (const word of ['previewFiles', '"landing"', '"preview"']) expect(outside).not.toContain(word);
    for (const p of Object.values(course.paths) as object[]) expect(Object.keys(p)).not.toContain('extensions');
  });

  it('a distribution package keeps no solution file, bug explanation or fix check', () => {
    const b = bundle();
    const files = bundleToPackage(b);
    // The vendored build also needs XSD-valid input, so strip the same fields its distributionFiles() strips.
    const dist: Record<string, string> = {};
    for (const [name, text] of Object.entries(files)) {
      if (!name.endsWith('.json')) { dist[name] = text; continue; }
      const doc = JSON.parse(text);
      delete doc.referenceSolution;
      if (doc.bug) { delete doc.bug.explanation; delete doc.bug.fixChecks; }
      if (name === 'cxm/course.json') doc.flavour = 'distribution';
      dist[name] = JSON.stringify(doc, null, 2);
    }
    for (const [name, text] of Object.entries(dist)) if (name.endsWith('.json')) expect(secretPointers(JSON.parse(text))).toEqual([]);
    const all = Object.values(dist).join('\n');
    const secrets: string[] = [];
    for (const p of Object.values(b.paths)) {
      const pub = new Set([...Object.values(p.previewFiles ?? {}), ...p.lessons.flatMap((id) => Object.values(b.lessons[id]!.starterFiles ?? {}))]);
      secrets.push(...Object.values(p.finalFiles ?? {}).filter((t) => !pub.has(t)));
    }
    for (const l of Object.values(b.lessons)) {
      if (l.bug) secrets.push(JSON.stringify(l.bug.explanation).slice(1, -1), ...l.bug.fixChecks.map((c) => JSON.stringify(c.message).slice(1, -1)));
    }
    expect(secrets.length).toBeGreaterThan(10);
    for (const t of secrets) expect(all).not.toContain(JSON.stringify(t).slice(1, -1));
  });

  it('finalFiles round-trip through the secret slot only', () => {
    const b = bundle();
    const back = packageToBundle(bundleToPackage(b));
    for (const p of Object.values(b.paths)) expect(back.paths[p.id].finalFiles).toEqual(p.finalFiles);
    expect(Object.values(b.paths).filter((p) => p.finalFiles).length).toBeGreaterThan(0);
  });

  it('one badge declaration per live path with countWaived true', () => {
    const b = bundle();
    const course = JSON.parse(bundleToPackage(b)['cxm/course.json']!);
    const live = Object.values(b.paths).filter((p) => p.status === 'live').map((p) => p.id);
    expect(course.badges.map((x: { for: string }) => x.for).sort()).toEqual([...live].sort());
    for (const x of course.badges) {
      expect(x.awardOn).toBe('block-satisfied');
      expect(x.countWaived).toBe(true);
    }
    expect(course.badges).toHaveLength(live.length);
  });
});
