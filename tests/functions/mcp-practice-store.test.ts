// The practice relay on D1 and the legacy-record conversion behind "every issued handle keeps resolving".
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { getCourse } from '../../functions/_lib/mcp/course';
import { practiceForm } from '../../functions/_lib/mcp/handles';
import { convertLegacyRecord } from '../../functions/_lib/mcp/legacyRecord';
import { D1PracticeStore } from '../../functions/_lib/mcp/practiceStore';
import { MCP_TTL_MS, ensureMcpSchema, handleKey } from '../../functions/_lib/mcp/recordStore';
import { getStandardCourse } from '../../functions/_lib/mcp/standardCourse';
import { getContent } from '../../functions/_lib/content';
import { COURSE_ID } from '../../src/shared/course-meta';
import { StoreConflictError } from '../../vendor/course-xapi-mcp/core/errors.ts';
import { PRACTICE_HOMEPAGE } from '../../vendor/course-xapi-mcp/core/constants.ts';
import { parsePracticeRecord, type PracticeRecord } from '../../vendor/course-xapi-mcp/core/practice-record.ts';
import {
  checkCode,
  choosePlacement,
  nextBeat,
  startPlacement,
  submitCheckpoint,
  newHandle,
  type Ctx,
  type LearningRecord,
} from '../../vendor/learning-mcp/core/index.ts';
import type { D1Like } from '../../functions/_lib/env';

const LESSON = 'bt-what-is-a-block-theme';
const NEXT = 'bt-style-css-and-theme-json';

let n = 0;
const ctx: Ctx = { now: () => new Date(Date.parse('2026-10-20T12:00:00Z') + n * 1000).toISOString(), uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };

/** A record exactly as today's server builds it: learning-mcp's own session functions on today's course. */
function legacyAt(stop: 'bug' | 'checkpoint' | 'reply'): LearningRecord {
  const course = getCourse();
  let r = startPlacement(course, undefined, ctx).record;
  const ok = <T extends { ok: boolean }>(x: T) => {
    if (!x.ok) throw new Error(JSON.stringify(x));
    return x as Extract<T, { ok: true }>;
  };
  r = ok(choosePlacement(course, r, { pathId: 'block-theme', startLessonId: LESSON, skip: [], reason: 'New to themes.' }, ctx)).record;
  for (let i = 0; i < 20; i++) {
    const st = r.courses[COURSE_ID].cursor!;
    if (st.phase !== 'beats') break;
    if (stop === 'reply' && st.awaitingReply) return r;
    const step = ok(nextBeat(course, r, { learner_reply: st.awaitingReply ? 'The Site Editor.' : undefined }, ctx));
    r = step.record;
  }
  const lesson = course.lessons[LESSON];
  r = ok(checkCode(course, r, { file: lesson.bug!.file, content: '{ "version": 1 }' }, ctx)).record;
  r = ok(checkCode(course, r, { file: lesson.bug!.file, content: '{ "version": 2 }' }, ctx)).record;
  if (stop === 'bug') return r;
  const fixed = getContent().paths['block-theme'].finalFiles!['theme.json'];
  r = ok(checkCode(course, r, { file: lesson.bug!.file, content: fixed }, ctx)).record;
  r = ok(nextBeat(course, r, {}, ctx)).record;
  return r;
}

let db: D1Like;
let t: number;
const store = () => new D1PracticeStore(db, getStandardCourse, () => t);
const rows = () => db.prepare('SELECT h, body, ver FROM mcp_records').all<{ h: string; body: string; ver: number }>();
const putLegacy = async (handle: string, r: LearningRecord) =>
  db.prepare('INSERT INTO mcp_records (h, body, ver, touched) VALUES (?, ?, 1, ?)').bind(await handleKey(handle), JSON.stringify(r), t).run();

beforeEach(async () => {
  db = createSqliteD1();
  t = Date.parse('2026-10-21T09:00:00Z');
  await ensureMcpSchema(db);
});

