// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true}}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content'), adoptPending: () => false, prefetchLatest: () => {} };
});
vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(), placement: vi.fn() }));

import { App } from '../../src/app';
import { PathCards } from '../../src/components/PathCards';
import { tidy } from '../../src/components/PlacementChat';
import { getStatus, placement } from '../../src/ai/client';
import { content } from '../../src/content';
import { MCP_URL } from '../../src/shared/course-meta';
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

  it('a placement into vibe-coder opens /learn/<vc lesson>', async () => {
    const vc = {
      pathId: 'vibe-coder' as const,
      startLessonId: 'vc-enqueueing',
      skip: ['vc-actions-and-filters'],
      reason: 'You already read hooks, so we start with loading a stylesheet.',
    };
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: vc } });
    render(<App />);
    await send('I ship with Cursor and I know what a filter is.');
    fireEvent.click(await screen.findByRole('button', { name: 'Start here' }));
    await waitFor(() => expect(manager.dispatch).toHaveBeenCalledWith({ type: 'placed', placement: vc }));
    await waitFor(() => expect(location.pathname).toBe('/learn/vc-enqueueing'));
    expect(manager.record.placement).toEqual(vc);
    expect(await screen.findByRole('heading', { level: 1, name: 'Enqueueing styles' })).toBeTruthy();
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
    // All three fixture paths are live; make Learner coming soon for this case.
    const saved = content.paths.learner;
    content.paths.learner = { ...saved, status: 'coming-soon', lessons: [] };
    try {
      render(<App />);
      const group = await screen.findByRole('group', { name: 'Choose your path' });
      const learner = within(group).getByRole('button', { name: /Learner/ }) as HTMLButtonElement;
      expect(learner.disabled).toBe(true);
      expect(learner.textContent).toContain('Coming soon');
      const vibe = within(group).getByRole('button', { name: /Vibe coder/ }) as HTMLButtonElement;
      expect(vibe.disabled).toBe(false);
    } finally {
      content.paths.learner = saved;
    }
  });
});

describe('PathCards', () => {
  it('links all three live paths and leaves a coming-soon card unclickable', () => {
    const renderCards = () =>
      render(
        <LocationProvider>
          <PathCards />
        </LocationProvider>,
      ).container;
    const cardFor = (c: Element, title: string) => Array.from(c.querySelectorAll('.path-card')).find((x) => x.querySelector('h3')?.textContent === title)!;
    const container = renderCards();
    expect(container.querySelectorAll('.path-card')).toHaveLength(3);
    expect(cardFor(container, 'Block theme developer').querySelector('a')?.getAttribute('href')).toBe('/path/block-theme');
    expect(cardFor(container, 'Learner').querySelector('a')?.getAttribute('href')).toBe('/path/learner');
    expect(cardFor(container, 'Vibe coder').querySelector('a')?.getAttribute('href')).toBe('/path/vibe-coder');
    cleanup();
    const saved = content.paths['vibe-coder'];
    content.paths['vibe-coder'] = { ...saved, status: 'coming-soon', lessons: [] };
    try {
      const card = cardFor(renderCards(), 'Vibe coder');
      expect(card.querySelector('a')).toBeNull();
      expect(card.textContent).toContain('Coming soon');
    } finally {
      content.paths['vibe-coder'] = saved;
    }
  });
});

