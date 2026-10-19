import { applyEvent, newRecord, type LearningRecord, type RecordEvent } from '../shared/record';
import type { ContentBundle } from '../shared/types';

export interface RecordStore {
  /** 'wordpress-org' is reserved for a future account adapter and is not implemented. */
  kind: 'opfs' | 'indexeddb' | 'memory' | 'folder' | 'wordpress-org';
  load(): Promise<LearningRecord | null>;
  save(r: LearningRecord): Promise<void>;
}

export class RecordManager {
  private current: LearningRecord = newRecord();
  private folder: RecordStore | null = null;
  private listeners = new Set<(r: LearningRecord) => void>();
  /** Set when the last folder save failed; cleared on the next success. */
  folderError: Error | null = null;

  constructor(private primary: RecordStore, private content: ContentBundle) {}

  get record(): LearningRecord {
    return this.current;
  }

  /** False when progress is only held in memory, so the UI can warn the learner. */
  get persistent(): boolean {
    return this.primary.kind !== 'memory';
  }

  /** Load the saved record from the primary store, if there is one. */
  async init(): Promise<void> {
    const r = await this.primary.load();
    if (r) {
      this.current = r;
      this.emit();
    }
  }

  async attachFolder(dir: FileSystemDirectoryHandle): Promise<void> {
    const { createFolderStore } = await import('./folderStore');
    const store = createFolderStore(dir);
    await store.save(this.current);
    this.folder = store;
    this.folderError = null;
  }

  async dispatch(e: RecordEvent): Promise<void> {
    this.current = applyEvent(this.current, e, this.content);
    this.emit();
    await this.persist();
  }

  async restore(r: LearningRecord): Promise<void> {
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

  private async persist() {
    const r = this.current;
    const folderSave = this.folder
      ? this.folder.save(r).then(
          () => { this.folderError = null; },
          (err) => { this.folderError = err instanceof Error ? err : new Error(String(err)); },
        )
      : Promise.resolve();
    await this.primary.save(r);
    await folderSave;
  }
}
