import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { runChecks } from '../../src/shared/checks';
import type { Check } from '../../src/shared/types';
import { SOLUTIONS } from './solutions';

/** The real block-theme path: every starter fails its checks, intended answers pass, plausible mistakes fail. */
const c = buildContent('content');
const L = c.lessons;
const passes = (checks: Check[], files: Record<string, string>) => runChecks(checks, files).passed;

const l1 = L['bt-what-is-a-block-theme'];
const l2 = L['bt-style-css-and-theme-json'];
const l3 = L['bt-templates-and-parts'];
const l4 = L['bt-global-styles'];
const l5 = L['bt-patterns'];
const afterL2 = SOLUTIONS['cp-settings-code']['theme.json'];

describe('block theme path content', () => {
  it('is live with at least 3 checkpoints, one of them code, and lesson 1 has a checkpoint and a bug', () => {
    const p = c.paths['block-theme'];
    expect(p.status).toBe('live');
    const cps = p.lessons.map((id) => L[id].checkpoint).filter(Boolean);
    expect(cps.length).toBeGreaterThanOrEqual(3);
    expect(cps.some((cp) => cp!.kind === 'code')).toBe(true);
    expect(l1.checkpoint && l1.bug).toBeTruthy();
  });

  it('L1 bug: only renaming value to color passes', () => {
    const b = l1.bug!;
    expect(passes(b.fixChecks, { 'theme.json': b.code })).toBe(false);
    expect(passes(b.fixChecks, { 'theme.json': b.code.replace('"value"', '"color"') })).toBe(true);
    expect(passes(b.fixChecks, { 'theme.json': l1.starterFiles!['theme.json'] })).toBe(true);
    expect(passes(b.fixChecks, { 'theme.json': b.code.replace(/\s*\{ "name": "Contrast"[^\n]*/, '') })).toBe(false);
  });

  it('L2 settings checkpoint', () => {
    const k = l2.checkpoint!.checks!;
    expect(passes(k, { 'theme.json': l2.starterFiles!['theme.json'] })).toBe(false);
    expect(passes(k, { 'theme.json': afterL2 })).toBe(true);
    const reordered = afterL2.replace('{ "name": "Accent", "slug": "accent", "color": "#3858e9" }', '{ "color": "#abc", "slug": "accent", "name": "Accent" }');
    expect(passes(k, { 'theme.json': reordered })).toBe(true);
    expect(passes(k, { 'theme.json': afterL2.replace('"slug": "accent", "color"', '"slug": "accent", "value"') })).toBe(false);
    const t = JSON.parse(afterL2);
    const topLevelLayout = JSON.stringify({ ...t, settings: { color: t.settings.color }, layout: t.settings.layout });
    expect(passes(k, { 'theme.json': topLevelLayout })).toBe(false);
  });

  describe('L3 header part checkpoint', () => {
    const k = l3.checkpoint!.checks!;
    const idx = l3.starterFiles!['templates/index.html'];
    const part = '<!-- wp:template-part {"slug":"header","tagName":"header"} /-->';
    const files = (index: string) => ({ ...l3.starterFiles!, 'templates/index.html': index });

    it('passes with the part at the top, in either attribute order', () => {
      expect(passes(k, files(`${part}\n\n${idx}`))).toBe(true);
      expect(passes(k, files(`<!-- wp:template-part {"tagName":"header","slug":"header"} /-->\n${idx}`))).toBe(true);
    });

    it('fails the starter, a missing tagName, and the part anywhere but the top', () => {
      expect(passes(k, files(idx))).toBe(false);
      expect(passes(k, files(`<!-- wp:template-part {"slug":"header"} /-->\n${idx}`))).toBe(false);
      expect(passes(k, files(`${idx}\n${part}`))).toBe(false);
      // inside the Query Loop (between the opening and closing query comments)
      expect(passes(k, files(idx.replace('<!-- wp:post-template -->', `${part}\n<!-- wp:post-template -->`)))).toBe(false);
      // inside <main>, before the loop
      expect(passes(k, files(idx.replace('<main class="wp-block-group">', `<main class="wp-block-group">\n${part}`)))).toBe(false);
    });

    it('fails when the Query Loop is removed', () => {
      expect(passes(k, files(`${part}\n<!-- wp:group {"tagName":"main"} -->\n<main class="wp-block-group"></main>\n<!-- /wp:group -->`))).toBe(false);
    });
  });

  describe('L4 global styles checkpoint', () => {
    const k = l4.checkpoint!.checks!;
    const withStyles = (json: string) => {
      const t = JSON.parse(json);
      t.styles = { color: { background: 'var:preset|color|base', text: 'var:preset|color|contrast' }, elements: { link: { color: { text: 'var:preset|color|accent' } } } };
      return JSON.stringify(t, null, 2);
    };
    it('passes the intended answer and fails the starter', () => {
      expect(passes(k, { 'theme.json': afterL2 })).toBe(false);
      expect(passes(k, { 'theme.json': withStyles(afterL2) })).toBe(true);
    });
    it('fails when the palette has no accent entry for links to use (lesson 2 skipped)', () => {
      const res = runChecks(k, { 'theme.json': withStyles(l1.starterFiles!['theme.json']) });
      expect(res.passed).toBe(false);
      expect(res.results.filter((r) => !r.passed).map((r) => r.check.message)).toEqual([
        'Your palette needs an accent entry (name, slug accent and a hex color), and your links need to use it.',
      ]);
    });
  });

  it('L5 bug: Name: fails, Title: passes', () => {
    const b = l5.bug!;
    expect(passes(b.fixChecks, { 'patterns/hero.php': b.code })).toBe(false);
    expect(passes(b.fixChecks, { 'patterns/hero.php': l5.starterFiles!['patterns/hero.php'] })).toBe(true);
    expect(passes(b.fixChecks, { 'patterns/hero.php': b.code.replace('Name: Hero', 'title: Hero') })).toBe(true);
  });

  it('the finished theme.json uses only keys the WordPress 7.1 schema allows (as taught)', () => {
    const t = JSON.parse(withStylesFinal());
    expect(Object.keys(t).sort()).toEqual(['$schema', 'settings', 'styles', 'version']);
    expect(t.version).toBe(3);
    for (const e of t.settings.color.palette) expect(Object.keys(e).sort()).toEqual(['color', 'name', 'slug']);
    expect(Object.keys(t.settings.layout).sort()).toEqual(['contentSize', 'wideSize']);
  });
});

function withStylesFinal() {
  const t = JSON.parse(afterL2);
  t.styles = { color: { background: 'var:preset|color|base', text: 'var:preset|color|contrast' }, elements: { link: { color: { text: 'var:preset|color|accent' } } } };
  return JSON.stringify(t);
}
