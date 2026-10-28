// @vitest-environment happy-dom
// Non-beat events that fail to reach the course server are kept and resent with the same eventId (final
// review I8): with the LRS shadow on, the course server is the only writer of the official record.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEAT_FLUSH_MS, EventClient, OUTBOX_KEY, SEND_TIMEOUT_MS } from '../../src/record/eventClient';
import { resetSession } from '../../src/record/session';
import { phasesUpTo, restoreFlags } from '../helpers/flags';

let outcomes: ('ok' | 'offline' | number)[];
let sessionDelay = 0;
let eventDelay = 0;
let fetchMock: ReturnType<typeof vi.fn>;
const eventBodies = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/events').map((c) => JSON.parse(c[1].body).events as { eventId: string; type: string }[]);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetSession();
  outcomes = [];
  sessionDelay = 0;
  eventDelay = 0;
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/session') {
      if (sessionDelay) await new Promise((r) => setTimeout(r, sessionDelay));
      return new Response(JSON.stringify({ actor: { homePage: 'h', name: 'n' } }), { status: 200 });
    }
    const o = outcomes.shift() ?? 'ok';
    if (o === 'offline') throw new Error('offline');
    if (typeof o === 'number') return new Response('{}', { status: o });
    if (eventDelay) await new Promise((r) => setTimeout(r, eventDelay));
    if (init.signal?.aborted) throw new Error('aborted');
    const events = JSON.parse(String(init.body)).events as { eventId: string }[];
    return new Response(JSON.stringify({ results: events.map((e) => ({ eventId: e.eventId, ok: true, statements: [] })) }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  restoreFlags();
  resetSession();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const stored = () => JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as { eventId: string; type: string }[];

describe('event outbox (lrsShadow on)', () => {
  beforeEach(() => phasesUpTo('lrsShadow'));

  it('a failed lessonCompleted is kept and resent with the same eventId on the next flush', async () => {
    outcomes = ['offline'];
    const c = new EventClient(() => 'l');
    expect(await c.send({ type: 'lessonCompleted', lessonId: 'a' })).toBeNull();
    const [kept] = stored();
    expect(kept.type).toBe('lessonCompleted');
    await vi.advanceTimersByTimeAsync(BEAT_FLUSH_MS);
    const last = eventBodies().at(-1)!;
    expect(last.map((e) => e.eventId)).toEqual([kept.eventId]);
    expect(stored()).toEqual([]);
  });

  it('a kept event goes first in the next send, and survives a reload', async () => {
    outcomes = [503];
    await new EventClient(() => 'l').send({ type: 'checkpointAnswered', lessonId: 'a', response: 'r', outcome: 'advance' } as never);
    const [kept] = stored();
    const reloaded = new EventClient(() => 'l');
    await reloaded.send({ type: 'lessonCompleted', lessonId: 'a' });
    const last = eventBodies().at(-1)!;
    expect(last[0].eventId).toBe(kept.eventId);
    expect(last[1].type).toBe('lessonCompleted');
    expect(stored()).toEqual([]);
  });

  it('a page load with a kept event resends it without waiting for an action', async () => {
    outcomes = ['offline'];
    await new EventClient(() => 'l').send({ type: 'lessonCompleted', lessonId: 'a' });
    const [kept] = stored();
    new EventClient(() => 'l');
    await vi.advanceTimersByTimeAsync(BEAT_FLUSH_MS);
    expect(eventBodies().at(-1)!.map((e) => e.eventId)).toEqual([kept.eventId]);
  });

  it('an event the server refused (400) is not kept', async () => {
    outcomes = [400];
    await new EventClient(() => 'l').send({ type: 'lessonCompleted', lessonId: 'a' });
    expect(stored()).toEqual([]);
  });

  it('discard drops the kept events', async () => {
    outcomes = ['offline'];
    const c = new EventClient(() => 'l');
    await c.send({ type: 'lessonCompleted', lessonId: 'a' });
    c.discard();
    expect(stored()).toEqual([]);
  });
});

describe('event outbox with lrsShadow off (today)', () => {
  it('keeps nothing, as before', async () => {
    outcomes = ['offline'];
    await new EventClient(() => 'l').send({ type: 'lessonCompleted', lessonId: 'a' });
    expect(localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });
});

describe('send timeout and the session (senseiLearners on)', () => {
  it('a slow first session does not use up the send window', async () => {
    phasesUpTo('senseiLearners');
    sessionDelay = SEND_TIMEOUT_MS - 1000;
    eventDelay = 2000;
    const c = new EventClient(() => 'l');
    const p = c.send({ type: 'lessonCompleted', lessonId: 'a' });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 3000);
    expect((await p)?.ok).toBe(true);
  });
});
