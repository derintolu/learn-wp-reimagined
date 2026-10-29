// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEAT_FLUSH_MS, EventClient } from '../../src/record/eventClient';
import { resetSession } from '../../src/record/session';

const LEARNER = '11111111-2222-4333-8444-555555555555';
let fetchMock: ReturnType<typeof vi.fn>;
/** Only the /api/events requests: sessions are on, so /api/session requests come first and are not what these tests are about. */
const eventCalls = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/events');
const sessionCalls = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/session');
const bodyOf = (i: number) => JSON.parse(eventCalls()[i][1].body);
/** Outcomes for the next /api/events requests, in order; anything not listed succeeds. */
let eventOutcomes: ('ok' | 'offline' | '500')[];
let sessionMode: 'ok' | 'offline';
const okResponse = (events: { eventId: string }[]) =>
  ({ ok: true, json: async () => ({ results: events.map((e) => ({ eventId: e.eventId, ok: true, statements: [] })) }) }) as Response;

beforeEach(() => {
  // Failed non-beat events are kept and resent (event-outbox.test.ts has that); each test starts with none kept.
  localStorage.clear();
  vi.useFakeTimers();
  resetSession();
  eventOutcomes = [];
  sessionMode = 'ok';
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/session') {
      if (sessionMode === 'offline') throw new Error('offline');
      return { ok: true, json: async () => ({ actor: { homePage: 'https://learnwp.sqwrlz.com/', name: 'Learner' } }) } as Response;
    }
    const outcome = eventOutcomes.shift() ?? 'ok';
    if (outcome === 'offline') throw new Error('offline');
    if (outcome === '500') return { ok: false, status: 500 } as Response;
    return okResponse(JSON.parse(init.body as string).events);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  resetSession();
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
    expect(eventCalls()).toHaveLength(1);
    const body = bodyOf(0);
    expect(body.learnerId).toBe(LEARNER);
    expect(body.events.map((e: { beatIndex: number }) => e.beatIndex)).toEqual([0, 1]);
  });

  it('flush sends immediately', async () => {
    const c = new EventClient(() => LEARNER);
    c.queueBeat('l1', 0);
    await c.flush();
    expect(eventCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(BEAT_FLUSH_MS * 2);
    expect(eventCalls()).toHaveLength(1);
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

  it('opening a lesson sends lessonOpened without awaiting it', async () => {
    const eventFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => (url === '/api/events' ? new Promise<Response>(() => {}) : eventFetch(url, init)));
    const c = new EventClient(() => LEARNER);
    // Returns nothing to wait for, even though the server never answers.
    expect(c.lessonOpened('l1')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(eventCalls()).toHaveLength(1);
    expect(bodyOf(0).events).toMatchObject([{ type: 'lessonOpened', lessonId: 'l1' }]);
    c.lessonLeft(); // this client's pagehide listener outlives the test
  });

  it('leaving sends lessonLeft once for the open lesson, after the queued beats', async () => {
    const c = new EventClient(() => LEARNER);
    c.lessonOpened('l1');
    await vi.advanceTimersByTimeAsync(0);
    c.queueBeat('l1', 1);
    c.lessonLeft();
    c.lessonLeft();
    await vi.advanceTimersByTimeAsync(0);
    const types = eventCalls().flatMap((_, i) => bodyOf(i).events.map((e: { type: string }) => e.type));
    expect(types).toEqual(['lessonOpened', 'beatViewed', 'lessonLeft']);
  });

  it('pagehide beacons lessonLeft for the open lesson, once', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    const c = new EventClient(() => LEARNER);
    c.lessonOpened('l1');
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    c.lessonLeft();
    expect(eventCalls().every((_, i) => bodyOf(i).events.every((e: { type: string }) => e.type !== 'lessonLeft'))).toBe(true);
  });

  it('splits batches larger than 50 into several requests', async () => {
    const c = new EventClient(() => LEARNER);
    for (let i = 0; i < 120; i++) c.queueBeat('l1', i);
    await c.flush();
    expect(eventCalls()).toHaveLength(3);
    expect(bodyOf(0).events).toHaveLength(50);
    expect(bodyOf(2).events).toHaveLength(20);
  });

  it('send returns the server result, and null on failure while keeping beats queued with the same ids', async () => {
    const c = new EventClient(() => LEARNER);
    c.queueBeat('l1', 0);
    eventOutcomes = ['offline'];
    expect(await c.send({ type: 'lessonCompleted', lessonId: 'l1' })).toBeNull();
    const [firstBeatId, failedId] = bodyOf(0).events.map((e: { eventId: string }) => e.eventId);
    const r = await c.send({ type: 'lessonCompleted', lessonId: 'l1' });
    expect(r?.ok).toBe(true);
    // The kept event goes first, then the queued beat, then the new event.
    expect(bodyOf(1).events.map((e: { eventId: string }) => e.eventId).slice(0, 2)).toEqual([failedId, firstBeatId]);
  });

  it('send returns null on a 5xx', async () => {
    const c = new EventClient(() => LEARNER);
    eventOutcomes = ['500'];
    expect(await c.send({ type: 'lessonCompleted', lessonId: 'l1' })).toBeNull();
  });

  it('a failed beat flush followed by a pagehide beacon sends the same event ids', async () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    const c = new EventClient(() => LEARNER);
    c.queueBeat('l1', 0);
    c.queueBeat('l1', 1);
    eventOutcomes = ['offline'];
    await c.flush();
    const failedIds = bodyOf(0).events.map((e: { eventId: string }) => e.eventId);
    window.dispatchEvent(new Event('pagehide'));
    const sent = JSON.parse(await ((beacon.mock.calls[0] as unknown[])[1] as Blob).text());
    expect(sent.events.map((e: { eventId: string }) => e.eventId)).toEqual(failedIds);
  });

  it('re-arms the flush timer when a failed batch is queued again', async () => {
    const c = new EventClient(() => LEARNER);
    c.queueBeat('l1', 0);
    eventOutcomes = ['offline'];
    await c.flush();
    expect(eventCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(BEAT_FLUSH_MS);
    expect(eventCalls()).toHaveLength(2);
  });

  it('asks the server for the session before the first send, and only once', async () => {
    const c = new EventClient(() => LEARNER);
    await c.send({ type: 'lessonCompleted', lessonId: 'l1' });
    await c.send({ type: 'lessonCompleted', lessonId: 'l2' });
    expect(sessionCalls().map((x) => x[1].method)).toEqual(['GET']);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/session');
    expect(eventCalls()).toHaveLength(2);
  });

  it('still sends events when the session request fails', async () => {
    sessionMode = 'offline';
    const c = new EventClient(() => LEARNER);
    const r = await c.send({ type: 'lessonCompleted', lessonId: 'l1' });
    expect(r?.ok).toBe(true);
    expect(sessionCalls().length).toBeGreaterThan(0);
    expect(eventCalls()).toHaveLength(1);
    expect(bodyOf(0).learnerId).toBe(LEARNER);
  });
});
