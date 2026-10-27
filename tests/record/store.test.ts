import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { buildContent } from '../../scripts/build-content';
import { newRecord, applyEvent } from '../../src/shared/record';
import { OPEN_TIMEOUT_MS, createBrowserStore } from '../../src/record/browserStore';
import { createFolderStore, supportsFolder } from '../../src/record/folderStore';
import { readRecordFile } from '../../src/record/fileTransfer';
import { RecordManager, type RecordStore } from '../../src/record/store';
import { FakeDir, asHandle } from './fakes';

const c = buildContent(resolve(__dirname, '../fixtures/content'));
const lessonId = c.paths['block-theme'].lessons[0];

const throwingOpfs = () => ({ getDirectory: async () => { throw new Error('SecurityError'); } });
const stubStorage = (s: unknown) => vi.stubGlobal('navigator', { storage: s });
const memStore = (): RecordStore => {
  let r: ReturnType<typeof newRecord> | null = null;
  return { kind: 'memory', load: async () => r, save: async (x) => { r = x; } };
};
const file = (text: string) => ({ text: async () => text }) as unknown as File;

afterEach(() => { vi.unstubAllGlobals(); indexedDB = new IDBFactory(); });

describe('createBrowserStore', () => {
  it('uses OPFS when it works and round-trips a record', async () => {
    const root = new FakeDir();
    stubStorage({ getDirectory: async () => root });
    const s = await createBrowserStore();
    expect(s.kind).toBe('opfs');
    const r = newRecord();
    await s.save(r);
    expect(await s.load()).toEqual(r);
  });

  it('falls back to IndexedDB when OPFS throws', async () => {
    stubStorage(throwingOpfs());
    const s = await createBrowserStore();
    expect(s.kind).toBe('indexeddb');
    const r = newRecord();
    await s.save(r);
    expect(await s.load()).toEqual(r);
  });

  it('falls back to memory when both throw, and is not persistent', async () => {
    stubStorage(throwingOpfs());
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('denied'); } });
    const s = await createBrowserStore();
    expect(s.kind).toBe('memory');
    const m = new RecordManager(s, c);
    expect(m.persistent).toBe(false);
    const r = newRecord();
    await s.save(r);
    expect(await s.load()).toEqual(r);
  });

  it('degrades on a failed save without losing data or throwing', async () => {
    const root = new FakeDir();
    stubStorage({ getDirectory: async () => root });
    const s = await createBrowserStore();
    expect(s.kind).toBe('opfs');
    root.failWrites = true;
    const r = newRecord();
    await expect(s.save(r)).resolves.toBeUndefined();
    expect(s.kind).not.toBe('opfs');
    expect(await s.load()).toEqual(r);
  });
});

describe('storage that never answers', () => {
  afterEach(() => vi.useRealTimers());
  const never = () => new Promise<never>(() => {});

  it('degrades from OPFS to IndexedDB when getDirectory never resolves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubStorage({ getDirectory: never });
    const p = createBrowserStore();
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS);
    const s = await p;
    expect(s.kind).toBe('indexeddb');
    vi.useRealTimers();
    const r = newRecord();
    await s.save(r);
    expect(await s.load()).toEqual(r);
  });

  it('degrades to memory when IndexedDB open never answers either, and the manager still inits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubStorage({ getDirectory: never });
    vi.stubGlobal('indexedDB', { open: () => ({}) as IDBOpenDBRequest }); // no callback ever fires
    const p = createBrowserStore();
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS * 2);
    const s = await p;
    expect(s.kind).toBe('memory');
    const m = new RecordManager(s, c);
    await m.init();
    expect(m.persistent).toBe(false);
  });

  it('a blocked IndexedDB open moves on to memory straight away', async () => {
    stubStorage(throwingOpfs());
    vi.stubGlobal('indexedDB', {
      open: () => {
        const r = {} as IDBOpenDBRequest;
        queueMicrotask(() => r.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
        return r;
      },
    });
    const s = await createBrowserStore();
    expect(s.kind).toBe('memory');
  });
});

