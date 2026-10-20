// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';

vi.mock('../../src/record/fileTransfer', async (orig) => ({
  ...(await orig<typeof import('../../src/record/fileTransfer')>()),
  downloadRecord: vi.fn(),
}));
vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(async () => ({ ai: 'off' })), placement: vi.fn() }));

import { App } from '../../src/app';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { downloadRecord } from '../../src/record/fileTransfer';
import { setRecordManager } from '../../src/record/useRecord';
import type { RecordManager } from '../../src/record/store';
import { content } from '../../src/content';
import { memoryManager } from './helpers';

function Boom(): never {
  throw new Error('kaboom');
}

afterEach(() => {
  cleanup();
  setRecordManager(null);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders a friendly page with a "Download your record" escape for the current record', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = memoryManager(content);
    await m.init();
    setRecordManager(m);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Something broke');
    expect(screen.getByRole('link', { name: 'Back to the start' }).getAttribute('href')).toBe('/');
    fireEvent.click(screen.getByRole('button', { name: 'Download your record' }));
    expect(downloadRecord).toHaveBeenCalledWith(m.record);
  });

  it('the App shows the page instead of going blank when the record itself is broken', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      get record(): never {
        throw new Error('bad record');
      },
      subscribe: () => () => {},
      init: async () => {},
    } as unknown as RecordManager;
    setRecordManager(broken);
    history.replaceState(null, '', '/path/block-theme');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Something broke');
    // No usable record, so no download button that would throw again.
    expect(screen.queryByRole('button', { name: 'Download your record' })).toBeNull();
  });
});
