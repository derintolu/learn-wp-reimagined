import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_ROUTES } from '../../src/pages/appRoutes';

const root = resolve(__dirname, '../..');
// sf.jsonc allows comments; strip whole-line and trailing // comments that are not inside a string.
const stripJsonc = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/[^"]*$/, ''))
    .join('\n');
const sf = JSON.parse(stripJsonc(readFileSync(resolve(root, 'sf.jsonc'), 'utf8')));
const rewrites: { source: string; destination: string }[] = sf.rewrites ?? [];

/** A `*` in a source matches one or more characters, anything else is literal. */
const matches = (source: string, path: string) =>
  new RegExp(`^${source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.+')}$`).test(path);

describe('sf.jsonc routes', () => {
  it('lists exactly the app routes', () => {
    expect(APP_ROUTES.map((r) => r.pattern)).toEqual([
      '/', '/path/*', '/learn/*', '/finale', '/finale/*', '/connect', '/how-it-works', '/proposal', '/blog', '/blog/*', '/backend/*', '/consent',
    ]);
  });
  it('every app route has an sf.jsonc rewrite to index.html', () => {
    for (const r of APP_ROUTES) expect(rewrites).toContainEqual(expect.objectContaining({ source: r.pattern, destination: '/index.html' }));
  });
  it('sends both OAuth metadata paths to the metadata Function', () => {
    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server'])
      expect(rewrites).toContainEqual({ source: p, destination: '/api/oauth/metadata' });
  });
  it('keeps the crons entries and has no catch-all fallback', () => {
    expect(sf.fallback).toBeUndefined();
    expect(sf.crons).toEqual([
      { path: '/api/mcp-sweep', schedule: 'daily' },
      { path: '/api/lrs-drain', schedule: 'hourly' },
      { path: '/api/sweep', schedule: 'daily' },
    ]);
  });
  it.each(['/wp-json/*', '/wp-admin/*', '/wp-login.php', '/course/*', '/lesson/*', '/xapi/*', '/courses/', '/api/events', '/theme/lwr-blog-0.1.0.zip', '/plugin/lwr-blog-cli-0.2.1.zip', '/blogroll'])(
    'leaves %s to WordPress or Functions',
    (p) => {
      expect(rewrites.some((r) => matches(r.source, p.replace('*', 'x')))).toBe(false);
    },
  );
  it('matches app paths', () => {
    for (const p of ['/', '/learn/abc', '/path/x', '/finale', '/finale/x', '/connect', '/how-it-works', '/proposal', '/blog', '/blog/a-post', '/blog/a-post/', '/backend/block-theme', '/backend/block-theme/one', '/consent'])
      expect(rewrites.some((r) => matches(r.source, p))).toBe(true);
  });
});
