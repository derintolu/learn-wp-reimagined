// @vitest-environment jsdom
// jsdom, not happy-dom: DOMPurify misbehaves on happy-dom (it keeps handlers and drops tags), so the sanitizer is only tested on a DOM it supports.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content') };
});
vi.mock('../../src/ai/client', () => ({
  getStatus: vi.fn(async () => ({ ai: 'off' })),
  placement: vi.fn(),
}));

import { App } from '../../src/app';
import { APP_ROUTES } from '../../src/pages/appRoutes';
import { BLOG_DESCRIPTION } from '../../src/pages/Blog';
import { formatDate, plainText, sanitizePostHtml } from '../../src/blog/posts';
import { setRecordManager } from '../../src/record/useRecord';

const SITE = 'Learn WordPress, reimagined';
const DEFAULT_DESCRIPTION = 'The site description.';

const restPost = (slug: string, title: string, over: Record<string, unknown> = {}) => ({
  id: slug.length,
  slug,
  title,
  date: '2026-10-27T18:30:00+00:00',
  modified: '2026-10-27T18:30:00+00:00',
  excerpt: `Excerpt of ${slug} &amp; more.`,
  content:
    '<h2 class="wp-block-heading">A heading</h2>\n<ul class="wp-block-list"><li>one</li><li>two</li></ul>\n' +
    '<pre class="wp-block-code"><code>wp lwr-blog put --events--&gt;</code></pre>\n' +
    '<p>Safe <a href="/blog/other">link</a><img src="x" onerror="window.__pwned=1"></p><script>window.__pwned=1</script>',
  author: 'Derin Tolu',
  ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: string[] = [];
function stubPosts(answer: (url: URL) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'https://learnwp.sqwrlz.com');
      if (url.pathname !== '/wp-json/lwr-blog/v1/posts') return json({ results: [] });
      calls.push(raw);
      return answer(url);
    }),
  );
}

function visit(path: string) {
  history.replaceState(null, '', path);
  render(<App />);
}

beforeEach(() => {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);
  }
  meta.content = DEFAULT_DESCRIPTION;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setRecordManager(null);
  delete (window as { __pwned?: number }).__pwned;
});

const description = () => document.querySelector<HTMLMetaElement>('meta[name="description"]')!.content;

describe('blog routes', () => {
  it('are app routes: /blog and /blog/:slug', () => {
    expect(APP_ROUTES).toContainEqual({ pattern: '/blog', rewrite: '/blog' });
    expect(APP_ROUTES).toContainEqual({ pattern: '/blog/*', rewrite: '/blog/:slug' });
  });
});

