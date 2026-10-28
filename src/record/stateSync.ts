// Files and resume sync to State documents on the LRS, through the course server (/api/state/:kind).
// Behind phaseOn('officialRecord'). Local editing never waits on this: every failure is quiet except "too big".
import { clientId } from '../clientId';
import { phaseOn } from '../config';
import type { LearningRecord } from '../shared/record';
import {
  STATE_MAX_BYTES,
  STATE_TOO_BIG_MESSAGE,
  mergeFilesDocs,
  newerResume,
  parseFilesDoc,
  parseResumeDoc,
  type FilesDoc,
  type ResumeDoc,
  type StateKind,
} from '../shared/stateDoc';
import { ensureSession } from './session';
import type { RecordManager } from './store';

export { STATE_MAX_BYTES };
/** How long editing must pause before the files are written. */
export const STATE_DEBOUNCE_MS = 2000;

interface Remote<T> {
  doc: T | null;
  etag: string | null;
}
type Outcome = 'ok' | 'conflict' | 'too-big' | 'failed';

let tooBig = false;
const listeners = new Set<() => void>();

/** The message to show when the files can't sync, else null. */
export const stateSyncMessage = (): string | null => (tooBig ? STATE_TOO_BIG_MESSAGE : null);
export function subscribeStateSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setTooBig(v: boolean) {
  if (tooBig === v) return;
  tooBig = v;
  for (const fn of listeners) fn();
}

/** `create`: may this request make a session? Only a write the learner just caused by editing may. */
async function request(kind: StateKind, init: RequestInit = {}, create = false): Promise<Response | null> {
  try {
    if (!(await ensureSession({ create }))) return null;
    const headers = new Headers(init.headers);
    headers.set('x-client-id', clientId());
    return await fetch(`/api/state/${kind}`, { ...init, headers });
  } catch {
    return null;
  }
}

async function read<T>(kind: StateKind, parse: (v: unknown) => T | null, create = false): Promise<Remote<T> | null> {
  const res = await request(kind, {}, create);
  if (!res || !res.ok) return null;
  try {
    const j = (await res.json()) as { doc?: unknown; etag?: unknown };
    return { doc: j.doc == null ? null : parse(j.doc), etag: typeof j.etag === 'string' ? j.etag : null };
  } catch {
    return null;
  }
}

/** The learner's files from the State document, or null (flag off, no session, none stored, unreadable). */
export async function fetchFilesState(): Promise<FilesDoc | null> {
  if (!phaseOn('officialRecord')) return null;
  return (await read('files', parseFilesDoc))?.doc ?? null;
}

class StateSync {
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  /** Bumped by every local edit, so a write that finishes can tell whether more edits came in meanwhile. */
  private rev = 0;
  /** File contents as last written to (or read from) the State document. */
  private synced = new Map<string, string>();
  private etag: Record<StateKind, string | null> = { files: null, resume: null };
  /** Whether each document has been read or written on this page, so its ETag is known. */
  private known: Record<StateKind, boolean> = { files: false, resume: false };
  /** A local edit since the last successful files write: only then may the write make a session. */
  private byEdit = false;
  /** False until the saved record has loaded, so loading it does not count as the learner moving. */
  private ready = false;
  private lesson: string | undefined;
  /** Bumped by reset, so a write already queued for the old learner does nothing. */
  private epoch = 0;
  private off: () => void;

  constructor(private manager: RecordManager) {
    this.off = manager.subscribe((r) => this.onRecord(r));
    const start = () => {
      this.ready = true;
      this.lesson = manager.record.current?.lessonId;
      this.prime(manager.record);
    };
    manager.init().then(start, start);
  }

  /** Files already stored from before this page loaded may never have been synced: write them after the usual wait. */
  private primed = false;
  private prime(r: LearningRecord) {
    if (this.primed || Object.keys(r.files).length === 0) return;
    this.primed = true;
    this.markDirty();
  }

