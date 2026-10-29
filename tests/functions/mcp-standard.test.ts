// /api/mcp on the course-xapi-mcp reference server (SERVER_FLAGS.mcpOnStandard), practice custody on D1.
// Every handle today's server issued keeps resolving, with the same progress.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import * as route from '../../functions/api/mcp';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { PHASES_OFF, restoreServerFlags, setServerFlags } from '../helpers/flags';
import { getContent } from '../../functions/_lib/content';
import { handleMcp } from '../../functions/_lib/mcp/handler';
import { D1PracticeStore } from '../../functions/_lib/mcp/practiceStore';
import { ensureMcpSchema, handleKey } from '../../functions/_lib/mcp/recordStore';
import { getStandardCourse } from '../../functions/_lib/mcp/standardCourse';
import { EXTENSION_ID, PRACTICE_CATEGORY, TOOL_NAMES } from '../../vendor/course-xapi-mcp/core/constants.ts';
import { parsePracticeRecord, type PracticeRecord } from '../../vendor/course-xapi-mcp/core/practice-record.ts';
import { connectMcp, routeFetch, TOOLS, type Era } from '../helpers/mcpClient';
import type { D1Like, Env } from '../../functions/_lib/env';
import legacyFixture from '../fixtures/legacy-mcp-record.json';

const LESSON = 'bt-what-is-a-block-theme';
const NEXT = 'bt-style-css-and-theme-json';
const lesson = () => getContent().lessons[LESSON];
const fixedThemeJson = () => getContent().paths['block-theme'].finalFiles!['theme.json'];

let db: D1Like;
let env: Env;
let open: { close(): Promise<void> }[] = [];

// Handles are bearer secrets: nothing on this path may log one.
const logs: unknown[][] = [];
beforeAll(() => {
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a));
});
afterAll(() => {
  expect(JSON.stringify(logs)).not.toMatch(/(lr|cxp)_[A-Za-z0-9_-]{32}/);
  vi.restoreAllMocks();
});

beforeEach(() => {
  db = createSqliteD1();
  env = { DB: db } as Env;
  setServerFlags({ ...PHASES_OFF, mcpOnStandard: true });
});
afterEach(async () => {
  await Promise.all(open.map((c) => c.close()));
  open = [];
  restoreServerFlags();
});

async function session(era: Era, e: Env = env) {
  const s = await connectMcp(routeFetch(route, e), era);
  open.push(s.client);
  return s;
}
type Call = Awaited<ReturnType<typeof session>>['call'];

/** Plays beats until the step is no longer a beat. `id` reads the lesson key in either server's result. */
async function playBeats(call: Call, handle: string) {
  let r = await call('next_beat', { handle });
  for (let guard = 0; guard < 20 && r.data.step === 'beat'; guard++) {
    const asked = r.data.beat.question;
    r = await call('next_beat', asked ? { handle, learner_reply: 'I think it shows up in the Site Editor.' } : { handle });
  }
  return r;
}

/** Today's server (flag off) teaches a learner to `stop`; returns the lr_ handle. */
async function legacyLearner(stop: 'reply' | 'bug', e: Env = env): Promise<string> {
  SERVER_FLAGS.mcpOnStandard = false;
  try {
    const { call } = await session('legacy', e);
    const handle = (await call('start_placement')).data.handle as string;
    expect(handle).toMatch(/^lr_/);
    expect((await call('choose_placement', { handle, pathId: 'block-theme', startLessonId: LESSON, skip: [], reason: 'New to themes.' })).isError).toBe(false);
    if (stop === 'reply') {
      // Serve beats until one asks a question, and stop there, unanswered.
      for (let i = 0; i < 20; i++) {
        const r = await call('next_beat', { handle });
        expect(r.data.step).toBe('beat');
        if (r.data.beat.question) return handle;
      }
      throw new Error('no beat asks a question');
    }
    expect((await playBeats(call, handle)).data.step).toBe('bug');
    for (const content of ['{ "version": 1 }', '{ "version": 2 }']) expect((await call('check_code', { handle, file: 'theme.json', content })).data.passed).toBe(false);
    return handle;
  } finally {
    SERVER_FLAGS.mcpOnStandard = true;
  }
}

