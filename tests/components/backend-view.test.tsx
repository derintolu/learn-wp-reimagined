// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';

vi.mock('../../src/content', () => ({
  content: {
    paths: {
      'block-theme': { id: 'block-theme', title: 'Build a block theme', status: 'live', lessons: ['one', 'two', 'three'] },
      learner: { id: 'learner', title: 'Learner', status: 'live', lessons: ['solo'] },
    },
    lessons: {
      one: { id: 'one', pathId: 'block-theme', title: 'One' },
      two: { id: 'two', pathId: 'block-theme', title: 'Two' },
      three: { id: 'three', pathId: 'block-theme', title: 'Three' },
      solo: { id: 'solo', pathId: 'learner', title: 'Solo' },
    },
  },
}));

import { LocationProvider } from 'preact-iso';
import { BackendView } from '../../src/pages/BackendView';
import { FEATURES } from '../../src/config';
import { sanitizeHtml } from '../../src/backend/sanitize';
import { BACKEND_VIEW_PATH } from '../../src/shared/course-meta';

const flags = FEATURES as { wordpressContent: boolean };
let calls: { url: string; init?: RequestInit }[] = [];

const COURSE = [{ id: 7, slug: 'block-theme', title: { rendered: 'Build a block theme' }, content: { rendered: '<p>Course intro.</p>' } }];
const LESSONS = [
  { id: 13, slug: 'three', title: { rendered: 'Lesson three' }, content: { rendered: '<p>c</p>' } },
  { id: 11, slug: 'one', title: { rendered: 'Lesson one &amp; first' }, content: { rendered: '<p>a</p>' } },
  { id: 12, slug: 'two', title: { rendered: 'Lesson two' }, content: { rendered: '<p>b</p>' } },
];

function fakeFetch(handler: (url: string) => unknown) {
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = handler(url);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
}

// preact-iso's useRoute reads the router context, so render under the real router at the real URL.
import { Router, Route } from 'preact-iso';
function at(url: string) {
  history.replaceState(null, '', url);
  return render(
    <LocationProvider>
      <Router>
        <Route path="/backend/:pathId" component={BackendView} />
        <Route path="/backend/:pathId/:lessonId" component={BackendView} />
      </Router>
    </LocationProvider>,
  );
}

beforeEach(() => {
  calls = [];
  flags.wordpressContent = true;
});
afterEach(() => {
  cleanup();
  flags.wordpressContent = false;
  vi.useRealTimers();
});

describe('BACKEND_VIEW_PATH', () => {
  it('is the app route for the block-theme path', () => {
    expect(BACKEND_VIEW_PATH).toBe('/backend/block-theme');
  });
});

describe('backend view: course', () => {
  const route = (url: string) => (url.includes('/course?') ? COURSE : LESSONS);

  it('renders the course title and its lessons in path order, with the banner', async () => {
    fakeFetch(route);
    at('/backend/block-theme');
    await screen.findByRole('heading', { level: 1, name: 'Build a block theme' });
    expect(screen.getByText("This is the backend view: Sensei's own record of this course.")).toBeTruthy();
    const items = Array.from(document.querySelectorAll('.backend-lessons li a')).map((a) => a.textContent);
    expect(items).toEqual(['Lesson one & first', 'Lesson two', 'Lesson three']);
    expect(document.querySelector('.backend-lessons li a')!.getAttribute('href')).toBe('/backend/block-theme/one');
    expect(screen.getByText('Course intro.')).toBeTruthy();
    expect(screen.getByText('unofficial concept').className).toContain('sticker');
    const studio = screen.getByRole('link', { name: 'Take the course in the studio' });
    expect(studio.getAttribute('href')).toBe('/path/block-theme');
  });

  it('asks Sensei anonymously, same origin, with a timeout signal', async () => {
    fakeFetch(route);
    at('/backend/block-theme');
    await screen.findByRole('heading', { level: 1 });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url.startsWith('/wp-json/wp/v2/')).toBe(true);
      expect(c.init?.credentials).toBe('omit');
      expect(c.init?.signal).toBeTruthy();
      expect(JSON.stringify(c.init?.headers ?? {})).not.toMatch(/nonce/i);
    }
  });

  it('says Sensei is not answering, with the studio link, when fetch fails', async () => {
    fakeFetch(() => new Error('down'));
    at('/backend/block-theme');
    await screen.findByText("Sensei isn't answering right now.");
    expect(screen.getByRole('link', { name: 'Take the course in the studio' }).getAttribute('href')).toBe('/path/block-theme');
  });

  it('treats a non-200 (Sensei not installed) as not answering', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as any;
    at('/backend/block-theme');
    await screen.findByText("Sensei isn't answering right now.");
  });

  it('gives up after 3 seconds', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_u: any, init?: RequestInit) =>
        new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new Error('aborted')))),
    ) as any;
    at('/backend/block-theme');
    await vi.advanceTimersByTimeAsync(3100);
    await screen.findByText("Sensei isn't answering right now.");
  });

  it('is NotFound for a path the studio does not have', async () => {
    fakeFetch(route);
    at('/backend/nope');
    await screen.findByText('Nothing');
    expect(calls).toEqual([]);
  });
});

