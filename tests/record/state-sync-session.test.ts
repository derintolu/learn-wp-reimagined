// @vitest-environment happy-dom
// State sync with the real session module (final review I4): a page load, a read or the finale fallback
// never makes a session; only a learner's edit may.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { content } from '../../src/content';
import { resetSession } from '../../src/record/session';
import { STATE_DEBOUNCE_MS, fetchFilesState, notifyFileEdited, startStateSync } from '../../src/record/stateSync';
import { RecordManager } from '../../src/record/store';
import { applyEvent, newRecord, type LearningRecord } from '../../src/shared/record';

const lessons = Object.keys(content.lessons);
let calls: { url: string; method: string }[];
let hasSession: boolean;
let remoteFiles: unknown;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  resetSession();
  calls = [];
  hasSession = false;
  remoteFiles = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method });
      if (url === '/api/session' && method === 'GET') return new Response(JSON.stringify({ actor: hasSession ? { homePage: 'h', name: 'n' } : null }), { status: 200 });
      if (url === '/api/session' && method === 'POST') {
        hasSession = true;
        return new Response(JSON.stringify({ actor: { homePage: 'h', name: 'n' } }), { status: 200 });
      }
      if (url === '/api/state/files' && method === 'GET') return new Response(JSON.stringify({ doc: remoteFiles, etag: remoteFiles ? '"v1"' : null }), { status: 200 });
      if (url === '/api/state/resume' && method === 'GET') return new Response(JSON.stringify({ doc: null, etag: null }), { status: 200 });
      if (method === 'PUT') return new Response(JSON.stringify({ etag: '"v2"' }), { status: 200 });
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => {
  resetSession();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A returning learner's stored record: a lesson open and a file saved on an earlier visit. */
function saved(): LearningRecord {
  let r = newRecord();
  r = applyEvent(r, { type: 'beatViewed', lessonId: lessons[0], beatIndex: 1 }, content);
  r = applyEvent(r, { type: 'fileEdited', file: 'style.css', content: 'body{}', lessonId: lessons[0] }, content);
  return r;
}
/** A manager whose saved record loads after State sync has started, as on a real page load. */
function reloaded(r: LearningRecord) {
  return new RecordManager({ kind: 'indexeddb', load: async () => r, save: async () => {} }, content);
}
const posts = () => calls.filter((c) => c.url === '/api/session' && c.method === 'POST');
const state = (method?: string) => calls.filter((c) => c.url.startsWith('/api/state/') && (!method || c.method === method));

describe('State sync on a page load', () => {
  it('a returning learner with no session: no session is made and nothing is written', async () => {
    const m = reloaded(saved());
    const stop = startStateSync(m);
    await m.init();
    await vi.advanceTimersByTimeAsync(STATE_DEBOUNCE_MS * 3);
    expect(posts()).toEqual([]);
    expect(state()).toEqual([]);
    expect(calls.filter((c) => c.url === '/api/session')).toHaveLength(1); // one look, remembered
    stop();
  });

  it('loading the saved record is not a lesson change: no resume write, and files wait for the debounce', async () => {
    hasSession = true;
    const m = reloaded(saved());
    const stop = startStateSync(m);
    await m.init();
    await vi.advanceTimersByTimeAsync(STATE_DEBOUNCE_MS - 10);
    expect(state()).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(state('PUT').map((c) => c.url)).toEqual(['/api/state/files']);
    stop();
  });

  it('files already stored as they are here: one read, no write', async () => {
    hasSession = true;
    const r = saved();
    remoteFiles = { files: r.files, fileLessons: r.fileLessons, times: r.fileTimes };
    const m = reloaded(r);
    const stop = startStateSync(m);
    await m.init();
    await vi.advanceTimersByTimeAsync(STATE_DEBOUNCE_MS * 3);
    expect(state('GET').map((c) => c.url)).toEqual(['/api/state/files']);
    expect(state('PUT')).toEqual([]);
    stop();
  });

  it('a learner edit may make the session, and is written', async () => {
    const m = reloaded(newRecord());
    const stop = startStateSync(m);
    await m.init();
    await m.dispatch({ type: 'fileEdited', file: 'style.css', content: 'x', lessonId: lessons[0] });
    notifyFileEdited('style.css');
    await vi.advanceTimersByTimeAsync(STATE_DEBOUNCE_MS + 10);
    expect(posts()).toHaveLength(1);
    expect(state('PUT').map((c) => c.url)).toContain('/api/state/files');
    stop();
  });
});

describe('fetchFilesState (the finale fallback)', () => {
  it('a visitor with no session: no session is made', async () => {
    expect(await fetchFilesState()).toBeNull();
    expect(posts()).toEqual([]);
    expect(state()).toEqual([]);
  });
});
