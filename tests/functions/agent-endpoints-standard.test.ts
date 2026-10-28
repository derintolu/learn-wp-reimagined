// /api/agent/* with SERVER_FLAGS.mcpOnStandard: the hand-off seeds a practice copy the reference server
// continues; record and delete read and remove what either server wrote.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { POST as handoff } from '../../functions/api/agent/handoff';
import { POST as getRecord } from '../../functions/api/agent/record';
import { POST as del } from '../../functions/api/agent/delete';
import * as mcpRoute from '../../functions/api/mcp';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { MCP_TTL_MS } from '../../functions/_lib/mcp/recordStore';
import { MCP_LIMITS } from '../../functions/_lib/mcp/gate';
import { practiceForm } from '../../functions/_lib/mcp/handles';
import { BAD_HANDLE, NO_RECORD } from '../../functions/_lib/mcp/agentApi';
import { SEED_REASON } from '../../functions/_lib/mcp/seed';
import { getStandardCourse } from '../../functions/_lib/mcp/standardCourse';
import { newHandle, parseRecord } from '../../vendor/learning-mcp/core/index.ts';
import { parsePracticeRecord, type PracticeRecord } from '../../vendor/course-xapi-mcp/core/practice-record.ts';
import { MCP_URL, agentHandlePrompt } from '../../src/shared/course-meta';
import { connectMcp, routeFetch } from '../helpers/mcpClient';
import type { D1Like, Env, Handler } from '../../functions/_lib/env';

let db: D1Like;
let env: Env;
const post = async (h: Handler, body: unknown) => {
  const r = await h(new Request('http://x/api/agent', { method: 'POST', body: JSON.stringify(body) }), { params: {}, env });
  return { status: r.status, body: await r.json() };
};
const count = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM mcp_records').first<{ n: number }>())?.n ?? 0);

const logs: unknown[][] = [];
beforeAll(() => {
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a));
});
afterAll(() => {
  expect(JSON.stringify(logs)).not.toMatch(/(lr|cxp)_[A-Za-z0-9_-]{32}/);
  vi.restoreAllMocks();
});

let open: { close(): Promise<void> }[] = [];
beforeEach(() => {
  db = createSqliteD1();
  env = { DB: db } as Env;
  SERVER_FLAGS.mcpOnStandard = true;
});
afterEach(async () => {
  await Promise.all(open.map((c) => c.close()));
  open = [];
  SERVER_FLAGS.mcpOnStandard = true;
});

async function agent(era: 'legacy' | 'modern' = 'legacy') {
  const s = await connectMcp(routeFetch(mcpRoute, env), era);
  open.push(s.client);
  return s;
}
const copyOf = (r: { raw: { content: { type: string; resource?: { text: string } }[] } }): PracticeRecord =>
  JSON.parse(r.raw.content.find((c) => c.type === 'resource')!.resource!.text);

describe('POST /api/agent/handoff on the standard', () => {
  it('seeds a practice copy placed at the learner lesson, and the agent continues there', async () => {
    const r = await post(handoff, { lessonId: 'bt-templates-and-parts', files: { 'theme.json': '{"version":3}' } });
    expect(r.status).toBe(200);
    const { handle, mcpUrl, prompt } = r.body;
    expect(handle).toMatch(/^cxp_[A-Za-z0-9_-]{32}$/);
    expect(mcpUrl).toBe(MCP_URL);
    expect(prompt).toBe(agentHandlePrompt(handle));
    const { call } = await agent();
    // What the prompt tells the agent to do.
    expect((await call('start_placement', { handle })).isError).toBe(false);
    expect((await call('next_beat', { handle })).data).toMatchObject({ step: 'beat', lesson: { key: 'bt-templates-and-parts' }, position: { beat: 1 } });
    const copy = copyOf(await call('get_record', { handle }));
    expect(parsePracticeRecord(copy, getStandardCourse().id).ok).toBe(true);
    expect(copy.state.files).toEqual({ 'theme.json': '{"version":3}' });
    expect(copy.statements.find((s) => s.verb.id.endsWith('/placed'))?.result?.response).toBe(SEED_REASON);
  });

  it("every live path's first and last lessons seed and continue", async () => {
    const bundle = buildContent('content');
    const live = Object.values(bundle.paths).filter((p) => p.status === 'live');
    const { call } = await agent('modern');
    for (const p of live) {
      for (const lessonId of [p.lessons[0], p.lessons[p.lessons.length - 1]]) {
        const lesson = bundle.lessons[lessonId];
        const r = await post(handoff, { lessonId, files: { ...(lesson.starterFiles ?? {}) } });
        expect(r.status, lessonId).toBe(200);
        const { handle } = r.body;
        expect(copyOf(await call('get_record', { handle })).state.files, lessonId).toEqual(lesson.starterFiles ?? {});
        expect((await call('next_beat', { handle })).data, lessonId).toMatchObject({ step: 'beat', lesson: { key: lessonId } });
        const got = await call('get_lesson', { lessonKey: lessonId });
        expect(got.data.beats.map((b: { key: string }) => b.key), lessonId).toEqual(lesson.beats.map((b) => b.id));
      }
    }
    expect(live.map((p) => p.id)).toContain('block-theme');
  });

  it("keeps the path's files and drops others and oversized ones", async () => {
    const r = await post(handoff, {
      lessonId: 'bt-what-is-a-block-theme',
      files: { 'theme.json': '{}', 'templates/index.html': '<!-- -->', 'evil.php': '<?php', 'style.css': 'x'.repeat(70_000), n: 5 },
    });
    const { call } = await agent();
    expect(copyOf(await call('get_record', { handle: r.body.handle })).state.files).toEqual({ 'theme.json': '{}', 'templates/index.html': '<!-- -->' });
  });

  it('gives 400 for an unknown or coming-soon lesson, and creates no row', async () => {
    for (const lessonId of ['nope', '__proto__', 42, undefined]) expect((await post(handoff, { lessonId })).status).toBe(400);
    expect(await count()).toBe(0);
  });

  it('the 61st handoff in 10 minutes gets 429', async () => {
    for (let i = 0; i < MCP_LIMITS.create.limit; i++) expect((await post(handoff, { lessonId: 'bt-patterns' })).status).toBe(200);
    expect((await post(handoff, { lessonId: 'bt-patterns' })).status).toBe(429);
    expect(await count()).toBe(MCP_LIMITS.create.limit);
  });
});

