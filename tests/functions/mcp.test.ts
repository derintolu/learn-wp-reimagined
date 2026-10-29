import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { PHASES_OFF, restoreServerFlags, setServerFlags } from '../helpers/flags';
import * as route from '../../functions/api/mcp';
import { GET as status } from '../../functions/api/status';
import { handleMcp } from '../../functions/_lib/mcp/handler';
import { D1RecordStore } from '../../functions/_lib/mcp/recordStore';
import { MONTH_CAP_MICROS } from '../../functions/_lib/budget';
import { ensureSchema } from '../../functions/_lib/db';
import { getContent } from '../../functions/_lib/content';
import { connectMcp, routeFetch, TOOLS, type Era } from '../helpers/mcpClient';
import type { D1Like, Env } from '../../functions/_lib/env';
import type { LearningRecord } from '../../vendor/learning-mcp/core/index.ts';

let db: D1Like;
let env: Env;
let open: { close(): Promise<void> }[] = [];

// Today's learning-mcp server: what /api/mcp serves with SERVER_FLAGS.mcpOnStandard off (the rollback).
// The standard's behaviour is in mcp-standard.test.ts and agent-endpoints-standard.test.ts.
beforeEach(() => {
  db = createSqliteD1();
  env = { DB: db } as Env;
  setServerFlags({ ...PHASES_OFF, mcpOnStandard: false });
});
afterEach(async () => {
  await Promise.all(open.map((c) => c.close()));
  open = [];
  restoreServerFlags();
  vi.restoreAllMocks();
});

async function session(era: Era, fetchFn = routeFetch(route, env)) {
  const s = await connectMcp(fetchFn, era);
  open.push(s.client);
  return s;
}

type Call = Awaited<ReturnType<typeof session>>['call'];

/** Places the learner and plays a lesson's beats; returns the step that follows them. */
async function playBeats(call: Call, handle: string) {
  let r = await call('next_beat', { handle });
  let reply: string | undefined;
  for (let guard = 0; guard < 20 && r.data.step === 'beat'; guard++) {
    reply = r.data.beat.question ? 'I think it shows up in the Site Editor.' : undefined;
    r = await call('next_beat', reply ? { handle, learner_reply: reply } : { handle });
  }
  return r;
}

