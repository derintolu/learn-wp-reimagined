import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { runChecks } from '../../src/shared/checks';
import { newRecord } from '../../src/shared/record';
import { workspaceFiles } from '../../src/studio/workspace';
import { SOLUTIONS } from './solutions';
import { hasNestedQuantifier } from '../../vendor/course-xapi-mcp/core/checks.ts';

/** The same checks for every live path in the real bundle. Paths join automatically when they go live. */
const c = buildContent();
const live = Object.values(c.paths).filter((p) => p.status === 'live');
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

describe('there is at least one live path', () => {
  it('has live paths, block theme among them', () => {
    expect(live.length).toBeGreaterThan(0);
    expect(live.map((p) => p.id)).toContain('block-theme');
  });
});

describe('regex checks the course-xapi-mcp server runs', () => {
  it('no regex check has the nested-quantifier shape the standard refuses to run (it would always fail there)', () => {
    const refused: string[] = [];
    for (const l of Object.values(c.lessons)) {
      for (const k of [...(l.bug?.fixChecks ?? []), ...(l.checkpoint?.checks ?? [])]) {
        if (k.type === 'regex' && hasNestedQuantifier(k.pattern)) refused.push(`${l.id}: ${k.pattern}`);
      }
    }
    expect(refused).toEqual([]);
  });
});

/**
 * Checks that guard earlier work (CXM-PKG-022/024): each one fails on the starter or bug code, passes on the intended
 * answer, and still fails when the answer breaks the thing it guards.
 */
const lastOf = (s: string, find: string) => { const i = s.lastIndexOf(find); return s.slice(0, i) + s.slice(i + find.length); };
const version2 = (s: string) => s.replace('"version": 3', '"version": 2');
const GUARDS: [lesson: string, where: 'checkpoint' | 'bug', index: number, breakIt: (s: string) => string][] = [
  ['bt-what-is-a-block-theme', 'bug', 2, (s) => s.replace('"slug": "contrast", "color"', '"slug": "contrast" "color"')],
  ['bt-what-is-a-block-theme', 'bug', 2, version2],
  ['bt-style-css-and-theme-json', 'checkpoint', 1, version2],
  ['bt-global-styles', 'checkpoint', 1, version2],
  ['bt-style-css-and-theme-json', 'checkpoint', 0, (s) => s.replace('"#f0f0f0" },', '"#f0f0f0" }')],
  ['bt-templates-and-parts', 'checkpoint', 2, (s) => s.replace('<!-- wp:query {', '<!-- wp:group {')],
  ['bt-global-styles', 'checkpoint', 0, (s) => s.replace(/\},(\s*"styles")/, '}$1')],
  ['bt-global-styles', 'checkpoint', 1, (s) => s.replace(/"slug":\s*"accent"/, '"slug": "accent-1"')],
  ['bt-patterns', 'bug', 1, (s) => s.replace('Slug: my-block-theme/hero', 'Slug: hero')],
  ['ln-blocks', 'bug', 1, (s) => s.replace('<!-- /wp:paragraph -->', '<!-- /wp:paragraph -->\n<!-- /wp:paragraph -->')],
  ['ln-blocks', 'bug', 2, (s) => s.replace('<!-- wp:paragraph -->', '')],
  ['ln-blocks', 'bug', 3, (s) => s.replace("<!-- wp:paragraph -->\n<p>I'm learning", "<p>I'm learning")],
  ['ln-blocks', 'checkpoint', 4, (s) => lastOf(s, '<!-- /wp:paragraph -->')],
  ['vc-actions-and-filters', 'bug', 2, (s) => s.replace(/add_filter\(\s*'the_content'[^;]*;/, '')],
  ['vc-actions-and-filters', 'bug', 3, (s) => s.replace('class="my-first-plugin-note"', '')],
  ['vc-enqueueing', 'checkpoint', 2, (s) => s.replace(/add_filter\(\s*'the_content'[^;]*;/, '')],
  ['vc-escaping-and-sanitizing', 'bug', 2, (s) => s.replace(/\$_GET\['reader'\]/g, "''")],
  ['vc-escaping-and-sanitizing', 'bug', 3, (s) => s.replace('return $content . $note;', 'return $content;')],
  ['vc-escaping-and-sanitizing', 'checkpoint', 2, (s) => s.replace('esc_html( $reader )', '$reader')],
  ['vc-theme-json-from-code', 'checkpoint', 4, (s) => s.replace(/add_filter\(\s*'the_content'[^;]*;/, '')],
];

describe.each(GUARDS)('guard check %s %s %i', (id, where, index, breakIt) => {
  const l = c.lessons[id]!;
  const check = where === 'bug' ? l.bug!.fixChecks[index]! : l.checkpoint!.checks![index]!;
  const start = where === 'bug' ? { [l.bug!.file]: l.bug!.code } : l.starterFiles!;
  const answer = where === 'bug' ? SOLUTIONS[l.bug!.id]! : { ...workspaceFiles(c, newRecord(), id).files, ...SOLUTIONS[l.checkpoint!.id] };
  const one = (files: Record<string, string>) => runChecks([check], files).passed;

  it('fails on the starting code and passes on the answer', () => {
    expect(one(start)).toBe(false);
    expect(one(answer)).toBe(true);
  });

  it('fails when the answer breaks what it guards', () => {
    const broken = breakIt(answer[check.file]!);
    expect(broken).not.toBe(answer[check.file]);
    expect(one({ ...answer, [check.file]: broken })).toBe(false);
  });
});

describe.each(live.map((p) => [p.id, p] as const))('%s content', (_id, path) => {
  const lessons = path.lessons.map((id) => c.lessons[id]);
  const withCode = lessons.filter((l) => l.checkpoint?.kind === 'code');
  const withBug = lessons.filter((l) => l.bug);

  it('placementHints name every lesson in the path', () => {
    for (const id of path.lessons) {
      const whole = new RegExp('(?<![\\w-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
      expect(whole.test(path.placementHints), id).toBe(true);
    }
  });

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
