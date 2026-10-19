import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { buildContent } from '../../scripts/build-content';
import { nextLessonId, resolveBranch, validatePlacement } from '../../src/shared/engine';

const c = buildContent(resolve(__dirname, '../fixtures/content'));
const ids = c.paths['block-theme'].lessons;
const valid = { pathId: 'block-theme', startLessonId: ids[2], skip: [ids[0]], reason: 'knows theme.json' };

describe('validatePlacement', () => {
  it('accepts a valid placement', () => {
    const r = validatePlacement(c, valid);
    expect(r).toEqual({ ok: true, placement: valid });
  });
  it('rejects a coming-soon path', () => {
    expect(validatePlacement(c, { ...valid, pathId: 'learner' }).ok).toBe(false);
  });
  it('rejects unknown path and non-object input', () => {
    expect(validatePlacement(c, { ...valid, pathId: 'nope' }).ok).toBe(false);
    expect(validatePlacement(c, null).ok).toBe(false);
    expect(validatePlacement(c, 'x').ok).toBe(false);
  });
  it('rejects a start lesson from another path or unknown', () => {
    expect(validatePlacement(c, { ...valid, startLessonId: 'nope', skip: [] }).ok).toBe(false);
  });
  it('rejects a skip containing a later or the start lesson or non-array', () => {
    expect(validatePlacement(c, { ...valid, startLessonId: ids[1], skip: [ids[2]] }).ok).toBe(false);
    expect(validatePlacement(c, { ...valid, startLessonId: ids[1], skip: [ids[1]] }).ok).toBe(false);
    expect(validatePlacement(c, { ...valid, skip: 'x' }).ok).toBe(false);
    expect(validatePlacement(c, { ...valid, skip: [5] }).ok).toBe(false);
  });
  it('requires a reason of 1..300 chars', () => {
    expect(validatePlacement(c, { ...valid, reason: '' }).ok).toBe(false);
    expect(validatePlacement(c, { ...valid, reason: 'x'.repeat(301) }).ok).toBe(false);
    expect(validatePlacement(c, { ...valid, reason: 'x'.repeat(300) }).ok).toBe(true);
    expect(validatePlacement(c, { ...valid, reason: 7 }).ok).toBe(false);
  });
});

describe('resolveBranch', () => {
  it('returns the authored branch for each outcome', () => {
    const cp = c.lessons[ids[0]].checkpoint!;
    for (const outcome of ['advance', 'review', 'skip'] as const) {
      expect(resolveBranch(c, ids[0], outcome)).toEqual(cp.branches.find((b) => b.outcome === outcome));
    }
  });
  it('throws without a checkpoint or lesson', () => {
    const noCp = ids.find((i) => !c.lessons[i].checkpoint);
    if (noCp) expect(() => resolveBranch(c, noCp, 'advance')).toThrow();
    expect(() => resolveBranch(c, 'nope', 'advance')).toThrow();
  });
});

describe('nextLessonId', () => {
  it('starts at the first lesson when afterLessonId is null', () => {
    expect(nextLessonId(c, 'block-theme', null, [])).toBe(ids[0]);
  });
  it('skips listed lessons', () => {
    expect(nextLessonId(c, 'block-theme', null, [ids[0]])).toBe(ids[1]);
    expect(nextLessonId(c, 'block-theme', ids[0], [ids[1]])).toBe(ids[2]);
  });
  it('returns null at the end', () => {
    expect(nextLessonId(c, 'block-theme', ids[ids.length - 1], [])).toBeNull();
    expect(nextLessonId(c, 'block-theme', ids[ids.length - 2], [ids[ids.length - 1]])).toBeNull();
  });
});
