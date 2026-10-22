import { describe, expect, it } from 'vitest';
import { playgroundBlueprint, playgroundUrl, previewTarget, sitePagesPhp } from '../../src/finale/playground';

const THEME = { kind: 'theme', slug: 'my-block-theme' } as const;
const T = '/wordpress/wp-content/themes/my-block-theme';
const themeFiles = { 'style.css': '/* t */', 'theme.json': '{"version":3}', 'templates/index.html': '<p>i</p>', 'parts/x/y.html': 'y' };

/** Captured from the pre-change implementation, playgroundBlueprint(themeFiles), before paths were added. */
const SNAPSHOT = {
  $schema: 'https://playground.wordpress.net/blueprint-schema.json',
  landingPage: '/',
  preferredVersions: { wp: 'latest', php: '8.3' },
  login: true,
  steps: [
    { step: 'mkdir', path: T },
    { step: 'mkdir', path: `${T}/parts` },
    { step: 'mkdir', path: `${T}/parts/x` },
    { step: 'mkdir', path: `${T}/templates` },
    { step: 'writeFile', path: `${T}/parts/x/y.html`, data: 'y' },
    { step: 'writeFile', path: `${T}/style.css`, data: '/* t */' },
    { step: 'writeFile', path: `${T}/templates/index.html`, data: '<p>i</p>' },
    { step: 'writeFile', path: `${T}/theme.json`, data: '{"version":3}' },
    { step: 'activateTheme', themeFolderName: 'my-block-theme' },
  ],
};

describe('previewTarget', () => {
  it('maps each kind to the folder its files live under', () => {
    expect(previewTarget(THEME)).toBe(T);
    expect(previewTarget({ kind: 'plugin', slug: 'hello-learn' })).toBe('/wordpress/wp-content/plugins');
    expect(previewTarget({ kind: 'site' })).toBe('/tmp/learn-pages');
  });
});

describe('playgroundBlueprint by preview kind', () => {
  it('theme blueprint is unchanged for block-theme', () => {
    expect(playgroundBlueprint(themeFiles, THEME)).toEqual(SNAPSHOT);
    expect(JSON.stringify(playgroundBlueprint(themeFiles, THEME))).toBe(JSON.stringify(SNAPSHOT));
    expect(playgroundBlueprint(themeFiles, THEME, { login: false })).toEqual({ ...SNAPSHOT, login: false });
    const url = playgroundUrl(themeFiles, THEME);
    expect(JSON.parse(decodeURIComponent(url.slice(url.indexOf('#') + 1)))).toEqual(SNAPSHOT);
  });

  it('playgroundUrl passes its options through to the blueprint', () => {
    const url = playgroundUrl(themeFiles, THEME, { landing: '/about/', login: false });
    expect(JSON.parse(decodeURIComponent(url.slice(url.indexOf('#') + 1)))).toEqual(playgroundBlueprint(themeFiles, THEME, { landing: '/about/', login: false }));
    expect(playgroundUrl(themeFiles, THEME, {})).toBe(playgroundUrl(themeFiles, THEME));
  });

  it('lands on opts.landing', () => {
    expect(playgroundBlueprint(themeFiles, THEME, { landing: '/about/' }).landingPage).toBe('/about/');
  });

  it('plugin blueprint activates the known-good main file', () => {
    const MAIN = 'hello-learn/hello-learn.php';
    const GOOD = '<?php\n/**\n * Plugin Name: Hello Learn\n */\n';
    const BAD = '<?php syntax error';
    const files = { [MAIN]: BAD, 'hello-learn/includes/greet.php': '<?php // greet' };
    const bp = playgroundBlueprint(files, { kind: 'plugin', slug: 'hello-learn' }, { known: { [MAIN]: GOOD }, login: false });
    const act = bp.steps.findIndex((s) => s.step === 'activatePlugin');
    expect(act).toBeGreaterThan(0);
    expect(bp.steps[act]).toEqual({ step: 'activatePlugin', pluginPath: MAIN });
    const mainWrite = bp.steps.findIndex((s) => s.step === 'writeFile' && s.path === `/wordpress/wp-content/plugins/${MAIN}`);
    expect(mainWrite).toBeGreaterThanOrEqual(0);
    expect(mainWrite).toBeLessThan(act);
    expect(bp.steps[mainWrite].data).toBe(GOOD);
    expect(JSON.stringify(bp)).not.toContain('syntax error');
    expect(bp.steps.some((s) => s.step === 'writeFile' && s.path === '/wordpress/wp-content/plugins/hello-learn/includes/greet.php')).toBe(true);
    const mk = bp.steps.findIndex((s) => s.step === 'mkdir' && s.path === '/wordpress/wp-content/plugins/hello-learn/includes');
    expect(mk).toBeGreaterThanOrEqual(0);
    expect(bp.steps.some((s) => s.step === 'activateTheme')).toBe(false);
  });

  it('site pages are read from files, never inlined into PHP', () => {
    const NASTY = "<?php echo 1; ?>' ); exit; //";
    const files = { 'pages/home.html': NASTY, 'pages/about-us.html': '<!-- wp:paragraph --><p>About</p><!-- /wp:paragraph -->' };
    const bp = playgroundBlueprint(files, { kind: 'site' }, { landing: '/about-us/' });
    expect(bp.landingPage).toBe('/about-us/');
    const writes = bp.steps.filter((s) => s.step === 'writeFile');
    expect(writes.find((s) => s.path === '/tmp/learn-pages/pages/home.html')?.data).toBe(NASTY);
    const mk = bp.steps.findIndex((s) => s.step === 'mkdir' && s.path === '/tmp/learn-pages/pages');
    const wr = bp.steps.findIndex((s) => s.step === 'writeFile');
    expect(mk).toBeGreaterThanOrEqual(0);
    expect(mk).toBeLessThan(wr);
    const runs = bp.steps.filter((s) => s.step === 'runPHP');
    expect(runs).toHaveLength(1);
    expect(bp.steps[bp.steps.length - 1].step).toBe('runPHP');
    for (const r of runs) {
      expect(r.code).not.toContain(NASTY);
      expect(r.code).not.toContain('About');
    }
    const code = runs[0].code!;
    expect(code).toBe(sitePagesPhp(['pages/about-us.html', 'pages/home.html']));
    expect(code).toContain("require_once '/wordpress/wp-load.php';");
    expect(code).toContain('file_get_contents');
    expect(code).toContain("'/tmp/learn-pages/pages/'");
    expect(code).toContain("'about-us'");
    expect(code).toContain("'home'");
    expect(code).toContain('get_page_by_path');
    expect(code).toContain("update_option( 'show_on_front', 'page' )");
    expect(code).toContain("update_option( 'page_on_front'");
  });

  it('sitePagesPhp only sets a front page when pages/home.html exists', () => {
    expect(sitePagesPhp(['pages/about.html'])).not.toContain('show_on_front');
    expect(sitePagesPhp(['pages/home.html'])).toContain('show_on_front');
  });

  it('sitePagesPhp rejects names outside pages/<name>.html', () => {
    for (const bad of ["pages/x'.html", 'pages/../x.html', 'theme.json', 'pages/A.html', 'pages/x.html.php']) {
      expect(() => sitePagesPhp([bad])).toThrow();
    }
  });
});