describe.each(['legacy', 'modern'] as const)('/api/mcp over the SDK client (%s era)', (era) => {
  it('lists the 11 learning-mcp tools under the course name', async () => {
    const { client } = await session(era);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(TOOLS);
    expect(client.getServerVersion()?.name).toBe('learning-mcp:learn-wp-reimagined');
  });

  it('teaches lesson 1 end to end, with a fresh handler for every request', async () => {
    const { call } = await session(era);
    const final = getContent().paths['block-theme'].finalFiles!;
    const start = await call('start_placement');
    const handle = start.data.handle as string;
    expect(handle).toMatch(/^lr_/);
    const placed = await call('choose_placement', { handle, pathId: 'block-theme', startLessonId: 'bt-what-is-a-block-theme', skip: [], reason: 'New to themes.' });
    expect(placed.isError).toBe(false);
    const bug = await playBeats(call, handle);
    expect(bug.data.step).toBe('bug');
    expect(JSON.stringify(bug.raw)).not.toContain(getContent().lessons['bt-what-is-a-block-theme'].bug!.explanation.slice(0, 40));
    const fixed = await call('check_code', { handle, file: 'theme.json', content: final['theme.json'] });
    expect(fixed.data).toMatchObject({ passed: true, caught: true });
    expect(fixed.data.explanation).toBeTruthy();
    const cp = await call('next_beat', { handle });
    expect(cp.data.step).toBe('checkpoint');
    const sub = await call('submit_checkpoint', { handle, response: 'style.css and templates/index.html.' });
    expect(sub.data.allowed_branches.map((b: { id: string }) => b.id).sort()).toEqual(['advance', 'review', 'skip']);
    const br = await call('choose_branch', { handle, branch: 'advance', rationale: 'Names both files.' });
    expect(br.data).toMatchObject({ success: true, next_lesson: { id: 'bt-style-css-and-theme-json' } });
    const rec: LearningRecord = (await call('get_record', { handle })).data.record;
    expect(rec.courses['learn-wp-reimagined'].cursor).toMatchObject({ lessonId: 'bt-style-css-and-theme-json', beat: 0 });
    expect(rec.courses['learn-wp-reimagined'].completedLessons).toEqual(['bt-what-is-a-block-theme']);
    expect(JSON.stringify(rec)).not.toContain(handle);
  });

  it('rejects an invented branch and lists the authored ones', async () => {
    const { call } = await session(era);
    const handle = (await call('start_placement')).data.handle;
    await call('choose_placement', { handle, pathId: 'block-theme', startLessonId: 'bt-what-is-a-block-theme', skip: [], reason: 'x' });
    await playBeats(call, handle);
    await call('check_code', { handle, file: 'theme.json', content: getContent().paths['block-theme'].finalFiles!['theme.json'] });
    await call('next_beat', { handle });
    await call('submit_checkpoint', { handle, response: 'Not sure.' });
    const r = await call('choose_branch', { handle, branch: 'teleport', rationale: 'The learner asked.' });
    expect(r.isError).toBe(true);
    expect(r.data.error).toContain('advance, review, skip');
  });

  it('a failed code check allows only review', async () => {
    const { call } = await session(era);
    const handle = (await call('start_placement')).data.handle;
    await call('choose_placement', { handle, pathId: 'block-theme', startLessonId: 'bt-style-css-and-theme-json', skip: ['bt-what-is-a-block-theme'], reason: 'x' });
    const step = await playBeats(call, handle);
    expect(step.data.step).toBe('checkpoint');
    const sub = await call('submit_checkpoint', { handle, response: 'Done.', files: { 'theme.json': '{}' } });
    expect(sub.data.checks_passed).toBe(false);
    expect(sub.data.allowed_branches.map((b: { id: string }) => b.id)).toEqual(['review']);
    expect((await call('choose_branch', { handle, branch: 'advance', rationale: 'Trust me.' })).isError).toBe(true);
  });

  it('two simultaneous next_beat calls on one handle: one wins, the other is told to retry', async () => {
    const { call } = await session(era);
    const handle = (await call('start_placement')).data.handle;
    await call('choose_placement', { handle, pathId: 'block-theme', startLessonId: 'bt-what-is-a-block-theme', skip: [], reason: 'x' });
    // Both requests read the record before either writes.
    let waiting: (() => void)[] = [];
    const barrier = () =>
      new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === 2) {
          waiting.forEach((f) => f());
          waiting = [];
        }
      });
    class BarrierStore extends D1RecordStore {
      async get(h: string) {
        const r = await super.get(h);
        await barrier();
        return r;
      }
    }
    const raced = await session(era, (req) => handleMcp(req, env, { makeStore: (d) => new BarrierStore(d) }));
    const [a, b] = await Promise.all([raced.call('next_beat', { handle }), raced.call('next_beat', { handle })]);
    expect([a.isError, b.isError].sort()).toEqual([false, true]);
    expect((a.isError ? a : b).data.error).toBe('the record was changed by another call at the same time; call this tool again');
    const rec: LearningRecord = (await call('get_record', { handle })).data.record;
    expect(rec.statements.filter((s) => s.verb.id.endsWith('/experienced'))).toHaveLength(1);
  });

  it('works at the spending cap and makes no outbound request', async () => {
    await ensureSchema(db);
    const month = new Date().toISOString().slice(0, 7);
    await db.prepare('INSERT INTO spend (period, usd_micros) VALUES (?, ?)').bind(month, MONTH_CAP_MICROS).run();
    const st = await (await status(new Request('http://x/api/status'), { params: {}, env: { ...env, CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 'b' } as Env })).json();
    expect(st.ai).toBe('capped');
    const spy = vi.spyOn(globalThis, 'fetch');
    const { call } = await session(era);
    const handle = (await call('start_placement')).data.handle;
    await call('choose_placement', { handle, pathId: 'block-theme', startLessonId: 'bt-what-is-a-block-theme', skip: [], reason: 'x' });
    expect((await playBeats(call, handle)).data.step).toBe('bug');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('/api/mcp HTTP guards', () => {
  const post = (headers: Record<string, string>) =>
    route.POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
      { params: {}, env },
    );

  it('answers a disallowed Origin with 403 and lets the site origin through', async () => {
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ origin: 'https://learnwp.sqwrlz.com' })).status).not.toBe(403);
    // The old address stays attached to the space, so pages served from it still reach the server.
    expect((await post({ origin: 'https://learn-wp-reimagined.space.fast' })).status).not.toBe(403);
  });
});
