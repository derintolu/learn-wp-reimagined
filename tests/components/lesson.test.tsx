// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { EditorView } from '@codemirror/view';

const wp = vi.hoisted(() => ({ pending: null as unknown, current: null as unknown }));
vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  const c = buildContent('tests/fixtures/content');
  // A third beat, so "resume at beat 3" has somewhere to land.
  c.lessons['theme-json-basics'].beats.push({
    id: 'layout',
    goal: 'Set a content width.',
    content: 'Layout widths live under `settings.layout`.',
  });
  return {
    get content() {
      return wp.current ?? c;
    },
    // The same shape as the real module: swap what is ready, never wait.
    adoptPending: vi.fn(() => {
      if (!wp.pending) return false;
      wp.current = wp.pending;
      wp.pending = null;
      return true;
    }),
    prefetchLatest: vi.fn(() => Promise.resolve()),
  };
});
vi.mock('../../src/ai/client', () => ({
  getStatus: vi.fn(),
  placement: vi.fn(),
  judge: vi.fn(),
  codeFeedback: vi.fn(),
  tutorStream: vi.fn(),
}));

import { App } from '../../src/app';
import { getStatus, judge, codeFeedback, tutorStream } from '../../src/ai/client';
import { content, prefetchLatest } from '../../src/content';
import type { ContentBundle } from '../../src/shared/types';
import { setRecordManager } from '../../src/record/useRecord';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import { resetSession } from '../../src/record/session';
import { resetSaveWarning, RESTORED_EVENT } from '../../src/components/RecordPanel';
import { RecordManager, type RecordStore } from '../../src/record/store';
import { applyEvent, newRecord, type LearningRecord } from '../../src/shared/record';
import { memoryManager } from './helpers';

const status = vi.mocked(getStatus);
const judgeMock = vi.mocked(judge);
const feedbackMock = vi.mocked(codeFeedback);
const stream = vi.mocked(tutorStream);

const BUG_LABEL = 'AI-written code. We planted one bug. Find it.';

/** A manager over a persistent-looking store that starts from the given record. */
function managerWith(r: LearningRecord | null, kind: RecordStore['kind'] = 'indexeddb'): RecordManager {
  let saved = r;
  const store: RecordStore = {
    kind,
    load: async () => saved,
    save: async (x) => {
      saved = x;
    },
  };
  return new RecordManager(store, content);
}

function recordAt(lessonId: string, beatIndex: number, extra: Partial<LearningRecord> = {}): LearningRecord {
  return {
    ...newRecord(),
    placement: { pathId: 'block-theme', startLessonId: 'theme-json-basics', skip: [], reason: 'Picked.' },
    current: { pathId: 'block-theme', lessonId, beatIndex },
    ...extra,
  };
}

let manager: RecordManager;
function use(m: RecordManager) {
  manager = m;
  vi.spyOn(manager, 'dispatch');
  setRecordManager(manager);
}
const dispatched = () => vi.mocked(manager.dispatch).mock.calls.map((c) => c[0]);

function open(url: string) {
  history.replaceState(null, '', url);
  return render(<App />);
}

async function editor(name: RegExp): Promise<EditorView> {
  const el = await screen.findByRole('textbox', { name });
  const view = EditorView.findFromDOM(el.closest('.cm-editor') as HTMLElement);
  if (!view) throw new Error('no editor view');
  return view;
}
async function typeInto(name: RegExp, text: string) {
  const view = await editor(name);
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}