describe('createFolderStore', () => {
  it('writes the record and theme files, and reloading returns an equal record', async () => {
    const dir = new FakeDir();
    const store = createFolderStore(asHandle(dir));
    expect(store.kind).toBe('folder');
    expect(await store.load()).toBeNull();
    const r = { ...newRecord(), files: { 'theme.json': '{"a":1}', 'templates/index.html': '<p>hi</p>' } };
    await store.save(r);
    const flat = dir.flat();
    expect(Object.keys(flat).sort()).toEqual(['learn-wp-record.json', 'theme/templates/index.html', 'theme/theme.json']);
    expect(flat['theme/theme.json']).toBe('{"a":1}');
    expect(await createFolderStore(asHandle(dir)).load()).toEqual(r);
  });

  it('refuses theme paths that escape the theme folder', async () => {
    const dir = new FakeDir();
    const r = { ...newRecord(), files: { '../evil.txt': 'x' } };
    await expect(createFolderStore(asHandle(dir)).save(r)).rejects.toThrow(/path/i);
  });

  it('supportsFolder reflects showDirectoryPicker', () => {
    vi.stubGlobal('window', {});
    expect(supportsFolder()).toBe(false);
    vi.stubGlobal('window', { showDirectoryPicker: () => {} });
    expect(supportsFolder()).toBe(true);
  });
});

describe('readRecordFile', () => {
  it('a rejected file never reaches the manager: record is left untouched', async () => {
    const m = new RecordManager(memStore(), c);
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    const before = m.record;
    const res = await readRecordFile(file('{not json'));
    expect(res.ok).toBe(false);
    if (res.ok) await m.restore(res.record);
    expect(m.record).toBe(before);
  });
  it('rejects a newer version with the Task 4 message', async () => {
    const res = await readRecordFile(file(JSON.stringify({ ...newRecord(), version: 2 })));
    expect(res).toEqual({ ok: false, error: 'This record was made by a newer version' });
  });
  it('accepts a valid record', async () => {
    const r = newRecord();
    const res = await readRecordFile(file(JSON.stringify(r)));
    expect(res).toEqual({ ok: true, record: r });
  });
});

describe('RecordManager', () => {
  it('init loads the primary record', async () => {
    const primary = memStore();
    const r = newRecord();
    await primary.save(r);
    const m = new RecordManager(primary, c);
    await m.init();
    expect(m.record).toEqual(r);
  });

  it('dispatch applies the event, saves, and notifies subscribers', async () => {
    const primary = memStore();
    const m = new RecordManager(primary, c);
    const seen: number[] = [];
    const off = m.subscribe((r) => seen.push(r.completedLessons.length));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    expect(seen).toEqual([1]);
    expect((await primary.load())!.completedLessons).toEqual([lessonId]);
    off();
    await m.dispatch({ type: 'fileEdited', file: 'theme.json', content: '{}' });
    expect(seen).toEqual([1]);
  });

  it('saves to an attached folder and survives a folder failure', async () => {
    const primary = memStore();
    const m = new RecordManager(primary, c);
    const dir = new FakeDir();
    await m.attachFolder(asHandle(dir));
    await m.dispatch({ type: 'fileEdited', file: 'theme.json', content: '{"v":1}' });
    expect(dir.flat()['theme/theme.json']).toBe('{"v":1}');
    dir.failWrites = true;
    await m.dispatch({ type: 'fileEdited', file: 'theme.json', content: '{"v":2}' });
    expect((await primary.load())!.files['theme.json']).toBe('{"v":2}');
    expect(m.folderError).toBeInstanceOf(Error);
  });

  it('reports savingToFolder once a folder is attached, and tells subscribers when a folder save fails or recovers', async () => {
    const m = new RecordManager(memStore(), c);
    expect(m.savingToFolder).toBe(false);
    const dir = new FakeDir();
    await m.attachFolder(asHandle(dir));
    expect(m.savingToFolder).toBe(true);
    const errors: (Error | null)[] = [];
    m.subscribe(() => errors.push(m.folderError));
    dir.failWrites = true;
    await m.dispatch({ type: 'fileEdited', file: 'a.css', content: 'x' });
    expect(errors.at(-1)).toBeInstanceOf(Error);
    dir.failWrites = false;
    await m.dispatch({ type: 'fileEdited', file: 'a.css', content: 'y' });
    expect(errors.at(-1)).toBeNull();
  });

  it('restore replaces the record and saves it', async () => {
    const primary = memStore();
    const m = new RecordManager(primary, c);
    const r = applyEvent(newRecord(), { type: 'lessonCompleted', lessonId }, c);
    await m.restore(r);
    expect(m.record).toEqual(r);
    expect(await primary.load()).toEqual(r);
  });
});

