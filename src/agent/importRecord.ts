// "Bring back your agent's progress": turns an agent's learning-mcp record into the site's own events.
// Pure. The two record formats stay separate (plan B, B4): the site's statements are only ever made by
// the site's applyEvent, so the agent's statements are read, never copied. Nothing that differs from
// the site changes without the learner's tick, and the result must pass the site's parseRecord.
import { EXT, LIMITS, VERBS, isHandle, parseRecord as parseMcpRecord, type LearningRecord as McpRecord } from '../../vendor/learning-mcp/core/index.ts';
import { COURSE_ACTIVITY_BASE, COURSE_ID } from '../shared/course-meta';
import { resolveBranch, validatePlacement } from '../shared/engine';
import { applyEvent, parseRecord, type LearningRecord, type RecordEvent } from '../shared/record';
import type { ContentBundle, Outcome } from '../shared/types';
import { VERBS as SITE_VERBS, activityId } from '../shared/xapi';

export const INVALID_PASTE = 'Paste a record handle (it starts with lr_) or the exported JSON.';
export const NO_PROGRESS = 'This record has no progress in this course yet.';

export type Paste = { kind: 'handle'; handle: string } | { kind: 'json'; value: unknown } | { kind: 'invalid'; message: string };

export function classifyPaste(text: string): Paste {
  const t = text.trim();
  if (isHandle(t)) return { kind: 'handle', handle: t };
  if (t.startsWith('{')) {
    try {
      return { kind: 'json', value: JSON.parse(t) };
    } catch {
      // fall through
    }
  }
  return { kind: 'invalid', message: INVALID_PASTE };
}

export interface ImportConflict {
  kind: 'position' | 'placement' | 'file';
  /** `position`, `placement` or `file:<name>`: what the learner ticks. */
  key: string;
  site: string;
  agent: string;
  event: RecordEvent;
}

