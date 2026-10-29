import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import * as mcpRoute from '../../functions/api/mcp';
import * as metadata from '../../functions/api/oauth/metadata';
import * as register from '../../functions/api/oauth/register';
import * as authorize from '../../functions/api/oauth/authorize';
import * as consent from '../../functions/api/oauth/consent';
import * as token from '../../functions/api/oauth/token';
import * as revoke from '../../functions/api/oauth/revoke';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession } from '../../functions/_lib/session/session';
import { runCli, verifyMcpOAuth } from '../../scripts/verify-mcp';
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

  const cli = async (argv: string[], cookie: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'vmcp-'));
    const file = join(dir, 'session');
    writeFileSync(file, cookie);
    const lines: string[] = [];
    const { fetchLike } = recordSite();
    const code = await runCli(argv.map((a) => (a === '<file>' ? file : a)), (l) => lines.push(l), (l) => lines.push(l), fetchLike);
    return { code, printed: lines.join('\n') };
  };

  it('CLI: --complete-lesson with no value fails with the usage text and a non-zero exit, before signing in', async () => {
    const base = ['https://learn-wp-reimagined.space.fast/api/mcp', 'modern', '--oauth', '--cookie-file', '<file>'];
    for (const argv of [[...base, '--complete-lesson'], [...base, '--complete-lesson', '--oauth'], [...base, '--complete-lesson', '']]) {
      const r = await cli(argv, 'x');
      expect(r.code).toBe(2);
      expect(r.printed).toContain('usage: verify-mcp.ts');
    }
  });

  it('CLI: --help names the throwaway-session caveat', async () => {
    const r = await cli(['--help'], 'x');
    expect(r.code).toBe(0);
    expect(r.printed).toMatch(/throwaway session/);
  });

  it('CLI: what is printed on the main path carries no cookie, token, code or verifier', async () => {
    const { cookie } = await createSession(env, Date.now());
    const sid = cookie.split(';')[0]!;
    const r = await cli(['https://learn-wp-reimagined.space.fast/api/mcp', 'modern', '--oauth', '--cookie-file', '<file>', '--complete-lesson', 'ln-publish'], sid);
    expect(r.code).toBe(0);
    expect(r.printed).toContain('lesson ln-publish: 4 beats, completed in the official record');
    expect(r.printed).not.toContain(sid.slice('lwr_sid='.length));
    expect(r.printed).not.toMatch(/access_token|refresh_token|code_verifier|Bearer|lwr_sid/);
  });

  it('the script as a process: its real stdout and stderr carry no cookie, token, code or verifier', async () => {
    const { cookie } = await createSession(env, Date.now());
    const sid = cookie.split(';')[0]!;
    // A local http server in front of the in-process routes, so the spawned script talks to a real socket.
    // The routes know the space by its public origin; the proxy swaps it for the local one in both directions.
    const PUBLIC = 'https://learn-wp-reimagined.space.fast';
    let local = '';
    const toPublic = (t: string) => t.split(local).join(PUBLIC).split(encodeURIComponent(local)).join(encodeURIComponent(PUBLIC));
    const toLocal = (t: string) => t.split(PUBLIC).join(local).split(encodeURIComponent(PUBLIC)).join(encodeURIComponent(local));
    const server = createServer(async (rq, rs) => {
      const chunks: Buffer[] = [];
      for await (const c of rq) chunks.push(c as Buffer);
      const body = toPublic(Buffer.concat(chunks).toString('utf8'));
      const headers = new Headers();
      for (const [k, v] of Object.entries(rq.headers)) if (v !== undefined && k !== 'content-length') headers.set(k, toPublic(Array.isArray(v) ? v.join(', ') : v));
      const res = await site(new URL(toPublic(rq.url!), PUBLIC), { method: rq.method, headers, ...(body.length > 0 ? { body } : {}), redirect: 'manual' });
      const out: Record<string, string | string[]> = {};
      res.headers.forEach((v, k) => (out[k] = toLocal(v)));
      delete out['content-length'];
      const cookies = res.headers.getSetCookie();
      if (cookies.length > 0) out['set-cookie'] = cookies;
      rs.writeHead(res.status, out);
      rs.end(toLocal(await res.text()));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      const port = (server.address() as { port: number }).port;
      local = `http://127.0.0.1:${port}`;
      const file = join(mkdtempSync(join(tmpdir(), 'vmcp-')), 'session');
      writeFileSync(file, sid);
      const child = spawn(join(process.cwd(), 'node_modules/.bin/tsx'), ['scripts/verify-mcp.ts', `http://127.0.0.1:${port}/api/mcp`, 'modern', '--oauth', '--cookie-file', file, '--complete-lesson', 'ln-publish'], { cwd: process.cwd() });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      const code = await new Promise<number | null>((done) => child.on('close', done));
      expect(stderr).toBe('');
      expect(stdout).toContain('lesson ln-publish: 4 beats, completed in the official record');
      expect(code).toBe(0);
      const all = stdout + stderr;
      expect(all).not.toContain(sid.slice('lwr_sid='.length));
      expect(all).not.toMatch(/access_token|refresh_token|code_verifier|Bearer|lwr_sid|code=/);
    } finally {
      server.close();
    }
  }, 30_000);
});
