// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURES } from '../../src/config';
import { content } from '../../src/content';
import { STATE_DEBOUNCE_MS, fetchFilesState, notifyFileEdited, startStateSync, stateSyncMessage } from '../../src/record/stateSync';
import { STATE_MAX_BYTES, STATE_TOO_BIG_MESSAGE, type FilesDoc, type ResumeDoc } from '../../src/shared/stateDoc';
import { memoryManager } from '../components/helpers';
import type { RecordManager } from '../../src/record/store';

vi.mock('../../src/record/session', () => ({ ensureSession: async () => ({ homePage: 'h', name: 'n' }) }));

const flags = FEATURES as { officialRecord: boolean };
const lessons = Object.keys(content.lessons);

/** A course server holding the two State documents with ETags, as /api/state does. */
function fakeServer() {
  const s = {
    docs: { files: null as unknown, resume: null as unknown },
    version: { files: 0, resume: 0 },
    puts: [] as { kind: string; ifMatch: string | null; body: any }[],
    gets: 0,
    forceStatus: 0,
    fetch: vi.fn(async (url: string, init: RequestInit = {}) => {
      if (!url.startsWith('/api/state/')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      const kind = url.replace('/api/state/', '') as 'files' | 'resume';
      const etag = () => (s.version[kind] ? `"v${s.version[kind]}"` : null);
      if ((init.method ?? 'GET') === 'GET') {
        s.gets++;
        return new Response(JSON.stringify({ doc: s.docs[kind], etag: etag() }), { status: 200 });
      }
      const body = JSON.parse(String(init.body));
      const ifMatch = new Headers(init.headers).get('If-Match');
      s.puts.push({ kind, ifMatch, body });
      if (s.forceStatus) return new Response(JSON.stringify({ error: { code: 'too-large' } }), { status: s.forceStatus });
      if ((ifMatch ?? null) !== etag()) return new Response(JSON.stringify({ error: { code: 'conflict' } }), { status: 412 });
      s.docs[kind] = body;
      s.version[kind]++;
      return new Response(JSON.stringify({ etag: etag() }), { status: 200 });
    }),
  };
  return s;
}

let server: ReturnType<typeof fakeServer>;
let m: RecordManager;
let stop: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
  flags.officialRecord = true;
  server = fakeServer();
  vi.stubGlobal('fetch', server.fetch);
  m = memoryManager(content);
  await m.init();
  stop = startStateSync(m);
});
afterEach(() => {
  stop();
  flags.officialRecord = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const edit = async (file: string, text: string, lessonId = lessons[0]) => {
  await m.dispatch({ type: 'fileEdited', file, content: text, lessonId });
  notifyFileEdited(file);
};
const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const stateCalls = () => server.fetch.mock.calls.filter((c) => String(c[0]).startsWith('/api/state/'));
const filesPuts = () => server.puts.filter((p) => p.kind === 'files');

describe('startStateSync', () => {
  it('does nothing with the flag off', async () => {
    stop();
    flags.officialRecord = false;
    stop = startStateSync(m);
    await edit('a.css', 'x');
    await settle(STATE_DEBOUNCE_MS * 3);
    expect(stateCalls()).toHaveLength(0);
  });

  it('sync waits 2 s after the last edit', async () => {
    expect(STATE_DEBOUNCE_MS).toBe(2000);
    await edit('a.css', '1');
    await settle(1999);
    expect(filesPuts()).toHaveLength(0);
    await settle(1000); // an edit 1 s later restarts the wait
    expect(filesPuts()).toHaveLength(1);
    await edit('a.css', '2');
    await settle(1500);
    await edit('a.css', '3');
    await settle(1999);
    expect(filesPuts()).toHaveLength(1);
    await settle(1);
    expect(filesPuts()).toHaveLength(2);
    expect((server.docs.files as FilesDoc).files['a.css']).toBe('3');
  });

  it('writes the files, their lessons and edit times', async () => {
    await edit('a.css', '1');
    await settle(STATE_DEBOUNCE_MS);
    expect(server.docs.files).toEqual({
      files: { 'a.css': '1' },
      fileLessons: { 'a.css': lessons[0] },
      times: { 'a.css': '2026-10-28T10:00:00.000Z' },
    });
  });

  it('writes the resume position on a lesson change, without waiting', async () => {
    await m.dispatch({ type: 'beatViewed', lessonId: lessons[0], beatIndex: 0 });
    await settle(0);
    const first = server.puts.filter((p) => p.kind === 'resume').length;
    await m.dispatch({ type: 'beatViewed', lessonId: lessons[1], beatIndex: 0 });
    await settle(0);
    const resumes = server.puts.filter((p) => p.kind === 'resume');
    expect(resumes.length).toBe(first + 1);
    expect((resumes.at(-1)!.body as ResumeDoc).current.lessonId).toBe(lessons[1]);
  });

  it('concurrent writers do not lose a file: a 412 refetches, merges and retries', async () => {
    await edit('a.css', 'mine');
    await settle(STATE_DEBOUNCE_MS);
    expect(filesPuts()).toHaveLength(1);
    // An agent saves b.css meanwhile, moving the ETag.
    const cur = server.docs.files as FilesDoc;
    server.docs.files = { ...cur, files: { ...cur.files, 'b.css': 'agent' }, times: { ...cur.times, 'b.css': '2026-10-28T10:00:01.000Z' } };
    server.version.files++;
    await edit('c.css', 'mine too');
    await settle(STATE_DEBOUNCE_MS);
    const doc = server.docs.files as FilesDoc;
    expect(doc.files).toEqual({ 'a.css': 'mine', 'b.css': 'agent', 'c.css': 'mine too' });
    const last = filesPuts().slice(-2);
    expect(last[0].ifMatch).not.toBe(last[1].ifMatch);
  });

  it('a first write over a document that already exists keeps the other writer\'s files', async () => {
    server.docs.files = { files: { 'b.css': 'agent' }, times: { 'b.css': '2026-10-28T09:00:00.000Z' } };
    server.version.files = 1;
    await edit('a.css', 'mine');
    await settle(STATE_DEBOUNCE_MS);
    expect((server.docs.files as FilesDoc).files).toEqual({ 'a.css': 'mine', 'b.css': 'agent' });
  });

  it('keeps the newest copy of a file both writers changed', async () => {
    server.docs.files = { files: { 'a.css': 'agent' }, times: { 'a.css': '2026-10-28T10:00:05.000Z' } };
    server.version.files = 1;
    await edit('a.css', 'mine'); // edited at 10:00:00, older than the agent's
    await settle(STATE_DEBOUNCE_MS);
    expect((server.docs.files as FilesDoc).files['a.css']).toBe('agent');
    await edit('a.css', 'mine again'); // now 10:00:04+
    await settle(10_000);
    expect((server.docs.files as FilesDoc).files['a.css']).toBe('mine again');
  });

  it('a reload before the sync does not let an older remote copy beat the local edit', async () => {
    server.docs.files = { files: { 'a.css': 'old remote' }, times: { 'a.css': '2026-10-28T09:00:00.000Z' } };
    server.version.files = 1;
    await edit('a.css', 'unsynced local');
    await settle(500);
    stop(); // the page goes away before the 2 s timer fires
    expect(filesPuts()).toHaveLength(0);
    vi.setSystemTime(new Date('2026-10-28T10:05:00.000Z'));
    stop = startStateSync(m); // the reloaded page: same stored record
    await settle(STATE_DEBOUNCE_MS);
    expect((server.docs.files as FilesDoc).files['a.css']).toBe('unsynced local');
  });

  it('a local file with no recorded time that differs from the last-synced copy counts as a local edit', async () => {
    server.docs.files = { files: { 'a.css': 'remote' }, times: { 'a.css': '2026-10-28T09:00:00.000Z' } };
    server.version.files = 1;
    stop();
    await m.restore({ ...m.record, files: { 'a.css': 'legacy local' }, fileTimes: undefined, updatedAt: '2026-10-28T09:30:00.000Z' });
    stop = startStateSync(m);
    await settle(STATE_DEBOUNCE_MS);
    expect((server.docs.files as FilesDoc).files['a.css']).toBe('legacy local');
  });

  it('an edit made while a write is in flight stays unsynced until its own write', async () => {
    await edit('a.css', '1');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = server.fetch.getMockImplementation()!;
    server.fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT' && url.endsWith('/files') && !server.puts.length) await gate;
      return real(url, init);
    });
    await settle(STATE_DEBOUNCE_MS); // first write starts and waits on the gate
    await edit('b.css', '2'); // typed while it is in flight
    await m.dispatch({ type: 'beatViewed', lessonId: lessons[1], beatIndex: 0 }); // a lesson change cancels the timer
    release();
    await settle(STATE_DEBOUNCE_MS * 2);
    expect((server.docs.files as FilesDoc).files).toEqual({ 'a.css': '1', 'b.css': '2' });
  });

  it('retries a conflict once, then waits for the next edit', async () => {
    await edit('a.css', '1');
    await settle(STATE_DEBOUNCE_MS);
    const real = server.fetch.getMockImplementation()!;
    server.fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT' && url.endsWith('/files')) {
        server.puts.push({ kind: 'files', ifMatch: new Headers(init.headers).get('If-Match'), body: JSON.parse(String(init.body)) });
        return new Response('{}', { status: 412 });
      }
      return real(url, init);
    });
    const before = filesPuts().length;
    await edit('a.css', '2');
    await settle(STATE_DEBOUNCE_MS * 5);
    expect(filesPuts().length - before).toBe(2);
  });

  it('over 2 MB shows the plain message and sends nothing; local editing is untouched', async () => {
    await edit('big.txt', 'x'.repeat(STATE_MAX_BYTES));
    await settle(STATE_DEBOUNCE_MS);
    expect(filesPuts()).toHaveLength(0);
    expect(stateSyncMessage()).toBe("Your files are too big to sync. They're still saved in this browser.");
    expect(STATE_TOO_BIG_MESSAGE).toBe(stateSyncMessage());
    expect(m.record.files['big.txt']).toHaveLength(STATE_MAX_BYTES);
  });

  it('shows the same message when the server answers too-large, and clears it once files fit', async () => {
    server.forceStatus = 413;
    await edit('a.css', '1');
    await settle(STATE_DEBOUNCE_MS);
    expect(stateSyncMessage()).toBe(STATE_TOO_BIG_MESSAGE);
    server.forceStatus = 0;
    await edit('a.css', '2');
    await settle(STATE_DEBOUNCE_MS);
    expect(stateSyncMessage()).toBeNull();
  });

  it('survives the server being unreachable', async () => {
    server.fetch.mockRejectedValue(new Error('offline'));
    await edit('a.css', '1');
    await settle(STATE_DEBOUNCE_MS);
    expect(stateSyncMessage()).toBeNull();
    expect(m.record.files['a.css']).toBe('1');
  });
});

describe('fetchFilesState', () => {
  it('returns the stored files document, or null when there is none or the flag is off', async () => {
    expect(await fetchFilesState()).toBeNull();
    server.docs.files = { files: { 'a.css': 'x' } };
    server.version.files = 1;
    expect(await fetchFilesState()).toEqual({ files: { 'a.css': 'x' } });
    server.docs.files = { files: 5 };
    expect(await fetchFilesState()).toBeNull();
    flags.officialRecord = false;
    server.fetch.mockClear();
    expect(await fetchFilesState()).toBeNull();
    expect(stateCalls()).toHaveLength(0);
  });
});