const progressed = (updatedAt: string) => ({
  ...applyEvent(newRecord(), { type: 'lessonCompleted', lessonId }, c),
  updatedAt,
});
const seed = (dir: FakeDir, r: object | string) =>
  dir.files.set('learn-wp-record.json', typeof r === 'string' ? r : JSON.stringify(r));
const namesLike = (dir: FakeDir, re: RegExp) => Object.keys(dir.flat()).filter((n) => re.test(n));

describe('attachFolder', () => {
  it('writes the current record into an empty folder', async () => {
    const m = new RecordManager(memStore(), c);
    expect(await m.attachFolder(asHandle(new FakeDir()))).toBe('wrote');
  });

  it('resumes from the folder record when the current one is fresh', async () => {
    const primary = memStore();
    const m = new RecordManager(primary, c);
    const dir = new FakeDir();
    const theirs = progressed('2026-01-01T00:00:00.000Z');
    seed(dir, theirs);
    const seen: number[] = [];
    m.subscribe((r) => seen.push(r.completedLessons.length));
    expect(await m.attachFolder(asHandle(dir))).toBe('resumed');
    expect(m.record).toEqual(theirs);
    expect(await primary.load()).toEqual(theirs);
    expect(seen).toContain(1);
  });

  it('keeps the newer record and backs up the other when both have progress', async () => {
    const dir = new FakeDir();
    const older = progressed('2020-01-01T00:00:00.000Z');
    seed(dir, older);
    const m = new RecordManager(memStore(), c);
    await m.dispatch({ type: 'lessonCompleted', lessonId }); // updatedAt = now, newer
    const mine = m.record;
    expect(await m.attachFolder(asHandle(dir))).toBe('kept-current-with-backup');
    expect(m.record).toBe(mine);
    const [b] = namesLike(dir, /^learn-wp-record\.backup-.*\.json$/);
    expect(b).toBeDefined();
    expect(b).not.toMatch(/:/);
    expect(JSON.parse(dir.flat()[b])).toEqual(older);
    expect(JSON.parse(dir.flat()['learn-wp-record.json']).learnerId).toBe(mine.learnerId);
  });

  it('adopts a newer folder record and backs up the local progress', async () => {
    const dir = new FakeDir();
    const theirs = progressed('2999-01-01T00:00:00.000Z');
    seed(dir, theirs);
    const m = new RecordManager(memStore(), c);
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    const mine = m.record;
    expect(await m.attachFolder(asHandle(dir))).toBe('resumed');
    expect(m.record).toEqual(theirs);
    const [b] = namesLike(dir, /^learn-wp-record\.backup-/);
    expect(JSON.parse(dir.flat()[b])).toEqual(mine);
  });

  it.each([['{oops'], [JSON.stringify({ format: 'nope' })]])('quarantines an invalid folder record: %s', async (bad) => {
    const dir = new FakeDir();
    seed(dir, bad);
    const m = new RecordManager(memStore(), c);
    expect(await m.attachFolder(asHandle(dir))).toBe('recovered-corrupt');
    const [n] = namesLike(dir, /^learn-wp-record\.corrupt-/);
    expect(dir.flat()[n]).toBe(bad);
    expect(JSON.parse(dir.flat()['learn-wp-record.json']).learnerId).toBe(m.record.learnerId);
  });
});

