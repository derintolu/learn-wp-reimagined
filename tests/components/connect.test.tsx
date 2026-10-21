// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';

const h = vi.hoisted(() => ({
  startHandoff: vi.fn(),
  fetchAgentRecord: vi.fn(),
  deleteAgentRecord: vi.fn(),
}));
vi.mock('../../src/agent/client', () => ({ ...h, NO_ANSWER: "The connector didn't answer. Try again in a moment." }));
vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(async () => ({ ai: 'off' })), placement: vi.fn() }));

import { Connect } from '../../src/pages/Connect';
import { RecordPanel } from '../../src/components/RecordPanel';
import { CLAUDE_CODE_COMMAND } from '../../src/agent/clients';
import { MCP_URL, agentPrompt } from '../../src/shared/course-meta';
import { INVALID_PASTE } from '../../src/agent/importRecord';
import { HANDOFF_FAILED, KEEP_PRIVATE } from '../../src/components/AgentHandoff';
import { IMPORT_DONE } from '../../src/components/ImportAgentProgress';
import { getRecordManager, setRecordManager } from '../../src/record/useRecord';
import { content } from '../../src/content';
import { applyEvent, newRecord } from '../../src/shared/record';
import { buildCourse } from '../../functions/_lib/mcp/course';
import { choosePlacement, nextBeat, newHandle, startPlacement, type Ctx } from '../../vendor/learning-mcp/core/index.ts';
import { memoryManager } from './helpers';

const HANDLE = newHandle();

function ctx(): Ctx {
  let n = 0;
  return { now: () => '2026-10-20T10:00:00.000Z', uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}

/** An agent record placed at lesson 3, one beat in. */
function agentAtLesson3() {
  const course = buildCourse(content);
  const c = ctx();
  let r = startPlacement(course, undefined, c).record;
  const placed = choosePlacement(course, r, { pathId: 'block-theme', startLessonId: 'bt-templates-and-parts', skip: [], reason: 'x' }, c);
  if (!placed.ok) throw new Error(placed.error);
  const b = nextBeat(course, placed.record, {}, c);
  if (!b.ok) throw new Error(b.error);
  r = b.record;
  return r;
}

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setRecordManager(memoryManager(content));
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  for (const f of Object.values(h)) f.mockReset();
});
afterEach(() => {
  cleanup();
  setRecordManager(null);
  history.replaceState(null, '', '/');
});