beforeEach(() => {
  setPlaygroundImporter(() => Promise.reject(new Error('no Playground in tests')));
  status.mockResolvedValue({ ai: 'off' });
  stream.mockRejectedValue(new Error('not set'));
  feedbackMock.mockResolvedValue({ ok: false, fallback: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setRecordManager(null);
  setPlaygroundImporter(null);
  resetSaveWarning();
  vi.restoreAllMocks();
});

describe('Lesson page', () => {
  it('shows the lesson header with its sources and the review disclaimer', async () => {
    use(managerWith(null));
    open('/learn/theme-json-basics');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('theme.json basics');
    const source = screen.getByRole('link', { name: /Introduction to theme\.json/ });
    expect(source.getAttribute('href')).toBe('https://developer.wordpress.org/themes/global-settings-and-styles/');
    expect(document.body.textContent).toContain('Adapted from Learn WordPress, not reviewed by the Training Team');
  });

  it('resumes at beat 3 when the record says beatIndex 2', async () => {
    use(managerWith(recordAt('theme-json-basics', 2)));
    open('/learn/theme-json-basics');
    const current = await screen.findByRole('heading', { name: 'Set a content width.' });
    const beat = current.closest('[data-beat]') as HTMLElement;
    expect(beat.getAttribute('aria-current')).toBe('step');
    expect(within(beat).getByText('1.3')).toBeTruthy();
    const outline = screen.getByRole('navigation', { name: 'Course outline' });
    const sections = within(outline).getByRole('list', { name: 'Sections in this lesson' });
    expect(within(sections).getAllByRole('listitem')[2].getAttribute('aria-current')).toBe('step');
    // Earlier beats stay readable, but are not the current one.
    const first = screen.getByRole('heading', { name: /control centre/ }).closest('[data-beat]') as HTMLElement;
    expect(first.getAttribute('aria-current')).toBeNull();
    // Resuming does not record the beat again.
    expect(dispatched().filter((e) => e.type === 'beatViewed')).toHaveLength(0);
  });

  it('starts a fresh lesson at beat 1 and records it, then records each next beat', async () => {
    use(managerWith(null));
    open('/learn/theme-json-basics');
    await screen.findByRole('heading', { name: /control centre/ });
    await waitFor(() =>
      expect(dispatched()).toContainEqual({ type: 'beatViewed', lessonId: 'theme-json-basics', beatIndex: 0 }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    await screen.findByRole('heading', { name: 'Add a colour palette.' });
    await waitFor(() =>
      expect(dispatched()).toContainEqual({ type: 'beatViewed', lessonId: 'theme-json-basics', beatIndex: 1 }),
    );
  });

  it('with AI off, a beat shows the authored markdown, then its question', async () => {
    use(managerWith(null));
    open('/learn/theme-json-basics');
    await screen.findByRole('heading', { name: /control centre/ });
    const beat = screen.getByRole('heading', { name: /control centre/ }).closest('[data-beat]') as HTMLElement;
    await waitFor(() => expect(beat.querySelector('code')?.textContent).toBe('theme.json'));
    expect(beat.textContent).toContain('declares your palette, typography and layout in one file.');
    const q = within(screen.getByRole('log')).getByText('What would you put in theme.json instead of CSS?');
    expect(beat.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stream).not.toHaveBeenCalled();
  });

  it('with AI on, a beat still shows the authored text and the tutor waits to be asked', async () => {
    status.mockResolvedValue({ ai: 'on' });
    use(managerWith(null));
    open('/learn/theme-json-basics');
    const beat = (await screen.findByRole('heading', { name: /control centre/ })).closest('[data-beat]') as HTMLElement;
    expect(beat.textContent).toContain('declares your palette');
    await screen.findByRole('button', { name: 'Send' });
    expect(stream).not.toHaveBeenCalled();
  });
});

async function toCheckpoint() {
  const next = await screen.findByRole('button', { name: /checkpoint/i });
  fireEvent.click(next);
  return screen.findByRole('region', { name: /Checkpoint/ });
}

describe('AU session events', () => {
  const sent = () =>
    vi.mocked(fetch).mock.calls
      .filter((c) => c[0] === '/api/events')
      .flatMap((c) => JSON.parse((c[1] as RequestInit).body as string).events as { type: string; lessonId: string }[])
      .filter((e) => e.lessonId === 'templates-and-parts' && (e.type === 'lessonOpened' || e.type === 'lessonLeft'));
  beforeEach(() => {
    resetSession();
    // The session answers; the course server never does.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/api/session'
          ? Promise.resolve({ ok: true, json: async () => ({ actor: { homePage: 'https://learnwp.sqwrlz.com/', name: 'Learner' } }) })
          : new Promise(() => {}),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSession();
  });

  it('opening a lesson sends lessonOpened without awaiting it', async () => {
    use(managerWith(null));
    open('/learn/templates-and-parts');
    // The lesson shows although the server never answers.
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(sent()).toEqual([expect.objectContaining({ type: 'lessonOpened', lessonId: 'templates-and-parts' })]));
    // Let this test's own lessonLeft go out before the next test starts.
    cleanup();
    await waitFor(() => expect(sent()).toHaveLength(2));
  });

  it('changing lesson sends lessonLeft for the previous one', async () => {
    use(managerWith(null));
    open('/learn/templates-and-parts');
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(sent()).toHaveLength(1));
    cleanup();
    await waitFor(() =>
      expect(sent().map((e) => [e.type, e.lessonId])).toEqual([
        ['lessonOpened', 'templates-and-parts'],
        ['lessonLeft', 'templates-and-parts'],
      ]),
    );
  });
});

describe('Free-text checkpoint', () => {
  it('shows the branch moment for a judged answer, records it and continues to the branch', async () => {
    status.mockResolvedValue({ ai: 'on' });
    stream.mockImplementation(async (_r, onText) => onText('Beat text.'));
    judgeMock.mockResolvedValue({
      ok: true,
      data: { outcome: 'advance', to: 'templates-and-parts', message: 'Nice. On to templates.', feedback: 'You named presets. Spot on.', decisionId: 'dec-1' },
    });
    use(managerWith(recordAt('theme-json-basics', 2)));
    open('/learn/theme-json-basics');
    const cp = await toCheckpoint();
    fireEvent.input(within(cp).getByLabelText('Your answer'), { target: { value: 'It sets which controls and presets exist.' } });
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my answer' }));

    const moment = await screen.findByTestId('branch-moment');
    expect(moment.closest('[aria-live="polite"]')).toBeTruthy();
    expect(moment.getAttribute('data-outcome')).toBe('advance');
    expect(moment.textContent).toContain('Nice. On to templates.');
    expect(moment.textContent).toContain('You named presets. Spot on.');
    expect(judgeMock).toHaveBeenCalledWith('theme-json-basics', 'It sets which controls and presets exist.', expect.any(AbortSignal));
    await waitFor(() =>
      expect(dispatched()).toContainEqual({
        type: 'checkpointAnswered',
        lessonId: 'theme-json-basics',
        response: 'It sets which controls and presets exist.',
        outcome: 'advance',
        to: 'templates-and-parts',
        decisionId: 'dec-1',
      }),
    );
    await waitFor(() => expect(dispatched()).toContainEqual({ type: 'lessonCompleted', lessonId: 'theme-json-basics' }));

    fireEvent.click(within(moment).getByRole('link', { name: /Continue/ }));
    await waitFor(() => expect(location.pathname).toBe('/learn/templates-and-parts'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Templates and template parts' })).toBeTruthy();
  });

  it('records the answer and completes the lesson while the course server has not answered', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    try {
      status.mockResolvedValue({ ai: 'on' });
      stream.mockImplementation(async (_r, onText) => onText('Beat text.'));
      judgeMock.mockResolvedValue({
        ok: true,
        data: { outcome: 'advance', to: 'templates-and-parts', message: 'Nice.', feedback: 'Good.', decisionId: 'dec-2' },
      });
      use(managerWith(recordAt('theme-json-basics', 2)));
      open('/learn/theme-json-basics');
      const cp = await toCheckpoint();
      fireEvent.input(within(cp).getByLabelText('Your answer'), { target: { value: 'It sets which controls exist.' } });
      fireEvent.click(within(cp).getByRole('button', { name: 'Check my answer' }));
      await screen.findByTestId('branch-moment');
      await waitFor(() => expect(dispatched()).toContainEqual({ type: 'lessonCompleted', lessonId: 'theme-json-basics' }));
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the authored branch, not whatever "to" or message the response carries', async () => {
    status.mockResolvedValue({ ai: 'on' });
    stream.mockImplementation(async (_r, onText) => onText('Beat text.'));
    judgeMock.mockResolvedValue({
      ok: true,
      data: { outcome: 'skip', to: 'evil', message: 'Invented', feedback: 'ok' },
    });
    use(managerWith(recordAt('theme-json-basics', 2)));
    open('/learn/theme-json-basics');
    const cp = await toCheckpoint();
    fireEvent.input(within(cp).getByLabelText('Your answer'), { target: { value: 'x' } });
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my answer' }));
    const moment = await screen.findByTestId('branch-moment');
    expect(moment.textContent).toContain('Skipping ahead to templates.');
    expect(moment.textContent).not.toContain('Invented');
    expect(within(moment).getByRole('link', { name: /Continue/ }).getAttribute('href')).toBe('/learn/templates-and-parts');
  });

  it('shows the authored options when the judge falls back, and picking one follows the branch', async () => {
    status.mockResolvedValue({ ai: 'on' });
    stream.mockImplementation(async (_r, onText) => onText('Beat text.'));
    judgeMock.mockResolvedValue({ ok: false, fallback: true });
    use(managerWith(recordAt('theme-json-basics', 2)));
    open('/learn/theme-json-basics');
    const cp = await toCheckpoint();
    fireEvent.input(within(cp).getByLabelText('Your answer'), { target: { value: 'No idea really' } });
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my answer' }));

    const pick = await within(cp).findByRole('button', { name: "I'm not sure yet" });
    expect(within(cp).getByRole('button', { name: 'Settings control editor options and presets' })).toBeTruthy();
    fireEvent.click(pick);
    const moment = await screen.findByTestId('branch-moment');
    expect(moment.getAttribute('data-outcome')).toBe('review');
    expect(moment.textContent).toContain("Let's look at settings once more.");
    await waitFor(() =>
      expect(dispatched()).toContainEqual({
        type: 'checkpointAnswered',
        lessonId: 'theme-json-basics',
        response: "I'm not sure yet",
        outcome: 'review',
        to: 'theme-json-basics',
      }),
    );
    expect(dispatched().some((e) => e.type === 'lessonCompleted')).toBe(false);
  });

  it('with AI off, goes straight to the authored options', async () => {
    use(managerWith(recordAt('theme-json-basics', 2)));
    open('/learn/theme-json-basics');
    const cp = await toCheckpoint();
    expect(await within(cp).findByRole('button', { name: 'Settings control editor options and presets' })).toBeTruthy();
    expect(within(cp).queryByLabelText('Your answer')).toBeNull();
    fireEvent.click(within(cp).getByRole('button', { name: 'Settings control editor options and presets' }));
    const moment = await screen.findByTestId('branch-moment');
    expect(moment.getAttribute('data-outcome')).toBe('advance');
    expect(judgeMock).not.toHaveBeenCalled();
  });
});

describe('Code checkpoint', () => {
  it('passes or fails on the checks alone, with AI feedback alongside', async () => {
    status.mockResolvedValue({ ai: 'on' });
    stream.mockImplementation(async (_r, onText) => onText('Beat text.'));
    // The AI claims success; it must not matter.
    feedbackMock.mockResolvedValue({ ok: true, data: { feedback: 'Looks great to me!' } });
    use(managerWith(recordAt('templates-and-parts', 1)));
    open('/learn/templates-and-parts');
    const cp = await toCheckpoint();
    // The editor is in the workspace, not the card.
    expect(within(cp).queryByRole('textbox')).toBeNull();
    expect(await screen.findByRole('textbox', { name: /theme\.json/ })).toBeTruthy();

    fireEvent.click(within(cp).getByRole('button', { name: 'Check my code' }));
    expect(await within(cp).findByText('Add a colour with a slug.')).toBeTruthy();
    expect(screen.queryByTestId('branch-moment')).toBeNull();
    await waitFor(() =>
      expect(dispatched()).toContainEqual(expect.objectContaining({ type: 'codeChecked', lessonId: 'templates-and-parts', file: 'theme.json', passed: false })),
    );
    await waitFor(() =>
      expect(feedbackMock).toHaveBeenCalledWith(
        expect.objectContaining({ lessonId: 'templates-and-parts', file: 'theme.json', passed: false, failedMessages: ['Set version to 3.', 'Add a colour with a slug.'] }),
        expect.any(AbortSignal),
      ),
    );
    expect(await within(cp).findByText('Looks great to me!')).toBeTruthy();

    await typeInto(/theme\.json/, '{ "version": 3, "settings": { "color": { "palette": [ { "slug": "brand", "color": "#3858E9", "name": "Brand" } ] } } }');
    await waitFor(() => expect(dispatched().some((e) => e.type === 'fileEdited' && e.file === 'theme.json' && e.lessonId === 'templates-and-parts')).toBe(true), {
      timeout: 2000,
    });
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my code' }));
    const moment = await screen.findByTestId('branch-moment');
    expect(moment.getAttribute('data-outcome')).toBe('advance');
    expect(moment.textContent).toContain('Your theme.json looks right.');
    await waitFor(() =>
      expect(dispatched()).toContainEqual(
        expect.objectContaining({
          type: 'checkpointAnswered',
          lessonId: 'templates-and-parts',
          response: 'code checks passed',
          outcome: 'advance',
          to: 'patterns',
          files: expect.objectContaining({ 'theme.json': expect.any(String) }),
        }),
      ),
    );
    expect(dispatched()).toContainEqual(expect.objectContaining({ type: 'codeChecked', lessonId: 'templates-and-parts', file: 'theme.json', passed: true }));
  });

  it('after two failed checks offers only "Keep trying" and the review branch, never a pass (R21)', async () => {
    use(managerWith(recordAt('templates-and-parts', 1)));
    open('/learn/templates-and-parts');
    const cp = await toCheckpoint();
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my code' }));
    await within(cp).findByText('Add a colour with a slug.');
    expect(within(cp).queryByRole('button', { name: 'Keep trying' })).toBeNull();
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my code' }));
    expect(await within(cp).findByRole('button', { name: 'Keep trying' })).toBeTruthy();
    expect(within(cp).getByRole('button', { name: /Review/ })).toBeTruthy();
    // The authored "skip" and "show me" options would record a pass the checks never gave.
    expect(within(cp).queryByRole('button', { name: 'Skip this one' })).toBeNull();
    expect(within(cp).queryByRole('button', { name: 'Show me the answer' })).toBeNull();

    fireEvent.click(within(cp).getByRole('button', { name: 'Keep trying' }));
    await waitFor(() => expect(within(cp).queryByRole('button', { name: 'Keep trying' })).toBeNull());
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my code' }));
    fireEvent.click(await within(cp).findByRole('button', { name: /Review/ }));
    const moment = await screen.findByTestId('branch-moment');
    expect(moment.getAttribute('data-outcome')).toBe('review');
    await waitFor(() =>
      expect(dispatched()).toContainEqual(
        expect.objectContaining({ type: 'checkpointAnswered', outcome: 'review', to: 'theme-json-basics' }),
      ),
    );
    const events = dispatched();
    expect(events.some((e) => e.type === 'codeChecked' && e.passed)).toBe(false);
    expect(events.some((e) => e.type === 'checkpointAnswered' && e.outcome !== 'review')).toBe(false);
    expect(events.some((e) => e.type === 'lessonCompleted')).toBe(false);
    expect(feedbackMock).not.toHaveBeenCalled(); // AI was off
  });
});

describe('Catch the bug', () => {
  it('shows the exact label and passes only when the fix checks pass', async () => {
    use(managerWith(recordAt('patterns', 0)));
    open('/learn/patterns');
    const next = await screen.findByRole('button', { name: /bug/i });
    fireEvent.click(next);
    const box = await screen.findByRole('region', { name: /Catch the bug/ });
    expect(box.textContent).toContain(BUG_LABEL);
    expect((await editor(/hero\.php/)).state.doc.toString()).toContain('Slug: hero');

    fireEvent.click(within(box).getByRole('button', { name: 'Check my fix' }));
    expect(await within(box).findByText('Not yet. The bug is still in there.')).toBeTruthy();
    expect(dispatched()).toContainEqual(expect.objectContaining({ type: 'codeChecked', lessonId: 'patterns', file: 'patterns/hero.php', passed: false }));
    expect(dispatched().some((e) => e.type === 'lessonCompleted')).toBe(false);

    await typeInto(/hero\.php/, '<?php\n/**\n * Title: Hero\n * Slug: mytheme/hero\n */\n?>\n');
    fireEvent.click(within(box).getByRole('button', { name: 'Check my fix' }));
    expect(await within(box).findByText(/You caught it/)).toBeTruthy();
    expect(box.textContent).toContain('Pattern slugs must be namespaced');
    await waitFor(() => expect(dispatched()).toContainEqual({ type: 'lessonCompleted', lessonId: 'patterns' }));
    await waitFor(() =>
      expect(dispatched()).toContainEqual({ type: 'fileEdited', file: 'patterns/hero.php', content: expect.stringContaining('mytheme/hero'), lessonId: 'patterns' }),
    );
    // patterns is the last lesson of the path
    expect(screen.getByRole('link', { name: /Continue to the finale/ }).getAttribute('href')).toBe('/finale/block-theme');
  });
});

describe('Catch the bug with AI on', () => {
  it('asks for an AI note only once the bug is fixed, never on a miss', async () => {
    status.mockResolvedValue({ ai: 'on' });
    stream.mockImplementation(async (_req, onText) => onText('Beat text.'));
    feedbackMock.mockResolvedValue({ ok: true, data: { feedback: 'Nice catch.' } });
    use(managerWith(recordAt('patterns', 0)));
    open('/learn/patterns');
    fireEvent.click(await screen.findByRole('button', { name: /bug/i }));
    const box = await screen.findByRole('region', { name: /Catch the bug/ });
    fireEvent.click(within(box).getByRole('button', { name: 'Check my fix' }));
    expect(await within(box).findByText('Not yet. The bug is still in there.')).toBeTruthy();
    expect(feedbackMock).not.toHaveBeenCalled();

    await typeInto(/hero\.php/, '<?php\n/**\n * Title: Hero\n * Slug: mytheme/hero\n */\n?>\n');
    fireEvent.click(within(box).getByRole('button', { name: 'Check my fix' }));
    expect(await within(box).findByText('Nice catch.')).toBeTruthy();
    expect(feedbackMock).toHaveBeenCalledTimes(1);
    expect(feedbackMock.mock.calls[0][0]).toMatchObject({ lessonId: 'patterns', file: 'patterns/hero.php', passed: true });
  });
});

async function ask(text: string) {
  const box = await screen.findByRole('textbox', { name: 'Message the tutor' });
  fireEvent.input(box, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('Tutor', () => {
  it('answers questions in ask mode, grounded in the current beat', async () => {
    status.mockResolvedValue({ ai: 'on' });
    stream.mockImplementation(async (_req, onText) => onText('Presets are reusable values.'));
    use(managerWith(recordAt('theme-json-basics', 1)));
    open('/learn/theme-json-basics');
    await ask('What is a preset?');
    expect(await within(screen.getByRole('log')).findByText('Presets are reusable values.')).toBeTruthy();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toEqual({
      lessonId: 'theme-json-basics',
      beatIndex: 1,
      mode: 'ask',
      messages: [{ role: 'user', content: 'What is a preset?' }],
    });
  });

  it('says the tutor is unavailable when AI is off, and the lesson still works', async () => {
    use(managerWith(null));
    open('/learn/theme-json-basics');
    await screen.findByRole('log');
    const composer = document.querySelector('.composer') as HTMLElement;
    await waitFor(() => expect(composer.querySelector('[role="status"]')?.textContent).toContain('switched off'));
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    expect(await screen.findByRole('heading', { name: 'Add a colour palette.' })).toBeTruthy();
  });
});

describe('Path overview', () => {
  it('lists the lessons and continues where the learner left off', async () => {
    use(managerWith(recordAt('templates-and-parts', 0, { completedLessons: ['theme-json-basics'] })));
    open('/path/block-theme');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toContain('Block theme developer');
    const list = screen.getByRole('list', { name: /Lessons/ });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Done')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Continue/ }).getAttribute('href')).toBe('/learn/templates-and-parts'),
    );
  });

  it('starts at the first lesson that is not skipped', async () => {
    use(
      managerWith({
        ...newRecord(),
        placement: { pathId: 'block-theme', startLessonId: 'templates-and-parts', skip: ['theme-json-basics'], reason: 'r' },
      }),
    );
    open('/path/block-theme');
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getByText('Skipped')).toBeTruthy());
  });
});

describe('Record panel', () => {
  async function openPanel() {
    fireEvent.click(await screen.findByRole('button', { name: /Your record/ }));
    return screen.findByRole('dialog', { name: /Your record/ });
  }

  it('warns when progress is not being saved, visibly, without opening the menu', async () => {
    use(memoryManager(content));
    const url = vi.fn(() => 'blob:x');
    URL.createObjectURL = url as never;
    URL.revokeObjectURL = vi.fn();
    // happy-dom would really navigate to blob:x and break the next test's URL.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    open('/learn/theme-json-basics');
    const button = await screen.findByRole('button', { name: /Your record/ });
    expect(button.textContent).toContain('Not saved');
    const banner = await screen.findByText("Your progress isn't being saved. Download it to keep it.");
    expect(screen.queryByRole('dialog')).toBeNull();
    const box = banner.closest('.save-warning') as HTMLElement;
    fireEvent.click(within(box).getByRole('button', { name: 'Download record' }));
    expect(url).toHaveBeenCalled();
    fireEvent.click(within(box).getByRole('button', { name: 'Dismiss this warning' }));
    await waitFor(() => expect(screen.queryByText("Your progress isn't being saved. Download it to keep it.")).toBeNull());
    // The menu still says so.
    const panel = await openPanel();
    expect(panel.textContent).toContain('Not saved');
    expect(panel.textContent).toContain("This browser can't keep a working copy.");
    expect(document.activeElement).toBe(panel);
  });

  it('flags a stored-record notice on the header button and the lesson page', async () => {
    const m = managerWith(recordAt('theme-json-basics', 0));
    use(m);
    await m.init();
    m.notice = { kind: 'newer-version', message: 'Your saved record was made by a newer version, so we started fresh.' };
    open('/learn/theme-json-basics');
    expect((await screen.findByRole('button', { name: /Your record/ })).textContent).toContain('Check your record');
    expect(await screen.findByText('Your saved record was made by a newer version, so we started fresh.')).toBeTruthy();
  });

  it('shows the browser save state and a stored-record notice', async () => {
    const m = managerWith(null);
    use(m);
    open('/');
    await act(() => m.init());
    m.notice = { kind: 'recovered-corrupt', message: 'Your saved record was damaged, so we kept a copy aside.' };
    const panel = await openPanel();
    expect(panel.textContent).toContain('Working copy in this browser');
    expect(panel.textContent).toContain('Your saved record was damaged, so we kept a copy aside.');
  });

  it('asks before a restore overwrites progress, and rejects a bad file', async () => {
    const m = managerWith(recordAt('templates-and-parts', 1));
    use(m);
    vi.spyOn(m, 'restore');
    open('/');
    const panel = await openPanel();
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement;

    const bad = new File(['{"format":"nope"}'], 'x.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [bad] } });
    expect(await within(panel).findByText(/not a Learn WordPress, reimagined record/)).toBeTruthy();
    expect(m.restore).not.toHaveBeenCalled();

    const good = recordAt('patterns', 0, { completedLessons: ['theme-json-basics', 'templates-and-parts'] });
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(good)], 'r.json')] } });
    const yes = await within(panel).findByRole('button', { name: 'Replace my progress' });
    expect(m.restore).not.toHaveBeenCalled();
    fireEvent.click(yes);
    await waitFor(() => expect(m.restore).toHaveBeenCalledWith(expect.objectContaining({ learnerId: good.learnerId })));
    expect(await within(panel).findByText(/Restored/)).toBeTruthy();
  });

  it('restoring on a lesson page takes the learner to the restored place without moving it', async () => {
    const m = managerWith(recordAt('theme-json-basics', 1));
    use(m);
    open('/learn/theme-json-basics');
    await screen.findByRole('heading', { name: 'Add a colour palette.' });
    const panel = await openPanel();
    const good = recordAt('templates-and-parts', 1, { completedLessons: ['theme-json-basics'] });
    fireEvent.change(panel.querySelector('input[type="file"]')!, { target: { files: [new File([JSON.stringify(good)], 'r.json')] } });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Replace my progress' }));
    await waitFor(() => expect(location.pathname).toBe('/learn/templates-and-parts'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Templates and template parts' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Reuse a header as a template part.' })).toBeTruthy();
    expect(m.record.current).toEqual({ pathId: 'block-theme', lessonId: 'templates-and-parts', beatIndex: 1 });
  });

  it('describes the folder result in plain words, and only offers folders where supported', async () => {
    const m = managerWith(recordAt('templates-and-parts', 1));
    use(m);
    open('/');
    let panel = await openPanel();
    expect(within(panel).queryByRole('button', { name: 'Save to a folder' })).toBeNull();
    cleanup();

    const dir = {} as FileSystemDirectoryHandle;
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dir));
    vi.spyOn(m, 'attachFolder').mockResolvedValue('kept-current-with-backup');
    open('/');
    panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Save to a folder' }));
    expect(
      await within(panel).findByText("Kept this browser's newer progress and saved a backup in the folder"),
    ).toBeTruthy();
    expect(m.attachFolder).toHaveBeenCalledWith(dir);
    vi.unstubAllGlobals();
  });

  it('downloads the record', async () => {
    use(managerWith(recordAt('templates-and-parts', 1)));
    const url = vi.fn(() => 'blob:x');
    URL.createObjectURL = url as never;
    URL.revokeObjectURL = vi.fn();
    // happy-dom would really navigate to blob:x and break the next test's URL.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    open('/');
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Download record' }));
    expect(url).toHaveBeenCalled();
  });
});