describe('stored record validation', () => {
  it('quarantines a corrupt OPFS record, returns null and sets a manager notice', async () => {
    const root = new FakeDir();
    seed(root, '{"broken');
    stubStorage({ getDirectory: async () => root });
    const m = new RecordManager(await createBrowserStore(), c);
    await m.init();
    expect(m.notice?.kind).toBe('recovered-corrupt');
    const [n] = namesLike(root, /^learn-wp-record\.corrupt-/);
    expect(root.flat()[n]).toBe('{"broken');
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    expect(root.flat()[n]).toBe('{"broken'); // the quarantined copy survives later saves
  });

  it('flags a newer-version record in IndexedDB and keeps the raw blob', async () => {
    stubStorage(throwingOpfs());
    const s1 = await createBrowserStore();
    await s1.save({ ...newRecord(), version: 2 } as never);
    const m = new RecordManager(await createBrowserStore(), c);
    await m.init();
    expect(m.notice?.kind).toBe('newer-version');
    const keys = await new Promise<IDBValidKey[]>((res) => {
      const o = indexedDB.open('learn-wp-reimagined', 1);
      o.onsuccess = () => {
        const q = o.result.transaction('record').objectStore('record').getAllKeys();
        q.onsuccess = () => res(q.result);
      };
    });
    expect(keys.some((k) => String(k).startsWith('record.corrupt-'))).toBe(true);
  });

  it('does not create a record file on the read path', async () => {
    const root = new FakeDir();
    stubStorage({ getDirectory: async () => root });
    const s = await createBrowserStore();
    expect(await s.load()).toBeNull();
    expect(Object.keys(root.flat())).toEqual([]);
  });
});

describe('save ordering', () => {
  it('two quick dispatches leave the final state stored even if writes resolve out of order', async () => {
    let r: ReturnType<typeof newRecord> | null = null;
    let calls = 0;
    const slowFirst: RecordStore = {
      kind: 'opfs',
      load: async () => r,
      save: async (x) => {
        const delay = calls++ === 0 ? 30 : 0;
        await new Promise((res) => setTimeout(res, delay));
        r = x;
      },
    };
    const m = new RecordManager(slowFirst, c);
    await Promise.all([
      m.dispatch({ type: 'fileEdited', file: 'a', content: '1' }),
      m.dispatch({ type: 'fileEdited', file: 'a', content: '2' }),
    ]);
    expect(r).toEqual(m.record);
    expect(r!.files.a).toBe('2');
  });

  it('dispatch before init does not clobber the stored record', async () => {
    const primary = memStore();
    const stored = progressed('2026-01-01T00:00:00.000Z');
    await primary.save(stored);
    const m = new RecordManager(primary, c);
    await m.dispatch({ type: 'fileEdited', file: 'a', content: '1' });
    expect(m.record.completedLessons).toEqual([lessonId]);
    expect(m.record.learnerId).toBe(stored.learnerId);
  });
});

