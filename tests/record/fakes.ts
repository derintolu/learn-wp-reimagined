// Small hand-made fakes for OPFS and File System Access directory handles.
export class FakeDir {
  files = new Map<string, string>();
  dirs = new Map<string, FakeDir>();
  failWrites = false;
  constructor(public name = '') {}

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
      this.files.set(name, '');
    }
    const dir = this;
    return {
      kind: 'file' as const,
      name,
      async getFile() {
        const t = dir.files.get(name)!;
        return { text: async () => t } as unknown as File;
      },
      async createWritable() {
        let buf = '';
        return {
          async write(d: string) { if (dir.failWrites) throw new Error('write failed'); buf += d; },
          async close() { dir.files.set(name, buf); },
        };
      },
    };
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
      d = new FakeDir(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  /** Flatten to path -> content for assertions. */
  flat(prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [n, c] of this.files) out[prefix + n] = c;
    for (const [n, d] of this.dirs) Object.assign(out, d.flat(`${prefix}${n}/`));
    return out;
  }
}
export const asHandle = (d: FakeDir) => d as unknown as FileSystemDirectoryHandle;
