// @vitest-environment happy-dom
// Delete my data together with State sync, the event client and the badges (final review I3, M4).
// The unit tests each mock the others away; this one wires the real modules together.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/preact';
import { content } from '../../src/content';
import { useBadges } from '../../src/badges/badges';
import { deleteMyDataDetailed, ensureSession, resetSession } from '../../src/record/session';
import { STATE_DEBOUNCE_MS, notifyFileEdited, startStateSync, stateSyncMessage } from '../../src/record/stateSync';
import { setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from '../components/helpers';

const ACTOR = { homePage: 'https://learnwp.sqwrlz.com', name: 'old-actor' };
const lessons = Object.keys(content.lessons);
let calls: { url: string; method: string }[];
let stateStatus = 200;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  resetSession();
  calls = [];
  stateStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method });
      if (url === '/api/session' && method === 'GET') return new Response(JSON.stringify({ actor: ACTOR }), { status: 200 });
      if (url === '/api/session' && method === 'POST') return new Response(JSON.stringify({ actor: { ...ACTOR, name: 'new-actor' } }), { status: 200 });
      if (url === '/api/session' && method === 'DELETE') return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      if (url.startsWith('/api/state/')) return new Response(JSON.stringify({ doc: null, etag: null }), { status: stateStatus });
      if (url === '/api/badges') return new Response(JSON.stringify([{ id: 'b1', pathId: 'block-theme', name: 'B', status: 'pending', testedOut: 0 }]), { status: 200 });
      if (url === '/api/events') {
        const events = JSON.parse(String(init.body)).events as { eventId: string }[];
        return new Response(JSON.stringify({ results: events.map((e) => ({ eventId: e.eventId, ok: true, statements: [] })) }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  resetSession();
  setRecordManager(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const after = (i: number) => calls.slice(i);

describe('Delete my data with State sync running', () => {
  it('a pending edit makes no new session and no State request after the delete', async () => {
    const m = memoryManager(content);
    setRecordManager(m);
    await m.init();
    const stop = startStateSync(m);
    await ensureSession();
    await m.dispatch({ type: 'beatViewed', lessonId: lessons[0], beatIndex: 0 });
    await m.dispatch({ type: 'fileEdited', file: 'style.css', content: 'a', lessonId: lessons[0] });
    notifyFileEdited('style.css');
    const at = calls.length;
    expect(await deleteMyDataDetailed()).toBe('deleted');
    await vi.advanceTimersByTimeAsync(STATE_DEBOUNCE_MS * 3);
    expect(after(at).filter((c) => c.url === '/api/session' && c.method === 'POST')).toEqual([]);
    expect(after(at).filter((c) => c.url.startsWith('/api/state/'))).toEqual([]);
    stop();
  });

  it('a write that failed earlier (still dirty) is not retried under a new session', async () => {
    const m = memoryManager(content);
    setRecordManager(m);
    await m.init();
    const stop = startStateSync(m);
    stateStatus = 500;
    await m.dispatch({ type: 'beatViewed', lessonId: lessons[0], beatIndex: 0 });
    await m.dispatch({ type: 'fileEdited', file: 'style.css', content: 'a', lessonId: lessons[0] });
    notifyFileEdited('style.css');
    await vi.advanceTimersByTimeAsync(STATE_DEBOUNCE_MS + 10);
    stateStatus = 200;
    const at = calls.length;
    await deleteMyDataDetailed();
    await vi.advanceTimersByTimeAsync(STATE_DEBOUNCE_MS * 3);
    expect(after(at).filter((c) => c.url === '/api/session' && c.method === 'POST')).toEqual([]);
    expect(after(at).filter((c) => c.url.startsWith('/api/state/'))).toEqual([]);
    expect(stateSyncMessage()).toBeNull();
    stop();
  });
});

describe('Delete my data and the badges', () => {
  it('badges shown before the delete are cleared', async () => {
    setRecordManager(memoryManager(content));
    vi.useRealTimers();
    const { result } = renderHook(() => useBadges(true));
    await waitFor(() => expect(result.current?.length).toBe(1));
    await act(async () => {
      await deleteMyDataDetailed();
    });
    expect(result.current).toBeNull();
  });
});

