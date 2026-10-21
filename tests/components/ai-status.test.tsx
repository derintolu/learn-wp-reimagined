// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
// A cap or rate limit that kicks in mid-session reaches the whole page (final review item 2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content') };
});
vi.mock('../../src/ai/client', () => ({
  getStatus: vi.fn(),
  placement: vi.fn(),
  judge: vi.fn(),
  codeFeedback: vi.fn(),
  tutorStream: vi.fn(),
}));

import { App } from '../../src/app';
import { getStatus, judge, placement, tutorStream } from '../../src/ai/client';
import { content } from '../../src/content';
import { setRecordManager } from '../../src/record/useRecord';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import { resetSaveWarning } from '../../src/components/RecordPanel';
import { CapNotice } from '../../src/components/CapNotice';
import { resetAiStatusForTests } from '../../src/ai/useAiStatus';
import { RecordManager, type RecordStore } from '../../src/record/store';
import { newRecord, type LearningRecord } from '../../src/shared/record';

const { AiFallbackError } = await vi.importActual<typeof import('../../src/ai/client')>('../../src/ai/client');
const status = vi.mocked(getStatus);
const stream = vi.mocked(tutorStream);
const SLOW = 'You are going a little fast. Please wait a few minutes and try again.';

function use(r: LearningRecord | null) {
  let saved = r;
  const store: RecordStore = {
    kind: 'indexeddb',
    load: async () => saved,
    save: async (x) => {
      saved = x;
    },
  };
  setRecordManager(new RecordManager(store, content));
}
function open(url: string) {
  history.replaceState(null, '', url);
  return render(<App />);
}
/** The tutor's message box under the lesson conversation. */
async function tutorPanel(): Promise<HTMLElement> {
  await screen.findByRole('log');
  return document.querySelector('.composer') as HTMLElement;
}
async function ask(text: string) {
  fireEvent.input(await screen.findByRole('textbox', { name: 'Message the tutor' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => {
  setPlaygroundImporter(() => Promise.reject(new Error('no Playground in tests')));
  status.mockResolvedValue({ ai: 'on' });
  stream.mockImplementation(async (req, onText) => onText(req.mode === 'ask' ? 'An answer.' : 'Beat text.'));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setRecordManager(null);
  setPlaygroundImporter(null);
  resetSaveWarning();
  resetAiStatusForTests();
});

describe('CapNotice copy', () => {
  it('distinguishes the daily cap, the monthly cap, a rate limit and AI off', () => {
    const day = render(<CapNotice status={{ ai: 'capped', reason: 'day-cap' }} />);
    expect(day.container.textContent).toContain('back after midnight UTC');
    expect(day.container.textContent).not.toContain('1st');
    cleanup();
    const month = render(<CapNotice status={{ ai: 'capped', reason: 'month-cap' }} />);
    expect(month.container.textContent).toContain("this month's AI budget");
    expect(month.container.textContent).toContain('back on the 1st of next month (UTC)');
    expect(month.container.textContent).not.toContain('midnight');
    cleanup();
    const slow = render(<CapNotice status={{ ai: 'capped', reason: 'rate-limited', message: 'Slow down, friend.' }} />);
    expect(slow.container.textContent).toContain('Slow down, friend.');
    cleanup();
    const off = render(<CapNotice status={{ ai: 'off', reason: 'not-configured' }} />);
    expect(off.container.textContent).toContain('switched off');
  });

  it('a monthly cap reported by /api/status at load shows the monthly copy', async () => {
    status.mockResolvedValue({ ai: 'capped', reason: 'month-cap' });
    use(null);
    open('/learn/theme-json-basics');
    const tutor = await tutorPanel();
    await waitFor(() => expect(tutor.textContent).toContain('back on the 1st of next month (UTC)'));
  });
});

describe('Mid-session cap (503) on a lesson', () => {
  it('a judge call that hits the daily cap turns the whole page to the cap notice', async () => {
    vi.mocked(judge).mockResolvedValue({ ok: false, fallback: true, reason: 'day-cap' });
    use({ ...newRecord(), current: { pathId: 'block-theme', lessonId: 'theme-json-basics', beatIndex: 1 } });
    open('/learn/theme-json-basics');
    const tutor = await tutorPanel();
    // AI on: the tutor can be asked.
    expect(await within(tutor).findByRole('button', { name: 'Send' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /checkpoint/i }));
    const cp = await screen.findByRole('region', { name: /Checkpoint/ });
    fireEvent.input(within(cp).getByLabelText('Your answer'), { target: { value: 'Presets and settings.' } });
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my answer' }));
    // The checkpoint falls back to the authored options, with the cap notice.
    await waitFor(() => expect(cp.textContent).toContain('back after midnight UTC'));
    expect(within(cp).getByRole('group', { name: 'Pick the closest answer' })).toBeTruthy();
    // The tutor panel, which never made a call itself, now says so too.
    await waitFor(() => expect(tutor.textContent).toContain('back after midnight UTC'));
    expect(within(tutor).queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('a tutor question that hits the monthly cap shows the monthly copy', async () => {
    use({ ...newRecord(), current: { pathId: 'block-theme', lessonId: 'theme-json-basics', beatIndex: 0 } });
    open('/learn/theme-json-basics');
    const tutor = await tutorPanel();
    stream.mockRejectedValue(new AiFallbackError('month-cap'));
    await ask('What is a preset?');
    await waitFor(() => expect(tutor.textContent).toContain('back on the 1st of next month (UTC)'));
  });
});

describe('Rate limited (429)', () => {
  it('on a lesson, the tutor shows the server’s friendly message', async () => {
    use({ ...newRecord(), current: { pathId: 'block-theme', lessonId: 'theme-json-basics', beatIndex: 0 } });
    open('/learn/theme-json-basics');
    const tutor = await tutorPanel();
    stream.mockRejectedValue(new AiFallbackError('rate-limited', SLOW));
    await ask('Why?');
    await waitFor(() => expect(tutor.querySelector('.cap-notice')?.textContent).toContain(SLOW));
  });

  it('in the placement chat, a 429 mid-chat swaps to the chooser with the server’s message', async () => {
    use(null);
    vi.mocked(placement).mockResolvedValue({ ok: false, fallback: true, reason: 'rate-limited', message: SLOW });
    open('/');
    fireEvent.input(await screen.findByLabelText('Your message'), { target: { value: 'I build sites' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.cap-notice')?.textContent).toContain(SLOW));
  });

  it('in the placement chat, a daily cap mid-chat shows the daily copy', async () => {
    use(null);
    vi.mocked(placement).mockResolvedValue({ ok: false, fallback: true, reason: 'day-cap' });
    open('/');
    fireEvent.input(await screen.findByLabelText('Your message'), { target: { value: 'I build sites' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(document.querySelector('.cap-notice')?.textContent).toContain('back after midnight UTC'));
  });
});