describe('Home', () => {
  const HEADLINE = 'Learn WordPress in the AI you already use.';
  const main = () => document.querySelector('main')!;

  it('leads with the connect offer, then the paths, the studio, what is being built and the concept', () => {
    render(<App />);
    const titles = Array.from(main().querySelectorAll(':scope > section h1, :scope > section > .wrap h2, :scope > section > .wrap > div > h2')).map(
      (h) => h.textContent,
    );
    expect(titles).toEqual([
      HEADLINE,
      'Three steps to start',
      'Your AI becomes the tutor',
      'Three paths',
      'Or learn here, in your browser',
      "What's being built",
      'An unofficial concept',
    ]);
  });

  it('makes connecting the primary action and the studio a secondary link', () => {
    render(<App />);
    const hero = document.getElementById('hero-title')!.closest('section')!;
    const primary = within(hero).getByRole('link', { name: 'Connect your AI' });
    expect(primary.getAttribute('href')).toBe('/connect');
    expect(primary.classList.contains('button')).toBe(true);
    const studio = within(hero).getByRole('link', { name: 'Or try a lesson in your browser' });
    expect(studio.getAttribute('href')).toBe('#studio');
    expect(studio.classList.contains('button')).toBe(false);
    expect(document.getElementById('studio')).toBeTruthy();
  });

  it('shows the real connect steps with a copyable connector URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);
    const steps = screen.getByRole('region', { name: 'Three steps to start' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Copy the connector URL.');
    expect(items[1].textContent).toContain('custom connector, with no sign-in');
    expect(items[2].textContent).toContain('ask it to teach you the course');
    expect(within(steps).getByText(MCP_URL)).toBeTruthy();
    fireEvent.click(within(steps).getByRole('button', { name: 'Copy connector url' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MCP_URL));
    expect(within(steps).getByRole('link', { name: /Setup for Claude, ChatGPT/ }).getAttribute('href')).toBe('/connect');
  });

  it('keeps the approved privacy sentence for the agent record', () => {
    render(<App />);
    expect(main().textContent).toContain(
      'When you take the course into an agent, the server keeps your progress under a random record handle that only you hold. It stores no personal data, expires after 30 days without use, and you can delete it at any time from Connect your AI.',
    );
  });

  it('labels what is not live yet and does not claim it as running', () => {
    render(<App />);
    const next = document.getElementById('next-title')!.closest('section')!;
    expect(next.textContent).toContain('not live yet');
    expect(next.textContent).toContain('None of this runs on the site today.');
    for (const planned of ['course-xapi-mcp', 'Learning Ledger', 'Open Badges 3.0', 'Sensei']) {
      expect(next.textContent).toContain(planned);
    }
    // Outside the "being built" band the page names none of the planned pieces.
    const rest = Array.from(main().querySelectorAll(':scope > section'))
      .filter((s) => s !== next)
      .map((s) => s.textContent)
      .join(' ');
    for (const planned of ['course-xapi-mcp', 'Learning Ledger', 'Badge', 'Sensei', 'cmi5', 'LRS']) {
      expect(rest).not.toContain(planned);
    }
    expect(rest).toContain("hasn't been tried inside each of these apps yet");
  });

  it('links the paths, How this works and the proposal lower down', () => {
    render(<App />);
    const paths = document.getElementById('paths')!;
    expect(paths.querySelectorAll('.path-card')).toHaveLength(3);
    expect(paths.textContent).toContain('Every path has at least one moment');
    const concept = document.getElementById('how-title')!.closest('section')!;
    expect(within(concept).getByRole('link', { name: 'How this works' }).getAttribute('href')).toBe('/how-it-works');
    expect(within(concept).getByRole('link', { name: 'The proposal' }).getAttribute('href')).toBe('/proposal');
  });

  it('never skips a heading level', () => {
    render(<App />);
    const levels = Array.from(main().querySelectorAll('h1, h2, h3, h4')).map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    levels.forEach((l, i) => i > 0 && expect(l - levels[i - 1]).toBeLessThanOrEqual(1));
  });

  it('never skips a heading level inside the studio chat card', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    render(<App />);
    await send('I build sites with CSS');
    await screen.findByRole('button', { name: 'Start here' });
    expect(document.querySelector('.home-studio .hero__chat h3')).toBeNull();
    expect(document.querySelector('.placement-card h2')).toBeTruthy();
    await waitFor(() => expect(status).toHaveBeenCalled());
  });
});
