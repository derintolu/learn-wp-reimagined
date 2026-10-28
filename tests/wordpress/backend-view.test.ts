import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipWpPlugin } from '../../scripts/zip-wp-plugin.ts';

const dir = join(__dirname, '../../wordpress/lwr-backend-view');
const php = readFileSync(join(dir, 'lwr-backend-view.php'), 'utf8');
const css = readFileSync(join(dir, 'banner.css'), 'utf8');

const hasPhp = (() => {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('lwr-backend-view plugin', () => {
  it('hooks admin_notices and admin_enqueue_scripts, never wp_body_open', () => {
    expect(php).toContain("add_action( 'admin_notices'");
    expect(php).toContain("add_action( 'admin_enqueue_scripts'");
    expect(php).not.toContain('wp_body_open');
  });

  it('limits itself to course and lesson screens for users who can edit posts', () => {
    expect(php).toMatch(/get_current_screen\(\)/);
    expect(php).toMatch(/array\(\s*'course',\s*'lesson'\s*\)/);
    expect(php).toContain("current_user_can( 'edit_posts' )");
  });

  it('escapes output and carries the exact copy', () => {
    expect(php).toContain('esc_url(');
    expect(php).toContain('esc_html(');
    expect(php).toContain("This is the backend view: Sensei's own page for this %s.");
    expect(php).toContain('Take the lesson in the studio');
    expect(php).toContain('Take the course in the studio');
    expect(php).toContain('unofficial concept');
    expect(php).toContain("'https://learnwp.sqwrlz.com'");
    expect(php).toContain("'/learn/'");
    expect(php).toContain("'/path/'");
  });

  it("reads Learning Ledger's stable key meta and falls back to the slug", () => {
    expect(php).toContain('_lledger_stable_key');
    expect(php).toContain('post_name');
  });

  it('is GPL-2.0-or-later with a Version header', () => {
    expect(php).toMatch(/^\s*\* License:\s*GPL-2\.0-or-later/m);
    expect(php).toMatch(/^\s*\* Version:\s*\d+\.\d+\.\d+/m);
    expect(php).toMatch(/^\s*\* Text Domain:\s*lwr-backend-view/m);
  });

  it('styles with Inter, the brand blues, wraps, and has no W logo', () => {
    expect(css).toContain('Inter');
    expect(css).toContain('#3858E9');
    expect(css).toContain('#9FB1FF');
    expect(css).toMatch(/flex-wrap:\s*wrap/);
    expect(css.toLowerCase()).not.toContain('dashicons-wordpress');
    expect(php.toLowerCase()).not.toContain('dashicons-wordpress');
  });

  it.skipIf(!hasPhp)('passes php -l', () => {
    expect(() => execFileSync('php', ['-l', join(dir, 'lwr-backend-view.php')], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('zipWpPlugin', () => {
  it('names the zip from the Version header and nests files under the slug', () => {
    const out = mkdtempSync(join(tmpdir(), 'wpzip-'));
    const zip = zipWpPlugin(dir, out);
    const version = /^\s*\* Version:\s*(\S+)/m.exec(php)![1];
    expect(zip).toBe(join(out, `lwr-backend-view-${version}.zip`));
    const names = Object.keys(unzipSync(new Uint8Array(readFileSync(zip))));
    expect(names).toContain('lwr-backend-view/lwr-backend-view.php');
    expect(names).toContain('lwr-backend-view/banner.css');
  });

  it('throws without a Version header', () => {
    const d = mkdtempSync(join(tmpdir(), 'wpplug-'));
    const p = join(d, 'thing');
    mkdirSync(p);
    writeFileSync(join(p, 'thing.php'), '<?php\n/* Plugin Name: Thing */');
    expect(() => zipWpPlugin(p, d)).toThrow(/Version/);
  });
});
