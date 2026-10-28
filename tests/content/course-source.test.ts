import { afterEach, describe, expect, it, vi } from 'vitest';
import * as mod from '../../src/content';
import type { ContentBundle } from '../../src/shared/types';

afterEach(() => mod.setCourseSourceForTests(null));

describe('CourseSource', () => {
  it('content equals bundledSource.initial()', () => {
    expect(mod.content).toBe(mod.bundledSource.initial());
  });

  it('adoptLatest returns false with the bundled source', async () => {
    expect(await mod.bundledSource.latest()).toBeNull();
    expect(await mod.adoptLatest()).toBe(false);
  });

  it('a source returning a newer bundle swaps content only when adoptLatest is called', async () => {
    const original = mod.content;
    const newer = { ...original } as ContentBundle;
    mod.setCourseSourceForTests({
      initial: () => original,
      latest: async () => ({ bundle: newer, etag: 'v2' }),
    });
    expect(mod.content).toBe(original);
    expect(await mod.adoptLatest()).toBe(true);
    expect(mod.content).toBe(newer);
    expect(await mod.adoptLatest()).toBe(false);
  });
});

describe('wordpressSource', () => {
  afterEach(() => vi.unstubAllGlobals());
  const bundle = () => ({ ...mod.bundledSource.initial() }) as ContentBundle;
  const ok = (etag = '"e1"') => ({ ok: true, status: 200, headers: new Headers({ ETag: etag }), json: async () => bundle() });

  it('starts from the baked bundle', () => {
    expect(mod.wordpressSource.initial()).toBe(mod.bundledSource.initial());
  });

  it('fetches /api/course, remembers the etag and sends it next time', async () => {
    const f = vi.fn().mockResolvedValueOnce(ok('"e1"')).mockResolvedValueOnce({ ok: false, status: 304, headers: new Headers() });
    vi.stubGlobal('fetch', f);
    const first = await mod.wordpressSource.latest();
    expect(first?.etag).toBe('"e1"');
    expect(f.mock.calls[0][0]).toBe('/api/course');
    expect(await mod.wordpressSource.latest()).toBeNull();
    expect((f.mock.calls[1][1] as RequestInit).headers).toEqual({ 'If-None-Match': '"e1"' });
  });

  it('a failed fetch keeps the baked bundle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await mod.wordpressSource.latest()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, headers: new Headers() }));
    expect(await mod.wordpressSource.latest()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ ETag: 'x' }), json: async () => ({ nope: 1 }) }));
    expect(await mod.wordpressSource.latest()).toBeNull();
    expect(mod.content).toBe(mod.bundledSource.initial());
  });

  it('gives up after 3 seconds', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))));
      const p = mod.wordpressSource.latest();
      await vi.advanceTimersByTimeAsync(3000);
      expect(await p).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pending bundle', () => {
  it('adoptPending swaps only what a background check already fetched, and never waits', async () => {
    const original = mod.content;
    const newer = { ...original } as ContentBundle;
    let answer: (v: { bundle: ContentBundle; etag: string }) => void = () => {};
    mod.setCourseSourceForTests({ initial: () => original, latest: () => new Promise((r) => (answer = r)) });
    // Nothing fetched yet: returns at once, with the old content.
    expect(mod.adoptPending()).toBe(false);
    const check = mod.prefetchLatest();
    expect(mod.adoptPending()).toBe(false);
    expect(mod.content).toBe(original);
    answer({ bundle: newer, etag: 'v2' });
    await check;
    expect(mod.content).toBe(original);
    expect(mod.adoptPending()).toBe(true);
    expect(mod.content).toBe(newer);
    expect(mod.adoptPending()).toBe(false);
  });

  it('an etag already adopted is not pending again, and a failing check is harmless', async () => {
    const original = mod.content;
    const newer = { ...original } as ContentBundle;
    mod.setCourseSourceForTests({ initial: () => original, latest: async () => ({ bundle: newer, etag: 'v2' }) });
    await mod.prefetchLatest();
    expect(mod.adoptPending()).toBe(true);
    await mod.prefetchLatest();
    expect(mod.adoptPending()).toBe(false);
    mod.setCourseSourceForTests({ initial: () => original, latest: () => Promise.reject(new Error('x')) });
    await mod.prefetchLatest();
    expect(mod.adoptPending()).toBe(false);
  });
});
