import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ANSWER, revokeAllAgents } from '../../src/agent/client';
import { JSON_TIMEOUT_MS } from '../../src/ai/client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const reply = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('agent client', () => {
  it('posts to revoke-all and returns the count', async () => {
    const f = reply(200, { revoked: 2 });
    expect(await revokeAllAgents()).toEqual({ ok: true, data: { revoked: 2 } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/oauth/revoke-all');
    expect(init!.method).toBe('POST');
  });

  it("maps an error answer to the server's message", async () => {
    reply(429, { error: { code: 'rate-limited', message: 'Too many requests right now.' } });
    expect(await revokeAllAgents()).toEqual({ ok: false, message: 'Too many requests right now.' });
  });

  it('maps a timeout to the no-answer message', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_u, init) => new Promise((_r, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const p = revokeAllAgents();
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS + 1);
    expect(await p).toEqual({ ok: false, message: NO_ANSWER });
  });
});