  private markDirty() {
    this.dirty = true;
    this.rev++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(['files']), STATE_DEBOUNCE_MS);
  }

  stop() {
    this.off();
    clearTimeout(this.timer);
  }

  /** The learner's data was deleted: forget everything about the old documents, and write nothing for them. */
  reset() {
    clearTimeout(this.timer);
    this.epoch++;
    this.dirty = false;
    this.rev++;
    this.primed = false;
    this.synced = new Map();
    this.etag = { files: null, resume: null };
    this.known = { files: false, resume: false };
    this.byEdit = false;
    // manager.reset() then emits a record with no lesson, which must not count as leaving one.
    this.lesson = undefined;
  }

  /** A file was just written to the local record. */
  edited(_file: string) {
    this.primed = true;
    this.byEdit = true;
    this.markDirty();
  }

  private onRecord(r: LearningRecord) {
    if (!this.ready) return;
    this.prime(r);
    const lesson = r.current?.lessonId;
    if (lesson === this.lesson) return;
    this.lesson = lesson;
    clearTimeout(this.timer);
    this.run(this.dirty ? ['files', 'resume'] : ['resume']);
  }

  private run(kinds: StateKind[]) {
    const epoch = this.epoch;
    this.chain = this.chain.then(async () => {
      for (const kind of kinds) {
        if (epoch !== this.epoch) return;
        try {
          if (kind === 'files') await this.syncFiles();
          else await this.syncResume();
        } catch {
          // Nothing here may disturb the studio.
        }
      }
    });
  }

  private localFiles(): FilesDoc {
    const r = this.manager.record;
    const doc: FilesDoc = { files: r.files };
    if (r.fileLessons) doc.fileLessons = r.fileLessons;
    // Edit times live in the record, so they survive a reload. A file with none (a record from before they
    // existed) that differs from what was last synced is a local edit, as new as the record.
    const times: Record<string, string> = {};
    for (const f of Object.keys(r.files)) {
      const t = r.fileTimes?.[f] ?? (this.synced.get(f) === r.files[f] ? undefined : r.updatedAt);
      if (t) times[f] = t;
    }
    if (Object.keys(times).length) doc.times = times;
    return doc;
  }

  private async put(kind: StateKind, doc: unknown, etag: string | null, create = false): Promise<Outcome> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (etag) headers['If-Match'] = etag;
    const res = await request(kind, { method: 'PUT', headers, body: JSON.stringify(doc) }, create);
    if (!res) return 'failed';
    if (res.status === 413) return 'too-big';
    if (res.status === 412) return 'conflict';
    if (!res.ok) return 'failed';
    this.known[kind] = true;
    try {
      this.etag[kind] = ((await res.json()) as { etag?: string }).etag ?? null;
    } catch {
      this.etag[kind] = null;
    }
    return 'ok';
  }

  /**
   * Write `local`. The first write on a page reads the document first and merges, and writes nothing if
   * the merge is what is already stored; after that, a conflict refetches, merges and writes once more.
   */
  private async write<T>(
    kind: StateKind,
    local: T,
    parse: (v: unknown) => T | null,
    merge: (mine: T, theirs: T) => T,
    create = false,
  ): Promise<{ out: Outcome | 'unchanged'; doc: T }> {
    if (!this.known[kind]) {
      const remote = await read(kind, parse, create);
      if (!remote) return { out: 'failed', doc: local };
      this.known[kind] = true;
      this.etag[kind] = remote.etag;
      if (remote.doc) {
        const merged = merge(local, remote.doc);
        if (sameJson(merged, remote.doc)) return { out: 'unchanged', doc: remote.doc };
        local = merged;
      }
    }
    let out = await this.put(kind, local, this.etag[kind], create);
    if (out !== 'conflict') return { out, doc: local };
    const remote = await read(kind, parse);
    if (!remote) return { out: 'failed', doc: local };
    this.etag[kind] = remote.etag;
    const doc = remote.doc ? merge(local, remote.doc) : local;
    out = await this.put(kind, doc, remote.etag);
    return { out, doc };
  }

  private async syncFiles() {
    const local = this.localFiles();
    if (new TextEncoder().encode(JSON.stringify(local)).length > STATE_MAX_BYTES) return setTooBig(true);
    const rev = this.rev;
    const { out, doc } = await this.write('files', local, parseFilesDoc, mergeFilesDocs, this.byEdit);
    if (out === 'too-big') setTooBig(true);
    else if (out === 'ok' || out === 'unchanged') {
      setTooBig(false);
      if (this.rev === rev) this.byEdit = false;
      this.synced = new Map(Object.entries(doc.files));
      // An edit that came in while this write was on its way is still unsynced.
      if (this.rev === rev) this.dirty = false;
      else this.markDirty();
    }
  }

  private async syncResume() {
    const r = this.manager.record;
    if (!r.current) return;
    const local: ResumeDoc = { current: r.current, updatedAt: r.updatedAt };
    await this.write('resume', local, parseResumeDoc, newerResume);
  }
}

/** Equal as JSON, whatever the key order. */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

let active: StateSync | null = null;

/** Start syncing the manager's record to State documents. Does nothing with the flag off. Returns the stop function. */
export function startStateSync(manager: RecordManager): () => void {
  if (!phaseOn('officialRecord')) return () => {};
  active?.stop();
  const s = new StateSync(manager);
  active = s;
  return () => {
    s.stop();
    if (active === s) active = null;
    setTooBig(false);
  };
}

/** After "Delete my data": drop pending writes, ETags and the too-big notice, before the local record is reset. */
export function resetStateSync(): void {
  active?.reset();
  setTooBig(false);
}

/** useFileEdits calls this after a file has been written to the local record. */
export function notifyFileEdited(file: string): void {
  active?.edited(file);
}
