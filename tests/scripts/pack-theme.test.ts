import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { CLI_PLUGIN_SLUG, THEME_SLUG, packCliPlugin, packTheme, pluginVersion, themeVersion } from '../../scripts/pack-theme';

const THEME = fileURLToPath(new URL('../../wordpress/theme', import.meta.url));
const CLI_PLUGIN = fileURLToPath(new URL('../../wordpress/mu-plugins/lwr-blog-cli.php', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('packTheme', () => {
  it('zips the block theme under its slug, named by version, without dotfiles', () => {
    const out = mkdtempSync(join(tmpdir(), 'theme-'));
    dirs.push(out);
    const dotfile = join(THEME, '.DS_Store');
    let wroteDotfile = false;
    try {
      writeFileSync(dotfile, 'x', { flag: 'wx' });
      wroteDotfile = true;
    } catch {
      // already there, fine
    }
    try {
      const zip = packTheme(THEME, out);
      expect(zip).toBe(join(out, `${THEME_SLUG}-${themeVersion(THEME)}.zip`));
      const names = Object.keys(unzipSync(readFileSync(zip)));
      for (const f of ['style.css', 'theme.json', 'functions.php', 'templates/index.html', 'templates/home.html', 'templates/single.html', 'parts/header.html', 'parts/footer.html']) {
        expect(names).toContain(`${THEME_SLUG}/${f}`);
      }
      expect(names.every((n) => n.startsWith(`${THEME_SLUG}/`))).toBe(true);
      expect(names.some((n) => n.split('/').some((part) => part.startsWith('.')))).toBe(false);
    } finally {
      if (wroteDotfile) rmSync(dotfile);
    }
  });
});

describe('the theme', () => {
  const json = JSON.parse(readFileSync(join(THEME, 'theme.json'), 'utf8'));
  const tokens = readFileSync(fileURLToPath(new URL('../../src/styles/tokens.css', import.meta.url)), 'utf8');
  it('uses the app colour tokens', () => {
    const palette = Object.fromEntries(json.settings.color.palette.map((c: { slug: string; color: string }) => [c.slug, c.color.toLowerCase()]));
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)![1].toLowerCase();
    for (const slug of ['wp-blue', 'wp-blue-light', 'wp-blue-dark', 'charcoal', 'charcoal-2', 'paper', 'ink-muted', 'on-dark', 'on-dark-muted', 'rule', 'rule-dark', 'tint', 'surface-muted']) {
      expect(palette[slug], slug).toBe(token(slug));
    }
  });
  it('bundles EB Garamond and Inter', () => {
    const families = json.settings.typography.fontFamilies.map((f: { name: string }) => f.name);
    expect(families).toEqual(expect.arrayContaining(['EB Garamond', 'Inter']));
    for (const f of json.settings.typography.fontFamilies) {
      for (const face of f.fontFace ?? []) readFileSync(join(THEME, face.src[0].replace('file:./', '')));
    }
  });
  it('has a header that links back to the app and a labelled nav', () => {
    const header = readFileSync(join(THEME, 'parts/header.html'), 'utf8');
    expect(header).toContain('<nav class="lwr-nav-wrap" aria-label="Main">');
    for (const href of ['/#paths', '/how-it-works', '/blog/']) expect(header).toContain(`href="${href}"`);
    expect(header).toContain('unofficial concept');
  });
});

describe('packCliPlugin', () => {
  it('zips the lwr-blog put command as a one-file plugin, named by version', () => {
    const out = mkdtempSync(join(tmpdir(), 'plugin-'));
    dirs.push(out);
    const version = pluginVersion(CLI_PLUGIN);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const zip = packCliPlugin(CLI_PLUGIN, out);
    expect(zip).toBe(join(out, `${CLI_PLUGIN_SLUG}-${version}.zip`));
    const files = unzipSync(readFileSync(zip));
    expect(Object.keys(files)).toEqual([`${CLI_PLUGIN_SLUG}/${CLI_PLUGIN_SLUG}.php`]);
    const php = new TextDecoder().decode(files[`${CLI_PLUGIN_SLUG}/${CLI_PLUGIN_SLUG}.php`]);
    expect(php).toContain("WP_CLI::add_command( 'lwr-blog put'");
    expect(php).toContain('base64_decode( $chunk, true )');
    // The blog's read route: anonymous, read-only, published posts only.
    expect(php).toContain("register_rest_route(\n\t\t\t'lwr-blog/v1',\n\t\t\t'/posts',");
    expect(php).toContain("'permission_callback' => '__return_true'");
    expect(php).toContain("'methods'             => WP_REST_Server::READABLE");
    expect(php.match(/register_rest_route\(/g)).toHaveLength(1);
    expect(php).toContain("post_status = 'publish' AND post_password = ''");
    expect(php).toContain("$wpdb->prepare( ' AND post_name = %s', $slug )");
  });
});
