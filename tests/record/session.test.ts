// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURES } from '../../src/config';
import { content } from '../../src/content';
import { EventClient } from '../../src/record/eventClient';
import { deleteMyData, deleteMyDataDetailed, currentActor, ensureSession, forgetSession, resetSession } from '../../src/record/session';
import { RecordManager, type RecordStore } from '../../src/record/store';
import { setRecordManager } from '../../src/record/useRecord';
import type { LearningRecord } from '../../src/shared/record';

const flags = FEATURES as { sessions: boolean };
const ACTOR = { homePage: 'https://learn.example/xapi', name: 'learner-abc' };
const lessonId = Object.keys(content.lessons)[0];

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let calls: { url: string; method: string }[];
function stubFetch(routes: Record<string, Handler>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method });
      const h = routes[`${method} ${url}`];
      if (!h) throw new Error(`unexpected ${method} ${url}`);
      return h(url, init);
    }),
  );
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const count = (method: string, url = '/api/session') => calls.filter((c) => c.method === method && c.url === url).length;

function memStore(): RecordStore & { saved: LearningRecord | null } {
  const s = {
    kind: 'memory' as const,
    saved: null as LearningRecord | null,
    load: async () => s.saved,
    save: async (r: LearningRecord) => {
      s.saved = r;
    },
  };
  return s;
}

beforeEach(() => {
  flags.sessions = true;
  resetSession();
});
afterEach(() => {
  flags.sessions = false;
  setRecordManager(null);
  vi.unstubAllGlobals();
});

