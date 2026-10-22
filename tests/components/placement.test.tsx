// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content') };
});
vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(), placement: vi.fn() }));

import { App } from '../../src/app';
import { PathCards } from '../../src/components/PathCards';
import { tidy } from '../../src/components/PlacementChat';
import { getStatus, placement } from '../../src/ai/client';
import { content } from '../../src/content';
import { setRecordManager } from '../../src/record/useRecord';
import { setPlaygroundImporter } from '../../src/studio/previewClient';
import type { RecordManager } from '../../src/record/store';
import { LocationProvider } from 'preact-iso';
import { memoryManager } from './helpers';

const status = vi.mocked(getStatus);
const place = vi.mocked(placement);

const PLACED = {
  pathId: 'block-theme' as const,
  startLessonId: 'templates-and-parts',
  skip: ['theme-json-basics'],
  reason: "You already style sites with CSS, so we'll skip theme.json basics and start with templates.",
};

let manager: RecordManager;

beforeEach(() => {
  setPlaygroundImporter(() => Promise.reject(new Error('no Playground in tests')));
  history.replaceState(null, '', '/');
  manager = memoryManager(content);
  vi.spyOn(manager, 'dispatch');
  setRecordManager(manager);
  status.mockResolvedValue({ ai: 'on' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setRecordManager(null);
  setPlaygroundImporter(null);
});

const input = () => screen.getByLabelText('Your message') as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
/** Waits for the chat to be ready (status known), then types and clicks Send. */
async function send(text: string) {
  await screen.findByLabelText('Your message');
  fireEvent.input(input(), { target: { value: text } });
  fireEvent.click(sendButton());
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
type PlaceResult = Awaited<ReturnType<typeof placement>>;

describe('PlacementChat (AI on)', () => {
  it('has a labelled input with the authored placeholder and a polite chat log', async () => {
    render(<App />);
    await screen.findByLabelText('Your message');
    expect(input().getAttribute('placeholder')).toBe("Not sure where to start? Tell me what you're building.");
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the learner bubble and then the tutor reply', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Lovely. Have you edited theme files before?' } });
    render(<App />);
    await send('A portfolio for my pottery. I know a little CSS.');
    const log = screen.getByRole('log');
    expect(log.querySelector('.bubble--learner')?.textContent).toContain('A portfolio for my pottery.');
    await screen.findByText('Lovely. Have you edited theme files before?');
    expect(place).toHaveBeenCalledWith([{ role: 'user', content: 'A portfolio for my pottery. I know a little CSS.' }]);
  });

  it('shows a thinking indicator and disables Send while waiting, even with a new draft', async () => {
    const d = deferred<PlaceResult>();
    place.mockReturnValue(d.promise);
    render(<App />);
    await send('Hello');
    expect(screen.getByText(/thinking/i)).toBeTruthy();
    fireEvent.input(input(), { target: { value: 'A second message' } });
    expect(input().value).toBe('A second message');
    expect(sendButton().disabled).toBe(true);
    d.resolve({ ok: true, data: { reply: 'Hi there.' } });
    await screen.findByText('Hi there.');
    expect(screen.queryByText(/thinking/i)).toBeNull();
    expect(sendButton().disabled).toBe(false);
  });

  it('sends only once when Enter is pressed again while a request is in flight', async () => {
    const d = deferred<PlaceResult>();
    place.mockReturnValue(d.promise);
    render(<App />);
    await screen.findByLabelText('Your message');
    fireEvent.input(input(), { target: { value: 'one' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.input(input(), { target: { value: 'two' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(place).toHaveBeenCalledTimes(1);
    d.resolve({ ok: true, data: { reply: 'ok' } });
    await screen.findByText('ok');
    expect(place).toHaveBeenCalledTimes(1);
  });

  it('ignores a reply that arrives after the chat has unmounted', async () => {
    const d = deferred<PlaceResult>();
    place.mockReturnValue(d.promise);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<App />);
    await send('Hello');
    unmount();
    d.resolve({ ok: true, data: { reply: 'Too late.', placement: PLACED } });
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/');
    errors.mockRestore();
  });

  it('returns focus to the message box after sending from the Send button', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Noted.' } });
    render(<App />);
    await screen.findByLabelText('Your message');
    fireEvent.input(input(), { target: { value: 'Hello' } });
    sendButton().focus();
    fireEvent.click(sendButton());
    await screen.findByText('Noted.');
    expect(document.activeElement).toBe(input());
  });

  it('ignores a late reply once the learner has skipped to the chooser', async () => {
    const d = deferred<PlaceResult>();
    place.mockReturnValue(d.promise);
    render(<App />);
    await send('Hello');
    fireEvent.click(screen.getByRole('button', { name: 'Skip the chat and choose a path' }));
    d.resolve({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /your path/i })).toBeNull();
  });

  it('caps a message at 600 characters with a visible counter', async () => {
    render(<App />);
    await screen.findByLabelText('Your message');
    expect(input().maxLength).toBe(600);
    fireEvent.input(input(), { target: { value: 'x'.repeat(42) } });
    expect(screen.getByText('42 / 600')).toBeTruthy();
  });

  it('sends earlier tutor replies back no longer than 600 characters', async () => {
    place.mockResolvedValueOnce({ ok: true, data: { reply: 'y'.repeat(800) } });
    place.mockResolvedValueOnce({ ok: true, data: { reply: 'ok' } });
    render(<App />);
    await send('one');
    await waitFor(() => expect(place).toHaveBeenCalledTimes(1));
    await screen.findByText('y'.repeat(800));
    await send('two');
    await waitFor(() => expect(place).toHaveBeenCalledTimes(2));
    const sent = place.mock.calls[1][0];
    expect(sent).toHaveLength(3);
    expect(sent.every((m) => m.content.length <= 600)).toBe(true);
  });

  it('shows a placement card with the path, the reason, the skipped lessons and both choices', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    render(<App />);
    await send('I build sites with CSS');
    const card = await screen.findByRole('region', { name: /your path/i });
    const c = within(card);
    expect(c.getByText('Block theme developer')).toBeTruthy();
    expect(card.textContent).toContain(PLACED.reason);
    expect(card.textContent).toContain('theme.json basics');
    expect(card.textContent).toContain('Templates and template parts');
    expect(c.getByRole('button', { name: 'Start here' })).toBeTruthy();
    expect(c.getByRole('button', { name: 'Choose a different path' })).toBeTruthy();
    expect(screen.queryByLabelText('Your message')).toBeNull();
  });

  it('accepting dispatches placed and navigates to the start lesson', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    render(<App />);
    await send('I build sites with CSS');
    fireEvent.click(await screen.findByRole('button', { name: 'Start here' }));
    await waitFor(() => expect(manager.dispatch).toHaveBeenCalledWith({ type: 'placed', placement: PLACED }));
    await waitFor(() => expect(location.pathname).toBe('/learn/templates-and-parts'));
    expect(manager.record.placement).toEqual(PLACED);
    expect(await screen.findByRole('heading', { level: 1, name: 'Templates and template parts' })).toBeTruthy();
  });

  it('a double click on "Start here" dispatches placed only once', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    render(<App />);
    await send('I build sites with CSS');
    const start = await screen.findByRole('button', { name: 'Start here' });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(location.pathname).toBe('/learn/templates-and-parts'));
    expect(manager.dispatch).toHaveBeenCalledTimes(1);
  });

  it('navigates anyway when saving the placement takes longer than 3 seconds', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    vi.mocked(manager.dispatch).mockReturnValue(new Promise(() => {}));
    render(<App />);
    await send('I build sites with CSS');
    const start = await screen.findByRole('button', { name: 'Start here' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(start);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2900);
      });
      expect(location.pathname).toBe('/');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(location.pathname).toBe('/learn/templates-and-parts');
    } finally {
      vi.useRealTimers();
    }
  });

  it('navigates anyway when saving the placement fails', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    vi.mocked(manager.dispatch).mockRejectedValue(new Error('disk full'));
    render(<App />);
    await send('I build sites with CSS');
    fireEvent.click(await screen.findByRole('button', { name: 'Start here' }));
    await waitFor(() => expect(location.pathname).toBe('/learn/templates-and-parts'));
  });

  it('does not navigate if the chat unmounts while the placement is saving', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    const d = deferred<void>();
    vi.mocked(manager.dispatch).mockReturnValue(d.promise);
    const { unmount } = render(<App />);
    await send('I build sites with CSS');
    fireEvent.click(await screen.findByRole('button', { name: 'Start here' }));
    unmount();
    d.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(location.pathname).toBe('/');
  });

  it('"Choose a different path" swaps the card for the path chooser', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    render(<App />);
    await send('I build sites with CSS');
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a different path' }));
    expect(screen.getByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(manager.dispatch).not.toHaveBeenCalled();
  });

  it('falls back to the chooser after a fallback response', async () => {
    place.mockResolvedValue({ ok: false, fallback: true });
    render(<App />);
    await send('Hello');
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(screen.queryByLabelText('Your message')).toBeNull();
  });

  it('treats a 200 response without a reply as a fallback', async () => {
    place.mockResolvedValue({ ok: true, data: {} as never });
    render(<App />);
    await send('Hello');
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
  });

  it('offers the chooser after four learner turns without a placement', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Tell me more.' } });
    render(<App />);
    for (let i = 1; i <= 4; i++) {
      await send(`turn ${i}`);
      await waitFor(() => expect(place).toHaveBeenCalledTimes(i));
      await waitFor(() => expect(screen.getAllByText('Tell me more.')).toHaveLength(i));
    }
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(screen.queryByLabelText('Your message')).toBeNull();
  });
});

