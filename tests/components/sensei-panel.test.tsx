// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';

vi.mock('../../src/content', () => ({
  content: {
    paths: { 'block-theme': { id: 'block-theme', title: 'Build a block theme', status: 'live', lessons: ['one', 'two', 'three'] } },
    lessons: {
      one: { id: 'one', pathId: 'block-theme', title: 'Lesson One' },
      two: { id: 'two', pathId: 'block-theme', title: 'Lesson Two' },
      three: { id: 'three', pathId: 'block-theme', title: 'Lesson Three' },
    },
  },
}));

import { LocationProvider } from 'preact-iso';
import { SenseiPanel } from '../../src/components/SenseiPanel';
import { BACKEND_VIEW_PATH } from '../../src/shared/course-meta';

const DATA = {
  enrolled: ['block-theme'],
  completedLessons: ['one', 'two'],
  testedOutLessons: ['three'],
  completedCourses: [],
  certificates: [],
};
const mount = () =>
  render(
    <LocationProvider>
      <SenseiPanel />
    </LocationProvider>,
  );

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SenseiPanel', () => {
  it('lists tested-out lessons separately', async () => {
    const { container } = mount();
    expect(screen.getByRole('heading', { name: 'What Sensei sees' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Lesson One')).toBeTruthy());
    const done = screen.getByRole('list', { name: 'Completed lessons' });
    const out = screen.getByRole('list', { name: 'Tested-out lessons' });
    expect(done.textContent).toContain('Lesson One');
    expect(done.textContent).toContain('Lesson Two');
    expect(done.textContent).not.toContain('Lesson Three');
    expect(out.textContent).toBe('Lesson Three');
    expect(container.textContent).toContain('Build a block theme');
    expect(container.querySelector(`a[href="${BACKEND_VIEW_PATH}"]`)).toBeTruthy();
    expect(container.querySelector('[data-slot="certificate"]')).toBeTruthy();
  });

  it('connector down shows "Sensei isn\'t answering right now."', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 'connector-unavailable', message: 'x' } }), { status: 503 })),
    );
    mount();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Sensei isn't answering right now."));
  });
});
