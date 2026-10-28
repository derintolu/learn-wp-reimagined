// The learner's files and resume position as xAPI State documents on the course activity. The standard
// (course-xapi-mcp core) names no State ids for them, so these are ours (see STATE_ID).

export type StateKind = 'files' | 'resume';
export const STATE_KINDS: readonly StateKind[] = ['files', 'resume'];
export const STATE_ID: Record<StateKind, string> = { files: 'lwr-files', resume: 'lwr-resume' };
/** Learning Ledger's State document limit; the course server answers 413 too-large above it. */
export const STATE_MAX_BYTES = 2 * 1024 * 1024;
export const STATE_TOO_BIG_MESSAGE = "Your files are too big to sync. They're still saved in this browser.";

/** The files document. `times` holds when each file was last edited (ISO), so writers can keep the newest. */
export interface FilesDoc {
  files: Record<string, string>;
  fileLessons?: Record<string, string>;
  times?: Record<string, string>;
}

export interface ResumeDoc {
  current: { pathId: string; lessonId: string; beatIndex: number };
  updatedAt: string;
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strMap = (v: unknown): v is Record<string, string> =>
  isObj(v) && Object.keys(v).every((k) => k !== '__proto__' && typeof v[k] === 'string');

export function parseFilesDoc(v: unknown): FilesDoc | null {
  if (!isObj(v) || !strMap(v.files)) return null;
  if (v.fileLessons !== undefined && !strMap(v.fileLessons)) return null;
  if (v.times !== undefined && !strMap(v.times)) return null;
  const doc: FilesDoc = { files: v.files };
  if (v.fileLessons) doc.fileLessons = v.fileLessons;
  if (v.times) doc.times = v.times;
  return doc;
}

export function parseResumeDoc(v: unknown): ResumeDoc | null {
  if (!isObj(v) || typeof v.updatedAt !== 'string' || !isObj(v.current)) return null;
  const c = v.current;
  if (typeof c.pathId !== 'string' || typeof c.lessonId !== 'string' || typeof c.beatIndex !== 'number' || !Number.isFinite(c.beatIndex)) return null;
  return { current: { pathId: c.pathId, lessonId: c.lessonId, beatIndex: c.beatIndex }, updatedAt: v.updatedAt };
}

/** Newest-per-file union of two files documents. A file with no time is older than any with one; a tie keeps `mine`. */
export function mergeFilesDocs(mine: FilesDoc, theirs: FilesDoc): FilesDoc {
  const files: Record<string, string> = {};
  const fileLessons: Record<string, string> = {};
  const times: Record<string, string> = {};
  const names = new Set([...Object.keys(mine.files), ...Object.keys(theirs.files)]);
  for (const f of names) {
    if (f === '__proto__') continue;
    const a = has(mine.files, f);
    const b = has(theirs.files, f);
    const ta = mine.times && has(mine.times, f) ? mine.times[f] : '';
    const tb = theirs.times && has(theirs.times, f) ? theirs.times[f] : '';
    const from = a && (!b || ta >= tb) ? mine : theirs;
    files[f] = from.files[f];
    if (from.fileLessons && has(from.fileLessons, f)) fileLessons[f] = from.fileLessons[f];
    const t = from.times && has(from.times, f) ? from.times[f] : '';
    if (t) times[f] = t;
  }
  const doc: FilesDoc = { files };
  if (Object.keys(fileLessons).length) doc.fileLessons = fileLessons;
  if (Object.keys(times).length) doc.times = times;
  return doc;
}

export const newerResume = (a: ResumeDoc, b: ResumeDoc): ResumeDoc => (a.updatedAt >= b.updatedAt ? a : b);
