// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
// Finale links go to the learner's own path. Learner and Vibe coder are not live in real content yet,
// so they are made live from fixtures for these tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content') };
});
vi.mock('../../src/ai/client', () => ({
  getStatus: vi.fn(async () => ({ ai: 'off' })),
  placement: vi.fn(),
}));

import { App } from '../../src/app';
import { content } from '../../src/content';
import { setRecordManager } from '../../src/record/useRecord';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import { memoryManager } from './helpers';
import { makeLive } from '../finale/livePaths';

let restore = () => {};
beforeEach(() => {
  restore = makeLive(content);
  setPlaygroundImporter(() => Promise.reject(new Error('no Playground in tests')));
});
afterEach(() => {
  cleanup();
  restore();
  setRecordManager(null);
  setPlaygroundImporter(null);
});

async function completed(lessonId: string) {
  const m = memoryManager(content);
  await m.init();
  await m.dispatch({ type: 'lessonCompleted', lessonId });
  setRecordManager(m);
}

describe('finale links', () => {
  it("the last lesson's button goes to its own path's finale", async () => {
    await completed('vc-first-plugin');
    history.replaceState(null, '', '/learn/vc-first-plugin');
    render(<App />);
    const link = await screen.findByRole('link', { name: /Continue to the finale/ });
    expect(link.getAttribute('href')).toBe('/finale/vibe-coder');
  });

  it("PathOverview's finale link uses the path id", async () => {
    await completed('ln-first-page');
    history.replaceState(null, '', '/path/learner');
    render(<App />);
    const link = await screen.findByRole('link', { name: /Go to the finale/ });
    expect(link.getAttribute('href')).toBe('/finale/learner');
  });
});
