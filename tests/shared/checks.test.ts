import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { runChecks } from '../../src/shared/checks';
import { buildContent } from '../../scripts/build-content';
import type { Check } from '../../src/shared/types';

const FIXTURE = resolve(__dirname, '../fixtures/content');

describe('runChecks', () => {
  const files = { 'a.txt': 'hello world', 'theme.json': JSON.stringify({ settings: { color: { palette: [{ slug: 'primary' }] } } }) };

  it('contains / notContains', () => {
    const r = runChecks(
      [
        { type: 'contains', file: 'a.txt', value: 'world', message: 'm' },
        { type: 'notContains', file: 'a.txt', value: 'xyz', message: 'm' },
      ],
      files,
    );
    expect(r.passed).toBe(true);
    expect(runChecks([{ type: 'contains', file: 'a.txt', value: 'nope', message: 'm' }], files).passed).toBe(false);
    expect(runChecks([{ type: 'notContains', file: 'a.txt', value: 'hello', message: 'm' }], files).passed).toBe(false);
  });

  it('regex with flags', () => {
    expect(runChecks([{ type: 'regex', file: 'a.txt', pattern: '^HELLO', flags: 'i', message: 'm' }], files).passed).toBe(true);
    expect(runChecks([{ type: 'regex', file: 'a.txt', pattern: '^HELLO', message: 'm' }], files).passed).toBe(false);
  });

  it('invalid regex fails rather than throws', () => {
    expect(runChecks([{ type: 'regex', file: 'a.txt', pattern: '(', message: 'm' }], files).passed).toBe(false);
  });

  it('json pointer equality', () => {
    const ok: Check = { type: 'json', file: 'theme.json', pointer: '/settings/color/palette/0/slug', equals: 'primary', message: 'm' };
    expect(runChecks([ok], files).passed).toBe(true);
    expect(runChecks([{ ...ok, equals: 'other' }], files).passed).toBe(false);
    expect(runChecks([{ ...ok, pointer: '/settings/nope/0' }], files).passed).toBe(false);
  });

  it('json pointer escapes ~0 and ~1', () => {
    const f = { 'x.json': JSON.stringify({ 'a/b': { 'c~d': 1 } }) };
    expect(runChecks([{ type: 'json', file: 'x.json', pointer: '/a~1b/c~0d', equals: 1, message: 'm' }], f).passed).toBe(true);
  });

  it('invalid JSON fails, does not throw', () => {
    const r = runChecks([{ type: 'json', file: 'a.txt', pointer: '/x', equals: 1, message: 'm' }], files);
    expect(r.passed).toBe(false);
  });

  it('missing file fails', () => {
    const r = runChecks([{ type: 'contains', file: 'missing.txt', value: 'a', message: 'm' }], files);
    expect(r.passed).toBe(false);
    expect(r.results[0].passed).toBe(false);
  });

  it('reports per-check results', () => {
    const c1: Check = { type: 'contains', file: 'a.txt', value: 'hello', message: 'm' };
    const c2: Check = { type: 'contains', file: 'a.txt', value: 'nope', message: 'm' };
    const r = runChecks([c1, c2], files);
    expect(r.results).toEqual([{ check: c1, passed: true }, { check: c2, passed: false }]);
  });

  it('planted bug fails its fixChecks and passes once the slug is corrected', () => {
    const bug = buildContent(FIXTURE).lessons['patterns'].bug!;
    expect(runChecks(bug.fixChecks, { [bug.file]: bug.code }).passed).toBe(false);
    expect(runChecks(bug.fixChecks, { [bug.file]: bug.code.replace('Slug: hero', 'Slug: demo/hero') }).passed).toBe(true);
  });
});
