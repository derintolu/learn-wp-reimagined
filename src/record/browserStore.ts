import type { LearningRecord } from '../shared/record';
import type { RecordStore } from './store';

const FILE = 'learn-wp-record.json';
const DB = 'learn-wp-reimagined';
const STORE = 'record';
const KEY = 'record';

type Tier = 'opfs' | 'indexeddb' | 'memory';

interface Backend {
  load(): Promise<LearningRecord | null>;
  save(r: LearningRecord): Promise<void>;
}

const parse = (text: string): LearningRecord | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as LearningRecord;
  } catch {
    return null;
  }
};

async function openOpfs(): Promise<Backend> {
  const root = await navigator.storage.getDirectory();
  const probe = await root.getFileHandle(FILE, { create: true });
  if (typeof probe.createWritable !== 'function') throw new Error('OPFS writes unsupported');
  return {
    async load() {
      const h = await root.getFileHandle(FILE, { create: true });
      return parse(await (await h.getFile()).text());
    },
    async save(r) {
      const h = await root.getFileHandle(FILE, { create: true });
      const w = await h.createWritable();
      await w.write(JSON.stringify(r));
      await w.close();
    },
  };
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

async function openIdb(): Promise<Backend> {
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  const db = await req(open);
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  await req(tx('readonly').count());
  return {
    async load() {
      return ((await req(tx('readonly').get(KEY))) as LearningRecord | undefined) ?? null;
    },
    async save(r) {
      await req(tx('readwrite').put(r, KEY));
    },
  };
}

/**
 * Tries OPFS, then IndexedDB, then memory. Never throws. If a store fails
 * later (quota, eviction), it degrades to the next tier and keeps the latest
 * record in memory, so `kind` always reports where data really is.
 */
export async function createBrowserStore(): Promise<RecordStore> {
  let kind: Tier = 'memory';
  let backend: Backend | null = null;
  let last: LearningRecord | null = null;
  const openers: [Tier, () => Promise<Backend>][] = [
    ['opfs', openOpfs],
    ['indexeddb', openIdb],
  ];
  let next = 0;

  const advance = async () => {
    while (next < openers.length) {
      const [k, open] = openers[next++];
      try {
        backend = await open();
        kind = k;
        return;
      } catch {
        // try the next tier
      }
    }
    backend = null;
    kind = 'memory';
  };
  await advance();

  return {
    get kind() {
      return kind;
    },
    async load() {
      while (backend) {
        try {
          const r = await backend.load();
          if (r) last = r;
          return r ?? last;
        } catch {
          await advance();
        }
      }
      return last;
    },
    async save(r) {
      last = r;
      while (backend) {
        try {
          await backend.save(r);
          return;
        } catch {
          await advance();
        }
      }
    },
  };
}
