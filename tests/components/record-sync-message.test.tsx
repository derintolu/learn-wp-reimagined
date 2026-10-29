// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { content } from '../../src/content';
import { RecordPanel } from '../../src/components/RecordPanel';
import { setRecordManager } from '../../src/record/useRecord';
import { STATE_DEBOUNCE_MS, notifyFileEdited, startStateSync } from '../../src/record/stateSync';
import { STATE_MAX_BYTES } from '../../src/shared/stateDoc';
import { memoryManager } from './helpers';

vi.mock('../../src/record/session', async (orig) => ({ ...(await orig<object>()), ensureSession: async () => ({ homePage: 'h', name: 'n' }) }));
let stop = () => {};
beforeEach(() => {
});
afterEach(() => {
  stop();
  cleanup();
  setRecordManager(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('record panel sync message', () => {
  it('over 2 MB the studio shows "Your files are too big to sync. They\'re still saved in this browser."', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    const m = memoryManager(content);
    await m.init();
    setRecordManager(m);
    stop = startStateSync(m);
    render(
      <LocationProvider>
        <RecordPanel />
      </LocationProvider>,
    );
    await m.dispatch({ type: 'fileEdited', file: 'big.txt', content: 'x'.repeat(STATE_MAX_BYTES), lessonId: Object.keys(content.lessons)[0] });
    notifyFileEdited('big.txt');
    await vi.advanceTimersByTimeAsync(STATE_DEBOUNCE_MS);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: /record|saved|browser/i }));
    expect((await screen.findByText("Your files are too big to sync. They're still saved in this browser.")).getAttribute('role')).toBe('status');
  });
});
