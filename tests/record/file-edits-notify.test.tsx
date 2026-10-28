// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/preact';
import { content } from '../../src/content';
import { useFileEdits } from '../../src/record/useFileEdits';
import { setRecordManager } from '../../src/record/useRecord';
import { memoryManager } from '../components/helpers';

const notify = vi.fn();
vi.mock('../../src/record/stateSync', () => ({ notifyFileEdited: (f: string) => notify(f) }));

afterEach(() => {
  cleanup();
  setRecordManager(null);
  notify.mockClear();
});

describe('useFileEdits', () => {
  it('tells the state sync about a file once it has been written locally', async () => {
    const m = memoryManager(content);
    setRecordManager(m);
    const { result } = renderHook(() => useFileEdits('l1'));
    act(() => result.current.edit('style.css', 'a'));
    expect(notify).not.toHaveBeenCalled();
    await act(async () => {
      result.current.flush();
      await m.settled();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(m.record.files['style.css']).toBe('a');
    expect(notify).toHaveBeenCalledWith('style.css');
  });
});
