import { applyEvent, newRecord, parseRecord, type LearningRecord, type RecordEvent } from '../shared/record';
import type { ContentBundle } from '../shared/types';
import type { XapiStatement } from '../shared/xapi';
import { FEATURES } from '../config';
import { currentActor } from './session';
import { bindLearnerId, getEventClient, type EventClient } from './eventClient';
import type { EventResult, ServerEvent } from '../shared/events';
import { createFolderStore, type FolderStore } from './folderStore';

export interface RecordNotice {
  kind: 'recovered-corrupt' | 'newer-version';
  message: string;
}

export interface RecordStore {
  /** 'wordpress-org' is reserved for a future account adapter and is not implemented. */
  kind: 'opfs' | 'indexeddb' | 'memory' | 'folder' | 'wordpress-org';
  load(): Promise<LearningRecord | null>;
  save(r: LearningRecord): Promise<void>;
  /** Set by load() when a stored record was unreadable and was kept aside. */
  notice?: RecordNotice | null;
  /** Fires when the store degrades to another tier. */
  onKindChange?(fn: () => void): () => void;
}

export type AttachResult = 'wrote' | 'resumed' | 'kept-current-with-backup' | 'recovered-corrupt';

const stamp = () => new Date().toISOString().replace(/:/g, '-');
const isFresh = (r: LearningRecord) => r.statements.length === 0 && !r.placement;

export class RecordManager {
  private current: LearningRecord = newRecord();
  private folder: FolderStore | null = null;
  private listeners = new Set<(r: LearningRecord) => void>();
  private initP: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private pending = new Set<Promise<void>>();
  /** Set when the last folder save failed; cleared on the next success. */
  folderError: Error | null = null;
  /** Set during init() when a stored record was corrupt or too new. */
  notice: RecordNotice | null = null;

  constructor(private primary: RecordStore, private content: ContentBundle, private client: EventClient = getEventClient()) {
    bindLearnerId(() => this.current.learnerId);
    primary.onKindChange?.(() => this.emit());
  }

  get record(): LearningRecord {
    return this.current;
  }

  /** True once a folder is attached; saves then go to the folder as well as the browser. */
  get savingToFolder(): boolean {
    return this.folder !== null;
  }

  /** False when progress is only held in memory, so the UI can warn the learner. */
  get persistent(): boolean {
    return this.primary.kind !== 'memory';
  }

  /** Load the saved record from the primary store, if there is one. Idempotent. */
  init(): Promise<void> {
    this.initP ??= (async () => {
      const r = await this.primary.load();
      this.notice = this.primary.notice ?? null;
      if (r) {
        this.current = r;
        this.emit();
      }
    })();
    this.initP.catch(() => { this.initP = null; });
    return this.initP;
  }

  async attachFolder(dir: FileSystemDirectoryHandle): Promise<AttachResult> {
    await this.init();
    const store = createFolderStore(dir);
    const raw = await store.readRaw();
    if (raw === null) {
      await store.save(this.current);
      this.folder = store;
      this.folderError = null;
      return 'wrote';
    }
    let parsed: ReturnType<typeof parseRecord>;
    try {
      parsed = parseRecord(JSON.parse(raw));
    } catch {
      parsed = { ok: false, error: 'invalid JSON' };
    }
    if (!parsed.ok) {
      await store.writeRaw(`learn-wp-record.corrupt-${stamp()}.json`, raw);
      await store.save(this.current);
      this.folder = store;
      this.folderError = null;
      return 'recovered-corrupt';
    }
    const theirs = parsed.record;
    const mine = this.current;
    const useFolder = isFresh(mine) || (!isFresh(theirs) && theirs.updatedAt > mine.updatedAt);
    if (useFolder) {
      if (!isFresh(mine)) await store.writeRaw(`learn-wp-record.backup-${stamp()}.json`, JSON.stringify(mine, null, 2));
      this.folder = store;
      this.folderError = null;
      this.current = theirs;
      this.emit();
      await this.persist();
      return 'resumed';
    }
    await store.writeRaw(`learn-wp-record.backup-${stamp()}.json`, raw);
    await store.save(mine);
    this.folder = store;
    this.folderError = null;
    return 'kept-current-with-backup';
  }

