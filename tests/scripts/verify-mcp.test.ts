import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import * as mcpRoute from '../../functions/api/mcp';
import * as metadata from '../../functions/api/oauth/metadata';
import * as register from '../../functions/api/oauth/register';
import * as authorize from '../../functions/api/oauth/authorize';
import * as consent from '../../functions/api/oauth/consent';
import * as token from '../../functions/api/oauth/token';
import * as revoke from '../../functions/api/oauth/revoke';
import { createSession } from '../../functions/_lib/session/session';
import { verifyMcpOAuth } from '../../scripts/verify-mcp';
import { routeFetch } from '../helpers/mcpClient';
import { LEDGER_ENV, fakeLrs } from '../helpers/fakeLrs';
import type { Env } from '../../functions/_lib/env';

let env: Env;
beforeEach(() => {
  env = { DB: createSqliteD1() } as Env;
});

describe('verifyMcpOAuth: the sign-in an agent does', () => {
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
    env = { ...env, SESSION_KEY: 'k'.repeat(32), LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test', ...LEDGER_ENV } as Env;
    vi.stubGlobal('fetch', fakeLrs().fetch);
  });
  afterEach(() => {
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
});
