import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { buildContent } from '../../scripts/build-content';
import { newRecord, applyEvent } from '../../src/shared/record';
import { createBrowserStore } from '../../src/record/browserStore';
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
  it('rejects corrupt JSON and leaves the manager untouched', async () => {
    const m = new RecordManager(memStore(), c);
    await m.dispatch({ type: 'lessonCompleted', lessonId });
    const before = m.record;
    const res = await readRecordFile(file('{not json'));
    expect(res.ok).toBe(false);
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

  it('restore replaces the record and saves it', async () => {
    const primary = memStore();
    const m = new RecordManager(primary, c);
    const r = applyEvent(newRecord(), { type: 'lessonCompleted', lessonId }, c);
    await m.restore(r);
    expect(m.record).toEqual(r);
    expect(await primary.load()).toEqual(r);
  });
});