describe('PlacementChat (status not known yet)', () => {
  it('shows a loading state, not the greeting and input, until the status arrives', async () => {
    const d = deferred<{ ai: 'on' | 'capped' | 'off' }>();
    status.mockReturnValue(d.promise);
    render(<App />);
    expect(screen.queryByLabelText('Your message')).toBeNull();
    expect(screen.queryByText(/I'm your tutor/)).toBeNull();
    expect(screen.getByText(/Connecting to the tutor/)).toBeTruthy();
    d.resolve({ ai: 'off' });
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(screen.queryByText(/Connecting to the tutor/)).toBeNull();
  });
});

describe('tidy', () => {
  it('turns odd Unicode spaces into plain spaces and strips invisible joiners', () => {
    expect(tidy('Theme\u202FJSON and\u2009Parts\u00A0here')).toBe('Theme JSON and Parts here');
    expect(tidy('\uFEFFTemp\u2060lates\u200B!')).toBe('Templates!');
    expect(tidy('plain text')).toBe('plain text');
  });
});

describe('PlacementChat (AI off or capped)', () => {
  it.each(['off', 'capped'] as const)('with status %s shows "Choose your path" instead of the chat', async (ai) => {
    status.mockResolvedValue({ ai });
    render(<App />);
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(screen.queryByLabelText('Your message')).toBeNull();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('picking Block theme places at the first lesson with "You chose this path."', async () => {
    status.mockResolvedValue({ ai: 'off' });
    render(<App />);
    const group = await screen.findByRole('group', { name: 'Choose your path' });
    fireEvent.click(within(group).getByRole('button', { name: /Block theme developer/ }));
    await waitFor(() =>
      expect(manager.dispatch).toHaveBeenCalledWith({
        type: 'placed',
        placement: { pathId: 'block-theme', startLessonId: 'theme-json-basics', skip: [], reason: 'You chose this path.' },
      }),
    );
    await waitFor(() => expect(location.pathname).toBe('/learn/theme-json-basics'));
  });

  it('coming-soon paths in the chooser cannot be picked', async () => {
    status.mockResolvedValue({ ai: 'off' });
    render(<App />);
    const group = await screen.findByRole('group', { name: 'Choose your path' });
    const learner = within(group).getByRole('button', { name: /Learner/ }) as HTMLButtonElement;
    expect(learner.disabled).toBe(true);
    expect(learner.textContent).toContain('Coming soon');
  });
});

describe('PathCards', () => {
  it('links live paths and leaves coming-soon cards unclickable', () => {
    const { container } = render(
      <LocationProvider>
        <PathCards />
      </LocationProvider>,
    );
    const cards = Array.from(container.querySelectorAll('.path-card'));
    expect(cards).toHaveLength(3);
    const live = cards.find((c) => c.textContent?.includes('Block theme developer'))!;
    expect(live.querySelector('a')?.getAttribute('href')).toBe('/path/block-theme');
    for (const name of ['Learner', 'Vibe coder']) {
      const card = cards.find((c) => c.querySelector('h3')?.textContent === name)!;
      expect(card.querySelector('a')).toBeNull();
      expect(card.textContent).toContain('Coming soon');
    }
  });

  it('the learner path card links to /path/learner', async () => {
    // The fixtures keep Learner coming soon; this case uses the real Learner path, which is live.
    const { buildContent } = await import('../../scripts/build-content');
    const real = buildContent('content');
    const saved = { path: content.paths.learner, lessons: { ...content.lessons } };
    content.paths.learner = real.paths.learner;
    for (const id of real.paths.learner.lessons) content.lessons[id] = real.lessons[id];
    try {
      const { container } = render(
        <LocationProvider>
          <PathCards />
        </LocationProvider>,
      );
      const card = Array.from(container.querySelectorAll('.path-card')).find((c) => c.querySelector('h3')?.textContent === 'Learner')!;
      expect(card.querySelector('a')?.getAttribute('href')).toBe('/path/learner');
      expect(card.textContent).not.toContain('Coming soon');
    } finally {
      content.paths.learner = saved.path;
      for (const id of Object.keys(content.lessons)) if (!(id in saved.lessons)) delete content.lessons[id];
    }
  });
});

describe('Home', () => {
  it('renders the spec bands in order', async () => {
    render(<App />);
    const titles = Array.from(document.querySelectorAll('main > section h1, main > section .split__title')).map(
      (h) => h.textContent,
    );
    expect(titles[0]).toBe('Learn WordPress, your way.');
    expect(titles.slice(1)).toEqual([
      'Three ways in',
      'Continue in the agent you already use',
      'How this works',
    ]);
  });

  it('does not claim features that are not live yet', () => {
    render(<App />);
    const text = document.querySelector('main')!.textContent!;
    expect(text).toContain('is also a remote MCP server');
    expect(text).not.toContain('will also be a remote MCP server');
    expect(screen.getByRole('link', { name: 'Connect your agent' }).getAttribute('href')).toBe('/connect');
    expect(text).not.toContain('Each path has a moment');
    expect(text).toContain('The block theme path has a moment');
  });

  it('never skips a heading level inside the hero card', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    render(<App />);
    await send('I build sites with CSS');
    await screen.findByRole('button', { name: 'Start here' });
    expect(document.querySelector('.hero h3')).toBeNull();
    expect(document.querySelector('.placement-card h2')).toBeTruthy();
    await waitFor(() => expect(status).toHaveBeenCalled());
  });
});