describe('Fix round 1', () => {
  it('a completed lesson is read-only: it shows the past outcome and records nothing new (R22)', async () => {
    let r = recordAt('theme-json-basics', 2);
    r = applyEvent(r, { type: 'checkpointAnswered', lessonId: 'theme-json-basics', response: 'x', outcome: 'skip', to: 'templates-and-parts' }, content);
    r = applyEvent(r, { type: 'lessonCompleted', lessonId: 'theme-json-basics' }, content);
    use(managerWith(r));
    open('/learn/theme-json-basics');
    const summary = await screen.findByTestId('completed-summary');
    expect(summary.textContent).toContain('You answered this: Skip ahead');
    expect(summary.textContent).toContain('Skipping ahead to templates.');
    expect(within(summary).getByRole('link', { name: /Continue/ }).getAttribute('href')).toBe('/learn/templates-and-parts');
    expect(screen.queryByRole('region', { name: /Checkpoint/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check my answer' })).toBeNull();
    await new Promise((res) => setTimeout(res, 50));
    expect(dispatched().filter((e) => e.type !== 'beatViewed')).toEqual([]);
  });

  it('a completed bug lesson does not offer the bug hunt again (R22)', async () => {
    let r = recordAt('patterns', 0);
    r = applyEvent(r, { type: 'lessonCompleted', lessonId: 'patterns' }, content);
    use(managerWith(r));
    open('/learn/patterns');
    const summary = await screen.findByTestId('completed-summary');
    expect(summary.textContent).toContain('You caught the planted bug.');
    expect(screen.queryByRole('region', { name: /Catch the bug/ })).toBeNull();
    expect(within(summary).getByRole('link', { name: /Continue/ }).getAttribute('href')).toBe('/finale/block-theme');
    expect(dispatched()).toEqual([]);
  });

  it('a double click on Next records the next beat once', async () => {
    use(managerWith(recordAt('theme-json-basics', 0)));
    open('/learn/theme-json-basics');
    const next = await screen.findByRole('button', { name: /^Next/ });
    fireEvent.click(next);
    fireEvent.click(next);
    await screen.findByRole('heading', { name: 'Add a colour palette.' });
    await new Promise((res) => setTimeout(res, 20));
    const viewed = dispatched().filter((e) => e.type === 'beatViewed');
    expect(viewed).toEqual([{ type: 'beatViewed', lessonId: 'theme-json-basics', beatIndex: 1 }]);
  });

  it('pressing Next mid-reply does not abort it; the reply lands on the earlier beat when it arrives (R28)', async () => {
    status.mockResolvedValue({ ai: 'on' });
    const signals: AbortSignal[] = [];
    let finish!: () => void;
    stream.mockImplementation(
      (_req, onText, signal) =>
        new Promise<void>((res, rej) => {
          signals.push(signal!);
          signal!.addEventListener('abort', () => rej(new Error('aborted')));
          finish = () => {
            onText('Presets, mostly.');
            res();
          };
        }),
    );
    use(managerWith(recordAt('theme-json-basics', 0)));
    open('/learn/theme-json-basics');
    await ask('Colours?');
    await waitFor(() => expect(signals).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    const second = (await screen.findByRole('heading', { name: 'Add a colour palette.' })).closest('[data-beat]') as HTMLElement;
    await new Promise((r) => setTimeout(r, 20));
    expect(signals[0].aborted).toBe(false);
    act(() => finish());
    const reply = await screen.findByText('Presets, mostly.');
    expect(reply.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaving the lesson aborts an in-flight tutor reply (R28)', async () => {
    status.mockResolvedValue({ ai: 'on' });
    const signals: AbortSignal[] = [];
    stream.mockImplementation(
      (_req, _onText, signal) =>
        new Promise<void>((_res, rej) => {
          signals.push(signal!);
          signal!.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    use(managerWith(recordAt('theme-json-basics', 0)));
    const { unmount } = open('/learn/theme-json-basics');
    await ask('Colours?');
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    await waitFor(() => expect(signals[0].aborted).toBe(true));
  });

  it('a stalled tutor reply (tutorStream timeout) shows the failure copy and the lesson carries on (R28)', async () => {
    status.mockResolvedValue({ ai: 'on' });
    const { AiFallbackError } = await vi.importActual<typeof import('../../src/ai/client')>('../../src/ai/client');
    stream.mockRejectedValue(new AiFallbackError('timeout'));
    use(managerWith(recordAt('theme-json-basics', 0)));
    open('/learn/theme-json-basics');
    await ask('Colours?');
    expect(await screen.findByText(/I couldn't answer that just now\. Try again in a moment, or check the sources under each section\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    expect(await screen.findByRole('heading', { name: 'Add a colour palette.' })).toBeTruthy();
  });

  it('unmounting aborts a pending judge call', async () => {
    status.mockResolvedValue({ ai: 'on' });
    stream.mockImplementation(async (_r, onText) => onText('Beat.'));
    let seen: AbortSignal | undefined;
    judgeMock.mockImplementation((_l, _a, signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    use(managerWith(recordAt('theme-json-basics', 2)));
    const { unmount } = open('/learn/theme-json-basics');
    const cp = await toCheckpoint();
    fireEvent.input(within(cp).getByLabelText('Your answer'), { target: { value: 'An answer' } });
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my answer' }));
    await waitFor(() => expect(seen).toBeInstanceOf(AbortSignal));
    unmount();
    await waitFor(() => expect(seen!.aborted).toBe(true));
  });
});

describe('Course updates from WordPress', () => {
  /** The current bundle with one lesson retitled, as if WordPress had a newer version. */
  const retitled = (id: string, title: string): ContentBundle => {
    const c = content as ContentBundle;
    return { ...c, lessons: { ...c.lessons, [id]: { ...c.lessons[id], title } } };
  };
  const go = (url: string) => {
    act(() => {
      history.pushState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  };
  beforeEach(() => {
    wp.pending = null;
    wp.current = null;
  });
  afterEach(() => {
    wp.pending = null;
    wp.current = null;
  });

  it('a newer bundle never replaces content mid-lesson', async () => {
    use(managerWith(null));
    open('/learn/theme-json-basics');
    await screen.findByRole('heading', { level: 1, name: 'theme.json basics' });
    wp.pending = retitled('theme-json-basics', 'Changed upstream');
    // A restart remounts the lesson on the same id: still the same lesson open.
    act(() => {
      window.dispatchEvent(new Event(RESTORED_EVENT));
    });
    await screen.findByRole('heading', { level: 1, name: 'theme.json basics' });
    expect(screen.queryByText('Changed upstream')).toBeNull();
  });

  it('it is adopted at the next lesson open', async () => {
    use(managerWith(null));
    const setContent = vi.spyOn(manager, 'setContent');
    open('/learn/theme-json-basics');
    await screen.findByRole('heading', { level: 1, name: 'theme.json basics' });
    wp.pending = retitled('templates-and-parts', 'Templates, updated');
    go('/learn/templates-and-parts');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Templates, updated');
    // The manager that records progress now knows the adopted bundle.
    expect(setContent).toHaveBeenCalledWith(wp.current);
  });

  it('lesson open does not await the network when nothing is pending', async () => {
    use(managerWith(null));
    // The background check never answers; opening must not wait for it.
    vi.mocked(prefetchLatest).mockReturnValue(new Promise(() => {}));
    open('/learn/theme-json-basics');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('theme.json basics');
    expect(vi.mocked(prefetchLatest)).toHaveBeenCalled();
  });

});
