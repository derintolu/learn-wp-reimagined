import type { Placement } from './engine';
import type { ContentBundle, Outcome, PathId } from './types';
import { EXT_FROM_LESSON, EXT_OUTCOME, VERBS, activityId, buildStatement, validateStatement, type VerbKey, type XapiResult, type XapiStatement } from './xapi';

export interface LearningRecord {
  format: 'learn-wp-reimagined/record';
  version: 1;
  learnerId: string;
  createdAt: string;
  updatedAt: string;
  placement?: Placement;
  current?: { pathId: PathId; lessonId: string; beatIndex: number };
  completedLessons: string[];
  files: Record<string, string>;
  /** The lesson each file in `files` was last edited in. Missing for edits made before this existed. */
  fileLessons?: Record<string, string>;
  statements: XapiStatement[];
}

export type RecordEvent =
  | { type: 'placed'; placement: Placement }
  | { type: 'beatViewed'; lessonId: string; beatIndex: number }
  | { type: 'checkpointAnswered'; lessonId: string; response: string; outcome: Outcome; to: string }
  | { type: 'codeChecked'; lessonId: string; file: string; passed: boolean }
  | { type: 'fileEdited'; file: string; content: string; lessonId?: string }
  | { type: 'lessonCompleted'; lessonId: string };

