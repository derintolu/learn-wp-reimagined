// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('content') };
});

import { Finale } from '../../src/pages/Finale';
import { setRecordManager } from '../../src/record/useRecord';
import { content } from '../../src/content';
import { memoryManager } from '../components/helpers';
import { makeLive } from './livePaths';

afterEach(() => {
  cleanup();
  setRecordManager(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function withLessons(ids: string[], files: Record<string, [string, string]> = {}) {
  const m = memoryManager(content);
  await m.init();
  for (const [file, [c, lessonId]] of Object.entries(files)) await m.dispatch({ type: 'fileEdited', file, content: c, lessonId });
  for (const id of ids) await m.dispatch({ type: 'lessonCompleted', lessonId: id });
  setRecordManager(m);
  return m;
}

const STYLE = '/*\nTheme Name: Ada Theme\nText Domain: my-block-theme\n*/\n';

describe('Finale page', () => {
  it('celebrates the lessons the learner completed', async () => {
    await withLessons(['bt-what-is-a-block-theme', 'bt-templates-and-parts']);
    render(<Finale />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You made it this far');
    await waitFor(() => expect(screen.getByText(/2 of 6 lessons/)).toBeTruthy());
    const list = screen.getByRole('list', { name: 'Lessons in your theme' });
    expect(list.textContent).toContain(content.lessons['bt-what-is-a-block-theme'].title);
    expect(list.textContent).toContain(content.lessons['bt-templates-and-parts'].title);
  });

  it('has different copy, hero included, when no lessons are complete', async () => {
    await withLessons([]);
    render(<Finale />);
    await waitFor(() => expect(screen.getByText(/finished reference theme/)).toBeTruthy());
    expect(screen.queryByText(/and you wrote it/)).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Where this path ends up');
  });

  it('says "you wrote it" only when at least one of the learner’s edits was used', async () => {
    // Lessons done, but no edits: the theme is the path's finished theme.
    await withLessons(['bt-what-is-a-block-theme']);
    render(<Finale />);
    await waitFor(() => expect(screen.getByText(/Here's the finished theme from the path/)).toBeTruthy());
    expect(screen.queryByText(/and you wrote it/)).toBeNull();
    cleanup();
    // An edit that was used.
    await withLessons(['bt-what-is-a-block-theme'], { 'style.css': [STYLE, 'bt-what-is-a-block-theme'] });
    render(<Finale />);
    await waitFor(() => expect(screen.getByText(/and you wrote it/)).toBeTruthy());
  });

  it('opens the learner’s own theme in Playground', async () => {
    await withLessons([], { 'style.css': [STYLE, 'bt-what-is-a-block-theme'] });
    render(<Finale />);
    const link = await screen.findByRole('link', { name: /Open in WordPress Playground/ });
    expect(link.getAttribute('href')!.startsWith('https://playground.wordpress.net/#')).toBe(true);
    await waitFor(() => expect(decodeURIComponent(link.getAttribute('href')!)).toContain('Theme Name: Ada Theme'));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('marks only edits that were used, and explains the ones that were replaced', async () => {
    const bug = content.lessons['bt-what-is-a-block-theme'].bug!.code.replace('"value"', '"color"');
    await withLessons([], { 'style.css': [STYLE, 'bt-what-is-a-block-theme'], 'theme.json': [bug, 'bt-what-is-a-block-theme'] });
    render(<Finale />);
    const files = await screen.findByRole('list', { name: 'Files in your theme' });
    await waitFor(() => expect(files.querySelectorAll('.chip').length).toBe(1));
    expect(files.querySelector('li:has(.chip) code')!.textContent).toBe('style.css');
    expect(screen.getByText(/We used the finished version of theme\.json because/)).toBeTruthy();
  });

  it('falls back to the zip when the theme is too big for a link', async () => {
    const base = JSON.parse(content.lessons['bt-global-styles'].starterFiles!['theme.json']);
    const huge = JSON.stringify({
      ...base,
      settings: { ...base.settings, custom: { notes: 'x'.repeat(210_000) } },
      styles: {
        color: { background: 'var:preset|color|base', text: 'var:preset|color|contrast' },
        elements: { link: { color: { text: 'var:preset|color|accent' } } },
      },
    });
    await withLessons([], { 'theme.json': [huge, 'bt-global-styles'] });
    render(<Finale />);
    await waitFor(() => expect(screen.getByText(/too big for a Playground link/)).toBeTruthy());
    expect(screen.queryByRole('link', { name: /Open in WordPress Playground/ })).toBeNull();
  });

  it('downloads the theme as a zip and revokes the URL later', async () => {
    await withLessons([]);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.useFakeTimers();
    render(<Finale />);
    fireEvent.click(screen.getByRole('button', { name: /Download your theme \(\.zip\)/ }));
    expect(create).toHaveBeenCalledTimes(1);
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(100);
    vi.advanceTimersByTime(1000);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });

  it('says what to do next and that this is an unofficial concept', () => {
    render(<Finale />);
    expect(screen.getByText(/Appearance → Themes → Add Theme → Upload Theme/)).toBeTruthy();
    expect(screen.queryByText(/Add New/)).toBeNull();
    expect(screen.getByText(/unofficial concept/i)).toBeTruthy();
  });
});

describe('Finale per path', () => {
  let restore = () => {};
  beforeEach(() => {
    restore = makeLive(content);
  });
  afterEach(() => restore());

  it('/finale/vibe-coder downloads my-first-plugin.zip and opens Playground with the plugin active', async () => {
    await withLessons([]);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<Finale pathId="vibe-coder" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Where this path ends up');
    fireEvent.click(screen.getByRole('button', { name: /Download your plugin \(\.zip\)/ }));
    expect(create).toHaveBeenCalledTimes(1);
    const a = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(a.download).toBe('my-first-plugin.zip');
    const link = await screen.findByRole('link', { name: /Open in WordPress Playground/ });
    const bp = decodeURIComponent(link.getAttribute('href')!);
    expect(bp).toContain('"activatePlugin"');
    expect(bp).toContain('my-first-plugin/my-first-plugin.php');
    expect(screen.getByRole('list', { name: 'Files in your plugin' })).toBeTruthy();
    expect(screen.getByText(/Plugins → Add Plugin → Upload Plugin/)).toBeTruthy();
    expect(screen.queryByText(/Add New/)).toBeNull();
  });

  it('/finale/learner offers "Open your site in Playground" and no download', async () => {
    await withLessons([]);
    render(<Finale pathId="learner" />);
    const link = await screen.findByRole('link', { name: /Open your site in Playground/ });
    expect(link.getAttribute('href')!.startsWith('https://playground.wordpress.net/#')).toBe(true);
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(screen.getByRole('list', { name: 'Pages in your site' }).textContent).toContain('pages/home.html');
    const lede = screen.getByText(/finished reference site/).textContent!;
    expect(lede.match(/\bsite\b/g)!.length).toBe(1);
  });

  it('shows the path-specific h1 once lessons are done', async () => {
    await withLessons(['vc-first-plugin']);
    render(<Finale pathId="vibe-coder" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your first plugin, built');
  });

  it('an unknown or non-live path renders NotFound', async () => {
    await withLessons([]);
    restore();
    render(<Finale pathId="nope" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing here');
    cleanup();
    // Every real path is live now, so make one coming-soon for this check.
    const saved = content.paths['vibe-coder'];
    content.paths['vibe-coder'] = { ...saved, status: 'coming-soon' };
    try {
      render(<Finale pathId="vibe-coder" />);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing here');
    } finally {
      content.paths['vibe-coder'] = saved;
    }
  });
});
