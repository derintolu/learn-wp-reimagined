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

  /** The tools called through the connector, in order, and everything the check printed or returned. */
  const recordSite = () => {
    const tools: string[] = [];
    const wire: string[] = [];
    const fetchLike = async (u: string | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      try {
        const j = JSON.parse(body) as { method?: string; params?: { name?: string } };
        if (j.method === 'tools/call' && j.params?.name) tools.push(j.params.name);
      } catch {
        /* a form body */
      }
      wire.push(body);
      return site(u, init);
    };
    return { tools, fetchLike };
  };

  it('--complete-lesson: finishes a lesson with no checkpoint the way an agent does and reads it back from the record', async () => {
    const { cookie } = await createSession(env, Date.now());
    const sid = cookie.split(';')[0]!;
    const { tools, fetchLike } = recordSite();
    const r = await verifyMcpOAuth('https://learn-wp-reimagined.space.fast/api/mcp', 'modern', { cookie: sid, fetch: fetchLike, completeLesson: 'ln-publish' });
    expect(r.lesson).toMatchObject({ lessonId: 'ln-publish', completed: true });
    expect(tools.slice(0, 4)).toEqual(['get_status', 'get_lesson', 'start_placement', 'choose_placement']);
    expect(tools.filter((t) => t === 'next_beat')).toHaveLength(5);
    expect(tools.at(-1)).toBe('get_record');
    expect(tools).not.toContain('submit_checkpoint');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_tokens').first<{ n: number }>())!.n).toBe(0);
  });

  it('--complete-lesson: a lesson with a checkpoint or a planted bug fails clearly, before any placement', async () => {
    const { cookie } = await createSession(env, Date.now());
    const { tools, fetchLike } = recordSite();
    await expect(
      verifyMcpOAuth('https://learn-wp-reimagined.space.fast/api/mcp', 'modern', { cookie: cookie.split(';')[0]!, fetch: fetchLike, completeLesson: 'ln-blocks' }),
    ).rejects.toThrow(/ln-blocks needs a checkpoint and has a planted bug/);
    expect(tools).toEqual(['get_status', 'get_lesson']);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_tokens').first<{ n: number }>())!.n).toBe(0);
  });

  it('--complete-lesson: nothing secret is in the result or the error', async () => {
    const { cookie } = await createSession(env, Date.now());
    const sid = cookie.split(';')[0]!;
    const secret = sid.slice('lwr_sid='.length);
    const { fetchLike } = recordSite();
    const r = await verifyMcpOAuth('https://learn-wp-reimagined.space.fast/api/mcp', 'modern', { cookie: sid, fetch: fetchLike, completeLesson: 'ln-publish' });
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(JSON.stringify(r)).not.toMatch(/access_token|refresh_token|code_verifier|Bearer/);
    const err = await verifyMcpOAuth('https://learn-wp-reimagined.space.fast/api/mcp', 'modern', { cookie: sid, fetch: fetchLike, completeLesson: 'nope' }).catch((e: Error) => e.message);
    expect(String(err)).not.toContain(secret);
  });
});
