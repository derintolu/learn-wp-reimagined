import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const meta = (attr: 'name' | 'property', key: string) =>
  html.match(new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`))?.[1];
const SITE = 'https://learn-wp-reimagined.space.fast/';

describe('index.html social metadata', () => {
  it('has a description, Open Graph and Twitter card tags', () => {
    expect(meta('name', 'description')).toMatch(/Learn WordPress/);
    expect(meta('property', 'og:title')).toBe('Learn WordPress, reimagined');
    expect(meta('property', 'og:description')).toBeTruthy();
    expect(meta('property', 'og:type')).toBe('website');
    expect(meta('property', 'og:url')).toBe(SITE);
    expect(meta('property', 'og:image')).toBe(`${SITE}og.png`);
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
    expect(meta('name', 'twitter:image')).toBe(`${SITE}og.png`);
  });

  it('has an inline SVG favicon and a 1200x630 OG image', () => {
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
    const png = readFileSync(resolve(root, 'public/og.png'));
    expect(existsSync(resolve(root, 'public/og.png'))).toBe(true);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it('has a theme colour and no static canonical (one canonical would mark every SPA route as the home page)', () => {
    expect(html).not.toContain('rel="canonical"');
    expect(meta('name', 'theme-color')).toBe('#1E1E1E');
  });

  it('serves a robots.txt that keeps crawlers off /api/', () => {
    const robots = readFileSync(resolve(root, 'public/robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
  });
});