  async dispatch(e: RecordEvent): Promise<void> {
    await this.init();
    const before = this.current;
    this.current = applyEvent(before, e, this.content);
    const local = this.current.statements.slice(before.statements.length);
    this.emit();
    await this.persist();
    if (!FEATURES.serverEvents) return;
    if (e.type === 'beatViewed') {
      // Never waits for the network; the server hears about beats in a batch.
      this.client.queueBeat(e.lessonId, e.beatIndex);
      return;
    }
    const se = toServerEvent(e);
    if (!se || local.length === 0) return;
    // The send and the swap run in the background; the studio never waits on the network.
    const p = this.sendAndSwap(se, local).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Resolves when every background send started by dispatch has finished (for tests and shutdown). */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async sendAndSwap(se: Parameters<EventClient['send']>[0], local: XapiStatement[]): Promise<void> {
    const learnerAtSend = this.current.learnerId;
    let res: EventResult | null = null;
    try {
      res = await this.client.send(se);
    } catch {
      res = null;
    }
    // Once the learner has a session, the record is theirs under the session's name.
    const actor = currentActor();
    if (actor && this.current.learnerId === learnerAtSend && learnerAtSend !== actor.name) {
      this.current = { ...this.current, learnerId: actor.name };
      this.emit();
      await this.persist().catch(() => {});
    }
    if (!res || !res.ok) return; // keep the locally built statements
    // The server's statements stand in for the ones built here, if they are still there as built.
    // After a restore, or when this answer was already applied, they are not, and nothing changes.
    const cur = this.current.statements;
    const at = cur.indexOf(local[0]);
    if (at < 0 || !local.every((s, i) => cur[at + i] === s)) return;
    const statements = [...cur];
    statements.splice(at, local.length, ...res.statements);
    this.current = { ...this.current, statements };
    this.emit();
    await this.persist().catch(() => {});
  }

  async restore(r: LearningRecord): Promise<void> {
    await this.init();
    this.current = r;
    this.emit();
    await this.persist();
  }

  /**
   * Clear the browser's record and start a new one. An attached folder is the learner's own file:
   * it is detached and left as it is, and later saves no longer go there.
   */
  async reset(): Promise<void> {
    await this.init();
    this.folder = null;
    this.folderError = null;
    this.current = newRecord();
    this.emit();
    await this.persist();
  }

  subscribe(fn: (r: LearningRecord) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.current);
  }

  /** Saves run one at a time, each writing the latest record when it runs. */
  private persist(): Promise<void> {
    const p = this.chain.then(async () => {
      const r = this.current;
      const folderSave = this.folder
        ? this.folder.save(r).then(
            () => {
              if (this.folderError) {
                this.folderError = null;
                this.emit();
              }
            },
            (err) => {
              this.folderError = err instanceof Error ? err : new Error(String(err));
              this.emit(); // let the UI show the failure
            },
          )
        : Promise.resolve();
      try {
        await this.primary.save(r);
      } finally {
        await folderSave;
      }
    });
    this.chain = p.catch(() => {});
    return p;
  }
}

type NewServerEvent = ServerEvent extends infer E ? (E extends { eventId: string } ? Omit<E, 'eventId'> : never) : never;

/** The local event as the course server knows it; null when the server has no such event. */
function toServerEvent(e: RecordEvent): NewServerEvent | null {
  switch (e.type) {
    case 'placed':
      return { type: 'placed', placement: e.placement };
    case 'checkpointAnswered':
      return {
        type: 'checkpointAnswered',
        lessonId: e.lessonId,
        response: e.response,
        outcome: e.outcome,
        ...(e.decisionId ? { decisionId: e.decisionId } : {}),
        ...(e.files ? { files: e.files } : {}),
      };
    case 'codeChecked':
      return e.files ? { type: 'codeSubmitted', lessonId: e.lessonId, target: e.target ?? 'checkpoint', file: e.file, files: e.files } : null;
    case 'lessonCompleted':
      return { type: 'lessonCompleted', lessonId: e.lessonId };
    default:
      return null;
  }
}
