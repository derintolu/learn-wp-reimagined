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

describe('lwr-backend-view public REST route', () => {
  it('registers read-only course and lesson routes under lwr-backend-view/v1', () => {
    expect(php).toContain("'lwr-backend-view/v1'");
    expect(php).toContain("'/' . $type . '/(?P<key>");
    expect(php).toMatch(/array\(\s*'course',\s*'lesson'\s*\)/);
    expect(php).toContain('WP_REST_Server::READABLE');
    expect(php).not.toMatch(/CREATABLE|EDITABLE|DELETABLE/);
  });
  it('is public: __return_true, Cache-Control public, 404 when absent', () => {
    expect(php).toContain("'permission_callback' => '__return_true'");
    expect(php).toContain("'Cache-Control', 'public, max-age=60'");
    expect(php).toContain('? 200 : 404');
  });
  it('queries published, unprotected posts only, by stable key then slug, with prepared values', () => {
    expect(php).toContain("p.post_status = 'publish'");
    expect(php).toContain("p.post_password = ''");
    expect(php).toContain("m.meta_key = '_lledger_stable_key'");
    expect(php).toContain('p.post_name = %s');
    expect(php).toContain('$wpdb->prepare(');
    expect(php).not.toMatch(/post_status = '(draft|private|any)'/);
    expect(php).toContain("'sanitize_callback' => 'sanitize_text_field'");
  });
  it("orders lessons by Sensei's course order meta and renders through the_content", () => {
    expect(php).toContain('_lesson_course');
    expect(php).toContain("'_order_' . $course_id");
    expect(php).toContain("apply_filters( 'the_content'");
  });
  it('is version 0.3.0 in the header and the constant', () => {
    expect(/^\s*\* Version:\s*(\S+)/m.exec(php)![1]).toBe('0.3.0');
    expect(/LWR_BACKEND_VIEW_VERSION\s*=\s*'([^']+)'/.exec(php)![1]).toBe('0.3.0');
  });
  it('registers a public ids route over programs, courses and lessons', () => {
    expect(php).toContain("'/ids'");
    expect(php).toContain('lwr_backend_view_rest_ids');
    expect(php).toContain('lledger_program');
    expect(php).toContain('LIMIT 500');
    expect(php).toContain('ORDER BY p.ID');
    expect(php).toContain('(object) $groups');
  });
  it("exposes the post id on the course, the lesson and the course's lessons", () => {
    expect(php.match(/'id'\s+=> \(int\)/g)).toHaveLength(3);
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
