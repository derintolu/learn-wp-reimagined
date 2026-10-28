import { afterEach, describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { buildCourse, getCourse, setCourseForTests, toCourse } from '../../functions/_lib/mcp/course';
import { parseCourse } from '../../vendor/learning-mcp/core/index.ts';
import { buildStandardCourse } from '../../functions/_lib/mcp/standardCourse';
import { judgePrompt } from '../../functions/_lib/prompts';
import { BRANCH_WHEN, COURSE_ACTIVITY_BASE, COURSE_ID } from '../../src/shared/course-meta';
import type { ContentBundle } from '../../src/shared/types';

const real = () => buildContent();

afterEach(() => setCourseForTests(null));

describe('course conversion', () => {
  it('converts the real content and passes parseCourse', () => {
    const r = parseCourse(toCourse(real()));
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
    const c = buildCourse(real());
    expect(c.id).toBe(COURSE_ID);
    expect(c.activityBase).toBe(COURSE_ACTIVITY_BASE);
    expect(getCourse().lessons['bt-what-is-a-block-theme'].title).toBe(c.lessons['bt-what-is-a-block-theme'].title);
  });

  it('maps each outcome to a branch id with its success and judgePrompt wording', () => {
    const c = buildCourse(real());
    for (const l of Object.values(c.lessons)) {
      for (const b of l.checkpoint?.branches ?? []) {
        expect(['advance', 'review', 'skip']).toContain(b.id);
        expect(b.success).toBe(b.id !== 'review');
        expect(b.when).toBe(BRANCH_WHEN[b.id as keyof typeof BRANCH_WHEN]);
      }
    }
    // R-c: the wording must stay the same as the site's own judge prompt.
    const lesson = real().lessons['bt-what-is-a-block-theme'];
    const prompt = judgePrompt(lesson);
    for (const w of Object.values(BRANCH_WHEN)) expect(prompt).toContain(w.charAt(0).toLowerCase() + w.slice(1, -1));
  });

  it('drops the site-only fields and keeps files, bugs and checks byte for byte', () => {
    const bundle = real();
    const c = buildCourse(bundle);
    const json = JSON.stringify(c);
    expect(json).not.toContain('"fallback"');
    expect(json).not.toContain('"finalFiles"');
    expect(json).not.toContain('"previewFiles"');
    for (const [id, l] of Object.entries(bundle.lessons)) {
      expect(c.lessons[id].starterFiles).toEqual(l.starterFiles);
      // learning-mcp trims its text fields, so only the planted code's outer whitespace may differ.
      expect(c.lessons[id].bug).toEqual(l.bug && { ...l.bug, code: l.bug.code.trim(), explanation: l.bug.explanation.trim() });
      expect(c.lessons[id].checkpoint?.checks).toEqual(l.checkpoint?.checks);
    }
  });

  it('course text names no single path', () => {
    const course = toCourse(real()) as { description: string; rules: string[]; placement: { intro: string } };
    const live = Object.values(real().paths).filter((x) => x.status === 'live');
    let text = [course.description, ...course.rules, course.placement.intro].join('\n');
    for (const p of live) text = text.replace(p.title, ''); // the description may name each live path by title
    expect(text).not.toMatch(/block theme/i);
    expect(text).not.toMatch(/your theme/i);
    expect(course.rules[2]).toBe('The learner edits their files by hand. Never write a whole file for them; explain, hint and let them type it.');
    for (const p of live) expect(course.description).toContain(p.title);
    expect(course.description).toMatch(/^An unofficial concept course adapted from Learn WordPress\. Build something real, one hand edit at a time\. Paths: /);
  });

  it('keeps coming-soon paths with no lessons', () => {
    const c = buildCourse(real());
    const soon = Object.values(c.paths).filter((p) => p.status === 'coming-soon');
    for (const p of soon) expect(p.lessons).toEqual(real().paths[p.id as keyof ContentBundle['paths']].lessons);
  });

  it('throws naming the field when the bundle is invalid', () => {
    const bundle = real();
    bundle.lessons['bt-what-is-a-block-theme'].checkpoint!.branches[0].to = 'nowhere';
    expect(() => buildCourse(bundle)).toThrow(/branches/);
  });
});

describe('the content as a course-xapi-mcp package (/api/mcp on the standard)', () => {
  it('loads with the standard loader: same paths, lessons, beats, bugs and checks, practice custody', () => {
    const bundle = real();
    const m = buildStandardCourse(bundle);
    expect(m.id).toBe(COURSE_ACTIVITY_BASE);
    expect(m.custody).toBe('practice');
    expect(m.flavour).toBe('authoring');
    expect(Object.keys(m.paths).sort()).toEqual(Object.keys(bundle.paths).sort());
    expect(Object.keys(m.lessons).sort()).toEqual(Object.keys(bundle.lessons).sort());
    for (const l of Object.values(bundle.lessons)) {
      const ml = m.lessons[l.id];
      expect(ml.pathKey).toBe(l.pathId);
      expect(ml.beats.map((b) => b.key)).toEqual(l.beats.map((b) => b.id));
      expect(ml.starterFiles ?? {}).toEqual(l.starterFiles ?? {});
      expect(ml.bug?.fixChecks).toEqual(l.bug?.fixChecks);
      expect(ml.bug?.explanation).toBe(l.bug?.explanation);
      if (l.bug) expect(ml.bug?.revealAfter).toBe(3);
      expect(ml.checkpoint?.checks).toEqual(l.checkpoint?.checks);
      expect(ml.checkpoint?.branches.map((b) => b.key)).toEqual(l.checkpoint?.branches.map((b) => b.outcome));
    }
  });
});
