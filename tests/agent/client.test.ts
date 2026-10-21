import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ANSWER, deleteAgentRecord, fetchAgentRecord, startHandoff } from '../../src/agent/client';
import { JSON_TIMEOUT_MS } from '../../src/ai/client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const reply = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('agent client', () => {
  it('posts the lesson and files, and returns the handoff', async () => {
    const f = reply(200, { handle: 'lr_x', mcpUrl: 'u', prompt: 'p' });
    expect(await startHandoff('bt-patterns', { 'theme.json': '{}' })).toEqual({ ok: true, data: { handle: 'lr_x', mcpUrl: 'u', prompt: 'p' } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/agent/handoff');
    expect(JSON.parse(String(init!.body))).toEqual({ lessonId: 'bt-patterns', files: { 'theme.json': '{}' } });
  });

  it("maps 404 and 429 to the server's message, and keeps the handle out of the URL", async () => {
    const f = reply(404, { error: { code: 'no-record', message: 'No record for that handle.' } });
    expect(await fetchAgentRecord('lr_secret')).toEqual({ ok: false, message: 'No record for that handle.' });
    expect(String(f.mock.calls[0][0])).not.toContain('lr_secret');
    reply(429, { error: { code: 'rate-limited', message: 'Too many requests right now.' } });
    expect(await deleteAgentRecord('lr_secret')).toEqual({ ok: false, message: 'Too many requests right now.' });
  });

  it('maps a timeout to the no-answer message', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_u, init) => new Promise((_r, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const p = fetchAgentRecord('lr_x');
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS + 1);
    expect(await p).toEqual({ ok: false, message: NO_ANSWER });
  });
});
