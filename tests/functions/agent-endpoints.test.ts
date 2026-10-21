import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { POST as handoff } from '../../functions/api/agent/handoff';
import { POST as getRecord } from '../../functions/api/agent/record';
import { POST as del } from '../../functions/api/agent/delete';
import * as mcpRoute from '../../functions/api/mcp';
import { D1RecordStore, MCP_TTL_MS } from '../../functions/_lib/mcp/recordStore';
import { MCP_LIMITS } from '../../functions/_lib/mcp/gate';
import { BAD_HANDLE, NO_RECORD } from '../../functions/_lib/mcp/agentApi';
import { SEED_REASON } from '../../functions/_lib/mcp/seed';
import { newHandle, parseRecord, type LearningRecord } from '../../vendor/learning-mcp/core/index.ts';
import { COURSE_ID, MCP_URL, agentPrompt } from '../../src/shared/course-meta';
import { connectMcp, routeFetch } from '../helpers/mcpClient';
import type { D1Like, Env, Handler } from '../../functions/_lib/env';

let db: D1Like;
let env: Env;
const post = async (h: Handler, body: unknown) => {
  const r = await h(new Request('http://x/api/agent', { method: 'POST', body: JSON.stringify(body) }), { params: {}, env });
  return { status: r.status, body: await r.json() };
};
const count = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM mcp_records').first<{ n: number }>())?.n ?? 0);

// Handles are bearer secrets: nothing in this file may log one.
const logs: unknown[][] = [];
beforeAll(() => {
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a));
});
afterAll(() => {
  expect(JSON.stringify(logs)).not.toMatch(/lr_[A-Za-z0-9_-]{32}/);
  vi.restoreAllMocks();
});

beforeEach(() => {
  db = createSqliteD1();
  env = { DB: db } as Env;
});
let open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.close()));
  open = [];
});

describe('POST /api/agent/handoff', () => {
  it('seeds a record placed at the learner lesson, and the agent continues there', async () => {
    const r = await post(handoff, { lessonId: 'bt-templates-and-parts', files: { 'theme.json': '{"version":3}' } });
    expect(r.status).toBe(200);
    const { handle, mcpUrl, prompt } = r.body;
    expect(mcpUrl).toBe(MCP_URL);
    expect(prompt).toBe(agentPrompt(handle));
    const { client, call } = await connectMcp(routeFetch(mcpRoute, env), 'legacy');
    open.push(client);
    const resumed = await call('start_placement', { handle });
    expect(resumed.isError).toBe(false);
    const beat = await call('next_beat', { handle });
    expect(beat.data).toMatchObject({ step: 'beat', lesson: { id: 'bt-templates-and-parts' }, position: { beat: 1 } });
    const rec: LearningRecord = (await call('get_record', { handle })).data.record;
    expect(rec.courses[COURSE_ID].files).toEqual({ 'theme.json': '{"version":3}' });
    expect(rec.statements[0].result?.response).toBe(SEED_REASON);
  });

  it("keeps the path's files and drops others and oversized ones", async () => {
    const r = await post(handoff, {
      lessonId: 'bt-what-is-a-block-theme',
      files: { 'theme.json': '{}', 'templates/index.html': '<!-- -->', 'evil.php': '<?php', 'style.css': 'x'.repeat(70_000), n: 5 },
    });
    const rec = await new D1RecordStore(db).get(r.body.handle);
    expect(rec!.courses[COURSE_ID].files).toEqual({ 'theme.json': '{}', 'templates/index.html': '<!-- -->' });
  });

  it('gives 400 for an unknown or coming-soon lesson, and creates no row', async () => {
    for (const lessonId of ['nope', '__proto__', 42, undefined]) {
      const r = await post(handoff, { lessonId });
      expect(r.status).toBe(400);
    }
    expect(await count()).toBe(0);
  });

  it('the 61st handoff in 10 minutes gets 429', async () => {
    for (let i = 0; i < MCP_LIMITS.create.limit; i++) expect((await post(handoff, { lessonId: 'bt-patterns' })).status).toBe(200);
    const r = await post(handoff, { lessonId: 'bt-patterns' });
    expect(r.status).toBe(429);
    expect(await count()).toBe(MCP_LIMITS.create.limit);
  });

  it('refuses a body over 256 KB', async () => {
    const r = await post(handoff, { lessonId: 'bt-patterns', files: { 'theme.json': 'x'.repeat(300_000) } });
    expect(r.status).toBe(413);
  });
});

describe('POST /api/agent/record and /api/agent/delete', () => {
  it("returns what the agent wrote, and it passes learning-mcp's parseRecord", async () => {
    const { handle } = (await post(handoff, { lessonId: 'bt-what-is-a-block-theme' })).body;
    const { client, call } = await connectMcp(routeFetch(mcpRoute, env), 'modern');
    open.push(client);
    await call('next_beat', { handle });
    const r = await post(getRecord, { handle: `  ${handle}\n` });
    expect(r.status).toBe(200);
    expect(parseRecord(r.body.record).ok).toBe(true);
    expect(r.body.record.statements.some((s: { verb: { id: string } }) => s.verb.id.endsWith('/experienced'))).toBe(true);
  });

  it('gives 400 for a malformed handle and 404 for an unknown or expired one, with the exact messages', async () => {
    for (const handle of ['hello', 'lr_short', 42, null]) {
      const r = await post(getRecord, { handle });
      expect(r.status).toBe(400);
      expect(r.body.error.message).toBe(BAD_HANDLE);
    }
    const unknown = await post(getRecord, { handle: newHandle() });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.message).toBe(NO_RECORD);
    const { handle } = (await post(handoff, { lessonId: 'bt-patterns' })).body;
    await db.prepare('UPDATE mcp_records SET touched = ?').bind(Date.now() - MCP_TTL_MS - 1000).run();
    const expired = await post(getRecord, { handle });
    expect(expired.status).toBe(404);
    expect(expired.body.error.message).toBe(NO_RECORD);
    expect(await count()).toBe(0);
  });

  it('delete removes the row; a second delete is { deleted: false }', async () => {
    const { handle } = (await post(handoff, { lessonId: 'bt-patterns' })).body;
    expect((await post(del, { handle })).body).toEqual({ deleted: true });
    expect((await post(del, { handle })).body).toEqual({ deleted: false });
    expect((await post(del, { handle: 'nope' })).status).toBe(400);
  });

  it('rate-limits reads per handle', async () => {
    const handle = newHandle();
    for (let i = 0; i < MCP_LIMITS.perHandle.limit; i++) await post(getRecord, { handle });
    expect((await post(getRecord, { handle })).status).toBe(429);
    expect((await post(getRecord, { handle: newHandle() })).status).toBe(404);
  });
});
