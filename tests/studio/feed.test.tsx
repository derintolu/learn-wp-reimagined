// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';

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

import { Feed } from '../../src/studio/Feed';
import { getStatus, tutorStream } from '../../src/ai/client';
import { content } from '../../src/content';
import { resetAiStatusForTests } from '../../src/ai/useAiStatus';

const status = vi.mocked(getStatus);
const stream = vi.mocked(tutorStream);
const lesson = content.lessons['theme-json-basics'];
const QUESTION = 'What would you put in theme.json instead of CSS?';
const FAILURE = "I couldn't answer that just now. Try again in a moment, or check the sources under each section.";

/** A host that owns the step the way LessonView does. */
function Host({ start = 0, readOnly = false }: { start?: number; readOnly?: boolean }) {
  const [step, setStep] = useState(start);
  const n = lesson.beats.length;
  return (
    <Feed lesson={lesson} step={step} readOnly={readOnly} nextLabel={step === n - 1 ? 'On to the checkpoint' : 'Continue'} onNext={() => setStep((s) => s + 1)}>
      <p>Post cards</p>
    </Feed>
  );
}

/** Replies with `text`, delivered in one chunk. */
function reply(text: string) {
  stream.mockImplementationOnce(async (_req, onText) => {
    onText(text);
  });
}

