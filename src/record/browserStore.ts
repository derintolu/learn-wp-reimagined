import { parseRecord, type LearningRecord } from '../shared/record';
import type { RecordNotice, RecordStore } from './store';

const FILE = 'learn-wp-record.json';
const PROBE = 'learn-wp-probe.tmp';
const DB = 'learn-wp-reimagined';
const STORE = 'record';
const KEY = 'record';

type Tier = 'opfs' | 'indexeddb' | 'memory';

interface Loaded {
  record: LearningRecord | null;
  notice?: RecordNotice;
}
interface Backend {
  load(): Promise<Loaded>;
  save(r: LearningRecord): Promise<void>;
  remove(): Promise<void>;
}

const stamp = () => new Date().toISOString().replace(/:/g, '-');

function judge(raw: unknown): { record: LearningRecord } | { bad: RecordNotice } {
  const res = parseRecord(raw);
  if (res.ok) return { record: res.record };
  const newer = res.error.includes('newer version');
  return {
    bad: {
      kind: newer ? 'newer-version' : 'recovered-corrupt',
      message: newer
        ? 'Your saved progress was made by a newer version of this app. It was kept aside and not changed.'
        : 'Your saved progress could not be read. A copy was kept aside and a fresh record was started.',
    },
  };
}

async function openOpfs(): Promise<Backend> {
  const root = await navigator.storage.getDirectory();
  const probe = await root.getFileHandle(PROBE, { create: true });
  if (typeof probe.createWritable !== 'function') throw new Error('OPFS writes unsupported');
  await root.removeEntry(PROBE).catch(() => {});
  const writeText = async (name: string, text: string) => {
    const h = await root.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
  };
  return {
    async load() {
      let text: string;
      try {
        text = await (await (await root.getFileHandle(FILE)).getFile()).text();
      } catch (err) {
        if ((err as { name?: string }).name === 'NotFoundError') return { record: null };
        throw err;
      }
      if (!text) return { record: null };
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        await writeText(`learn-wp-record.corrupt-${stamp()}.json`, text);
        return { record: null, notice: (judge(null) as { bad: RecordNotice }).bad };
      }
      const j = judge(raw);
      if ('record' in j) return { record: j.record };
      await writeText(`learn-wp-record.corrupt-${stamp()}.json`, text);
      return { record: null, notice: j.bad };
    },
    async save(r) {
      await writeText(FILE, JSON.stringify(r));
    },
    async remove() {
      await root.removeEntry(FILE);
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
      const raw = await req(tx('readonly').get(KEY));
      if (raw === undefined) return { record: null };
      const j = judge(raw);
      if ('record' in j) return { record: j.record };
      await req(tx('readwrite').put(raw, `${KEY}.corrupt-${stamp()}`));
      return { record: null, notice: j.bad };
    },
    async save(r) {
      await req(tx('readwrite').put(r, KEY));
    },
    async remove() {
      await req(tx('readwrite').delete(KEY));
    },
  };
}

/**
 * Tries OPFS, then IndexedDB, then memory. Never throws. A failing operation
 * is retried once on the same tier, then the store degrades to the next tier
 * and keeps the latest record in memory. Operations run one at a time so a
 * double failure cannot skip a tier. `kind` always reports where data really is.
 *
 * Deletion rule: a tier that failed a SAVE is deleted only after a later save
 * succeeds in another persistent tier. If everything degrades to memory,
 * nothing is deleted, so the last persisted copy survives a reload.
 * Known trade-off: after a LOAD failure the old tier's copy is kept, never
 * deleted, even though it may shadow newer progress on the next load.
 */
export async function createBrowserStore(): Promise<RecordStore> {
  let kind: Tier = 'memory';
  let backend: Backend | null = null;
  let last: LearningRecord | null = null;
  let notice: RecordNotice | null = null;
  const listeners = new Set<() => void>();
  const openers: [Tier, () => Promise<Backend>][] = [
    ['opfs', openOpfs],
    ['indexeddb', openIdb],
  ];
  let next = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };

  const advance = async () => {
    const oldKind = kind;
    backend = null;
    kind = 'memory';
    while (next < openers.length) {
      const [k, open] = openers[next++];
      try {
        backend = await open();
        kind = k;
        break;
      } catch {
        // try the next tier
      }
    }
    if (kind !== oldKind) for (const fn of listeners) fn();
  };

  // Copies left behind by a failed SAVE. They are deleted only once the record
  // is safely elsewhere. A failed LOAD never queues anything: the unreadable
  // record may be the learner's only copy.
  let stale: Backend[] = [];
  const flushStale = async () => {
    const old = stale;
    stale = [];
    for (const b of old) await b.remove().catch(() => {});
  };

  const attempt = async <T>(run: (b: Backend) => Promise<T>, fromSave = false): Promise<{ ok: true; value: T } | { ok: false }> => {
    while (backend) {
      const b = backend;
      for (let i = 0; i < 2; i++) {
        try {
          return { ok: true, value: await run(b) };
        } catch {
          // retry the same tier once
        }
      }
      await advance();
      if (fromSave) stale.push(b);
    }
    return { ok: false };
  };

  await serial(advance);

  return {
    get kind() {
      return kind;
    },
    get notice() {
      return notice;
    },
    onKindChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    load: () =>
      serial(async () => {
        const res = await attempt((b) => b.load());
        if (res.ok) {
          if (res.value.notice) notice = res.value.notice;
          if (res.value.record) last = res.value.record;
        }
        return last;
      }),
    save: (r) =>
      serial(async () => {
        last = r;
        const res = await attempt((b) => b.save(r), true);
        if (res.ok) await flushStale();
      }),
  };
}
