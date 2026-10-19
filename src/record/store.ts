import { applyEvent, newRecord, parseRecord, type LearningRecord, type RecordEvent } from '../shared/record';
import type { ContentBundle } from '../shared/types';
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
  /** Set when the last folder save failed; cleared on the next success. */
  folderError: Error | null = null;
  /** Set during init() when a stored record was corrupt or too new. */
  notice: RecordNotice | null = null;

  constructor(private primary: RecordStore, private content: ContentBundle) {
    primary.onKindChange?.(() => this.emit());
  }

  get record(): LearningRecord {
    return this.current;
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
    this.current = applyEvent(this.current, e, this.content);
    this.emit();
    await this.persist();
  }

  async restore(r: LearningRecord): Promise<void> {
    await this.init();
    this.current = r;
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
            () => { this.folderError = null; },
            (err) => { this.folderError = err instanceof Error ? err : new Error(String(err)); },
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