describe('mid-session degradation', () => {
  it('retries the same tier once before degrading', async () => {
    const root = new FakeDir();
    stubStorage({ getDirectory: async () => root });
    const s = await createBrowserStore();
    root.failNext = 1;
    await s.save(newRecord());
    expect(s.kind).toBe('opfs');
  });

  it('degrading to memory flips persistent, notifies, and keeps the old copy', async () => {
    const root = new FakeDir();
    stubStorage({ getDirectory: async () => root });
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('denied'); } });
    const store = await createBrowserStore();
    const m = new RecordManager(store, c);
    await m.dispatch({ type: 'lessonCompleted', lessonId }); // saved to OPFS
    const persisted = root.flat()['learn-wp-record.json'];
    expect(persisted).toBeDefined();
    expect(m.persistent).toBe(true);
    let notified = 0;
    m.subscribe(() => { notified++; });
    root.failWrites = true;
    await m.dispatch({ type: 'fileEdited', file: 'a', content: '1' });
    expect(m.persistent).toBe(false);
    expect(notified).toBeGreaterThanOrEqual(2); // the dispatch itself plus the tier change
    expect(root.flat()['learn-wp-record.json']).toBe(persisted); // last persisted copy survives
    expect(await store.load()).toEqual(m.record);
  });

  it('deletes the stale copy only after a successful save in the new tier', async () => {
    const root = new FakeDir();
    stubStorage({ getDirectory: async () => root });
    const store = await createBrowserStore();
    await store.save(newRecord());
    expect(root.flat()['learn-wp-record.json']).toBeDefined();
    root.failWrites = true;
    const r = newRecord();
    await store.save(r);
    expect(store.kind).toBe('indexeddb');
    expect(root.flat()['learn-wp-record.json']).toBeUndefined();
    expect(await store.load()).toEqual(r);
  });
});

describe('failed reads never delete the stored record', () => {
  it('keeps the original when quarantining fails during load', async () => {
    const root = new FakeDir();
    const bad = JSON.stringify({ ...newRecord(), version: 2 });
    seed(root, bad);
    stubStorage({ getDirectory: async () => root });
    const s = await createBrowserStore();
    root.failNext = 2; // both load attempts fail while writing the quarantine copy
    await s.load();
    expect(s.kind).toBe('indexeddb');
    expect(root.flat()['learn-wp-record.json']).toBe(bad);
  });
});

describe('init retry', () => {
  it('a rejected init can be retried', async () => {
    let n = 0;
    const flaky: RecordStore = {
      kind: 'opfs',
      load: async () => { if (n++ === 0) throw new Error('boom'); return progressed('2026-01-01T00:00:00.000Z'); },
      save: async () => {},
    };
    const m = new RecordManager(flaky, c);
    await expect(m.init()).rejects.toThrow('boom');
    await m.init();
    expect(m.record.completedLessons).toEqual([lessonId]);
  });
});