describe('ensureSession', () => {
  it('makes one request for concurrent callers', async () => {
    stubFetch({
      'GET /api/session': async () => json({ actor: null }),
      'POST /api/session': async () => json({ actor: ACTOR }),
    });
    const [a, b, c] = await Promise.all([ensureSession(), ensureSession(), ensureSession()]);
    expect(a).toEqual(ACTOR);
    expect(b).toEqual(ACTOR);
    expect(c).toEqual(ACTOR);
    expect(count('GET')).toBe(1);
    expect(count('POST')).toBe(1);
    await ensureSession();
    expect(calls).toHaveLength(2); // remembered
  });

  it('uses the session a cookie already carries instead of making a new one', async () => {
    stubFetch({ 'GET /api/session': async () => json({ actor: ACTOR }) });
    expect(await ensureSession()).toEqual(ACTOR);
    expect(count('POST')).toBe(0);
  });

  it('returns null on 429 and retries next time', async () => {
    let post = 0;
    stubFetch({
      'GET /api/session': async () => json({ actor: null }),
      'POST /api/session': async () => (++post === 1 ? json({ error: { code: 'limited' } }, 429) : json({ actor: ACTOR })),
    });
    expect(await ensureSession()).toBeNull();
    expect(await ensureSession()).toEqual(ACTOR);
    expect(count('POST')).toBe(2);
  });

  it('returns null on 503 and on network failure', async () => {
    stubFetch({ 'GET /api/session': async () => json({ error: { code: 'disabled' } }, 503) });
    expect(await ensureSession()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await ensureSession()).toBeNull();
  });

  it('a stale request finishing does not clobber a newer one', async () => {
    const gates: (() => void)[] = [];
    stubFetch({
      'GET /api/session': () => new Promise<Response>((r) => gates.push(() => r(json({ actor: ACTOR })))),
    });
    const first = ensureSession();
    await Promise.resolve();
    forgetSession();
    const second = ensureSession();
    await Promise.resolve();
    expect(count('GET')).toBe(2);
    gates[0]();
    await first;
    const third = ensureSession(); // must share the second request, not start a third
    expect(count('GET')).toBe(2);
    gates[1]();
    expect(await Promise.all([second, third])).toEqual([ACTOR, ACTOR]);
  });

  it('makes no request when the sessions feature is off', async () => {
    flags.sessions = false;
    stubFetch({});
    expect(await ensureSession()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('sessions and the event client', () => {
  it('the record takes the session actor as its learnerId', async () => {
    stubFetch({
      'GET /api/session': async () => json({ actor: null }),
      'POST /api/session': async () => json({ actor: ACTOR }),
      'POST /api/events': async () => json({ results: [] }),
    });
    const m = new RecordManager(memStore(), content, new EventClient(() => m.record.learnerId));
    const before = m.record.learnerId;
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
    expect(before).not.toBe(ACTOR.name);
    expect(m.record.learnerId).toBe(ACTOR.name);
    expect(m.record.statements.length).toBeGreaterThan(0);
  });

  it('a 401 no-session keeps local statements and the next action asks for a session again', async () => {
    let post = 0;
    stubFetch({
      'GET /api/session': async () => json({ actor: ACTOR }),
      'POST /api/events': async () => (++post === 1 ? json({ error: { code: 'no-session' } }, 401) : json({ results: [] })),
    });
    const m = new RecordManager(memStore(), content, new EventClient(() => m.record.learnerId));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
    expect(m.record.statements.length).toBeGreaterThan(0);
    expect(count('GET')).toBe(1);
    await m.dispatch({ type: 'lessonCompleted', lessonId: Object.keys(content.lessons)[1] });
    await m.settled();
    expect(count('GET')).toBe(2);
  });

  it('a failed session does not stop events from being sent', async () => {
    stubFetch({
      'GET /api/session': async () => json({ error: { code: 'disabled' } }, 503),
      'POST /api/events': async () => json({ results: [] }),
    });
    const m = new RecordManager(memStore(), content, new EventClient(() => m.record.learnerId));
    const before = m.record.learnerId;
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
    expect(count('POST', '/api/events')).toBe(1);
    expect(m.record.learnerId).toBe(before);
  });
});

describe('deleteMyData', () => {
  async function recorded() {
    const store = memStore();
    const m = new RecordManager(store, content, new EventClient(() => m.record.learnerId));
    setRecordManager(m);
    flags.sessions = false; // no session traffic while the record is built
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
    flags.sessions = true;
    return { m, store };
  }

  it('clears the browser record after the server confirms', async () => {
    const { m, store } = await recorded();
    const oldId = m.record.learnerId;
    expect(m.record.statements.length).toBeGreaterThan(0);
    stubFetch({ 'DELETE /api/session': async () => json({ deleted: true }) });
    expect(await deleteMyData()).toBe(true);
    expect(m.record.statements).toHaveLength(0);
    expect(m.record.completedLessons).toHaveLength(0);
    expect(m.record.learnerId).not.toBe(oldId);
    expect(store.saved?.statements).toHaveLength(0);
  });

  it('leaves the record alone when the server fails', async () => {
    const { m } = await recorded();
    const before = m.record;
    stubFetch({ 'DELETE /api/session': async () => json({ error: { code: 'x' } }, 500) });
    expect(await deleteMyData()).toBe(false);
    expect(m.record).toBe(before);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await deleteMyData()).toBe(false);
    expect(m.record).toBe(before);
  });

  it('reports a browser failure after the server delete succeeded', async () => {
    const { m } = await recorded();
    vi.spyOn(m, 'reset').mockRejectedValue(new Error('disk'));
    stubFetch({
      'GET /api/session': async () => json({ actor: ACTOR }),
      'DELETE /api/session': async () => json({ deleted: true }),
    });
    await ensureSession();
    expect(await deleteMyDataDetailed()).toBe('browser-failed');
    expect(await deleteMyData()).toBe(false);
    expect(currentActor()).toBeNull(); // the server delete stands
  });

  it('forgets the session so the next action starts a new one', async () => {
    stubFetch({
      'GET /api/session': async () => json({ actor: ACTOR }),
      'DELETE /api/session': async () => json({ deleted: true }),
    });
    await ensureSession();
    await recorded();
    stubFetch({
      'GET /api/session': async () => json({ actor: null }),
      'DELETE /api/session': async () => json({ deleted: true }),
      'POST /api/session': async () => json({ actor: { ...ACTOR, name: 'learner-new' } }),
    });
    await deleteMyData();
    expect((await ensureSession())?.name).toBe('learner-new');
  });

  it('drops events that were waiting to be sent', async () => {
    const { m } = await recorded();
    const client = new EventClient(() => m.record.learnerId);
    client.queueBeat('l1', 0);
    stubFetch({ 'DELETE /api/session': async () => json({ deleted: true }) });
    const { getEventClient } = await import('../../src/record/eventClient');
    const shared = getEventClient();
    shared.queueBeat('l1', 1);
    const spy = vi.spyOn(shared, 'discard');
    await deleteMyData();
    expect(spy).toHaveBeenCalled();
    await shared.flush();
    expect(calls.filter((c) => c.url === '/api/events')).toHaveLength(0);
  });
});
