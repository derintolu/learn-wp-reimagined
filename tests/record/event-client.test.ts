// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEAT_FLUSH_MS, EventClient } from '../../src/record/eventClient';

const LEARNER = '11111111-2222-4333-8444-555555555555';
let fetchMock: ReturnType<typeof vi.fn>;
const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body);
const okResponse = (events: { eventId: string }[]) =>
  ({ ok: true, json: async () => ({ results: events.map((e) => ({ eventId: e.eventId, ok: true, statements: [] })) }) }) as Response;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async (_u: string, init: RequestInit) => okResponse(JSON.parse(init.body as string).events));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EventClient', () => {
  it('queues beats and sends one batch after 30 s', async () => {
    const c = new EventClient(() => LEARNER);
    c.queueBeat('l1', 0);
    c.queueBeat('l1', 1);
    await vi.advanceTimersByTimeAsync(BEAT_FLUSH_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = bodyOf(0);
    expect(body.learnerId).toBe(LEARNER);
    expect(body.events.map((e: { beatIndex: number }) => e.beatIndex)).toEqual([0, 1]);
  });

  it('flush sends immediately', async () => {
    const c = new EventClient(() => LEARNER);
    c.queueBeat('l1', 0);
    await c.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BEAT_FLUSH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pagehide uses sendBeacon', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    const c = new EventClient(() => LEARNER);
    c.queueBeat('l1', 3);
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect((beacon.mock.calls[0] as unknown[])[0]).toBe('/api/events');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('splits batches larger than 50 and reuses event ids on a resend of beats', async () => {
    const c = new EventClient(() => LEARNER);
    for (let i = 0; i < 120; i++) c.queueBeat('l1', i);
    await c.flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(0).events).toHaveLength(50);
    expect(bodyOf(2).events).toHaveLength(20);
  });

  it('send returns the server result, and null on failure while keeping beats queued with the same ids', async () => {
    const c = new EventClient(() => LEARNER);
    c.queueBeat('l1', 0);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await c.send({ type: 'lessonCompleted', lessonId: 'l1' })).toBeNull();
    const firstBeatId = bodyOf(0).events[0].eventId;
    const r = await c.send({ type: 'lessonCompleted', lessonId: 'l1' });
    expect(r?.ok).toBe(true);
    expect(bodyOf(1).events[0].eventId).toBe(firstBeatId);
  });

  it('send returns null on a 5xx', async () => {
    const c = new EventClient(() => LEARNER);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    expect(await c.send({ type: 'lessonCompleted', lessonId: 'l1' })).toBeNull();
  });
});
