import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import * as mcpRoute from '../../functions/api/mcp';
import { POST as handoff } from '../../functions/api/agent/handoff';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { verifyMcp } from '../../scripts/verify-mcp';
import { routeFetch } from '../helpers/mcpClient';
import type { Env } from '../../functions/_lib/env';

let env: Env;
let dir: string;
beforeEach(() => {
  env = { DB: createSqliteD1() } as Env;
  dir = mkdtempSync(join(tmpdir(), 'verify-mcp-'));
  SERVER_FLAGS.mcpOnStandard = true;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  SERVER_FLAGS.mcpOnStandard = true;
});

const seed = async (lessonId: string): Promise<string> =>
  (await (await handoff(new Request('http://x/api/agent/handoff', { method: 'POST', body: JSON.stringify({ lessonId }) }), { params: {}, env })).json()).handle;
const fetchFn = (u: string | URL, init?: RequestInit) => routeFetch(mcpRoute, env)(new Request(u, init));

describe('verifyMcp against /api/mcp', () => {
  it.each(['legacy', 'modern'] as const)('on the standard (%s era): lists the tools and continues a handle from either server', async (era) => {
    SERVER_FLAGS.mcpOnStandard = false;
    const legacy = await seed('bt-templates-and-parts');
    SERVER_FLAGS.mcpOnStandard = true;
    const practice = await seed('bt-patterns');
    const url = 'http://localhost/api/mcp';
    const plain = await verifyMcp(url, era, {}, { fetch: fetchFn });
    expect(plain.serverName).toBe('course-xapi-mcp:course');
    expect(plain.tools).toContain('get_status');
    expect((await verifyMcp(url, era, {}, { handle: legacy, fetch: fetchFn })).lessonId).toBe('bt-templates-and-parts');
    const out = join(dir, 'copy.json');
    expect((await verifyMcp(url, era, {}, { handle: practice, exportTo: out, fetch: fetchFn })).lessonId).toBe('bt-patterns');
    expect(JSON.parse(readFileSync(out, 'utf8')).format).toBe('course-xapi-mcp/practice-record');
    expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it("flag off: today's server, as before", async () => {
    SERVER_FLAGS.mcpOnStandard = false;
    const handle = await seed('bt-templates-and-parts');
    const r = await verifyMcp('http://localhost/api/mcp', 'legacy', {}, { handle, fetch: fetchFn });
    expect(r).toMatchObject({ serverName: 'learning-mcp:learn-wp-reimagined', lessonId: 'bt-templates-and-parts' });
  });
});
