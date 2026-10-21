// The anonymous relay for agent records: a learning-mcp RecordStore on env.DB.
// Portable SQL only (SQLite in tests and dev, MySQL behind the Spacefast broker): no upsert syntax, and
// only duplicate-key errors are tolerated. Concurrent writers are serialised by compare-and-set on `ver`.
// The handle is a bearer secret: only its SHA-256 is stored, and it is never logged.
import { StoreConflictError, StoreError, parseRecord, type LearningRecord, type RecordStore } from '../../../vendor/learning-mcp/core/index.ts';
import type { D1Like } from '../env';
import { isDuplicateKey } from '../db';

/** Records expire after 30 days without use (spec §3a; learning-mcp RULES §5.6). */
export const MCP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** `touched` is refreshed at most this often, so reads don't write on every call. */
export const TOUCH_EVERY_MS = 60 * 60 * 1000;
/** Largest stored record body, in characters (ruling R-B7). */
export const RECORD_MAX_CHARS = 2_000_000;
export const RECORD_TOO_BIG = 'this record has reached its size limit; export it with get_record to keep it';

export async function ensureMcpSchema(db: D1Like): Promise<void> {
  await db
    .prepare('CREATE TABLE IF NOT EXISTS mcp_records (h VARCHAR(64) PRIMARY KEY, body MEDIUMTEXT NOT NULL, ver INT NOT NULL, touched BIGINT NOT NULL)')
    .run();
}

/** SHA-256 of the handle as 64 hex characters. The only form of a handle that is ever stored. */
export async function handleKey(handle: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(handle));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Made per request: it remembers the `ver` it read for each handle, for the compare-and-set put. */
export class D1RecordStore implements RecordStore {
  private vers = new Map<string, number>();

  constructor(
    private db: D1Like,
    private now: () => number = Date.now,
    private ttlMs = MCP_TTL_MS,
  ) {}

  async get(handle: string): Promise<LearningRecord | undefined> {
    const h = await handleKey(handle);
    const row = await this.db
      .prepare('SELECT body, ver, touched FROM mcp_records WHERE h = ?')
      .bind(h)
      .first<{ body: string; ver: number; touched: number }>();
    if (!row) return undefined;
    const ver = Number(row.ver);
    const t = this.now();
    if (t - Number(row.touched) > this.ttlMs) {
      await this.db.prepare('DELETE FROM mcp_records WHERE h = ? AND ver = ?').bind(h, ver).run();
      return undefined;
    }
    let parsed: ReturnType<typeof parseRecord>;
    try {
      parsed = parseRecord(JSON.parse(row.body));
    } catch {
      parsed = { ok: false, error: 'invalid JSON' };
    }
    if (!parsed.ok) {
      console.warn('mcp record unreadable');
      return undefined;
    }
    if (t - Number(row.touched) >= TOUCH_EVERY_MS) {
      await this.db.prepare('UPDATE mcp_records SET touched = ? WHERE h = ? AND ver = ?').bind(t, h, ver).run();
    }
    this.vers.set(h, ver);
    return parsed.record;
  }

  async put(handle: string, record: LearningRecord): Promise<void> {
    const body = JSON.stringify(record);
    if (body.length > RECORD_MAX_CHARS) throw new StoreError(RECORD_TOO_BIG);
    const h = await handleKey(handle);
    const t = this.now();
    const known = this.vers.get(h);
    if (known !== undefined) {
      const r = await this.db
        .prepare('UPDATE mcp_records SET body = ?, ver = ?, touched = ? WHERE h = ? AND ver = ?')
        .bind(body, known + 1, t, h, known)
        .run();
      if (r.meta.changes !== 1) throw new StoreConflictError();
      this.vers.set(h, known + 1);
      return;
    }
    try {
      await this.db.prepare('INSERT INTO mcp_records (h, body, ver, touched) VALUES (?, ?, 1, ?)').bind(h, body, t).run();
    } catch (e) {
      if (isDuplicateKey(e)) throw new StoreConflictError();
      throw e;
    }
    this.vers.set(h, 1);
  }

  async delete(handle: string): Promise<boolean> {
    const h = await handleKey(handle);
    this.vers.delete(h);
    const r = await this.db.prepare('DELETE FROM mcp_records WHERE h = ?').bind(h).run();
    return r.meta.changes === 1;
  }
}

/** Deletes every record not used for `ttlMs`. Returns how many went. */
export async function sweepExpired(db: D1Like, now: number, ttlMs = MCP_TTL_MS): Promise<number> {
  const r = await db.prepare('DELETE FROM mcp_records WHERE touched < ?').bind(now - ttlMs).run();
  return r.meta.changes;
}
