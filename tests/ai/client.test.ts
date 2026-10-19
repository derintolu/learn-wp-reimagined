import { describe, it, expect, vi, afterEach } from 'vitest';
import { getStatus, judge, placement, codeFeedback, tutorStream } from '../../src/ai/client';

afterEach(() => vi.unstubAllGlobals());

const enc = new TextEncoder();
function sseResponse(parts: string[], status = 200): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    }),
    { status, headers: { 'content-type': 'text/event-stream' } },
  );
}
function stubFetch(res: Response | (() => Response)) {
  const f = vi.fn(async (_url: string) => (typeof res === 'function' ? res() : res));
  vi.stubGlobal('fetch', f);
  return f;
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

describe('ai client', () => {
  it('judge maps 503 to fallback', async () => {
    stubFetch(json({ fallback: true, reason: 'month-cap' }, 503));
    expect(await judge('l', 'a')).toMatchObject({ ok: false, fallback: true });
  });

  it('judge returns data on 200 and posts to a relative URL', async () => {
    const f = stubFetch(json({ outcome: 'advance', to: 'x', message: 'm', feedback: 'f' }));
    const r = await judge('l', 'a');
    expect(r).toEqual({ ok: true, data: { outcome: 'advance', to: 'x', message: 'm', feedback: 'f' } });
    expect(f.mock.calls[0][0]).toBe('/api/checkpoint');
  });

  it('network failure and 429 become fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await placement([])).toMatchObject({ ok: false, fallback: true });
    stubFetch(json({ error: { code: 'rate-limited', message: 'slow down' } }, 429));
    expect(await codeFeedback({ lessonId: 'l', file: 'f', code: 'c', passed: true, failedMessages: [] })).toMatchObject({
      ok: false,
      fallback: true,
    });
  });

  it('getStatus falls back to off', async () => {
    stubFetch(json({ ai: 'on' }));
    expect(await getStatus()).toEqual({ ai: 'on' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')));
    expect(await getStatus()).toEqual({ ai: 'off', reason: 'not-configured' });
  });

  it('tutorStream concatenates chunks, even split across reads', async () => {
    stubFetch(sseResponse(['data: {"t":"Hel"}\n\nda', 'ta: {"t":"lo"}\n\ndata: [DO', 'NE]\n\n']));
    const got: string[] = [];
    await tutorStream({ lessonId: 'l', beatIndex: 0, mode: 'deliver', messages: [] }, (t) => got.push(t));
    expect(got.join('')).toBe('Hello');
  });

  it('tutorStream rejects on an error event and on 503', async () => {
    stubFetch(sseResponse(['data: {"t":"a"}\n\ndata: {"error":"provider-error"}\n\n']));
    await expect(
      tutorStream({ lessonId: 'l', beatIndex: 0, mode: 'deliver', messages: [] }, () => {}),
    ).rejects.toThrow();
    stubFetch(json({ fallback: true, reason: 'month-cap' }, 503));
    await expect(
      tutorStream({ lessonId: 'l', beatIndex: 0, mode: 'deliver', messages: [] }, () => {}),
    ).rejects.toThrow();
  });

  const REQ = { lessonId: 'l', beatIndex: 0, mode: 'deliver' as const, messages: [] };

  it('tutorStream rejects when the stream ends without [DONE]', async () => {
    stubFetch(sseResponse(['data: {"t":"a"}\n\n']));
    const got: string[] = [];
    await expect(tutorStream(REQ, (t) => got.push(t))).rejects.toThrow(/truncated/);
    expect(got).toEqual(['a']);
  });

  it('tutorStream cancels the reader after [DONE]', async () => {
    const cancel = vi.fn();
    stubFetch(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('data: [DONE]\n\n'));
          },
          cancel,
        }),
      ),
    );
    await tutorStream(REQ, () => {});
    expect(cancel).toHaveBeenCalled();
  });

  it('tutorStream passes the signal and aborting rejects', async () => {
    const ctl = new AbortController();
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort')))),
    );
    vi.stubGlobal('fetch', f);
    const p = tutorStream(REQ, () => {}, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toThrow();
    expect(f.mock.calls[0][1].signal).toBe(ctl.signal);
  });
});
