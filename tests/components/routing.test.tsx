// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content') };
});
vi.mock('../../src/ai/client', () => ({
  getStatus: vi.fn(async () => ({ ai: 'off' })),
  placement: vi.fn(),
}));

import { App } from '../../src/app';
import { getRecordManager, setRecordManager, useRecord } from '../../src/record/useRecord';
import { RecordManager } from '../../src/record/store';
import { content } from '../../src/content';
import { memoryManager } from './helpers';

afterEach(() => {
  cleanup();
  setRecordManager(null);
});

describe('routing', () => {
  it.each([
    ['/', 'Learn WordPress, your way.'],
    ['/path/x', 'Your path'],
    ['/learn/x', 'This lesson is nearly ready'],
    ['/finale', 'You made it this far'],
    ['/no/such/page', 'Nothing here'],
  ])('renders %s', async (url, heading) => {
    history.replaceState(null, '', url);
    render(<App />);
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(heading);
    expect(document.querySelector('header .wordmark')).toBeTruthy();
    expect(document.querySelector('footer')).toBeTruthy();
  });

  it('passes the route param through to the page', async () => {
    history.replaceState(null, '', '/learn/theme-json-basics');
    render(<App />);
    await screen.findByText(/theme-json-basics/);
  });
});

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

describe('hash links', () => {
  it('scrolls to the target of a hash URL', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    history.replaceState(null, '', '/#paths');
    render(<App />);
    await nextFrame();
    await nextFrame();
    expect(scroll).toHaveBeenCalled();
    expect((scroll.mock.contexts[0] as Element).id).toBe('paths');
    scroll.mockRestore();
  });

  it('survives a malformed hash', async () => {
    history.replaceState(null, '', '/#%E0%A4%A');
    render(<App />);
    await nextFrame();
    await nextFrame();
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Learn WordPress, your way.');
  });
});

describe('useRecord', () => {
  it('shares one app-wide manager unless a test injects its own', () => {
    const a = getRecordManager();
    expect(a).toBeInstanceOf(RecordManager);
    expect(getRecordManager()).toBe(a);
    const fake = memoryManager(content);
    setRecordManager(fake);
    expect(getRecordManager()).toBe(fake);
  });

  it('re-renders when the record changes', async () => {
    const m = memoryManager(content);
    setRecordManager(m);
    function Probe() {
      const { record } = useRecord();
      return <p>{record.placement?.reason ?? 'none'}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('none')).toBeTruthy();
    await act(() =>
      m.dispatch({
        type: 'placed',
        placement: { pathId: 'block-theme', startLessonId: 'theme-json-basics', skip: [], reason: 'Picked.' },
      }),
    );
    await waitFor(() => expect(screen.getByText('Picked.')).toBeTruthy());
  });
});
