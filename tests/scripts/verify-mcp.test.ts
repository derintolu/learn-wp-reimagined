import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import * as mcpRoute from '../../functions/api/mcp';
import { POST as handoff } from '../../functions/api/agent/handoff';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import * as metadata from '../../functions/api/oauth/metadata';
import * as register from '../../functions/api/oauth/register';
import * as authorize from '../../functions/api/oauth/authorize';
import * as consent from '../../functions/api/oauth/consent';
import * as token from '../../functions/api/oauth/token';
import * as revoke from '../../functions/api/oauth/revoke';
import { createSession } from '../../functions/_lib/session/session';
import { verifyMcp, verifyMcpOAuth } from '../../scripts/verify-mcp';
import { routeFetch } from '../helpers/mcpClient';
import { fakeLrs } from '../helpers/fakeLrs';
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

describe('verifyMcpOAuth: the sign-in an agent does (SERVER_FLAGS.agentOnStandard)', () => {
  const routes: Record<string, Record<string, unknown>> = {
    '/api/mcp': mcpRoute,
    '/.well-known/oauth-protected-resource': metadata,
    '/.well-known/oauth-authorization-server': metadata,
    '/api/oauth/register': register,
    '/api/oauth/authorize': authorize,
    '/api/oauth/consent': consent,
    '/api/oauth/token': token,
    '/api/oauth/revoke': revoke,
  };
  /** The space, in process: each path to its route module, as sf.jsonc rewrites them. */
  const site = (u: string | URL, init?: RequestInit) => {
    const req = new Request(u, init);
    const mod = routes[new URL(req.url).pathname];
    return mod ? routeFetch(mod, env)(req) : Promise.resolve(new Response('Not found', { status: 404 }));
  };

  beforeEach(() => {
    env = { ...env, SESSION_KEY: 'k'.repeat(32), LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test' } as Env;
    vi.stubGlobal('fetch', fakeLrs().fetch);
    SERVER_FLAGS.agentOnStandard = true;
  });
  afterEach(() => {
    SERVER_FLAGS.agentOnStandard = false;
    vi.unstubAllGlobals();
  });

  it.each([
    ['legacy', 'https://learnwp.sqwrlz.com'],
    ['modern', 'https://learn-wp-reimagined.space.fast'],
  ] as const)('%s era on %s: registers, consents with the session cookie, and gets author-lrs custody', async (era, origin) => {
    const { cookie } = await createSession(env, Date.now());
    const sid = cookie.split(';')[0]!;
    const r = await verifyMcpOAuth(`${origin}/api/mcp`, era, { cookie: sid, fetch: site });
    expect(r).toMatchObject({ serverName: 'course-xapi-mcp:course', custody: 'author-lrs', official: true });
    expect(r.tools).toContain('get_status');
    expect(r.tools).not.toContain('link_record');
    // The grant is revoked when the check ends; the bare cookie value works as well as name=value.
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_tokens').first<{ n: number }>())!.n).toBe(0);
    await verifyMcpOAuth(`${origin}/api/mcp`, era, { cookie: sid.slice('lwr_sid='.length), fetch: site });
  });

  it('flag off: there is no sign-in to do', async () => {
    SERVER_FLAGS.agentOnStandard = false;
    const { cookie } = await createSession(env, Date.now());
    await expect(verifyMcpOAuth('http://localhost/api/mcp', 'modern', { cookie, fetch: site })).rejects.toThrow('expected 401 without a token, got HTTP 200');
  });
});
