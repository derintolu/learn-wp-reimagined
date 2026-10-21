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

  it('throws on duplicate lesson ids', () => {
    const dir = copyFixture();
    edit(join(dir, 'paths/block-theme/03-patterns.yaml'), 'id: patterns\n', 'id: theme-json-basics\n');
    expect(() => buildContent(dir)).toThrow(/duplicate/i);
  });

  describe('finalFiles', () => {
    const REAL = join(__dirname, '../../content');
    const copyReal = () => {
      const dir = mkdtempSync(join(tmpdir(), 'content-'));
      cpSync(REAL, dir, { recursive: true });
      return dir;
    };

    it('the real block theme path has finalFiles that pass every lesson check', () => {
      expect(Object.keys(buildContent(REAL).paths['block-theme'].finalFiles ?? {})).toContain('theme.json');
    });

    it('throws naming the lesson and check when finalFiles fail a checkpoint check', () => {
      const dir = copyReal();
      edit(join(dir, 'paths/block-theme/path.yaml'), '"contentSize": "40rem"', '"contentSize": "41rem"');
      expect(() => buildContent(dir)).toThrow(/path\.yaml.*finalFiles.*theme\.json.*bt-style-css-and-theme-json/);
    });

    it('throws when finalFiles fail a planted bug fixCheck', () => {
      const dir = copyReal();
      edit(join(dir, 'paths/block-theme/path.yaml'), 'Slug: my-block-theme/hero', 'Slug: other/hero');
      expect(() => buildContent(dir)).toThrow(/finalFiles.*patterns\/hero\.php.*bt-patterns/);
    });

    it('rejects finalFiles on a path that is not live', () => {
      const dir = copyFixture();
      writeFileSync(join(dir, 'paths/learner/path.yaml'), readFileSync(join(dir, 'paths/learner/path.yaml'), 'utf8') + 'finalFiles:\n  a.css: x\n');
      expect(() => buildContent(dir)).toThrow(/finalFiles/);
    });
  });

  describe('previewFiles', () => {
    const pathFile = (dir: string) => join(dir, 'paths/block-theme/path.yaml');

    it('the real block theme path ships the preview scaffold', () => {
      const pf = buildContent(join(__dirname, '../../content')).paths['block-theme'].previewFiles ?? {};
      expect(Object.keys(pf).sort()).toEqual(['style.css', 'templates/index.html', 'theme.json']);
    });

    it('throws when a live path has no previewFiles', () => {
      const dir = copyFixture();
      edit(pathFile(dir), /previewFiles:[\s\S]*$/, '');
      expect(() => buildContent(dir)).toThrow(/path\.yaml.*previewFiles/);
    });

    it('throws when previewFiles lack style.css', () => {
      const dir = copyFixture();
      edit(pathFile(dir), '  style.css:', '  other.css:');
      expect(() => buildContent(dir)).toThrow(/previewFiles must include style\.css/);
    });

    it('throws when previewFiles lack templates/index.html', () => {
      const dir = copyFixture();
      edit(pathFile(dir), '  templates/index.html:', '  templates/other.html:');
      expect(() => buildContent(dir)).toThrow(/previewFiles must include templates\/index\.html/);
    });

    it('throws when a previewFiles .json does not parse', () => {
      const dir = copyFixture();
      writeFileSync(pathFile(dir), readFileSync(pathFile(dir), 'utf8') + '  theme.json: "{nope"\n');
      expect(() => buildContent(dir)).toThrow(/previewFiles theme\.json is not valid JSON/);
    });

    it('rejects previewFiles on a path that is not live', () => {
      const dir = copyFixture();
      writeFileSync(join(dir, 'paths/learner/path.yaml'), readFileSync(join(dir, 'paths/learner/path.yaml'), 'utf8') + 'previewFiles:\n  a.css: x\n');
      expect(() => buildContent(dir)).toThrow(/previewFiles/);
    });
  });
});
