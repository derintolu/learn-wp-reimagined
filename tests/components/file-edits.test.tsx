// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { buildContent } from '../../scripts/build-content';
import { cancelPendingEdits, useFileEdits, FILE_EDIT_DEBOUNCE_MS } from '../../src/record/useFileEdits';
import { setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from './helpers';

afterEach(() => {
  cleanup();
  setRecordManager(null);
  vi.useRealTimers();
});

describe('useFileEdits', () => {
  it('debounces edits, and a restore can cancel a pending one so it never lands', async () => {
    vi.useFakeTimers();
    const m = memoryManager(buildContent('tests/fixtures/content'));
    const spy = vi.spyOn(m, 'dispatch');
    setRecordManager(m);
    let api!: ReturnType<typeof useFileEdits>;
    function Probe() {
      api = useFileEdits();
      return null;
    }
    render(<Probe />);
    api.edit('theme.json', 'a');
    api.edit('theme.json', 'ab');
    await vi.advanceTimersByTimeAsync(FILE_EDIT_DEBOUNCE_MS + 10);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: 'fileEdited', file: 'theme.json', content: 'ab' });

    api.edit('theme.json', 'stale');
    cancelPendingEdits();
    await vi.advanceTimersByTimeAsync(FILE_EDIT_DEBOUNCE_MS + 10);
    cleanup(); // unmount flush must not resurrect it either
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('tags each edit with the lesson it was made in', async () => {
    vi.useFakeTimers();
    const m = memoryManager(buildContent('tests/fixtures/content'));
    const spy = vi.spyOn(m, 'dispatch');
    setRecordManager(m);
    let api!: ReturnType<typeof useFileEdits>;
    function Probe({ lessonId }: { lessonId: string }) {
      api = useFileEdits(lessonId);
      return null;
    }
    const { rerender } = render(<Probe lessonId="theme-json-basics" />);
    api.edit('theme.json', 'a');
    rerender(<Probe lessonId="patterns" />); // the pending edit keeps the lesson it was typed in
    await vi.advanceTimersByTimeAsync(FILE_EDIT_DEBOUNCE_MS + 10);
    expect(spy).toHaveBeenCalledWith({ type: 'fileEdited', file: 'theme.json', content: 'a', lessonId: 'theme-json-basics' });
    api.edit('patterns/hero.php', 'b');
    api.flush();
    expect(spy).toHaveBeenLastCalledWith({ type: 'fileEdited', file: 'patterns/hero.php', content: 'b', lessonId: 'patterns' });
  });
});
