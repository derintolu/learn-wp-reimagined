import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { SNAPSHOT_DIR, readSnapshot, writeSnapshot } from '../../scripts/content-pull';
import { buildContentFromYaml } from '../../scripts/yaml-content';
import { compareBundles } from '../../src/shared/package';

const FIXTURE = join(__dirname, '../fixtures/content');

function copy(from: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-'));
  cpSync(from, dir, { recursive: true });
  return dir;
}

function edit(file: string, from: string | RegExp, to: string) {
  const text = readFileSync(file, 'utf8');
  const next = text.replace(from, to);
  if (next === text) throw new Error('edit did not change ' + file);
  writeFileSync(file, next);
}

describe('buildContent', () => {
  it('builds the fixture snapshot with lessons keyed by id', () => {
    const b = buildContent(FIXTURE);
    expect(Object.keys(b.lessons).sort()).toEqual([
      'ln-posts-and-pages',
      'ln-what-is-wordpress',
      'patterns',
      'templates-and-parts',
      'theme-json-basics',
      'vc-actions-and-filters',
      'vc-enqueueing',
    ]);
    expect(b.lessons['patterns'].pathId).toBe('block-theme');
    expect(b.paths['block-theme'].lessons).toEqual(['theme-json-basics', 'templates-and-parts', 'patterns']);
    expect(b.paths.learner.lessons).toEqual(['ln-what-is-wordpress', 'ln-posts-and-pages']);
    expect(b.lessons['patterns'].bug?.file).toBe('patterns/hero.php');
  });

  it('defaults to content/snapshot', () => {
    expect(SNAPSHOT_DIR).toBe('content/snapshot');
    expect(Object.keys(buildContent().lessons)).toHaveLength(18);
  });

  it('the snapshot equals the YAML build until the YAML is deleted', () => {
    expect(compareBundles(buildContentFromYaml('content'), buildContent())).toEqual([]);
  });

  it('refuses a package the standard\'s validator rejects, naming the code', () => {
    const dir = copy(FIXTURE);
    edit(join(dir, 'cxm/lessons/patterns.json'), /"bugFix": "[^\n]*",?\n/, '');
    expect(() => buildContent(dir)).toThrow(/CXM-PKG-\d+/);
  });

  it('refuses a bundle the house rules reject', () => {
    const dir = copy(FIXTURE);
    edit(join(dir, 'cxm/course.json'), /\s*"preview": \{\s*"kind": "site"\s*\},?/, '');
    expect(() => buildContent(dir)).toThrow(/house rules:\npath "learner" needs a preview/);
  });
});

describe('writeSnapshot', () => {
  it('is byte-stable across runs and has sorted keys, LF and no timestamps', () => {
    const files = readSnapshot(FIXTURE);
    const a = mkdtempSync(join(tmpdir(), 'snap-a-'));
    const b = mkdtempSync(join(tmpdir(), 'snap-b-'));
    writeSnapshot(files, a, { version: 3, etag: '"abc"' });
    writeSnapshot(files, b, { version: 3, etag: '"abc"' });
    writeSnapshot(readSnapshot(a), b, { version: 3, etag: '"abc"' });
    expect(readSnapshot(a)).toEqual(readSnapshot(b));
    expect(readFileSync(join(a, 'VERSION.json'), 'utf8')).toBe('{\n  "etag": "\\"abc\\"",\n  "version": 3\n}\n');
    const course = readFileSync(join(a, 'cxm/course.json'), 'utf8');
    expect(course).not.toContain('\r');
    expect(course.endsWith('}\n')).toBe(true);
    const keys = Object.keys(JSON.parse(course));
    expect(keys).toEqual([...keys].sort());
  });

  it('the committed fixture and snapshot are already in canonical form', () => {
    for (const dir of [FIXTURE, SNAPSHOT_DIR]) {
      const out = mkdtempSync(join(tmpdir(), 'snap-'));
      writeSnapshot(readSnapshot(dir), out, JSON.parse(readFileSync(join(dir, 'VERSION.json'), 'utf8')));
      expect(readSnapshot(out)).toEqual(readSnapshot(dir));
    }
  });
});
