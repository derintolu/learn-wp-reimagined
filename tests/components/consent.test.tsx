// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Consent, EXPIRED } from '../../src/pages/Consent';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

function mount(info: unknown = { clientName: 'Claude', redirectHost: 'claude.ai', hasSession: true }, status = 200) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init || !init.method || init.method === 'GET') return json(info, status);
    return json({ redirect: 'https://claude.ai/cb?code=abc' });
  });
  return render(
    <Consent />,
  );
}

beforeEach(() => {
  history.replaceState(null, '', '/consent?request=req-1');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {}) as unknown as ReturnType<typeof vi.fn>;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('Consent page', () => {
  it('names the agent and the host, and focuses the heading', async () => {
    mount();
    const h = await screen.findByRole('heading', { level: 1, name: 'Let Claude continue your course as you?' });
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText('It will send you back to claude.ai.')).toBeTruthy();
    expect(screen.getByText(/Disconnect agents/)).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/oauth/consent?request=req-1');
  });

  it('Allow posts allow and follows the redirect', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?code=abc'));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/oauth/consent');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ request: 'req-1', decision: 'allow' });
  });

  it('Cancel posts cancel', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ request: 'req-1', decision: 'cancel' });
  });

  it('client name is escaped text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = mount({ clientName: evil, redirectHost: '<b>evil</b>.test', hasSession: false });
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`Let ${evil} continue your course as you?`);
  });

  it('an expired request shows a plain message and no buttons', async () => {
    mount({ error: { code: 'request-ended' } }, 400);
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(EXPIRED).toBe('This sign-in request has expired. Start again from your agent.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a missing request id shows the expired message without calling the server', async () => {
    history.replaceState(null, '', '/consent');
    mount();
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