describe('convertLegacyRecord', () => {
  it('keeps lesson, beat, phase, files, placement, the learner and the failed fix attempts', () => {
    const legacy = legacyAt('bug');
    const st = legacy.courses[COURSE_ID];
    const copy = convertLegacyRecord(legacy, getStandardCourse())!;
    expect(copy.state.cursor).toEqual({ pathKey: 'block-theme', lessonKey: LESSON, beat: st.cursor!.beat, phase: 'bug' });
    expect(copy.state.files).toEqual(st.files);
    expect(copy.state.files['theme.json']).toBe('{ "version": 2 }');
    expect(copy.state.placement).toEqual({ pathKey: 'block-theme', startLessonKey: LESSON, skip: [], reason: 'New to themes.' });
    expect(copy.state.registration).toBe(st.registration);
    expect(copy.state.au[LESSON]).toMatchObject({ fixAttempts: 2, completed: false });
    expect(copy.actor).toEqual({ objectType: 'Agent', account: { homePage: PRACTICE_HOMEPAGE, name: legacy.learnerId } });
    expect(copy.courseId).toBe(getStandardCourse().id);
  });

  it('at the checkpoint: the bug counts as caught and the lesson as completed, as the standard records them', () => {
    const copy = convertLegacyRecord(legacyAt('checkpoint'), getStandardCourse())!;
    expect(copy.state.cursor).toMatchObject({ lessonKey: LESSON, phase: 'checkpoint' });
    expect(copy.state.au[LESSON]).toMatchObject({ bug: 'caught', completed: true, passed: false });
  });

  it('a beat waiting for the learner reply still waits for it', () => {
    const legacy = legacyAt('reply');
    expect(typeof legacy.courses[COURSE_ID].cursor!.awaitingReply).toBe('string');
    expect(convertLegacyRecord(legacy, getStandardCourse())!.state.cursor).toMatchObject({ awaitingReply: true, phase: 'beats' });
  });

  it('a pending checkpoint answer keeps its allowed branches; completed lessons are completed and passed', () => {
    const course = getCourse();
    const legacy = legacyAt('checkpoint');
    const sub = submitCheckpoint(course, legacy, { response: 'style.css and templates/index.html.' }, ctx);
    if (!sub.ok) throw new Error(sub.error);
    const r: LearningRecord = { ...sub.record, courses: { ...sub.record.courses, [COURSE_ID]: { ...sub.record.courses[COURSE_ID], completedLessons: [NEXT] } } };
    const copy = convertLegacyRecord(r, getStandardCourse())!;
    expect(copy.state.pending).toEqual({ lessonKey: LESSON, checkpointKey: course.lessons[LESSON].checkpoint!.id, checksPassed: null, allowed: ['advance', 'review', 'skip'] });
    expect(copy.state.cursor).toMatchObject({ phase: 'branch' });
    expect(copy.state.au[NEXT]).toMatchObject({ completed: true, passed: true });
  });

  it('the converted copy is a practice copy the standard accepts back (resume_practice)', () => {
    const copy = convertLegacyRecord(legacyAt('bug'), getStandardCourse())!;
    const back = parsePracticeRecord(JSON.parse(JSON.stringify(copy)), getStandardCourse().id);
    expect(back.ok).toBe(true);
  });

  it('refuses anything that is not a learning-mcp record', () => {
    expect(convertLegacyRecord({ format: 'nope' }, getStandardCourse())).toBeUndefined();
    expect(convertLegacyRecord(null, getStandardCourse())).toBeUndefined();
  });
});