describe('POST /api/agent/record and /api/agent/delete on the standard', () => {
  it('returns the practice copy the agent wrote', async () => {
    const { handle } = (await post(handoff, { lessonId: 'bt-what-is-a-block-theme' })).body;
    const { call } = await agent('modern');
    await call('next_beat', { handle });
    const r = await post(getRecord, { handle: `  ${handle}\n` });
    expect(r.status).toBe(200);
    expect(parsePracticeRecord(r.body.record, getStandardCourse().id).ok).toBe(true);
    expect(r.body.record.statements.some((s: { verb: { id: string } }) => s.verb.id.endsWith('/experienced'))).toBe(true);
  });

  it("an lr_ handle from today's server: the record as it was kept, then the practice copy once the agent continues", async () => {
    SERVER_FLAGS.mcpOnStandard = false;
    const { handle } = (await post(handoff, { lessonId: 'bt-what-is-a-block-theme' })).body;
    SERVER_FLAGS.mcpOnStandard = true;
    expect(handle).toMatch(/^lr_/);
    const before = await post(getRecord, { handle });
    expect(before.status).toBe(200);
    expect(parseRecord(before.body.record).ok).toBe(true);
    const { call } = await agent();
    expect((await call('next_beat', { handle })).data).toMatchObject({ step: 'beat', lesson: { key: 'bt-what-is-a-block-theme' } });
    const after = await post(getRecord, { handle });
    expect(parsePracticeRecord(after.body.record, getStandardCourse().id).ok).toBe(true);
    // Both forms of the handle name the same record.
    expect((await post(getRecord, { handle: practiceForm(handle) })).body).toEqual(after.body);
    expect((await post(del, { handle })).body).toEqual({ deleted: true });
    expect(await count()).toBe(0);
    expect((await post(getRecord, { handle })).status).toBe(404);
  });

  it('gives 400 for a malformed handle and 404 for an unknown or expired one, with the exact messages', async () => {
    for (const handle of ['hello', 'lr_short', 'cxp_short', 42, null]) {
      const r = await post(getRecord, { handle });
      expect(r.status).toBe(400);
      expect(r.body.error.message).toBe(BAD_HANDLE);
    }
    for (const handle of [newHandle(), practiceForm(newHandle())]) {
      const unknown = await post(getRecord, { handle });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.message).toBe(NO_RECORD);
    }
    const { handle } = (await post(handoff, { lessonId: 'bt-patterns' })).body;
    await db.prepare('UPDATE mcp_records SET touched = ?').bind(Date.now() - MCP_TTL_MS - 1000).run();
    expect((await post(getRecord, { handle })).status).toBe(404);
    expect(await count()).toBe(0);
  });

  it('delete removes the copy; a second delete is { deleted: false }', async () => {
    const { handle } = (await post(handoff, { lessonId: 'bt-patterns' })).body;
    expect((await post(del, { handle })).body).toEqual({ deleted: true });
    expect((await post(del, { handle })).body).toEqual({ deleted: false });
    expect((await post(del, { handle: 'nope' })).status).toBe(400);
  });

  it('rate-limits reads per handle, both forms in one bucket', async () => {
    const handle = newHandle();
    for (let i = 0; i < MCP_LIMITS.perHandle.limit; i++) await post(getRecord, { handle: i % 2 ? handle : practiceForm(handle) });
    expect((await post(getRecord, { handle })).status).toBe(429);
    expect((await post(getRecord, { handle: practiceForm(newHandle()) })).status).toBe(404);
  });
});
