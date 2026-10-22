import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { runChecks } from '../../src/shared/checks';
import { newRecord } from '../../src/shared/record';
import { workspaceFiles } from '../../src/studio/workspace';
import { SOLUTIONS } from './solutions';

/** The same checks for every live path in the real bundle. Paths join automatically when they go live. */
const c = buildContent('content');
const live = Object.values(c.paths).filter((p) => p.status === 'live');
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

describe('there is at least one live path', () => {
  it('has live paths, block theme among them', () => {
    expect(live.length).toBeGreaterThan(0);
    expect(live.map((p) => p.id)).toContain('block-theme');
  });
});

describe.each(live.map((p) => [p.id, p] as const))('%s content', (_id, path) => {
  const lessons = path.lessons.map((id) => c.lessons[id]);
  const withCode = lessons.filter((l) => l.checkpoint?.kind === 'code');
  const withBug = lessons.filter((l) => l.bug);

  it('every live path has a planted bug', () => {
    expect(withBug.length).toBeGreaterThan(0);
  });

  it('every live path has a code checkpoint', () => {
    expect(withCode.length).toBeGreaterThan(0);
  });

  it('lesson 1 has a checkpoint', () => {
    expect(lessons[0].checkpoint).toBeTruthy();
  });

  it('every code checkpoint fails on its starting workspace', () => {
    for (const l of withCode) {
      const { files } = workspaceFiles(c, newRecord(), l.id);
      expect(runChecks(l.checkpoint!.checks ?? [], files).passed, l.id).toBe(false);
    }
  });

  it('every code checkpoint passes on its solution', () => {
    for (const l of withCode) {
      const cp = l.checkpoint!;
      const { files } = workspaceFiles(c, newRecord(), l.id);
      expect(runChecks(cp.checks ?? [], { ...files, ...SOLUTIONS[cp.id] }).passed, l.id).toBe(true);
    }
  });

  it('every planted bug fails its fixChecks and its solution passes them', () => {
    for (const l of withBug) {
      const b = l.bug!;
      expect(runChecks(b.fixChecks, { [b.file]: b.code }).passed, l.id).toBe(false);
      expect(runChecks(b.fixChecks, { [b.file]: SOLUTIONS[b.id]?.[b.file] ?? '' }).passed, l.id).toBe(true);
    }
  });

  it('every code checkpoint and bug has a SOLUTIONS entry for its file', () => {
    for (const l of withCode) expect(has(SOLUTIONS, l.checkpoint!.id) && has(SOLUTIONS[l.checkpoint!.id], l.checkpoint!.file!), l.checkpoint!.id).toBe(true);
    for (const l of withBug) expect(has(SOLUTIONS, l.bug!.id) && has(SOLUTIONS[l.bug!.id], l.bug!.file), l.bug!.id).toBe(true);
  });

  it("finalFiles pass every lesson's checks", () => {
    expect(path.finalFiles).toBeTruthy();
    for (const l of lessons) {
      const checks = [...(l.checkpoint?.checks ?? []), ...(l.bug?.fixChecks ?? [])];
      expect(runChecks(checks, path.finalFiles!).passed, l.id).toBe(true);
    }
  });

  it('every lesson credits a learn.wordpress.org or developer.wordpress.org source', () => {
    for (const l of lessons) {
      expect(l.sources.some((s) => /^https:\/\/(learn|developer)\.wordpress\.org\//.test(s.url)), l.id).toBe(true);
    }
  });
});