const paste = (text: string) => {
  fireEvent.input(screen.getByLabelText('Record handle or exported JSON'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Check it' }));
};

describe('/connect', () => {
  it('lists the five clients as text, with no images', () => {
    const { container } = render(<Connect />);
    for (const n of ['Claude', 'ChatGPT', 'Claude Code', 'Cursor', 'Any MCP client']) expect(screen.getByRole('heading', { level: 3, name: n })).toBeTruthy();
    expect(container.querySelectorAll('img, svg:not(.swipe__mark)').length).toBe(0);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Connect your agent');
  });

  it('shows the exact Claude Code command, and Copy writes the connector URL', async () => {
    render(<Connect />);
    expect(CLAUDE_CODE_COMMAND).toBe(`claude mcp add --transport http learn-wp-reimagined ${MCP_URL}`);
    expect(screen.getByText(CLAUDE_CODE_COMMAND)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy connector url' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MCP_URL));
  });

  it('an invalid paste shows the classifyPaste message', async () => {
    render(<Connect />);
    paste('hello');
    expect(await screen.findByText(INVALID_PASTE)).toBeTruthy();
  });

  it('a handle import shows the server message on 404', async () => {
    h.fetchAgentRecord.mockResolvedValue({ ok: false, message: 'No record for that handle.' });
    render(<Connect />);
    paste(HANDLE);
    expect(await screen.findByText('No record for that handle.')).toBeTruthy();
    expect(h.fetchAgentRecord).toHaveBeenCalledWith(HANDLE);
  });

  it('a JSON import with a position conflict leaves the position unless ticked', async () => {
    const m = getRecordManager();
    await m.restore(applyEvent(newRecord(), { type: 'beatViewed', lessonId: 'bt-patterns', beatIndex: 1 }, content));
    const before = m.record.current;
    render(<Connect />);
    paste(JSON.stringify(agentAtLesson3()));
    const box = await screen.findByRole('checkbox', { name: /Use the agent's version: where you are/ });
    expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Bring it back' }));
    expect(await screen.findByText(IMPORT_DONE)).toBeTruthy();
    expect(m.record.current).toEqual(before);
    expect(m.record.placement?.startLessonId).toBe('bt-templates-and-parts');
  });

  it('a ticked position conflict moves the learner', async () => {
    const m = getRecordManager();
    await m.restore(applyEvent(newRecord(), { type: 'beatViewed', lessonId: 'bt-patterns', beatIndex: 1 }, content));
    render(<Connect />);
    paste(JSON.stringify(agentAtLesson3()));
    fireEvent.click(await screen.findByRole('checkbox', { name: /where you are/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bring it back' }));
    await screen.findByText(IMPORT_DONE);
    expect(m.record.current?.lessonId).toBe('bt-templates-and-parts');
  });

  it('deleting the agent copy asks first', async () => {
    h.fetchAgentRecord.mockResolvedValue({ ok: true, data: { record: agentAtLesson3() } });
    h.deleteAgentRecord.mockResolvedValue({ ok: true, data: { deleted: true } });
    render(<Connect />);
    paste(HANDLE);
    fireEvent.click(await screen.findByRole('button', { name: "Delete the agent's copy" }));
    expect(h.deleteAgentRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    await waitFor(() => expect(h.deleteAgentRecord).toHaveBeenCalledWith(HANDLE));
    expect(await screen.findByText("The agent's copy is deleted.")).toBeTruthy();
  });

  it('every control has an accessible name', () => {
    const { container } = render(<Connect />);
    for (const el of Array.from(container.querySelectorAll('button, a, textarea, input'))) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim() || (el.id && container.querySelector(`label[for="${el.id}"]`)?.textContent);
      expect(name, el.outerHTML).toBeTruthy();
    }
  });
});

describe('Your record: Continue in your agent', () => {
  const openPanel = async () => {
    history.replaceState(null, '', '/learn/bt-templates-and-parts');
    render(
      <LocationProvider>
        <RecordPanel />
      </LocationProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Your record/ }));
    return screen.findByRole('dialog', { name: /Your record/ });
  };

  it("calls startHandoff with the open lesson and the record's files, then shows the URL, handle and exact prompt", async () => {
    const m = getRecordManager();
    await m.restore(applyEvent(newRecord(), { type: 'fileEdited', file: 'theme.json', content: '{}' }, content));
    h.startHandoff.mockResolvedValue({ ok: true, data: { handle: HANDLE, mcpUrl: MCP_URL, prompt: agentPrompt(HANDLE) } });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in your agent' }));
    expect(await within(dialog).findByText(HANDLE)).toBeTruthy();
    expect(h.startHandoff).toHaveBeenCalledWith('bt-templates-and-parts', { 'theme.json': '{}' });
    expect(within(dialog).getByText(MCP_URL)).toBeTruthy();
    expect(within(dialog).getByText(agentPrompt(HANDLE))).toBeTruthy();
    expect(within(dialog).getByText(KEEP_PRIVATE)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Set up your agent' }).getAttribute('href')).toBe('/connect');
  });

  it('a failure shows the fallback copy and the /connect link', async () => {
    h.startHandoff.mockResolvedValue({ ok: false, message: 'nope' });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in your agent' }));
    expect(await within(dialog).findByText(HANDOFF_FAILED)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Set up your agent' })).toBeTruthy();
  });

  it('Back returns to the menu and Escape closes it and returns focus', async () => {
    h.startHandoff.mockResolvedValue({ ok: false, message: 'nope' });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: "Bring back your agent's progress" }));
    expect(within(dialog).getByLabelText('Record handle or exported JSON')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('button', { name: 'Download record' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Your record/ }));
  });
});
