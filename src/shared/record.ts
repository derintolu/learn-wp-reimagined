import type { Placement } from './engine';
import type { ContentBundle, Outcome, PathId } from './types';
import { buildStatement, validateStatement, type VerbKey, type XapiResult, type XapiStatement } from './xapi';

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
  statements: XapiStatement[];
}

export type RecordEvent =
  | { type: 'placed'; placement: Placement }
  | { type: 'beatViewed'; lessonId: string; beatIndex: number }
  | { type: 'checkpointAnswered'; lessonId: string; response: string; outcome: Outcome; to: string }
  | { type: 'codeChecked'; lessonId: string; file: string; passed: boolean }
  | { type: 'fileEdited'; file: string; content: string }
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
      add('branched', ['lessons', e.to], title(e.to), e.to, { extensions: { outcome: e.outcome, from: e.lessonId } });
      next.current = { pathId: pathOf(e.to), lessonId: e.to, beatIndex: 0 };
      break;
    }
    case 'codeChecked':
      add(e.passed ? 'passed' : 'failed', ['lessons', e.lessonId, 'files', e.file], `${title(e.lessonId)}: ${e.file}`, e.lessonId, { success: e.passed });
      break;
    case 'fileEdited':
      next.files[e.file] = e.content;
      break;
    case 'lessonCompleted':
      if (!next.completedLessons.includes(e.lessonId)) {
        next.completedLessons.push(e.lessonId);
        add('completed', ['lessons', e.lessonId], title(e.lessonId), e.lessonId, { completion: true });
      }
      break;
  }
  return next;
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
  if (!Array.isArray(r.statements)) return fail('statements must be an array');
  for (let i = 0; i < r.statements.length; i++) {
    const errs = validateStatement(r.statements[i]);
    if (errs.length) return fail(`statement ${i} is invalid: ${errs[0]}`);
  }
  const cur = r.current;
  if (cur !== undefined) {
    const o = cur as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || typeof o.pathId !== 'string' || typeof o.lessonId !== 'string' || typeof o.beatIndex !== 'number') {
      return fail('current is malformed');
    }
  }
  const p = r.placement;
  if (p !== undefined && (p === null || typeof p !== 'object' || typeof (p as Placement).pathId !== 'string')) {
    return fail('placement is malformed');
  }
  return { ok: true, record: raw as LearningRecord };
}
