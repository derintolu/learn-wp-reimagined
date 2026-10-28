import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { runChecks } from '../../src/shared/checks';
import type { Check } from '../../src/shared/types';
import { SOLUTIONS } from './solutions';

/** The real Learner path: starters fail their checks, intended answers pass, plausible mistakes fail. */
const c = buildContent();
const L = c.lessons;
const passes = (checks: Check[], files: Record<string, string>) => runChecks(checks, files).passed;
const about = (text: string) => ({ 'pages/about.html': text });

const l1 = L['ln-what-is-wordpress'];
const l2 = L['ln-posts-and-pages'];
const l3 = L['ln-blocks'];
const l4 = L['ln-navigation-and-site-editor'];
const l5 = L['ln-ai-in-wordpress'];
const l6 = L['ln-publish'];

describe('learner path content', () => {
  it('is live on the site preview, lessons 1 and 2 free-text, lesson 3 a bug and a code checkpoint', () => {
    const p = c.paths.learner;
    expect(p.status).toBe('live');
    expect(p.preview).toEqual({ kind: 'site' });
    expect(p.lessons.slice(0, 3)).toEqual(['ln-what-is-wordpress', 'ln-posts-and-pages', 'ln-blocks']);
    expect(l1.checkpoint?.kind).toBe('free-text');
    expect(l2.checkpoint?.kind).toBe('free-text');
    expect(l3.checkpoint?.kind).toBe('code');
    expect(l3.bug?.file).toBe('pages/about.html');
    expect(l1.landing).toBe('/wp-admin/');
    expect(l2.landing).toBe('/wp-admin/edit.php?post_type=page');
  });

  it('has six lessons: 4 and 5 free-text, 6 with no checkpoint, and each one leads to the next', () => {
    expect(c.paths.learner.lessons).toEqual([
      'ln-what-is-wordpress',
      'ln-posts-and-pages',
      'ln-blocks',
      'ln-navigation-and-site-editor',
      'ln-ai-in-wordpress',
      'ln-publish',
    ]);
    expect(l4.checkpoint?.kind).toBe('free-text');
    expect(l5.checkpoint?.kind).toBe('free-text');
    expect(l6.checkpoint).toBeUndefined();
    expect(l6.bug).toBeUndefined();
    expect(l4.landing).toBe('/wp-admin/site-editor.php');
    expect(l5.landing).toBe('/wp-admin/options-connectors.php');
    const to = (l: typeof l3, o: string) => l.checkpoint!.branches.find((b) => b.outcome === o)!.to;
    expect([to(l3, 'advance'), to(l3, 'skip')]).toEqual(['ln-navigation-and-site-editor', 'ln-navigation-and-site-editor']);
    expect([to(l4, 'advance'), to(l4, 'skip')]).toEqual(['ln-ai-in-wordpress', 'ln-ai-in-wordpress']);
    expect([to(l5, 'advance'), to(l5, 'skip')]).toEqual(['ln-publish', 'ln-publish']);
    for (const l of [l3, l4, l5]) expect(to(l, 'review')).toBe(l.id);
  });

  it('lesson 5 states what the AI plugin does accurately, and lesson 4 cites the Site Editor navigation docs', () => {
    const beat = (id: string) => l5.beats.find((b) => b.id === id)!.content;
    expect(beat('the-ai-plugin')).toContain('Nothing runs until you switch a feature on, and most only run when you click.');
    expect(beat('the-ai-plugin')).not.toContain('Nothing runs until you ask');
    expect(beat('connectors')).toContain("There's no key, and the AI plugin isn't installed here, so nothing can be generated in this practice site.");
    expect(beat('connectors')).not.toContain('the course this lesson is adapted from');
    expect(l4.sources.map((s) => s.url)).toContain('https://wordpress.org/documentation/article/site-editor-navigation/');
  });

  it('every page file is a pages/<slug>.html file', () => {
    const files = [
      ...Object.keys(c.paths.learner.previewFiles ?? {}),
      ...Object.keys(c.paths.learner.finalFiles ?? {}),
      ...[l1, l2, l3, l4, l5, l6].flatMap((l) => [...Object.keys(l.starterFiles ?? {}), l.checkpoint?.file, l.bug?.file].filter(Boolean)),
    ];
    for (const f of files) expect(f).toMatch(/^pages\/[a-z0-9-]+\.html$/);
  });

  describe('L3 bug: a paragraph missing its closing comment', () => {
    const b = l3.bug!;
    const fixed = SOLUTIONS['bug-paragraph-closer']['pages/about.html'];

    it('fails the planted bug and passes the fix and the starter', () => {
      expect(passes(b.fixChecks, about(b.code))).toBe(false);
      expect(passes(b.fixChecks, about(fixed))).toBe(true);
      expect(passes(b.fixChecks, about(l3.starterFiles!['pages/about.html']))).toBe(true);
    });

    it('fails the closer in the wrong place, an extra closer, and deleting the opener', () => {
      expect(passes(b.fixChecks, about(`${b.code}<!-- /wp:paragraph -->\n`))).toBe(false);
      expect(passes(b.fixChecks, about(`${fixed}<!-- /wp:paragraph -->\n`))).toBe(false);
      expect(passes(b.fixChecks, about(b.code.replace('<!-- wp:paragraph -->\n<p>Hi there', '<p>Hi there')))).toBe(false);
    });

    it('fails when the first paragraph is deleted instead of fixed', () => {
      expect(passes(b.fixChecks, about(b.code.replace(/^[\s\S]*?(?=<!-- wp:paragraph -->\n<p>I'm)/, '')))).toBe(false);
    });
  });

  describe('L3 checkpoint: add a heading and a paragraph', () => {
    const k = l3.checkpoint!.checks!;
    const start = l3.starterFiles!['pages/about.html'];
    const done = SOLUTIONS['cp-about-heading-code']['pages/about.html'];

    it('fails the starter and passes the intended answer', () => {
      expect(passes(k, about(start))).toBe(false);
      expect(passes(k, about(done))).toBe(true);
    });

    it('accepts a heading without the class, or at another level', () => {
      expect(passes(k, about(done.replace('<h2 class="wp-block-heading">', '<h2>')))).toBe(true);
      expect(passes(k, about(done.replace('<!-- wp:heading -->\n<h2 class="wp-block-heading">What I\'m working on</h2>', '<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">What I\'m working on</h3>')))).toBe(true);
    });

    it('ties the heading tag to the level setting: a bare comment means h2', () => {
      const h3 = (open: string) =>
        done.replace('<!-- wp:heading -->\n<h2 class="wp-block-heading">What I\'m working on</h2>', `${open}\n<h3 class="wp-block-heading">What I'm working on</h3>`);
      expect(passes(k, about(h3('<!-- wp:heading -->')))).toBe(false);
      expect(passes(k, about(h3('<!-- wp:heading {"level":3} -->')))).toBe(true);
      expect(passes(k, about(h3('<!-- wp:heading {"level":4} -->')))).toBe(false);
      expect(passes(k, about(done.replace('<!-- wp:heading -->', '<!-- wp:heading {"level":2} -->')))).toBe(true);
    });

    it('accepts inline formatting inside the heading and the paragraph', () => {
      const rich = done
        .replace('<p>Right now, I\'m learning how blocks work.</p>', '<p>Right <strong>now</strong>, I\'m learning how <em>blocks</em> work.</p>')
        .replace("What I'm working on</h2>", "What I'm <em>working on</em></h2>");
      expect(passes(k, about(rich))).toBe(true);
      expect(passes(k, about(done.replace('<p>Right now, I\'m learning how blocks work.</p>', '<p><strong></strong></p>')))).toBe(false);
    });

    it('fails a missing heading closer, a heading with no text, and a heading with no paragraph after it', () => {
      expect(passes(k, about(done.replace('<!-- /wp:heading -->', '')))).toBe(false);
      expect(passes(k, about(done.replace("What I'm working on", '')))).toBe(false);
      expect(passes(k, about(done.replace(/<!-- wp:paragraph -->\n<p>Right now[\s\S]*$/, '')))).toBe(false);
    });

    it('fails a plain HTML heading with no block comments', () => {
      const plain = done.replace('<!-- wp:heading -->\n', '').replace('<!-- /wp:heading -->\n', '');
      expect(passes(k, about(plain))).toBe(false);
    });

    it('fails when the new paragraph is missing its closing comment', () => {
      expect(passes(k, about(done.replace(/(<p>Right now[^\n]*\n)<!-- \/wp:paragraph -->\n/, '$1')))).toBe(false);
    });

    it('fails when the original paragraphs are removed', () => {
      const onlyNew = done.slice(done.indexOf('<!-- wp:heading'));
      expect(passes(k, about(onlyNew))).toBe(false);
    });
  });
});
