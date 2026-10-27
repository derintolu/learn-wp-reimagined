import { afterEach, describe, expect, it } from 'vitest';
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
