// Files and resume sync to State documents on the LRS, through the course server (/api/state/:kind).
// Behind FEATURES.officialRecord. Local editing never waits on this: every failure is quiet except "too big".
import { FEATURES } from '../config';
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

async function request(kind: StateKind, init: RequestInit = {}): Promise<Response | null> {
  try {
    if (!(await ensureSession())) return null;
    return await fetch(`/api/state/${kind}`, init);
  } catch {
    return null;
  }
}

async function read<T>(kind: StateKind, parse: (v: unknown) => T | null): Promise<Remote<T> | null> {
  const res = await request(kind);
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
  if (!FEATURES.officialRecord) return null;
  return (await read('files', parseFilesDoc))?.doc ?? null;
}

class StateSync {
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private times = new Map<string, string>();
  private etag: Record<StateKind, string | null> = { files: null, resume: null };
  private lesson: string | undefined;
  private off: () => void;

  constructor(private manager: RecordManager) {
    this.lesson = manager.record.current?.lessonId;
    this.off = manager.subscribe((r) => this.onRecord(r));
  }

  stop() {
    this.off();
    clearTimeout(this.timer);
  }

  /** A file was just written to the local record. */
  edited(file: string) {
    this.times.set(file, new Date().toISOString());
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(['files']), STATE_DEBOUNCE_MS);
  }

  private onRecord(r: LearningRecord) {
    const lesson = r.current?.lessonId;
    if (lesson === this.lesson) return;
    this.lesson = lesson;
    clearTimeout(this.timer);
    this.run(this.dirty ? ['files', 'resume'] : ['resume']);
  }

  private run(kinds: StateKind[]) {
    this.chain = this.chain.then(async () => {
      for (const kind of kinds) {
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
    const times: Record<string, string> = {};
    for (const f of Object.keys(r.files)) {
      const t = this.times.get(f);
      if (t) times[f] = t;
    }
    if (Object.keys(times).length) doc.times = times;
    return doc;
  }

  private async put(kind: StateKind, doc: unknown, etag: string | null): Promise<Outcome> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (etag) headers['If-Match'] = etag;
    const res = await request(kind, { method: 'PUT', headers, body: JSON.stringify(doc) });
    if (!res) return 'failed';
    if (res.status === 413) return 'too-big';
    if (res.status === 412) return 'conflict';
    if (!res.ok) return 'failed';
    try {
      this.etag[kind] = ((await res.json()) as { etag?: string }).etag ?? null;
    } catch {
      this.etag[kind] = null;
    }
    return 'ok';
  }

  /** Write `local`; on a conflict refetch, merge and write once more. */
  private async write<T>(kind: StateKind, local: T, parse: (v: unknown) => T | null, merge: (mine: T, theirs: T) => T): Promise<Outcome> {
    let out = await this.put(kind, local, this.etag[kind]);
    if (out !== 'conflict') return out;
    const remote = await read(kind, parse);
    if (!remote) return 'failed';
    this.etag[kind] = remote.etag;
    out = await this.put(kind, remote.doc ? merge(local, remote.doc) : local, remote.etag);
    return out;
  }

  private async syncFiles() {
    const local = this.localFiles();
    if (new TextEncoder().encode(JSON.stringify(local)).length > STATE_MAX_BYTES) return setTooBig(true);
    const out = await this.write('files', local, parseFilesDoc, mergeFilesDocs);
    if (out === 'too-big') setTooBig(true);
    else if (out === 'ok') {
      setTooBig(false);
      this.dirty = false;
    }
  }

  private async syncResume() {
    const r = this.manager.record;
    if (!r.current) return;
    const local: ResumeDoc = { current: r.current, updatedAt: r.updatedAt };
    await this.write('resume', local, parseResumeDoc, newerResume);
  }
}

let active: StateSync | null = null;

/** Start syncing the manager's record to State documents. Does nothing with the flag off. Returns the stop function. */
export function startStateSync(manager: RecordManager): () => void {
  if (!FEATURES.officialRecord) return () => {};
  active?.stop();
  const s = new StateSync(manager);
  active = s;
  return () => {
    s.stop();
    if (active === s) active = null;
    setTooBig(false);
  };
}

/** useFileEdits calls this after a file has been written to the local record. */
export function notifyFileEdited(file: string): void {
  active?.edited(file);
}
