import { useEffect, useState } from 'preact/hooks';
import { content } from '../content';
import type { LearningRecord } from '../shared/record';
import { createBrowserStore } from './browserStore';
import { RecordManager, type RecordNotice, type RecordStore } from './store';

/**
 * A RecordStore that is usable straight away and forwards to the browser store
 * once it has opened (createBrowserStore is async; RecordManager wants a store now).
 */
function lazyBrowserStore(): RecordStore {
  let inner: RecordStore | null = null;
  let notice: RecordNotice | null = null;
  const listeners = new Set<() => void>();
  const ready = createBrowserStore().then((s) => {
    inner = s;
    for (const fn of listeners) {
      s.onKindChange?.(fn);
      fn();
    }
    return s;
  });
  return {
    get kind() {
      return inner?.kind ?? 'indexeddb';
    },
    get notice() {
      return notice;
    },
    async load() {
      const s = await ready;
      const r = await s.load();
      notice = s.notice ?? null;
      return r;
    },
    async save(r) {
      await (await ready).save(r);
    },
    onKindChange(fn) {
      listeners.add(fn);
      if (inner) inner.onKindChange?.(fn);
      return () => listeners.delete(fn);
    },
  };
}

let manager: RecordManager | null = null;

/** The one app-wide learning record. Created on first use. */
export function getRecordManager(): RecordManager {
  manager ??= new RecordManager(lazyBrowserStore(), content);
  return manager;
}

/** The app-wide manager if one has been created, without creating it (for the error page). */
export function peekRecordManager(): RecordManager | null {
  return manager;
}

/** For tests: replace the app-wide manager (null resets it). */
export function setRecordManager(m: RecordManager | null): void {
  manager = m;
}

/** The current record, kept up to date. Loads the saved record on first use. */
export function useRecord(): {
  manager: RecordManager;
  record: LearningRecord;
  persistent: boolean;
  notice: RecordNotice | null;
} {
  const m = getRecordManager();
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = m.subscribe(() => setTick((t) => t + 1));
    m.init().then(() => setTick((t) => t + 1), () => {});
    return off;
  }, [m]);
  return { manager: m, record: m.record, persistent: m.persistent, notice: m.notice };
}