export interface ImportPlan {
  events: RecordEvent[];
  conflicts: ImportConflict[];
  ignored: string[];
  summary: { lessons: number; checkpoints: number; files: number };
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const OUTCOMES: readonly Outcome[] = ['advance', 'review', 'skip'];

/** Reads an MCP activity IRI as `{ lessonId, kind, name }` (e.g. lessons/<l>/files/<f>). */
function readActivity(id: string): { lessonId: string; kind?: string; name?: string } | null {
  const prefix = `${COURSE_ACTIVITY_BASE}/lessons/`;
  if (!id.startsWith(prefix)) return null;
  try {
    const [lessonId, kind, name, ...rest] = id.slice(prefix.length).split('/').map(decodeURIComponent);
    if (!lessonId || rest.length) return null;
    return { lessonId, kind, name };
  } catch {
    return null;
  }
}

/** Every file name a lesson works on: starter files, planted-bug files and checkpoint files. */
function courseFiles(content: ContentBundle): Set<string> {
  const out = new Set<string>();
  for (const l of Object.values(content.lessons)) {
    for (const f of Object.keys(l.starterFiles ?? {})) out.add(f);
    if (l.bug) out.add(l.bug.file);
    if (l.checkpoint?.file) out.add(l.checkpoint.file);
  }
  return out;
}

const firstLines = (s: string) => s.split('\n').slice(0, 3).join('\n');

export function planImport(site: LearningRecord, raw: unknown, content: ContentBundle): { ok: true; plan: ImportPlan } | { ok: false; error: string } {
  const parsed = parseMcpRecord(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const rec: McpRecord = parsed.record;
  if (!has(rec.courses, COURSE_ID)) return { ok: false, error: NO_PROGRESS };
  const st = rec.courses[COURSE_ID];
  const knownLesson = (id: string) => has(content.lessons, id);

  const events: RecordEvent[] = [];
  const conflicts: ImportConflict[] = [];
  const ignored = new Set<string>();
  const counts = { beats: 0, replies: 0, bugs: 0 };
  for (const id of Object.keys(rec.courses)) if (id !== COURSE_ID) ignored.add(`other course: ${id}`);

  const siteHas = (verbId: string | null, activity: string) =>
    site.statements.some((s) => s.object.id === activity && (verbId === null || s.verb.id === verbId));
  const responses = new Map<string, string>();
  const lastFileLesson = new Map<string, string>();

  for (const s of rec.statements) {
    const a = readActivity(s.object.id);
    if (!a) continue; // course- or path-level statements, or another course's
    if (!knownLesson(a.lessonId)) {
      ignored.add(`unknown lesson: ${a.lessonId}`);
      continue;
    }
    const verb = s.verb.id;
    if (a.kind === 'beats') {
      if (verb === VERBS.experienced.id) counts.beats++;
      else if (verb === VERBS.answered.id) counts.replies++;
    } else if (a.kind === 'bugs' && verb === VERBS.caught.id) counts.bugs++;
    else if (a.kind === 'checkpoints') {
      if (verb === VERBS.answered.id) responses.set(a.lessonId, s.result?.response ?? '');
      else if (verb === VERBS.branched.id) {
        const outcome = s.result?.extensions?.[EXT.branch] as Outcome;
        if (!OUTCOMES.includes(outcome)) continue;
        if (siteHas(SITE_VERBS.answered.id, activityId(['lessons', a.lessonId, 'checkpoint']))) {
          ignored.add(`already answered on the site: ${a.lessonId}`);
          continue;
        }
        let to: string;
        try {
          to = resolveBranch(content, a.lessonId, outcome).to;
        } catch {
          ignored.add(`unknown branch: ${a.lessonId} ${outcome}`);
          continue;
        }
        events.push({ type: 'checkpointAnswered', lessonId: a.lessonId, response: responses.get(a.lessonId) ?? '', outcome, to });
      }
      // passed/failed on a checkpoint come with its branch; checkpointAnswered records them on the site.
    } else if (a.kind === 'files' && a.name && (verb === VERBS.passed.id || verb === VERBS.failed.id)) {
      lastFileLesson.set(a.name, a.lessonId);
      if (siteHas(null, activityId(['lessons', a.lessonId, 'files', a.name]))) continue;
      events.push({ type: 'codeChecked', lessonId: a.lessonId, file: a.name, passed: verb === VERBS.passed.id });
    }
  }
  if (counts.beats) ignored.add(`beats taught in the agent: ${counts.beats}`);
  if (counts.replies) ignored.add(`beat replies: ${counts.replies}`);
  if (counts.bugs) ignored.add(`planted bugs caught: ${counts.bugs}`);

  let lessons = 0;
  for (const id of st.completedLessons) {
    if (!knownLesson(id)) ignored.add(`unknown lesson: ${id}`);
    else if (!site.completedLessons.includes(id)) {
      events.push({ type: 'lessonCompleted', lessonId: id });
      lessons++;
    }
  }

  const allowed = courseFiles(content);
  let files = 0;
  for (const [name, text] of Object.entries(st.files)) {
    if (!allowed.has(name) || text.length > LIMITS.file) {
      ignored.add(`file not in the course: ${name}`);
      continue;
    }
    const lessonId = lastFileLesson.get(name);
    const event: RecordEvent = { type: 'fileEdited', file: name, content: text, ...(lessonId ? { lessonId } : {}) };
    if (!has(site.files, name)) {
      events.push(event);
      files++;
    } else if (site.files[name] !== text) {
      conflicts.push({ kind: 'file', key: `file:${name}`, site: firstLines(site.files[name]), agent: firstLines(text), event });
      files++;
    }
  }

  if (st.placement) {
    const v = validatePlacement(content, st.placement);
    if (!v.ok) ignored.add('placement that no longer fits the course');
    else if (!site.placement) events.push({ type: 'placed', placement: v.placement });
    else if (site.placement.pathId !== v.placement.pathId || site.placement.startLessonId !== v.placement.startLessonId) {
      const title = (id: string) => (knownLesson(id) ? content.lessons[id].title : id);
      conflicts.push({ kind: 'placement', key: 'placement', site: title(site.placement.startLessonId), agent: title(v.placement.startLessonId), event: { type: 'placed', placement: v.placement } });
    }
  }

  const cur = st.cursor;
  if (cur && cur.phase !== 'done') {
    if (!knownLesson(cur.lessonId)) ignored.add(`unknown lesson: ${cur.lessonId}`);
    else {
      const beats = content.lessons[cur.lessonId].beats.length;
      const event: RecordEvent = { type: 'beatViewed', lessonId: cur.lessonId, beatIndex: Math.min(Math.max(0, cur.beat - 1), beats - 1) };
      if (!site.current) events.push(event);
      else if (site.current.lessonId !== cur.lessonId) {
        conflicts.push({ kind: 'position', key: 'position', site: content.lessons[site.current.lessonId]?.title ?? site.current.lessonId, agent: content.lessons[cur.lessonId].title, event });
      }
    }
  }

  const checkpoints = events.filter((e) => e.type === 'checkpointAnswered').length;
  return { ok: true, plan: { events, conflicts, ignored: [...ignored], summary: { lessons, checkpoints, files } } };
}

/** Applies a plan and the conflicts the learner ticked. Throws if the result is not a valid site record. */
export function applyImport(site: LearningRecord, plan: ImportPlan, accepted: ReadonlySet<string>, content: ContentBundle): LearningRecord {
  let r = site;
  for (const e of plan.events) r = applyEvent(r, e, content);
  for (const c of plan.conflicts) if (accepted.has(c.key)) r = applyEvent(r, c.event, content);
  if (site.current && !accepted.has('position')) r = { ...r, current: site.current };
  if (site.placement && !accepted.has('placement')) r = { ...r, placement: site.placement };
  const check = parseRecord(JSON.parse(JSON.stringify(r)));
  if (!check.ok) throw new Error(`The imported record is not valid: ${check.error}`);
  return r;
}
