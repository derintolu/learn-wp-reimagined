// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('content') };
});

import { Finale } from '../../src/pages/Finale';
import { setRecordManager } from '../../src/record/useRecord';
import { content } from '../../src/content';
import { memoryManager } from '../components/helpers';

afterEach(() => {
  cleanup();
  setRecordManager(null);
});

async function withLessons(ids: string[], files: Record<string, string> = {}) {
  const m = memoryManager(content);
  await m.init();
  for (const [file, c] of Object.entries(files)) await m.dispatch({ type: 'fileEdited', file, content: c });
  for (const id of ids) await m.dispatch({ type: 'lessonCompleted', lessonId: id });
  setRecordManager(m);
  return m;
}

describe('Finale page', () => {
  it('celebrates the lessons the learner completed', async () => {
    await withLessons(['bt-what-is-a-block-theme', 'bt-templates-and-parts']);
    render(<Finale />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You made it this far');
    await waitFor(() => expect(screen.getByText(/2 of 6 lessons/)).toBeTruthy());
    const done = screen.getByRole('list', { name: 'Lessons in your theme' });
    expect(done.textContent).toContain(content.lessons['bt-what-is-a-block-theme'].title);
    expect(done.textContent).toContain(content.lessons['bt-templates-and-parts'].title);
  });

  it('opens the learner’s own theme in Playground', async () => {
    await withLessons([], { 'style.css': '/*\nTheme Name: Ada Theme\n*/' });
    render(<Finale />);
    const link = await screen.findByRole('link', { name: /Open in WordPress Playground/ });
    const href = link.getAttribute('href')!;
    expect(href.startsWith('https://playground.wordpress.net/#')).toBe(true);
    await waitFor(() => expect(decodeURIComponent(link.getAttribute('href')!)).toContain('Theme Name: Ada Theme'));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('downloads the theme as a zip', async () => {
    await withLessons([]);
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    render(<Finale />);
    fireEvent.click(screen.getByRole('button', { name: /Download your theme \(\.zip\)/ }));
    expect(create).toHaveBeenCalledTimes(1);
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(100);
  });

  it('says what to do next and that this is an unofficial concept', () => {
    render(<Finale />);
    expect(screen.getByText(/Appearance → Themes → Add New Theme → Upload Theme/)).toBeTruthy();
    expect(screen.getByText(/unofficial concept/i)).toBeTruthy();
  });
});
