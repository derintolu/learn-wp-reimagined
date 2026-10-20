import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildContent } from '../../scripts/build-content';
import { newRecord, type LearningRecord } from '../../src/shared/record';
import { buildThemeFiles, themeZip, THEME_SLUG } from '../../src/finale/themeZip';
import { PLAYGROUND_URL_LIMIT, playgroundBlueprint, playgroundUrl } from '../../src/finale/playground';

const c = buildContent('content');
const L = c.lessons;
const rec = (files: Record<string, string>, completed: string[] = []): LearningRecord => ({
  ...newRecord(),
  files,
  completedLessons: completed,
});

const decode = (url: string) => JSON.parse(decodeURIComponent(url.slice(url.indexOf('#') + 1)));

describe('buildThemeFiles (R24 merge order)', () => {
  it('builds the whole theme from the starters, later lessons winning', () => {
    const files = buildThemeFiles(c, rec({}));
    expect(Object.keys(files).sort()).toEqual(
      ['parts/header.html', 'patterns/hero.php', 'style.css', 'templates/index.html', 'theme.json'],
    );
    // L4's theme.json (with layout) beats L1/L2's
    expect(files['theme.json']).toBe(L['bt-global-styles'].starterFiles!['theme.json']);
    expect(files['style.css']).toBe(L['bt-what-is-a-block-theme'].starterFiles!['style.css']);
  });

  it("the learner's edit overrides every starter", () => {
    const mine = '{ "version": 3, "settings": { "layout": { "contentSize": "42rem" } } }';
    const files = buildThemeFiles(c, rec({ 'theme.json': mine }));
    expect(files['theme.json']).toBe(mine);
  });

  it('a learner who skipped lesson 2 still gets a full theme with their other edits', () => {
    const css = L['bt-what-is-a-block-theme'].starterFiles!['style.css'].replace('Author: You', 'Author: Ada');
    const hero = '<?php /** Title: Mine */ ?>\n<!-- wp:paragraph --><p>Mine</p><!-- /wp:paragraph -->';
    const files = buildThemeFiles(
      c,
      rec({ 'style.css': css, 'patterns/hero.php': hero }, ['bt-what-is-a-block-theme', 'bt-templates-and-parts', 'bt-global-styles', 'bt-patterns']),
    );
    expect(files['style.css']).toContain('Author: Ada');
    expect(files['patterns/hero.php']).toBe(hero);
    expect(files['theme.json']).toBe(L['bt-global-styles'].starterFiles!['theme.json']);
    expect(files['templates/index.html']).toBe(L['bt-templates-and-parts'].starterFiles!['templates/index.html']);
  });

  it('drops record paths that would escape the theme folder', () => {
    const files = buildThemeFiles(c, rec({ '../evil.php': 'x', '/etc/passwd': 'x', 'a/../../b': 'x', 'parts/footer.html': 'ok' }));
    expect(files['parts/footer.html']).toBe('ok');
    expect(Object.keys(files).some((k) => k.includes('..') || k.startsWith('/'))).toBe(false);
  });
});

describe('themeZip', () => {
  it('puts every file under my-block-theme/', () => {
    const files = buildThemeFiles(c, rec({}));
    const out = unzipSync(themeZip(files));
    expect(Object.keys(out)).toContain(`${THEME_SLUG}/style.css`);
    expect(Object.keys(out)).toContain(`${THEME_SLUG}/theme.json`);
    expect(Object.keys(out).every((k) => k.startsWith('my-block-theme/'))).toBe(true);
    expect(strFromU8(out['my-block-theme/patterns/hero.php'])).toBe(files['patterns/hero.php']);
  });
});

describe('playground blueprint', () => {
  const files = buildThemeFiles(c, rec({}));

  it('writes every file into the theme folder, then activates it', () => {
    const bp = playgroundBlueprint(files);
    expect(bp.landingPage).toBe('/');
    expect(bp.preferredVersions).toEqual({ wp: 'latest', php: '8.3' });
    const writes = bp.steps.filter((s) => s.step === 'writeFile');
    expect(writes.map((s) => s.path).sort()).toEqual(
      Object.keys(files).map((f) => `/wordpress/wp-content/themes/my-block-theme/${f}`).sort(),
    );
    for (const w of writes) expect(w.data).toBe(files[w.path!.replace('/wordpress/wp-content/themes/my-block-theme/', '')]);
    const last = bp.steps[bp.steps.length - 1];
    expect(last).toEqual({ step: 'activateTheme', themeFolderName: 'my-block-theme' });
    // every directory exists before its files are written
    const mk = bp.steps.findIndex((s) => s.step === 'mkdir' && s.path === '/wordpress/wp-content/themes/my-block-theme/patterns');
    const wr = bp.steps.findIndex((s) => s.step === 'writeFile' && s.path?.endsWith('patterns/hero.php'));
    expect(mk).toBeGreaterThanOrEqual(0);
    expect(mk).toBeLessThan(wr);
  });

  it('encodes the blueprint in the URL fragment and round-trips', () => {
    const url = playgroundUrl(files);
    expect(url.startsWith('https://playground.wordpress.net/#')).toBe(true);
    expect(decode(url)).toEqual(playgroundBlueprint(files));
  });

  it('keeps the starter theme and a large realistic theme under the URL limit', () => {
    expect(playgroundUrl(files).length).toBeLessThan(PLAYGROUND_URL_LIMIT);
    // A learner who wrote a lot: full styles in theme.json, a bigger index, a footer and two more patterns.
    const big = buildThemeFiles(
      c,
      rec({
        'theme.json': files['theme.json'].replace(
          /\n}\s*$/,
          `,\n  "styles": ${JSON.stringify({
            color: { background: 'var(--wp--preset--color--base)', text: 'var(--wp--preset--color--contrast)' },
            typography: { fontSize: '1.125rem', lineHeight: '1.6' },
            elements: { link: { color: { text: 'var(--wp--preset--color--accent)' } }, heading: { typography: { fontWeight: '700' } } },
            blocks: { 'core/site-title': { typography: { fontSize: '1.5rem' } }, 'core/post-title': { typography: { fontSize: '2rem' } } },
          }, null, 2)}\n}\n`,
        ),
        'templates/index.html': `<!-- wp:template-part {"slug":"header"} /-->\n${files['templates/index.html']}\n<!-- wp:template-part {"slug":"footer"} /-->\n`,
        'templates/single.html': files['templates/index.html'].repeat(2),
        'parts/footer.html': files['parts/header.html'].repeat(2),
        'patterns/cta.php': files['patterns/hero.php'].repeat(2),
        'patterns/about.php': files['patterns/hero.php'].repeat(2),
      }),
    );
    expect(playgroundUrl(big).length).toBeLessThan(PLAYGROUND_URL_LIMIT);
  });
});
