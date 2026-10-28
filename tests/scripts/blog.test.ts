import { describe, expect, it } from 'vitest';
import { inline, originalLine, parsePost, toBlocks } from '../../scripts/blog/markdown';
import { draftArgs } from '../../scripts/blog/draft-learnwp';
import { DERINTOLU_SITE_ID, WPCOM_API, crossPostBody, readToken, seoPlugins } from '../../scripts/blog/cross-post';

const POST = `---
title: "A post: with a colon"
slug: a-post
excerpt: "Short."
---

First paragraph with \`code\`, **bold**, *em* and [a link](https://example.com/?a=1&b=2).
Same paragraph.

## A heading

- one
- two with [link](/blog/)

\`\`\`
studio --events--> server <b>
\`\`\`
`;

describe('parsePost', () => {
  it('reads the front matter and body', () => {
    const p = parsePost(POST);
    expect(p).toMatchObject({ title: 'A post: with a colon', slug: 'a-post', excerpt: 'Short.' });
    expect(p.body.startsWith('First paragraph')).toBe(true);
  });
  it('rejects a post without a slug or with a bad one', () => {
    expect(() => parsePost('---\ntitle: x\nexcerpt: y\n---\nbody')).toThrow(/slug/);
    expect(() => parsePost('---\ntitle: x\nslug: Bad Slug\nexcerpt: y\n---\nbody')).toThrow(/bad slug/);
  });
});

describe('inline', () => {
  it('escapes HTML and drops unsafe link targets', () => {
    expect(inline('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
    expect(inline('[x](javascript:alert(1))')).not.toContain('href');
    expect(inline('[q](https://e.com/"x)')).toContain('href="https://e.com/&quot;x"');
  });
});

describe('toBlocks', () => {
  const html = toBlocks(parsePost(POST).body);
  it('makes paragraph, heading, list and code blocks', () => {
    expect(html).toContain('<!-- wp:paragraph -->\n<p>First paragraph with <code>code</code>, <strong>bold</strong>, <em>em</em> and <a href="https://example.com/?a=1&amp;b=2">a link</a>. Same paragraph.</p>');
    expect(html).toContain('<!-- wp:heading -->\n<h2 class="wp-block-heading">A heading</h2>\n<!-- /wp:heading -->');
    expect(html).toContain('<ul class="wp-block-list"><!-- wp:list-item -->\n<li>one</li>');
    expect(html).toContain('<li>two with <a href="/blog/">link</a></li>');
    expect(html).toContain('<pre class="wp-block-code"><code>studio --events--&gt; server &lt;b&gt;</code></pre>');
  });
  it('balances every block comment', () => {
    const opens = html.match(/<!-- wp:([a-z-]+)/g)!.map((s) => s.slice(8));
    const closes = html.match(/<!-- \/wp:([a-z-]+)/g)!.map((s) => s.slice(9));
    expect(opens.sort()).toEqual(closes.sort());
  });
  it('refuses an h1 and an unclosed fence', () => {
    expect(() => toBlocks('# Title')).toThrow(/h1/);
    expect(() => toBlocks('```\ncode')).toThrow(/fence/);
  });
});

describe('draftArgs', () => {
  it('creates a draft, never a published post', () => {
    const args = draftArgs(POST, 2);
    expect(args.slice(0, 2)).toEqual(['post', 'create']);
    expect(args).toContain('--post_status=draft');
    expect(args.some((a) => /publish/.test(a))).toBe(false);
    expect(args).toContain('--post_author=2');
    expect(args).toContain('--post_name=a-post');
  });
  it('refuses a body over the 4,096-character WP-CLI argument limit', () => {
    const long = POST.replace('Same paragraph.', 'x'.repeat(5000));
    expect(() => draftArgs(long, 2)).toThrow(/--post_content is \d+ characters/);
  });
});

describe('cross-post', () => {
  it('is a draft that opens with a link to the original', () => {
    const body = crossPostBody(POST);
    expect(body.status).toBe('draft');
    expect(body.content.startsWith(originalLine('a-post'))).toBe(true);
    expect(body.content).toContain('Originally published on <a href="https://learnwp.sqwrlz.com/blog/a-post/">Learn WordPress, reimagined</a>');
  });
  it('reads a WordPress.com token from its file', () => {
    expect(readToken('token=abc123\n')).toBe('abc123');
    expect(() => readToken('user=derin\n')).toThrow(/token=/);
  });
  it('targets derintolu.com through the WordPress.com REST API', () => {
    expect(`${WPCOM_API}${DERINTOLU_SITE_ID}`).toBe('https://public-api.wordpress.com/wp/v2/sites/165681337');
  });
  it('names a supported SEO plugin from REST namespaces', () => {
    expect(seoPlugins(['wp/v2', 'yoast/v1'])).toEqual(['Yoast SEO']);
    expect(seoPlugins(['wp/v2', 'jetpack/v4'])).toEqual([]);
  });
});