describe('backend view: lesson', () => {
  it('renders sanitised content, strips scripts, and shows the lesson banner', async () => {
    fakeFetch(() => [
      {
        id: 11,
        slug: 'one',
        title: { rendered: 'Lesson one' },
        content: { rendered: '<p>Hello <strong>there</strong></p><script>window.x=1</script><img src=x onerror="window.x=2"><a href="javascript:alert(1)">bad</a>' },
      },
    ]);
    at('/backend/block-theme/one');
    await screen.findByRole('heading', { level: 1, name: 'Lesson one' });
    expect(screen.getByText("This is the backend view: Sensei's own record of this lesson.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Take the lesson in the studio' }).getAttribute('href')).toBe('/learn/one');
    const body = document.querySelector('.backend-body')!;
    expect(body.textContent).toContain('Hello there');
    expect(body.querySelector('script')).toBeNull();
    expect(body.innerHTML).not.toMatch(/onerror|javascript:/i);
    expect((window as any).x).toBeUndefined();
    expect(calls[0].url).toContain('/wp-json/wp/v2/lesson?');
    expect(calls[0].url).toContain('slug[]=one');
  });

  it('shows the down message when Sensei fails', async () => {
    fakeFetch(() => new Error('down'));
    at('/backend/block-theme/one');
    await screen.findByText("Sensei isn't answering right now.");
    expect(screen.getByRole('link', { name: 'Take the lesson in the studio' }).getAttribute('href')).toBe('/learn/one');
  });

  it('is NotFound for a lesson outside the path', async () => {
    fakeFetch(() => []);
    at('/backend/block-theme/solo');
    await screen.findByText('Nothing');
  });
});

describe('backend view: flag', () => {
  it('flag off renders NotFound and never fetches', async () => {
    flags.wordpressContent = false;
    fakeFetch(() => COURSE);
    at('/backend/block-theme');
    await screen.findByText('Nothing');
    expect(calls).toEqual([]);
  });
});

describe('sanitizeHtml', () => {
  it('keeps prose markup, drops active content and unknown wrappers', () => {
    const out = sanitizeHtml(
      '<h2>T</h2><ul><li>a</li></ul><pre><code>x &lt; y</code></pre><iframe></iframe><style>p{}</style><custom-x>kept text</custom-x><a href="https://e.com/x" onclick="1">l</a><svg onload="1"></svg>',
    );
    expect(out).toContain('<h2>T</h2>');
    expect(out).toContain('<ul><li>a</li></ul>');
    expect(out).toContain('x &lt; y');
    expect(out).toContain('kept text');
    expect(out).not.toMatch(/iframe|<style|svg|onclick|<custom-x/);
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