export function newRecord(): LearningRecord {
  const now = new Date().toISOString();
  return {
    format: 'learn-wp-reimagined/record',
    version: 1,
    learnerId: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    completedLessons: [],
    files: {},
    statements: [],
  };
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function applyEvent(r: LearningRecord, e: RecordEvent, c: ContentBundle): LearningRecord {
  const next: LearningRecord = {
    ...r,
    completedLessons: [...r.completedLessons],
    files: { ...r.files },
    statements: [...r.statements],
    updatedAt: new Date().toISOString(),
  };
  const lessonOf = (id: string) => (has(c.lessons, id) ? c.lessons[id] : undefined);
  const pathOf = (id: string): PathId => lessonOf(id)?.pathId ?? r.current?.pathId ?? r.placement?.pathId ?? 'block-theme';
  const add = (
    verb: VerbKey,
    activityPath: string[],
    name: string,
    lessonId: string,
    result?: XapiResult,
  ) => {
    next.statements.push(
      buildStatement({
        learnerId: r.learnerId,
        verb,
        activityPath,
        name,
        result,
        parent: lessonOf(lessonId) ? ['paths', pathOf(lessonId)] : undefined,
      }),
    );
  };
  const title = (id: string) => lessonOf(id)?.title ?? id;

  switch (e.type) {
    case 'placed':
      next.placement = e.placement;
      next.current = { pathId: e.placement.pathId, lessonId: e.placement.startLessonId, beatIndex: 0 };
      break;
    case 'beatViewed': {
      const beat = lessonOf(e.lessonId)?.beats[e.beatIndex];
      add('experienced', ['lessons', e.lessonId, 'beats', String(e.beatIndex)], beat ? `${title(e.lessonId)}: ${beat.id}` : title(e.lessonId), e.lessonId);
      next.current = { pathId: pathOf(e.lessonId), lessonId: e.lessonId, beatIndex: e.beatIndex };
      break;
    }
    case 'checkpointAnswered': {
      const cpPath = ['lessons', e.lessonId, 'checkpoint'];
      const name = `${title(e.lessonId)}: checkpoint`;
      add('answered', cpPath, name, e.lessonId, { response: e.response });
      add(e.outcome === 'review' ? 'failed' : 'passed', cpPath, name, e.lessonId, { success: e.outcome !== 'review' });
      add('branched', ['lessons', e.to], title(e.to), e.to, { extensions: { [EXT_OUTCOME]: e.outcome, [EXT_FROM_LESSON]: activityId(['lessons', e.lessonId]) } });
      next.current = { pathId: pathOf(e.to), lessonId: e.to, beatIndex: 0 };
      break;
    }
    case 'codeChecked':
      add(e.passed ? 'passed' : 'failed', ['lessons', e.lessonId, 'files', e.file], `${title(e.lessonId)}: ${e.file}`, e.lessonId, { success: e.passed });
      break;
    case 'fileEdited': {
      next.files[e.file] = e.content;
      const fl = { ...r.fileLessons };
      if (e.lessonId) fl[e.file] = e.lessonId;
      else delete fl[e.file];
      if (Object.keys(fl).length) next.fileLessons = fl;
      else delete next.fileLessons;
      break;
    }
    case 'lessonCompleted':
      if (!next.completedLessons.includes(e.lessonId)) {
        next.completedLessons.push(e.lessonId);
        add('completed', ['lessons', e.lessonId], title(e.lessonId), e.lessonId, { completion: true });
      }
      break;
  }
  return next;
}

/**
 * Lessons of a path that a checkpoint's skip branch jumped over: every lesson strictly between the
 * checkpoint's lesson and the branch target, read from the record's `branched` statements.
 */
export function branchSkippedLessons(r: LearningRecord, c: ContentBundle, pathId: PathId): string[] {
  const lessons = c.paths[pathId]?.lessons ?? [];
  const idx = new Map(lessons.map((id, i) => [activityId(['lessons', id]), i] as const));
  const out = new Set<string>();
  for (const st of r.statements) {
    if (st.verb.id !== VERBS.branched.id) continue;
    const ext = st.result?.extensions;
    if (ext?.[EXT_OUTCOME] !== 'skip') continue;
    const from = idx.get(String(ext?.[EXT_FROM_LESSON]));
    const to = idx.get(st.object.id);
    if (from === undefined || to === undefined) continue;
    for (let i = from + 1; i < to; i++) out.add(lessons[i]);
  }
  return [...out];
}

const LESSON_PREFIX = activityId(['lessons', '']);
const lessonFromActivity = (id: unknown): string | null => {
  if (typeof id !== 'string' || !id.startsWith(LESSON_PREFIX)) return null;
  const rest = id.slice(LESSON_PREFIX.length);
  if (!rest || rest.includes('/')) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
};
const OUTCOMES: readonly Outcome[] = ['advance', 'review', 'skip'];

/** Every checkpoint branch the learner took, oldest first, read from the `branched` statements. */
export function branchHistory(r: LearningRecord): { from: string; to: string; outcome: Outcome }[] {
  const out: { from: string; to: string; outcome: Outcome }[] = [];
  for (const st of r.statements) {
    if (st.verb.id !== VERBS.branched.id) continue;
    const ext = st.result?.extensions;
    const outcome = ext?.[EXT_OUTCOME] as Outcome;
    const from = lessonFromActivity(ext?.[EXT_FROM_LESSON]);
    const to = lessonFromActivity(st.object.id);
    if (!from || !to || !OUTCOMES.includes(outcome)) continue;
    out.push({ from, to, outcome });
  }
  return out;
}

export function parseRecord(raw: unknown): { ok: true; record: LearningRecord } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('Record must be an object');
  const r = raw as Record<string, unknown>;
  if (r.format !== 'learn-wp-reimagined/record') return fail('This is not a Learn WordPress, reimagined record');
  if (typeof r.version === 'number' && r.version > 1) return fail('This record was made by a newer version');
  if (r.version !== 1) return fail('Unsupported record version');
  if (typeof r.learnerId !== 'string' || !r.learnerId) return fail('learnerId must be a string');
  if (typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string') return fail('createdAt and updatedAt must be strings');
  if (!Array.isArray(r.completedLessons) || !r.completedLessons.every((s) => typeof s === 'string')) {
    return fail('completedLessons must be an array of strings');
  }
  const f = r.files;
  if (f === null || typeof f !== 'object' || Array.isArray(f) || !Object.values(f).every((v) => typeof v === 'string')) {
    return fail('files must map names to strings');
  }
  const fl = r.fileLessons;
  if (fl !== undefined && (fl === null || typeof fl !== 'object' || Array.isArray(fl) || !Object.values(fl).every((v) => typeof v === 'string'))) {
    return fail('fileLessons must map names to lesson ids');
  }
  if (!Array.isArray(r.statements)) return fail('statements must be an array');
  for (let i = 0; i < r.statements.length; i++) {
    const errs = validateStatement(r.statements[i]);
    if (errs.length) return fail(`statement ${i} is invalid: ${errs[0]}`);
  }
  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const cur = r.current;
  if (cur !== undefined) {
    if (
      !isObj(cur) ||
      typeof cur.pathId !== 'string' ||
      typeof cur.lessonId !== 'string' ||
      typeof cur.beatIndex !== 'number' ||
      !Number.isInteger(cur.beatIndex) ||
      cur.beatIndex < 0
    ) {
      return fail('current is malformed');
    }
  }
  const p = r.placement;
  if (p !== undefined) {
    if (
      !isObj(p) ||
      typeof p.pathId !== 'string' ||
      typeof p.startLessonId !== 'string' ||
      !Array.isArray(p.skip) ||
      !p.skip.every((x) => typeof x === 'string') ||
      typeof p.reason !== 'string'
    ) {
      return fail('placement is malformed');
    }
  }
  return { ok: true, record: raw as LearningRecord };
}
