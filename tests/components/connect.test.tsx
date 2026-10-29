// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';

const h = vi.hoisted(() => ({
  revokeAllAgents: vi.fn(),
}));
vi.mock('../../src/agent/client', () => ({ ...h, NO_ANSWER: "The connector didn't answer. Try again in a moment." }));
vi.mock('../../src/ai/client', () => ({ getStatus: vi.fn(async () => ({ ai: 'off' })), placement: vi.fn() }));

import { Connect } from '../../src/pages/Connect';
import { RecordPanel } from '../../src/components/RecordPanel';
import { CLAUDE_CODE_COMMAND } from '../../src/agent/clients';
import { MCP_URL, agentPrompt } from '../../src/shared/course-meta';
import { AGENTS_DISCONNECTED, DISCONNECT_FAILED } from '../../src/components/RecordPanel';
import { setRecordManager } from '../../src/record/useRecord';
import { content } from '../../src/content';
import { memoryManager } from './helpers';

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setRecordManager(memoryManager(content));
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  h.revokeAllAgents.mockReset();
  // The record menu reads the official record, badges and Sensei; none is what these tests are about.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setRecordManager(null);
  history.replaceState(null, '', '/');
});

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

  it('says to sign in when the agent asks, with no handle or import anywhere', () => {
    const { container } = render(<Connect />);
    expect(container.textContent).toMatch(/sign in when your agent asks/i);
    expect(container.textContent).not.toMatch(/handle|no sign.?in|no authentication|bring your AI's progress back/i);
    expect(screen.queryByLabelText('Record handle or exported JSON')).toBeNull();
    expect(container.querySelector('#import')).toBeNull();
  });

  it('every control has an accessible name', () => {
    const { container } = render(<Connect />);
    for (const el of Array.from(container.querySelectorAll('button, a, textarea, input'))) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim() || (el.id && container.querySelector(`label[for="${el.id}"]`)?.textContent);
      expect(name, el.outerHTML).toBeTruthy();
    }
  });
});

describe('Your record: your own AI', () => {
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

  it('the hand-off shows the connector URL and a prompt naming the lesson, and makes no handle', async () => {
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in your AI' }));
    expect(within(dialog).getByText(MCP_URL)).toBeTruthy();
    expect(within(dialog).getByText(agentPrompt(content.lessons['bt-templates-and-parts'].title))).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Set up your AI' }).getAttribute('href')).toBe('/connect');
    expect(dialog.textContent).not.toMatch(/handle/i);
  });

  it('Back returns to the menu and Escape closes it and returns focus', async () => {
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in your AI' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('button', { name: 'Download record' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Your record/ }));
  });

  it('offers no "Bring back your AI\'s progress", and "Disconnect agents" calls revoke-all', async () => {
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
