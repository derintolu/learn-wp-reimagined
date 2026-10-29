// A large text value stored in parts: the database broker refuses any single operation over 65,536 bytes, so a body
// that can pass that is split across rows of a parts table, one INSERT per part. Callers keep a pointer row naming the
// version, and write in this order so a reader never sees a half-written body: parts, then the pointer, then cleanup.
import { isDuplicateKey } from './db';
import type { D1Like } from './env';

/** The most UTF-8 bytes in one stored part: the INSERT carries its other bound values and text on top. */
export const PART_BYTES = 48_000;

/** Splits s at character boundaries into parts of at most maxBytes UTF-8 bytes each; the parts join back to s. */
export function splitUtf8(s: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new RangeError('maxBytes must be at least 4');
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i)!;
    const w = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + w > maxBytes) {
      parts.push(s.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += w;
    i += cp > 0xffff ? 2 : 1;
  }
  if (start < s.length || parts.length === 0) parts.push(s.slice(start));
  return parts;
}

/**
 * A parts table: (keyCol, verCol, seq, part), primary key (keyCol, verCol, seq). The names are fixed by the callers
 * (never user input), so they are put in the SQL text.
 */
export interface PartsTable {
  table: string;
  keyCol: string;
  verCol: string;
}

type Id = string | number;

/**
 * Writes body as the parts of (key, ver). fresh: nothing readable can be under this version (a new etag or time), so a
 * leftover from an interrupted attempt is deleted first. Otherwise (a repair of a version readers already point at)
 * nothing is deleted before the write: a part that exists is overwritten in place and any extra trailing parts go after.
 */
export async function writeParts(db: D1Like, t: PartsTable, key: Id, ver: Id, body: string, fresh: boolean): Promise<void> {
  if (fresh) await db.prepare(`DELETE FROM ${t.table} WHERE ${t.keyCol} = ? AND ${t.verCol} = ?`).bind(key, ver).run();
  const parts = splitUtf8(body, PART_BYTES);
  for (let seq = 0; seq < parts.length; seq++) {
    try {
      await db.prepare(`INSERT INTO ${t.table} (${t.keyCol}, ${t.verCol}, seq, part) VALUES (?, ?, ?, ?)`).bind(key, ver, seq, parts[seq]).run();
    } catch (e) {
      if (fresh || !isDuplicateKey(e)) throw e;
      await db
        .prepare(`UPDATE ${t.table} SET part = ? WHERE ${t.keyCol} = ? AND ${t.verCol} = ? AND seq = ?`)
        .bind(parts[seq], key, ver, seq)
        .run();
    }
  }
  if (!fresh) await db.prepare(`DELETE FROM ${t.table} WHERE ${t.keyCol} = ? AND ${t.verCol} = ? AND seq >= ?`).bind(key, ver, parts.length).run();
}

/**
 * The joined parts of (key, ver), or null when there are none. One SELECT per part, so no single result can pass the
 * broker limit either; the read stops at the first missing seq.
 */
export async function readParts(db: D1Like, t: PartsTable, key: Id, ver: Id): Promise<string | null> {
  const parts: string[] = [];
  for (let seq = 0; ; seq++) {
    const row = await db
      .prepare(`SELECT part FROM ${t.table} WHERE ${t.keyCol} = ? AND ${t.verCol} = ? AND seq = ?`)
      .bind(key, ver, seq)
      .first<{ part: string }>();
    if (!row) break;
    parts.push(row.part);
  }
  return parts.length ? parts.join('') : null;
}

/** Removes the parts of every version of key except keep (all of them when keep is omitted). */
export async function deleteOtherParts(db: D1Like, t: PartsTable, key: Id, keep?: Id): Promise<void> {
  if (keep === undefined) await db.prepare(`DELETE FROM ${t.table} WHERE ${t.keyCol} = ?`).bind(key).run();
  else await db.prepare(`DELETE FROM ${t.table} WHERE ${t.keyCol} = ? AND ${t.verCol} <> ?`).bind(key, keep).run();
}