/** A second database holding a copy of every row of the first: the same stored record, served twice. */
async function cloneDb(): Promise<Env> {
  const copy = createSqliteD1();
  await copy.prepare('CREATE TABLE mcp_records (h VARCHAR(64) PRIMARY KEY, body MEDIUMTEXT NOT NULL, ver INT NOT NULL, touched BIGINT NOT NULL)').run();
  const { results } = await db.prepare('SELECT h, body, ver, touched FROM mcp_records').all<{ h: string; body: string; ver: number; touched: number }>();
  for (const r of results) await copy.prepare('INSERT INTO mcp_records (h, body, ver, touched) VALUES (?, ?, ?, ?)').bind(r.h, r.body, r.ver, r.touched).run();
  return { DB: copy } as Env;
}

/** The practice copy attached to a get_record result. */
const exported = (r: { raw: { content: { type: string; resource?: { text: string } }[] } }): PracticeRecord =>
  JSON.parse(r.raw.content.find((c) => c.type === 'resource')!.resource!.text);

/** A handle for the stored fixture (tests/fixtures/legacy-mcp-record.json, written by today's server). */
const FIXTURE_HANDLE = 'lr_fixtureFixtureFixtureFixture0001';

describe.each(['legacy', 'modern'] as const)('/api/mcp on the standard (%s era)', (era) => {
  it('lists the 16 course-xapi-mcp tools and advertises com.sqwrlz/course-xapi-mcp with practice custody', async () => {
    const { client } = await session(era);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(client.getServerVersion()?.name).toBe('course-xapi-mcp:course');
    const ext = (client.getServerCapabilities() as { extensions?: Record<string, Record<string, unknown>> }).extensions?.[EXTENSION_ID];
    expect(EXTENSION_ID).toBe('com.sqwrlz/course-xapi-mcp');
    expect(ext).toMatchObject({ custody: 'practice', official: false, badges: false, course: getStandardCourse().id });
  });

  it('a handle from today\'s server resumes mid-beat with the same next step as today\'s server gives', async () => {
    const handle = await legacyLearner('reply');
    const reply = { handle, learner_reply: 'The Site Editor.' };
    // The same stored record, continued by today's server and by the standard.
    const legacyEnv = await cloneDb();
    SERVER_FLAGS.mcpOnStandard = false;
    const before = await (await session(era, legacyEnv)).call('next_beat', reply);
    SERVER_FLAGS.mcpOnStandard = true;
    const { call } = await session(era);
    const status = await call('get_status', { handle });
    expect(status.data.position).toEqual({ pathKey: 'block-theme', lessonKey: LESSON, phase: 'beats' });
    const after = await call('next_beat', reply);
    expect(after.isError).toBe(false);
    expect(after.data.step).toBe(before.data.step);
    expect(after.data.lesson.key).toBe(before.data.lesson.id);
    expect(after.data.position).toEqual(before.data.position);
    expect(after.data.beat.key).toBe(before.data.beat.id);
    expect(after.data.beat.content).toBe(before.data.beat.content);
    // The reply was recorded on the new server, against the beat that asked it.
    const copy = exported(await call('get_record', { handle }));
    expect(copy.statements.some((s) => s.verb.id.endsWith('/answered') && s.result?.response === 'The Site Editor.')).toBe(true);
  });

  it('a record stored in today\'s format (fixture) resumes with identical progress', async () => {
    const st = legacyFixture.courses['learn-wp-reimagined'];
    await ensureMcpSchema(db);
    await db
      .prepare('INSERT INTO mcp_records (h, body, ver, touched) VALUES (?, ?, 1, ?)')
      .bind(await handleKey(FIXTURE_HANDLE), JSON.stringify(legacyFixture), Date.now())
      .run();
    const reply = { handle: FIXTURE_HANDLE, learner_reply: 'It names the theme.' };
    const legacyEnv = await cloneDb();
    SERVER_FLAGS.mcpOnStandard = false;
    const before = await (await session(era, legacyEnv)).call('next_beat', reply);
    SERVER_FLAGS.mcpOnStandard = true;
    const { call } = await session(era);
    expect((await call('get_status', { handle: FIXTURE_HANDLE })).data.position).toEqual({ pathKey: st.cursor.pathId, lessonKey: st.cursor.lessonId, phase: 'beats' });
    const after = await call('next_beat', reply);
    expect(after.data).toMatchObject({ step: before.data.step, lesson: { key: before.data.lesson.id }, position: before.data.position, beat: { key: before.data.beat.id, content: before.data.beat.content } });
    const copy = exported(await call('get_record', { handle: FIXTURE_HANDLE }));
    expect(copy.state.files).toEqual(st.files);
    expect(copy.state.placement).toEqual({ pathKey: st.placement.pathId, startLessonKey: st.placement.startLessonId, skip: st.placement.skip, reason: st.placement.reason });
    expect(copy.state.au[LESSON]).toMatchObject({ completed: true, passed: true, bug: 'caught' });
    expect(copy.state.registration).toBe(st.registration);
    expect(copy.actor.account.name).toBe(legacyFixture.learnerId);
  });

  it('a handle from today\'s server resumes at the planted bug with its files and failed attempts', async () => {
    const handle = await legacyLearner('bug');
    const { call } = await session(era);
    // What the hand-off prompt tells the agent to do.
    expect((await call('start_placement', { handle })).isError).toBe(false);
    const bug = await call('next_beat', { handle });
    expect(bug.data).toMatchObject({ step: 'bug', lesson: { key: LESSON } });
    const copy = exported(await call('get_record', { handle }));
    expect(copy.state.files['theme.json']).toBe('{ "version": 2 }');
    expect(copy.state.au[LESSON]?.fixAttempts).toBe(2);
    const third = await call('check_code', { handle, file: 'theme.json', content: '{ "version": 3 }' });
    expect(third.data).toMatchObject({ passed: false, fix_attempts: 3, can_reveal: true });
    expect((await call('reveal_bug', { handle })).data).toMatchObject({ revealed: true, explanation: lesson().bug!.explanation });
    // The agent keeps using the handle it was given: no result names another one.
    expect(JSON.stringify(copy)).not.toContain(handle.slice(3));
  });

  it('teaches a lesson end to end on a new practice handle, and the exported copy resumes', async () => {
    const { call } = await session(era);
    const start = await call('start_placement');
    const handle = start.data.handle as string;
    expect(handle).toMatch(/^cxp_[A-Za-z0-9_-]{32}$/);
    expect(start.data.cxm).toMatchObject({ custody: 'practice', official: false });
    expect((await call('choose_placement', { handle, pathKey: 'block-theme', startLessonKey: LESSON, skip: [], reason: 'New to themes.' })).isError).toBe(false);
    expect((await playBeats(call, handle)).data.step).toBe('bug');
    const fixed = await call('check_code', { handle, file: 'theme.json', content: fixedThemeJson() });
    expect(fixed.data).toMatchObject({ passed: true, caught: true, explanation: lesson().bug!.explanation });
    expect((await call('next_beat', { handle })).data.step).toBe('checkpoint');
    const sub = await call('submit_checkpoint', { handle, response: 'style.css and templates/index.html.' });
    expect(sub.data.allowed_branches.map((b: { key: string }) => b.key).sort()).toEqual(['advance', 'review', 'skip']);
    expect((await call('choose_branch', { handle, branch: 'teleport', rationale: 'x' })).isError).toBe(true);
    const br = await call('choose_branch', { handle, branch: 'advance', rationale: 'Names both files.' });
    expect(br.data).toMatchObject({ success: true, next_lesson: { key: NEXT } });

    const rec = await call('get_record', { handle });
    const copy = exported(rec);
    expect(parsePracticeRecord(copy, getStandardCourse().id).ok).toBe(true);
    expect(copy.state.cursor).toMatchObject({ lessonKey: NEXT, beat: 0, phase: 'beats' });
    expect(copy.statements.every((s) => s.context?.contextActivities?.category?.some((a) => a.id === PRACTICE_CATEGORY))).toBe(true);
    expect(JSON.stringify(rec.raw)).not.toContain(handle);

    const resumed = await call('resume_practice', { record: JSON.stringify(copy) });
    const again = resumed.data.handle as string;
    expect(again).toMatch(/^cxp_/);
    expect(again).not.toBe(handle);
    expect((await call('next_beat', { handle: again })).data).toMatchObject({ step: 'beat', lesson: { key: NEXT }, position: { beat: 1 } });
    expect((await call('delete_practice_record', { handle })).data.deleted).toBe(true);
    expect((await call('get_status', { handle })).isError).toBe(true);
  });

  it('get_lesson and the bug step never carry the explanation or fix checks; reveal_bug only after 3 failed fixes', async () => {
    const secrets = () => [lesson().bug!.explanation, ...lesson().bug!.fixChecks.map((c) => c.message)];
    const leaks = (r: unknown) => secrets().filter((s) => JSON.stringify(r).includes(s.slice(0, 40)));
    const { call } = await session(era);
    const outline = await call('get_lesson', { lessonKey: LESSON });
    expect(outline.data.has_planted_bug).toBe(true);
    expect(leaks(outline.raw)).toEqual([]);
    expect(JSON.stringify(outline.raw)).not.toMatch(/fixChecks|explanation/);
    const handle = (await call('start_placement')).data.handle as string;
    await call('choose_placement', { handle, pathKey: 'block-theme', startLessonKey: LESSON, skip: [], reason: 'x' });
    const bug = await playBeats(call, handle);
    expect(bug.data.step).toBe('bug');
    expect(leaks(bug.raw)).toEqual([]);
    for (let i = 1; i <= 3; i++) {
      expect((await call('reveal_bug', { handle })).isError).toBe(true);
      const miss = await call('check_code', { handle, file: 'theme.json', content: `{ "try": ${i} }` });
      expect(miss.data).toMatchObject({ passed: false, fix_attempts: i, can_reveal: i >= 3 });
      expect(leaks(miss.raw)).toEqual([]);
      expect(leaks((await call('get_lesson', { lessonKey: LESSON })).raw)).toEqual([]);
    }
    const shown = await call('reveal_bug', { handle });
    expect(shown.data).toMatchObject({ revealed: true, file: 'theme.json', explanation: lesson().bug!.explanation });
  });

  it('a failed code check allows only review', async () => {
    const { call } = await session(era);
    const handle = (await call('start_placement')).data.handle as string;
    await call('choose_placement', { handle, pathKey: 'block-theme', startLessonKey: NEXT, skip: [LESSON], reason: 'x' });
    expect((await playBeats(call, handle)).data.step).toBe('checkpoint');
    const sub = await call('submit_checkpoint', { handle, response: 'Done.', files: { 'theme.json': '{}' } });
    expect(sub.data.checks_passed).toBe(false);
    expect(sub.data.allowed_branches.map((b: { key: string }) => b.key)).toEqual(['review']);
    expect((await call('choose_branch', { handle, branch: 'advance', rationale: 'Trust me.' })).isError).toBe(true);
  });

  it('works at the spending cap path: no outbound request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const { call } = await session(era);
    const handle = (await call('start_placement')).data.handle as string;
    await call('choose_placement', { handle, pathKey: 'block-theme', startLessonKey: LESSON, skip: [], reason: 'x' });
    expect((await playBeats(call, handle)).data.step).toBe('bug');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('SERVER_FLAGS.mcpOnStandard', () => {
  it('flag off serves today\'s server', async () => {
    SERVER_FLAGS.mcpOnStandard = false;
    const { client } = await session('legacy');
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(TOOLS);
    expect(client.getServerVersion()?.name).toBe('learning-mcp:learn-wp-reimagined');
  });
});

describe('/api/mcp on the standard: HTTP', () => {
  const post = (headers: Record<string, string>) =>
    route.POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
      { params: {}, env },
    );

  it('accepts both origins of the space and refuses any other', async () => {
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ origin: 'null' })).status).toBe(403);
    expect((await post({ origin: 'https://learnwp.sqwrlz.com' })).status).toBe(200);
    expect((await post({ origin: 'https://learn-wp-reimagined.space.fast' })).status).toBe(200);
    expect((await post({})).status).toBe(200);
  });

  it('a write that loses a race with another isolate is told to retry, and changes nothing', async () => {
    const { call } = await session('legacy');
    const handle = (await call('start_placement')).data.handle as string;
    await call('choose_placement', { handle, pathKey: 'block-theme', startLessonKey: LESSON, skip: [], reason: 'x' });
    // Another isolate saves between this call's load and its save (the in-process lock cannot see it).
    class RacedStore extends D1PracticeStore {
      private raced = false;
      async put(h: string, rec: PracticeRecord, etag?: string) {
        if (!this.raced && etag !== undefined) {
          this.raced = true;
          await db.prepare('UPDATE mcp_records SET ver = ver + 1 WHERE h = ?').bind(await handleKey(h)).run();
        }
        return super.put(h, rec, etag);
      }
    }
    const raced = await connectMcp((req) => handleMcp(req, env, { makePracticeStore: (d) => new RacedStore(d, getStandardCourse) }), 'legacy');
    open.push(raced.client);
    const lost = await raced.call('next_beat', { handle });
    expect(lost.isError).toBe(true);
    expect(lost.data.error).toBe('the record was changed by another call at the same time; call this tool again');
    expect((await call('next_beat', { handle })).data).toMatchObject({ step: 'beat', position: { beat: 1 } });
  });
});
