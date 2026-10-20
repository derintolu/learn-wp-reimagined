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
 * Debounced `fileEdited` dispatches, one timer per file, each tagged with the lesson
 * it was typed in (the finale uses it to pick the learner's edit, R25).
 * `flush()` writes any pending edit straight away (before a check, and on unmount).
 */
export function useFileEdits(lessonId?: string): { edit: (file: string, content: string) => void; flush: () => void } {
  const pending = useRef(new Map<string, { content: string; lessonId?: string; timer: ReturnType<typeof setTimeout> }>());
  const lesson = useRef(lessonId);
  lesson.current = lessonId;

  const write = (file: string) => {
    const p = pending.current.get(file);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(file);
    getRecordManager()
      .dispatch(p.lessonId ? { type: 'fileEdited', file, content: p.content, lessonId: p.lessonId } : { type: 'fileEdited', file, content: p.content })
      .catch(() => {});
  };
  const flush = () => {
    for (const file of [...pending.current.keys()]) write(file);
  };
  const edit = (file: string, content: string) => {
    const prev = pending.current.get(file);
    if (prev) clearTimeout(prev.timer);
    pending.current.set(file, { content, lessonId: lesson.current, timer: setTimeout(() => write(file), FILE_EDIT_DEBOUNCE_MS) });
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