describe('D1PracticeStore', () => {
  it('finds a record issued before the swap through the practice form of its handle, converted', async () => {
    const legacy = newHandle();
    const r = legacyAt('bug');
    await putLegacy(legacy, r);
    const got = await store().get(practiceForm(legacy));
    expect(got?.record.state.cursor).toMatchObject({ lessonKey: LESSON, phase: 'bug' });
    expect(got?.etag).toBe('legacy:1');
    expect(await store().get(practiceForm(newHandle()))).toBeUndefined();
  });

  it('the first save writes the copy under the practice key and leaves the legacy row as it was', async () => {
    const legacy = newHandle();
    const handle = practiceForm(legacy);
    const r = legacyAt('bug');
    await putLegacy(legacy, r);
    const got = (await store().get(handle))!;
    const next: PracticeRecord = { ...got.record, state: { ...got.record.state, files: { 'theme.json': 'mine' } } };
    expect(await store().put(handle, next, got.etag)).toEqual({ etag: '1' });
    const kept = await db.prepare('SELECT body FROM mcp_records WHERE h = ?').bind(await handleKey(legacy)).first<{ body: string }>();
    expect(JSON.parse(kept!.body)).toEqual(r);
    const again = (await store().get(handle))!;
    expect(again.etag).toBe('1');
    expect(again.record.state.files).toEqual({ 'theme.json': 'mine' });
    // The legacy read is now stale: saving from it again conflicts.
    await expect(store().put(handle, next, got.etag)).rejects.toBeInstanceOf(StoreConflictError);
  });

  it('a save from a legacy read conflicts when the legacy row changed meanwhile', async () => {
    const legacy = newHandle();
    await putLegacy(legacy, legacyAt('bug'));
    const got = (await store().get(practiceForm(legacy)))!;
    await db.prepare('UPDATE mcp_records SET ver = 2 WHERE h = ?').bind(await handleKey(legacy)).run();
    await expect(store().put(practiceForm(legacy), got.record, got.etag)).rejects.toBeInstanceOf(StoreConflictError);
  });

  it('round-trips a new practice copy with compare-and-set; only hashes are stored', async () => {
    const handle = practiceForm(newHandle());
    const copy = convertLegacyRecord(legacyAt('bug'), getStandardCourse())!;
    const { etag } = await store().put(handle, copy);
    await expect(store().put(handle, copy)).rejects.toBeInstanceOf(StoreConflictError);
    expect(await store().get(handle)).toEqual({ record: copy, etag });
    expect((await store().put(handle, copy, etag)).etag).toBe('2');
    await expect(store().put(handle, copy, etag)).rejects.toBeInstanceOf(StoreConflictError);
    const { results } = await rows();
    expect(results.map((x) => x.h)).toEqual([await handleKey(handle)]);
    expect(JSON.stringify(results)).not.toContain(handle.slice(4));
  });

  it('delete removes the practice copy and the legacy record behind it', async () => {
    const legacy = newHandle();
    const handle = practiceForm(legacy);
    await putLegacy(legacy, legacyAt('bug'));
    const got = (await store().get(handle))!;
    await store().put(handle, got.record, got.etag);
    expect((await rows()).results).toHaveLength(2);
    expect(await store().delete(handle)).toBe(true);
    expect((await rows()).results).toHaveLength(0);
    expect(await store().delete(handle)).toBe(false);
  });

  it('a copy unused for 30 days is gone, legacy or not', async () => {
    const legacy = newHandle();
    await putLegacy(legacy, legacyAt('bug'));
    const handle = practiceForm(newHandle());
    await store().put(handle, convertLegacyRecord(legacyAt('bug'), getStandardCourse())!);
    t += MCP_TTL_MS + 1;
    expect(await store().get(practiceForm(legacy))).toBeUndefined();
    expect(await store().get(handle)).toBeUndefined();
    expect((await rows()).results).toHaveLength(0);
  });

  it('stored() returns the legacy record as kept until the learner continues here, then the practice copy', async () => {
    const legacy = newHandle();
    const handle = practiceForm(legacy);
    const r = legacyAt('bug');
    await putLegacy(legacy, r);
    expect(await store().stored(handle)).toEqual(r);
    const got = (await store().get(handle))!;
    await store().put(handle, got.record, got.etag);
    expect(await store().stored(handle)).toEqual(got.record);
    expect(await store().stored(practiceForm(newHandle()))).toBeUndefined();
  });
});