describe('server events', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const fakeClient = (over: Partial<Record<'send' | 'queueBeat' | 'flush', unknown>> = {}) =>
    ({ send: vi.fn(async () => null), queueBeat: vi.fn(), flush: vi.fn(async () => {}), ...over }) as unknown as import('../../src/record/eventClient').EventClient;

  it('dispatch swaps in the server statements when the server answers', async () => {
    const serverStatement = { ...applyEvent(newRecord(), { type: 'lessonCompleted', lessonId }, c).statements[0], id: 'from-the-server' };
    const send = vi.fn(async (e: { type: string }) => ({ eventId: 'e1', ok: true as const, statements: [serverStatement] }));
    const m = new RecordManager(memStore(), c, fakeClient({ send }));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
    expect(send).toHaveBeenCalledWith({ type: 'lessonCompleted', lessonId });
    expect(m.record.completedLessons).toEqual([lessonId]);
    expect(m.record.statements.map((s) => s.id)).toEqual(['from-the-server']);
  });

  it('dispatch falls back to local statements when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { EventClient } = await import('../../src/record/eventClient');
    const m = new RecordManager(memStore(), c, new EventClient(() => m.record.learnerId));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
    expect(m.record.statements).toHaveLength(1);
    expect(m.record.statements[0].id).not.toBe('from-the-server');
  });

  it('falls back to local statements when the server says ok:false', async () => {
    const send = vi.fn(async () => ({ eventId: 'e1', ok: false as const, error: 'not-allowed' as const }));
    const m = new RecordManager(memStore(), c, fakeClient({ send }));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
    expect(m.record.statements).toHaveLength(1);
  });

  it('beat advance never awaits the network', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async () => { await gate; return { ok: true, json: async () => ({ results: [] }) }; }));
    const { EventClient } = await import('../../src/record/eventClient');
    const client = new EventClient(() => m.record.learnerId);
    const m = new RecordManager(memStore(), c, client);
    await m.dispatch({ type: 'beatViewed', lessonId, beatIndex: 1 });
    expect(m.record.current?.beatIndex).toBe(1);
    expect(m.record.statements).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    release();
    await client.flush();
  });

  it('maps codeChecked with files to codeSubmitted and keeps local statements without files', async () => {
    const send = vi.fn(async () => null);
    const m = new RecordManager(memStore(), c, fakeClient({ send }));
    await m.dispatch({ type: 'codeChecked', lessonId, file: 'a.json', passed: true, files: { 'a.json': '{}' }, target: 'bug' });
    expect(send).toHaveBeenCalledWith({ type: 'codeSubmitted', lessonId, target: 'bug', file: 'a.json', files: { 'a.json': '{}' } });
    await m.dispatch({ type: 'codeChecked', lessonId, file: 'a.json', passed: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  };
  const serverStmt = (id: string) => ({ ...applyEvent(newRecord(), { type: 'lessonCompleted', lessonId }, c).statements[0], id });
  const lessons = c.paths['block-theme'].lessons;

  it('dispatch resolves while the send is still pending', async () => {
    const gate = deferred<never>();
    const send = vi.fn(() => gate.promise);
    const m = new RecordManager(memStore(), c, fakeClient({ send }));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    expect(send).toHaveBeenCalledTimes(1);
    expect(m.record.completedLessons).toEqual([lessonId]);
    expect(m.record.statements).toHaveLength(1);
  });

  it('a late answer after an interleaved second dispatch swaps the right statements', async () => {
    const gate = deferred<{ eventId: string; ok: true; statements: ReturnType<typeof serverStmt>[] }>();
    const send = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(null);
    const m = new RecordManager(memStore(), c, fakeClient({ send }));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.dispatch({ type: 'lessonCompleted', lessonId: lessons[1] });
    const second = m.record.statements[1];
    gate.resolve({ eventId: 'e', ok: true, statements: [serverStmt('first-from-server')] });
    await m.settled();
    expect(m.record.statements.map((s) => s.id)).toEqual(['first-from-server', second.id]);
  });

  it('a late answer after restore() swaps nothing', async () => {
    const gate = deferred<{ eventId: string; ok: true; statements: ReturnType<typeof serverStmt>[] }>();
    const m = new RecordManager(memStore(), c, fakeClient({ send: vi.fn(() => gate.promise) }));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    const other = newRecord();
    await m.restore(other);
    gate.resolve({ eventId: 'e', ok: true, statements: [serverStmt('stale')] });
    await m.settled();
    expect(m.record).toEqual(other);
  });

  it('the same answer applied twice is a no-op the second time', async () => {
    const answer = { eventId: 'e', ok: true as const, statements: [serverStmt('once')] };
    const m = new RecordManager(memStore(), c, fakeClient({ send: vi.fn(async () => answer) }));
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    await m.settled();
    const after = m.record.statements;
    expect(after.map((s) => s.id)).toEqual(['once']);
    // Replaying the swap with the same statements finds nothing built locally to replace.
    await (m as unknown as { sendAndSwap(e: unknown, l: unknown[]): Promise<void> }).sendAndSwap({ type: 'lessonCompleted', lessonId }, [after[0]]).catch(() => {});
    await m.settled();
    expect(m.record.statements.map((s) => s.id)).toEqual(['once']);
    expect(m.record.statements).toHaveLength(1);
  });
});
