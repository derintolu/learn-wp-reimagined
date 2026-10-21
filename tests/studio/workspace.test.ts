import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { newRecord } from '../../src/shared/record';
import type { ContentBundle } from '../../src/shared/types';
import { ownedFiles, workspaceFiles } from '../../src/studio/workspace';

const PREVIEW = { 'style.css': '/* base */', 'theme.json': '{"scaffold":true}', 'templates/index.html': '<p>scaffold</p>' };
const STARTER = '{"version":3,"starter":true}';
const GOOD = '{"version":3,"mine":true}';

/** The fixture path, reshaped so lesson 1 owns theme.json (starter + code checkpoint), lesson 2 does not, lesson 3 owns notes.txt. */
function bundle(): ContentBundle {
  const c = structuredClone(buildContent('tests/fixtures/content'));
  const path = c.paths['block-theme'];
  path.previewFiles = { ...PREVIEW };
  const [a, b, d] = path.lessons.map((id) => c.lessons[id]);
  a.starterFiles = { 'theme.json': STARTER };
  a.checkpoint!.file = 'theme.json';
  a.checkpoint!.checks = [{ type: 'json', file: 'theme.json', pointer: '/version', equals: 3, message: 'Set version to 3.' }];
  delete b.starterFiles;
  delete b.checkpoint!.checks;
  b.checkpoint!.file = undefined;
  delete b.bug;
  d.starterFiles = { 'notes.txt': 'notes starter' };
  delete d.bug;
  return c;
}

describe('workspaceFiles', () => {
  it('first lesson = previewFiles overlaid by its starterFiles', () => {
    const c = bundle();
    const l1 = c.lessons[c.paths['block-theme'].lessons[0]];
    const w = workspaceFiles(c, newRecord(), l1.id);
    expect(w.files).toEqual({ ...c.paths['block-theme'].previewFiles, ...l1.starterFiles });
    expect(w.editable).toEqual(ownedFiles(l1));
  });

  it("an earlier lesson's passing edit carries forward", () => {
    const c = bundle();
    const [l1, l2] = c.paths['block-theme'].lessons;
    const r = { ...newRecord(), files: { 'theme.json': GOOD }, fileLessons: { 'theme.json': l1 } };
    const w = workspaceFiles(c, r, l2);
    expect(w.files['theme.json']).toBe(GOOD);
    expect(w.editable).toEqual(ownedFiles(c.lessons[l2]));
  });

  it("an earlier edit that fails its owner's checks is replaced by the starter", () => {
    const c = bundle();
    const [l1, l2] = c.paths['block-theme'].lessons;
    const failing = { ...newRecord(), files: { 'theme.json': '{"version":2}' }, fileLessons: { 'theme.json': l1 } };
    expect(workspaceFiles(c, failing, l2).files['theme.json']).toBe(STARTER);
    const broken = { ...newRecord(), files: { 'theme.json': '{"version":3,' }, fileLessons: { 'theme.json': l1 } };
    expect(workspaceFiles(c, broken, l2).files['theme.json']).toBe(STARTER);
  });

  it('an earlier edit with no recorded lesson counts as made in the owner lesson', () => {
    const c = bundle();
    const r = { ...newRecord(), files: { 'theme.json': GOOD } };
    expect(workspaceFiles(c, r, c.paths['block-theme'].lessons[1]).files['theme.json']).toBe(GOOD);
  });

  it("this lesson's own saved edit wins over its starter", () => {
    const c = bundle();
    const l1 = c.paths['block-theme'].lessons[0];
    const r = { ...newRecord(), files: { 'theme.json': GOOD }, fileLessons: { 'theme.json': l1 } };
    expect(workspaceFiles(c, r, l1).files['theme.json']).toBe(GOOD);
  });

  it("another lesson's later edit is not used as this lesson's starting point", () => {
    const c = bundle();
    const [l1, l2, l3] = c.paths['block-theme'].lessons;
    const r = { ...newRecord(), files: { 'notes.txt': 'from lesson 3' }, fileLessons: { 'notes.txt': l3 } };
    expect(workspaceFiles(c, r, l2).files['notes.txt']).toBeUndefined();
    expect(workspaceFiles(c, r, l3).files['notes.txt']).toBe('from lesson 3');
    expect(l1).toBeDefined();
  });

  it('files outside previewFiles and owned files are not included', () => {
    const c = bundle();
    const [, l2] = c.paths['block-theme'].lessons;
    const r = { ...newRecord(), files: { 'stray.txt': 'x', 'style.css': '/* edited */' }, fileLessons: { 'stray.txt': l2, 'style.css': l2 } };
    const w = workspaceFiles(c, r, l2);
    expect(Object.keys(w.files).sort()).toEqual(['style.css', 'templates/index.html', 'theme.json']);
    expect(w.files['style.css']).toBe('/* base */');
  });
});
