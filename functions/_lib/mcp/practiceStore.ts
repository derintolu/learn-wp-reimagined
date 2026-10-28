// The practice relay for /api/mcp on the standard: the reference server's PracticeStore on the same
// `mcp_records` table as today's records. Same rules as recordStore.ts: portable SQL, only the SHA-256 of a
// handle is stored, compare-and-set on `ver` (the etag), 30 days without use and the record expires.
//
// Records issued before the swap stay where they are, under the SHA-256 of their `lr_` handle, in
// learning-mcp's format. A practice handle with no row of its own is looked up there too: the legacy record
// is converted on read (legacyRecord.ts) and the first save writes the converted copy under the practice
// handle's own key. The legacy row is left unchanged (the copy a rollback reads) and expires on its own.
import { StoreConflictError, StoreError } from '../../../vendor/course-xapi-mcp/core/errors.ts';
import type { CourseModel } from '../../../vendor/course-xapi-mcp/core/model.ts';
import { PRACTICE_FORMAT, type PracticeRecord } from '../../../vendor/course-xapi-mcp/core/practice-record.ts';
import { createPracticeCustody, type PracticeCustody } from '../../../vendor/course-xapi-mcp/server/custody/practice.ts';
import type { PracticeStore } from '../../../vendor/course-xapi-mcp/server/custody/stores.ts';
import type { D1Like } from '../env';
import { isDuplicateKey } from '../db';
import { legacyForm } from './handles';
import { convertLegacyRecord } from './legacyRecord';
import { MCP_TTL_MS, RECORD_MAX_CHARS, RECORD_TOO_BIG, TOUCH_EVERY_MS, handleKey } from './recordStore';
import { getStandardCourse } from './standardCourse';

/** The etag of a legacy record read through a practice handle: the legacy row's `ver`, before any save. */
const LEGACY_ETAG = 'legacy:';

type Row = { body: string; ver: number; touched: number };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A stored practice copy, checked enough to trust our own write: format, state and statement list. */
function readPractice(body: string): PracticeRecord | undefined {
  try {
    const r = JSON.parse(body) as unknown;
    if (isObj(r) && r.format === PRACTICE_FORMAT && isObj(r.state) && Array.isArray(r.statements)) return r as unknown as PracticeRecord;
  } catch {
    // unreadable
  }
  return undefined;
}

export class D1PracticeStore implements PracticeStore {
  constructor(
    private db: D1Like,
    private course: () => CourseModel,
    private now: () => number = Date.now,
    private ttlMs = MCP_TTL_MS,
  ) {}

  /** The row under `h`, or undefined; an expired row is deleted. */
  private async row(h: string): Promise<Row | undefined> {
    const row = await this.db.prepare('SELECT body, ver, touched FROM mcp_records WHERE h = ?').bind(h).first<Row>();
    if (!row) return undefined;
    if (this.now() - Number(row.touched) > this.ttlMs) {
      await this.db.prepare('DELETE FROM mcp_records WHERE h = ? AND ver = ?').bind(h, Number(row.ver)).run();
      return undefined;
    }
    return row;
  }

  async get(handle: string): Promise<{ record: PracticeRecord; etag: string } | undefined> {
    const h = await handleKey(handle);
    const own = await this.row(h);
    if (own) {
      const record = readPractice(own.body);
      if (!record) {
        console.warn('mcp record unreadable');
        return undefined;
      }
      const t = this.now();
      const ver = Number(own.ver);
      if (t - Number(own.touched) >= TOUCH_EVERY_MS) {
        await this.db.prepare('UPDATE mcp_records SET touched = ? WHERE h = ? AND ver = ?').bind(t, h, ver).run();
      }
      return { record, etag: String(ver) };
    }
    const legacyHandle = legacyForm(handle);
    if (legacyHandle === handle) return undefined;
    const legacy = await this.row(await handleKey(legacyHandle));
    if (!legacy) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(legacy.body);
    } catch {
      raw = undefined;
    }
    const record = convertLegacyRecord(raw, this.course());
    if (!record) {
      console.warn('mcp record unreadable');
      return undefined;
    }
    return { record, etag: LEGACY_ETAG + Number(legacy.ver) };
  }

  async put(handle: string, rec: PracticeRecord, etag?: string): Promise<{ etag: string }> {
    const body = JSON.stringify(rec);
    if (body.length > RECORD_MAX_CHARS) throw new StoreError(RECORD_TOO_BIG);
    const h = await handleKey(handle);
    const t = this.now();
    if (etag !== undefined && !etag.startsWith(LEGACY_ETAG)) {
      const ver = Number(etag);
      const r = await this.db
        .prepare('UPDATE mcp_records SET body = ?, ver = ?, touched = ? WHERE h = ? AND ver = ?')
        .bind(body, ver + 1, t, h, ver)
        .run();
      if (r.meta.changes !== 1) throw new StoreConflictError();
      return { etag: String(ver + 1) };
    }
    if (etag !== undefined) {
      // The legacy record this save was read from must be unchanged (a rollback window could have moved it on).
      const lh = await handleKey(legacyForm(handle));
      const legacy = await this.db.prepare('SELECT ver FROM mcp_records WHERE h = ?').bind(lh).first<{ ver: number }>();
      if (!legacy || LEGACY_ETAG + Number(legacy.ver) !== etag) throw new StoreConflictError();
    }
    try {
      await this.db.prepare('INSERT INTO mcp_records (h, body, ver, touched) VALUES (?, ?, 1, ?)').bind(h, body, t).run();
    } catch (e) {
      if (isDuplicateKey(e)) throw new StoreConflictError();
      throw e;
    }
    return { etag: '1' };
  }

  /** Deletes the practice copy and, for a handle issued before the swap, the legacy record it came from. */
  async delete(handle: string): Promise<boolean> {
    let changes = 0;
    for (const hh of new Set([handle, legacyForm(handle)])) {
      changes += (await this.db.prepare('DELETE FROM mcp_records WHERE h = ?').bind(await handleKey(hh)).run()).meta.changes;
    }
    return changes > 0;
  }

  /** What is stored for a handle, as kept: a practice copy, or a legacy record not yet continued here. */
  async stored(handle: string): Promise<unknown> {
    const got = await this.get(handle);
    if (!got?.etag.startsWith(LEGACY_ETAG)) return got?.record;
    const legacy = await this.row(await handleKey(legacyForm(handle)));
    return legacy && (JSON.parse(legacy.body) as unknown);
  }
}

export interface PracticeDeps {
  makePracticeStore?: (db: D1Like) => PracticeStore;
  now?: () => number;
}

/** The reference server's practice custody on the D1 relay, as /api/mcp and /api/agent/* use it. */
export function practiceCustody(db: D1Like, deps: PracticeDeps = {}): PracticeCustody {
  const store = deps.makePracticeStore ? deps.makePracticeStore(db) : new D1PracticeStore(db, getStandardCourse, deps.now);
  return createPracticeCustody({ store, courseId: getStandardCourse().id });
}