describe('/blog', () => {
  it('lists published posts with title, date, author and excerpt, read from the lwr-blog route', async () => {
    stubPosts(() => json([restPost('second-post', 'Second &#8220;post&#8221;'), restPost('first-post', 'First post')]));
    visit('/blog');
    expect(screen.getByRole('status').textContent).toMatch(/Loading posts/);
    const list = await screen.findByRole('list', { name: 'Posts' });
    const items = within(list).getAllByRole('article');
    expect(items).toHaveLength(2);
    const link = within(items[0]).getByRole('link', { name: 'Second “post”' });
    expect(link.getAttribute('href')).toBe('/blog/second-post');
    expect(within(items[0]).getByRole('heading', { level: 2 })).toBeTruthy();
    expect(items[0].textContent).toContain('27 October 2026');
    expect(items[0].textContent).toContain('Derin Tolu');
    expect(items[0].textContent).toContain('Excerpt of second-post & more.');
    expect(items[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-10-27T18:30:00+00:00');
    // Spacefast hides wp/v2 content from anonymous callers, so the app reads the plugin's route.
    expect(calls[0]).toBe('/wp-json/lwr-blog/v1/posts');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The blog');
    await waitFor(() => expect(document.title).toBe(`Blog · ${SITE}`));
    expect(description()).toBe(BLOG_DESCRIPTION);
  });

  it('says so when there are no posts', async () => {
    stubPosts(() => json([]));
    visit('/blog');
    expect(await screen.findByText(/No posts yet/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Posts' })).toBeNull();
  });

  it('shows an error with a retry that loads again', async () => {
    let fail = true;
    stubPosts(() => (fail ? json({ code: 'oops' }, 500) : json([restPost('a-post', 'A post')])));
    visit('/blog');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn't load/);
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'A post' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('/blog/:slug', () => {
  it('renders one post: title, date, author, sanitized body, and the excerpt as the meta description', async () => {
    stubPosts(() => json([restPost('a-post', 'A post: with a colon')]));
    visit('/blog/a-post');
    const h1 = await screen.findByRole('heading', { level: 1, name: 'A post: with a colon' });
    const article = h1.closest('article')!;
    expect(article.textContent).toContain('27 October 2026');
    expect(article.textContent).toContain('Derin Tolu');
    expect(within(article).getByRole('heading', { level: 2, name: 'A heading' })).toBeTruthy();
    expect(within(article).getAllByRole('listitem')).toHaveLength(2);
    const pre = article.querySelector('pre.wp-block-code')!;
    expect(pre.textContent).toBe('wp lwr-blog put --events-->');
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(article.querySelector('script')).toBeNull();
    expect(article.querySelector('[onerror]')).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    expect(within(article).getByRole('link', { name: /All posts/ }).getAttribute('href')).toBe('/blog');

    expect(new URL(calls[0], 'https://x').searchParams.get('slug')).toBe('a-post');
    await waitFor(() => expect(document.title).toBe(`A post: with a colon · ${SITE}`));
    expect(description()).toBe('Excerpt of a-post & more.');
  });

  it('puts the site description back on leaving the post', async () => {
    stubPosts(() => json([restPost('a-post', 'A post')]));
    visit('/blog/a-post');
    await screen.findByRole('heading', { level: 1, name: 'A post' });
    await waitFor(() => expect(description()).toBe('Excerpt of a-post & more.'));
    cleanup();
    await waitFor(() => expect(description()).toBe(DEFAULT_DESCRIPTION));
  });

  it('shows not found for an unknown slug, linking back to the blog', async () => {
    stubPosts(() => json([]));
    visit('/blog/no-such-post');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('No post here');
    expect(screen.getByRole('link', { name: 'See all posts' }).getAttribute('href')).toBe('/blog');
    await waitFor(() => expect(document.title).toBe(`Post not found · ${SITE}`));
    expect(description()).toBe(DEFAULT_DESCRIPTION);
  });

  it('shows a loading state, then an error with a retry', async () => {
    let fail = true;
    stubPosts(() => (fail ? Promise.reject(new TypeError('offline')) : json([restPost('a-post', 'A post')])));
    visit('/blog/a-post');
    expect(screen.getByRole('status').textContent).toMatch(/Loading the post/);
    const alert = await screen.findByRole('alert');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'A post' })).toBeTruthy();
  });
});

describe('post helpers', () => {
  it('plainText decodes entities and drops tags', () => {
    expect(plainText('<p>Tom &amp; Jerry&#8217;s <b>show</b></p>\n')).toBe('Tom & Jerry’s show');
  });
  it('sanitizePostHtml strips scripts and handlers, keeps block markup', () => {
    const out = sanitizePostHtml('<h2>H</h2><a href="javascript:alert(1)">x</a><p onclick="x()">p</p><script>1</script><pre><code>c</code></pre>');
    expect(out).not.toMatch(/script|onclick|javascript:/);
    expect(out).toContain('<h2>H</h2>');
    expect(out).toContain('<pre tabindex="0"><code>c</code></pre>');
  });
  it('formatDate reads ISO dates in UTC', () => {
    expect(formatDate('2026-10-27T23:30:00+00:00')).toBe('27 October 2026');
    expect(formatDate('2026-10-27T23:30:00')).toBe('27 October 2026');
    expect(formatDate('nope')).toBe('');
  });
});
