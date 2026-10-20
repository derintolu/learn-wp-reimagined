import { useEffect, useRef } from 'preact/hooks';
import { getRecordManager } from './useRecord';

/** How long typing must pause before an edit is written to the record. */
export const FILE_EDIT_DEBOUNCE_MS = 500;

const editors = new Set<{ cancel: () => void; flush: () => void }>();

/** Drop every pending (not yet written) edit, e.g. just before a restore replaces the record. */
export function cancelPendingEdits(): void {
  for (const e of editors) e.cancel();
}

/** Write every pending edit now, e.g. before a folder is attached and compared. */
export function flushPendingEdits(): void {
  for (const e of editors) e.flush();
}

/**
 * Debounced `fileEdited` dispatches, one timer per file.
 * `flush()` writes any pending edit straight away (before a check, and on unmount).
 */
export function useFileEdits(): { edit: (file: string, content: string) => void; flush: () => void } {
  const pending = useRef(new Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>());

  const write = (file: string) => {
    const p = pending.current.get(file);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(file);
    getRecordManager().dispatch({ type: 'fileEdited', file, content: p.content }).catch(() => {});
  };
  const flush = () => {
    for (const file of [...pending.current.keys()]) write(file);
  };
  const edit = (file: string, content: string) => {
    const prev = pending.current.get(file);
    if (prev) clearTimeout(prev.timer);
    pending.current.set(file, { content, timer: setTimeout(() => write(file), FILE_EDIT_DEBOUNCE_MS) });
  };

  useEffect(() => {
    const cancel = () => {
      for (const p of pending.current.values()) clearTimeout(p.timer);
      pending.current.clear();
    };
    const entry = { cancel, flush };
    editors.add(entry);
    return () => {
      editors.delete(entry);
      flush();
    };
  }, []);
  return { edit, flush };
}
