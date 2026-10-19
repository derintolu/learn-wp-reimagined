import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';

const FIXTURE = join(__dirname, '../fixtures/content');

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'content-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function edit(file: string, from: string | RegExp, to: string) {
  const text = readFileSync(file, 'utf8');
  const next = text.replace(from, to);
  if (next === text) throw new Error('edit did not change ' + file);
  writeFileSync(file, next);
}

describe('buildContent', () => {
  it('builds the fixture with lessons keyed by id', () => {
    const b = buildContent(FIXTURE);
    expect(Object.keys(b.lessons).sort()).toEqual(['patterns', 'templates-and-parts', 'theme-json-basics']);
    expect(b.lessons['patterns'].pathId).toBe('block-theme');
    expect(b.paths['block-theme'].id).toBe('block-theme');
    expect(b.paths.learner.status).toBe('coming-soon');
    expect(b.paths.learner.lessons).toEqual([]);
    expect(b.lessons['patterns'].bug?.file).toBe('patterns/hero.php');
  });

  it('preserves lesson order from NN- filenames', () => {
    expect(buildContent(FIXTURE).paths['block-theme'].lessons).toEqual([
      'theme-json-basics',
      'templates-and-parts',
      'patterns',
    ]);
  });

  it('throws naming the file when a branch targets an unknown lesson', () => {
    const dir = copyFixture();
    edit(join(dir, 'paths/block-theme/01-theme-json.yaml'), 'outcome: advance, to: templates-and-parts', 'outcome: advance, to: nope');
    expect(() => buildContent(dir)).toThrow(/01-theme-json\.yaml/);
    expect(() => buildContent(dir)).toThrow(/nope/);
  });

  it('throws when a checkpoint lacks a required outcome branch', () => {
    const dir = copyFixture();
    edit(join(dir, 'paths/block-theme/01-theme-json.yaml'), /\n    - \{ outcome: skip[^\n]*/, '');
    expect(() => buildContent(dir)).toThrow(/01-theme-json\.yaml.*missing branch for outcome "skip"/);
  });

  it('throws when a live path has fewer than 2 checkpoints', () => {
    const dir = copyFixture();
    edit(join(dir, 'paths/block-theme/02-templates.yaml'), /checkpoint:[\s\S]*$/, '');
    expect(() => buildContent(dir)).toThrow(/block-theme[\\/]path\.yaml.*at least 2 checkpoints.*found 1/);
  });

  it('throws naming the file when a lesson file is malformed YAML', () => {
    const dir = copyFixture();
    writeFileSync(join(dir, 'paths/block-theme/01-theme-json.yaml'), 'title: [unclosed\n');
    expect(() => buildContent(dir)).toThrow(/01-theme-json\.yaml.*invalid YAML/);
  });

  it('planted bug code fails its fixChecks and the corrected code passes', () => {
    const bug = buildContent(FIXTURE).lessons['patterns'].bug!;
    const re = bug.fixChecks.find((c) => c.type === 'regex') as { pattern: string; flags?: string };
    const rx = new RegExp(re.pattern, re.flags);
    expect(rx.test(bug.code)).toBe(false);
    expect(rx.test(bug.code.replace('Slug: hero', 'Slug: demo/hero'))).toBe(true);
    const starter = buildContent(FIXTURE).lessons['patterns'].starterFiles![bug.file];
    expect(rx.test(starter)).toBe(false);
  });

  it('throws on duplicate lesson ids', () => {
    const dir = copyFixture();
    edit(join(dir, 'paths/block-theme/03-patterns.yaml'), 'id: patterns\n', 'id: theme-json-basics\n');
    expect(() => buildContent(dir)).toThrow(/duplicate/i);
  });
});
