// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';

vi.mock('../../src/content', async () => {
  const { buildContent } = await import('../../scripts/build-content');
  return { content: buildContent('tests/fixtures/content') };
});
vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(), placement: vi.fn() }));

import { App } from '../../src/app';
import { PathCards } from '../../src/components/PathCards';
import { getStatus, placement } from '../../src/ai/client';
import { content } from '../../src/content';
import { setRecordManager } from '../../src/record/useRecord';
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
});

const input = () => screen.getByLabelText('Your message') as HTMLTextAreaElement;
function send(text: string) {
  fireEvent.input(input(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('PlacementChat (AI on)', () => {
  it('has a labelled input with the authored placeholder and a polite chat log', async () => {
    render(<App />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(input().getAttribute('placeholder')).toBe("Not sure where to start? Tell me what you're building.");
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the learner bubble and then the tutor reply', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Lovely. Have you edited theme files before?' } });
    render(<App />);
    send('A portfolio for my pottery. I know a little CSS.');
    const log = screen.getByRole('log');
    expect(log.querySelector('.bubble--learner')?.textContent).toContain('A portfolio for my pottery.');
    await screen.findByText('Lovely. Have you edited theme files before?');
    expect(place).toHaveBeenCalledWith([{ role: 'user', content: 'A portfolio for my pottery. I know a little CSS.' }]);
  });

  it('shows a thinking indicator and disables Send while waiting', async () => {
    let resolve!: (v: Awaited<ReturnType<typeof placement>>) => void;
    place.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<App />);
    send('Hello');
    expect(screen.getByText(/thinking/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ ok: true, data: { reply: 'Hi there.' } });
    await screen.findByText('Hi there.');
    expect(screen.queryByText(/thinking/i)).toBeNull();
  });

  it('caps a message at 600 characters with a visible counter', async () => {
    render(<App />);
    expect(input().maxLength).toBe(600);
    fireEvent.input(input(), { target: { value: 'x'.repeat(42) } });
    expect(screen.getByText('42 / 600')).toBeTruthy();
  });

  it('sends earlier tutor replies back no longer than 600 characters', async () => {
    place.mockResolvedValueOnce({ ok: true, data: { reply: 'y'.repeat(800) } });
    place.mockResolvedValueOnce({ ok: true, data: { reply: 'ok' } });
    render(<App />);
    send('one');
    await waitFor(() => expect(place).toHaveBeenCalledTimes(1));
    await screen.findByText('y'.repeat(800));
    send('two');
    await waitFor(() => expect(place).toHaveBeenCalledTimes(2));
    const sent = place.mock.calls[1][0];
    expect(sent).toHaveLength(3);
    expect(sent.every((m) => m.content.length <= 600)).toBe(true);
  });

  it('shows a placement card with the path, the reason, the skipped lessons and both choices', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    render(<App />);
    send('I build sites with CSS');
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
    send('I build sites with CSS');
    fireEvent.click(await screen.findByRole('button', { name: 'Start here' }));
    await waitFor(() => expect(manager.dispatch).toHaveBeenCalledWith({ type: 'placed', placement: PLACED }));
    await waitFor(() => expect(location.pathname).toBe('/learn/templates-and-parts'));
    expect(manager.record.placement).toEqual(PLACED);
    await screen.findByText(/templates-and-parts/);
  });

  it('"Choose a different path" swaps the card for the path chooser', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Got it.', placement: PLACED } });
    render(<App />);
    send('I build sites with CSS');
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a different path' }));
    expect(screen.getByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(manager.dispatch).not.toHaveBeenCalled();
  });

  it('falls back to the chooser after a fallback response', async () => {
    place.mockResolvedValue({ ok: false, fallback: true });
    render(<App />);
    send('Hello');
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(screen.queryByLabelText('Your message')).toBeNull();
  });

  it('treats a 200 response without a reply as a fallback', async () => {
    place.mockResolvedValue({ ok: true, data: {} as never });
    render(<App />);
    send('Hello');
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
  });

  it('offers the chooser after four learner turns without a placement', async () => {
    place.mockResolvedValue({ ok: true, data: { reply: 'Tell me more.' } });
    render(<App />);
    for (let i = 1; i <= 4; i++) {
      send(`turn ${i}`);
      await waitFor(() => expect(place).toHaveBeenCalledTimes(i));
      await waitFor(() => expect(screen.getAllByText('Tell me more.')).toHaveLength(i));
    }
    expect(await screen.findByRole('group', { name: 'Choose your path' })).toBeTruthy();
    expect(screen.queryByLabelText('Your message')).toBeNull();
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
});

describe('Home', () => {
  it('renders the spec bands in order', async () => {
    render(<App />);
    const titles = Array.from(document.querySelectorAll('main section > .wrap h1, main section > .wrap h2')).map(
      (h) => h.textContent,
    );
    expect(titles[0]).toBe('Learn WordPress, your way.');
    expect(titles.slice(1)).toEqual([
      'Three ways in',
      'Continue in the agent you already use',
      'How this works',
    ]);
    await waitFor(() => expect(status).toHaveBeenCalled());
  });
});
