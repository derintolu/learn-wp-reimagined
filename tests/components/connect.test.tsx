// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';

const h = vi.hoisted(() => ({
  startHandoff: vi.fn(),
  fetchAgentRecord: vi.fn(),
  deleteAgentRecord: vi.fn(),
  revokeAllAgents: vi.fn(),
  flags: { agent: true, serverEvents: true, sessions: true, wordpressContent: false, senseiLearners: false, agentOnStandard: false },
}));
vi.mock('../../src/config', () => ({ FEATURES: h.flags, REPO_URL: 'https://github.com/derintolu/learn-wp-reimagined' }));
vi.mock('../../src/agent/client', () => ({ ...h, NO_ANSWER: "The connector didn't answer. Try again in a moment." }));
vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(async () => ({ ai: 'off' })), placement: vi.fn() }));

import { Connect } from '../../src/pages/Connect';
import { RecordPanel } from '../../src/components/RecordPanel';
import { CLAUDE_CODE_COMMAND } from '../../src/agent/clients';
import { MCP_URL, agentHandlePrompt, agentPrompt } from '../../src/shared/course-meta';
import { INVALID_PASTE } from '../../src/agent/importRecord';
import { HANDOFF_FAILED, KEEP_PRIVATE, resetHandoffs } from '../../src/components/AgentHandoff';
import { IMPORT_DONE } from '../../src/components/ImportAgentProgress';
import { AGENTS_DISCONNECTED, DISCONNECT_FAILED } from '../../src/components/RecordPanel';
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
  for (const f of [h.startHandoff, h.fetchAgentRecord, h.deleteAgentRecord, h.revokeAllAgents]) f.mockReset();
  h.flags.agentOnStandard = false;
  resetHandoffs();
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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Connect your AI');
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
    const box = await screen.findByRole('checkbox', { name: /Use your AI's version: where you are/ });
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
    fireEvent.click(await screen.findByRole('button', { name: "Delete your AI's copy" }));
    expect(h.deleteAgentRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    await waitFor(() => expect(h.deleteAgentRecord).toHaveBeenCalledWith(HANDLE));
    expect(await screen.findByText("Your AI's copy is deleted.")).toBeTruthy();
  });

  it('every control has an accessible name', () => {
    const { container } = render(<Connect />);
    for (const el of Array.from(container.querySelectorAll('button, a, textarea, input'))) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim() || (el.id && container.querySelector(`label[for="${el.id}"]`)?.textContent);
      expect(name, el.outerHTML).toBeTruthy();
    }
  });
});

describe('Your record: Continue in your AI', () => {
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
    h.startHandoff.mockResolvedValue({ ok: true, data: { handle: HANDLE, mcpUrl: MCP_URL, prompt: agentHandlePrompt(HANDLE) } });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in your AI' }));
    expect(await within(dialog).findByText(HANDLE)).toBeTruthy();
    expect(h.startHandoff).toHaveBeenCalledWith('bt-templates-and-parts', { 'theme.json': '{}' });
    expect(within(dialog).getByText(MCP_URL)).toBeTruthy();
    expect(within(dialog).getByText(agentHandlePrompt(HANDLE))).toBeTruthy();
    expect(within(dialog).getByText(KEEP_PRIVATE)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Set up your AI' }).getAttribute('href')).toBe('/connect');
    // Reopening shows the same handle and makes no second record.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in your AI' }));
    expect(await within(dialog).findByText(HANDLE)).toBeTruthy();
    expect(h.startHandoff).toHaveBeenCalledTimes(1);
  });

  it('a new paste clears the last check', async () => {
    h.fetchAgentRecord.mockResolvedValue({ ok: true, data: { record: agentAtLesson3() } });
    render(<Connect />);
    paste(HANDLE);
    expect(await screen.findByRole('button', { name: 'Bring it back' })).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Record handle or exported JSON'), { target: { value: 'something else' } });
    expect(screen.queryByRole('button', { name: 'Bring it back' })).toBeNull();
    expect(screen.queryByRole('button', { name: "Delete your AI's copy" })).toBeNull();
  });

  it('a failure shows the fallback copy and the /connect link', async () => {
    h.startHandoff.mockResolvedValue({ ok: false, message: 'nope' });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in your AI' }));
    expect(await within(dialog).findByText(HANDOFF_FAILED)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Set up your AI' })).toBeTruthy();
  });

  it('Back returns to the menu and Escape closes it and returns focus', async () => {
    h.startHandoff.mockResolvedValue({ ok: false, message: 'nope' });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: "Bring back your AI's progress" }));
    expect(within(dialog).getByLabelText('Record handle or exported JSON')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('button', { name: 'Download record' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Your record/ }));
  });
});

describe('agent on the standard (flag on)', () => {
  beforeEach(() => {
    h.flags.agentOnStandard = true;
  });
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

  it('/connect says to sign in when the agent asks, with no handle or import anywhere', () => {
    const { container } = render(<Connect />);
    expect(container.textContent).toMatch(/sign in when your agent asks/i);
    expect(container.textContent).not.toMatch(/handle|no sign.?in|no authentication/i);
    expect(screen.queryByLabelText('Record handle or exported JSON')).toBeNull();
    expect(screen.getByText(CLAUDE_CODE_COMMAND)).toBeTruthy();
  });

  it('the hand-off shows the connector URL and a prompt naming the lesson, and makes no handle', async () => {
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in your AI' }));
    expect(within(dialog).getByText(MCP_URL)).toBeTruthy();
    expect(within(dialog).getByText(agentPrompt(content.lessons['bt-templates-and-parts'].title))).toBeTruthy();
    expect(h.startHandoff).not.toHaveBeenCalled();
    expect(dialog.textContent).not.toMatch(/handle/i);
  });

  it('hides "Bring back your AI\'s progress" and "Disconnect agents" calls revoke-all', async () => {
    h.revokeAllAgents.mockResolvedValue({ ok: true, data: { revoked: 2 } });
    const dialog = await openPanel();
    expect(within(dialog).queryByRole('button', { name: "Bring back your AI's progress" })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect agents' }));
    expect(await within(dialog).findByText(AGENTS_DISCONNECTED)).toBeTruthy();
    expect(h.revokeAllAgents).toHaveBeenCalledTimes(1);
  });

  it('a failed disconnect says so', async () => {
    h.revokeAllAgents.mockResolvedValue({ ok: false, message: 'nope' });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect agents' }));
    expect(await within(dialog).findByText(DISCONNECT_FAILED)).toBeTruthy();
  });
});

describe('agent flag off still uses handles', () => {
  it('describes both handle formats and keeps the import', () => {
    expect(INVALID_PASTE).toMatch(/cxp_/);
    expect(INVALID_PASTE).toMatch(/lr_/);
    render(<Connect />);
    expect(screen.getByLabelText('Record handle or exported JSON')).toBeTruthy();
  });
});