async function send(text: string) {
  const box = await screen.findByPlaceholderText('Answer, or ask the tutor anything');
  fireEvent.input(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

const card = (goal: string) => screen.getByRole('heading', { name: goal }).closest('.section-card') as HTMLElement;

beforeEach(() => {
  status.mockResolvedValue({ ai: 'on' });
  stream.mockRejectedValue(new Error('not set'));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetAiStatusForTests();
});

describe('Feed', () => {
  it('renders the welcome, then one section card per reached beat with sources', async () => {
    render(<Host />);
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.textContent).toContain(
      "Hi. On the right is a real WordPress running your theme, and the files that make it. Everything we talk about, you'll see and change there.",
    );
    expect(document.querySelectorAll('.section-card')).toHaveLength(1);
    const first = card(lesson.beats[0].goal);
    // theme-json-basics is lesson 1 of its path.
    expect(within(first).getByText('1.1')).toBeTruthy();
    expect(first.getAttribute('aria-current')).toBe('step');
    expect(first.textContent).toContain('declares your palette');
    expect(first.textContent).toContain('Based on');
    const src = within(first).getByRole('link', { name: 'Introduction to theme.json' });
    expect(src.getAttribute('href')).toBe('https://developer.wordpress.org/themes/global-settings-and-styles/');
    expect(src.getAttribute('target')).toBe('_blank');
    expect(src.getAttribute('rel')).toContain('noopener');

    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    await screen.findByRole('heading', { name: lesson.beats[1].goal });
    expect(document.querySelectorAll('.section-card')).toHaveLength(2);
    expect(within(card(lesson.beats[1].goal)).getByText('1.2')).toBeTruthy();
    // The new card's heading takes focus, and only it is current.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: lesson.beats[1].goal })));
    expect(card(lesson.beats[0].goal).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: /On to the checkpoint/ })).toBeTruthy();
  });

  it('beat question appears as a tutor message after its card', async () => {
    render(<Host />);
    const q = screen.getByText(QUESTION);
    const msg = q.closest('.msg') as HTMLElement;
    expect(msg.classList.contains('msg--tutor')).toBe(true);
    expect(card(lesson.beats[0].goal).compareDocumentPosition(msg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('first send answers the question: request content is prefixed, bubble is not', async () => {
    reply('Good thinking: presets belong there.');
    render(<Host />);
    await send('Colours and fonts');
    await screen.findByText(/presets belong there/);
    expect(stream).toHaveBeenCalledTimes(1);
    const [req] = stream.mock.calls[0];
    expect(req).toMatchObject({ lessonId: lesson.id, beatIndex: 0, mode: 'ask' });
    expect(req.messages).toEqual([{ role: 'user', content: `Answering your question "${QUESTION}": Colours and fonts` }]);
    const bubble = document.querySelector('.msg--learner .msg__bubble') as HTMLElement;
    expect(bubble.textContent).toBe('Colours and fonts');
  });

  it('a later send is a plain ask with beatIndex = step', async () => {
    reply('First reply.');
    render(<Host />);
    await send('Colours');
    await screen.findByText('First reply.');
    reply('Second reply.');
    await send('What about spacing?');
    await screen.findByText('Second reply.');
    const [req] = stream.mock.calls[1];
    expect(req.beatIndex).toBe(0);
    expect(req.messages).toEqual([
      { role: 'user', content: `Answering your question "${QUESTION}": Colours` },
      { role: 'assistant', content: 'First reply.' },
      { role: 'user', content: 'What about spacing?' },
    ]);

    // On beat 2 (no question) the step is sent as beatIndex.
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    await screen.findByRole('heading', { name: lesson.beats[1].goal });
    reply('Third reply.');
    await send('Where do colours go?');
    await screen.findByText('Third reply.');
    const [req3] = stream.mock.calls[2];
    expect(req3.beatIndex).toBe(1);
    expect(req3.messages.at(-1)).toEqual({ role: 'user', content: 'Where do colours go?' });
  });

  it('Shift+Enter does not send', async () => {
    render(<Host />);
    const box = await screen.findByPlaceholderText('Answer, or ask the tutor anything');
    fireEvent.input(box, { target: { value: 'Half a thought' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(stream).not.toHaveBeenCalled();
  });

  it('turns stay under the beat they were sent in after Continue', async () => {
    reply('About beat one.');
    render(<Host />);
    await send('Answer one');
    await screen.findByText('About beat one.');
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    await screen.findByRole('heading', { name: lesson.beats[1].goal });
    const second = card(lesson.beats[1].goal);
    reply('About beat two.');
    await send('Answer two');
    await screen.findByText('About beat two.');

    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const one = screen.getByText('About beat one.');
    const two = screen.getByText('About beat two.');
    expect(before(card(lesson.beats[0].goal), one)).toBe(true);
    expect(before(one, second)).toBe(true);
    expect(before(second, two)).toBe(true);
    // The Continue button sits under the active beat, after its turns.
    expect(before(two, screen.getByRole('button', { name: /On to the checkpoint/ }))).toBe(true);
  });

  it('capped mid-conversation: pending turn shows failure copy, composer becomes CapNotice, Continue still advances', async () => {
    let fail!: (e: unknown) => void;
    stream.mockImplementationOnce(() => new Promise((_res, rej) => (fail = rej)));
    render(<Host />);
    await send('Colours');
    // The tutor is thinking.
    await screen.findByText('The tutor is thinking…');
    fail(Object.assign(new Error('capped'), { reason: 'day-cap' }));
    await screen.findByText(FAILURE);
    expect(await screen.findByText("The tutor's taking a breather.")).toBeTruthy();
    expect(screen.queryByPlaceholderText('Answer, or ask the tutor anything')).toBeNull();
    // The question stays as a plain tutor prompt.
    expect(screen.getByText(QUESTION)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    await screen.findByRole('heading', { name: lesson.beats[1].goal });
    fireEvent.click(screen.getByRole('button', { name: /On to the checkpoint/ }));
    // Past the last beat: no Continue, the post cards follow the last section.
    await waitFor(() => expect(screen.queryByRole('button', { name: /On to the checkpoint|Continue/ })).toBeNull());
    expect(screen.getByText('Post cards')).toBeTruthy();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('shows a skeleton while the AI status loads, and CapNotice when it is off', async () => {
    let resolve!: (v: { ai: 'off' }) => void;
    status.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<Host />);
    expect(screen.getByText('Connecting to the tutor…')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Answer, or ask the tutor anything')).toBeNull();
    resolve({ ai: 'off' });
    expect(await screen.findByText('The live tutor is switched off right now.')).toBeTruthy();
  });

  it('read-only: every card shows, no composer, children replace Continue', async () => {
    render(<Host start={lesson.beats.length} readOnly />);
    expect(document.querySelectorAll('.section-card')).toHaveLength(lesson.beats.length);
    expect(screen.queryByRole('button', { name: /Continue|On to the checkpoint/ })).toBeNull();
    expect(screen.getByText('Post cards')).toBeTruthy();
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText('Answer, or ask the tutor anything')).toBeNull();
  });

  it('no /api/tutor deliver request is ever made', async () => {
    reply('Reply.');
    render(<Host />);
    await send('Colours');
    await screen.findByText('Reply.');
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    await screen.findByRole('heading', { name: lesson.beats[1].goal });
    fireEvent.click(screen.getByRole('button', { name: /On to the checkpoint/ }));
    await screen.findByText('Post cards');
    expect(stream.mock.calls.every(([req]) => req.mode === 'ask')).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
