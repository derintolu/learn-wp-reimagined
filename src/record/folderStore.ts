import { parseRecord, type LearningRecord } from '../shared/record';
import type { RecordStore } from './store';

const RECORD_FILE = 'learn-wp-record.json';
const THEME_DIR = 'theme';

export function supportsFolder(): boolean {
  return typeof window !== 'undefined' && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string) {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
}

function safeSegments(path: string): string[] {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || parts.some((p) => p === '' || p === '.' || p === '..' || p.includes('\\'))) {
    throw new Error(`Unsafe theme file path: ${path}`);
  }
  return parts;
}

export interface FolderStore extends RecordStore {
  /** Raw text of the record file, or null if the folder has none. */
  readRaw(): Promise<string | null>;
  /** Write a file at the top level of the folder (used for backups). */
  writeRaw(name: string, text: string): Promise<void>;
}

export function createFolderStore(dir: FileSystemDirectoryHandle): FolderStore {
  return {
    kind: 'folder',
    async readRaw() {
      try {
        return await (await (await dir.getFileHandle(RECORD_FILE)).getFile()).text();
      } catch (err) {
        if ((err as { name?: string }).name === 'NotFoundError') return null;
        throw err;
      }
    },
    writeRaw: (name, text) => writeText(dir, name, text),
    async load() {
      let text: string;
      try {
        text = await (await (await dir.getFileHandle(RECORD_FILE)).getFile()).text();
      } catch (err) {
        if ((err as { name?: string }).name === 'NotFoundError') return null;
        throw err;
      }
      const res = parseRecord(JSON.parse(text));
      if (!res.ok) throw new Error(res.error);
      return res.record;
    },
    async save(r: LearningRecord) {
      // Validate every path before writing anything.
      const entries = Object.entries(r.files).map(([p, c]) => [safeSegments(p), c] as const);
      await writeText(dir, RECORD_FILE, JSON.stringify(r, null, 2));
      const theme = await dir.getDirectoryHandle(THEME_DIR, { create: true });
      for (const [segs, content] of entries) {
        let d = theme;
        for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true });
        await writeText(d, segs[segs.length - 1], content);
      }
    },
  };
}
