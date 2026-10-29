import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { createSession } from '../../functions/_lib/session/session';
import { GET, PUT, STATE_MAX_BYTES } from '../../functions/api/state';
import { lrsHealth } from '../../functions/_lib/record/registration';
import { LEDGER_ENV, fakeLrs } from '../helpers/fakeLrs';
import { enrolHealth } from '../../functions/_lib/session/enrol';

let env: Env;
let lrs: ReturnType<typeof fakeLrs>;
let cookie: string;
const ctx = (kind = 'files') => ({ params: { kind }, env });
const url = (kind = 'files') => `http://x/api/state/${kind}`;

beforeEach(async () => {
  env = { DB: createSqliteD1(), SESSION_KEY: 'test-session-key-not-a-secret', LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test', ...LEDGER_ENV };
  await ensureSchema(env.DB);
  lrs = fakeLrs();
  vi.stubGlobal('fetch', lrs.fetch);
  lrsHealth.downUntil = 0;
  cookie = (await createSession(env, Date.now())).cookie.split(';')[0];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const get = (kind = 'files', c: string | null = cookie) => GET(new Request(url(kind), { headers: c ? { cookie: c } : {} }), ctx(kind));
const put = (body: unknown, headers: Record<string, string> = {}, kind = 'files') =>
  PUT(new Request(url(kind), { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { cookie, ...headers } }), ctx(kind));
const doc = (files: Record<string, string>) => ({ files, times: Object.fromEntries(Object.keys(files).map((f) => [f, '2026-10-28T10:00:00.000Z'])) });

describe('/api/state', () => {
  it('404 for an unknown kind, 401 without a session', async () => {
    expect((await get('other')).status).toBe(404);
    expect((await get('files', null)).status).toBe(401);
  });

  it('reads nothing, writes, then reads the document and its etag', async () => {
    expect(await (await get()).json()).toEqual({ doc: null, etag: null });
    const w = await put(doc({ 'style.css': 'a' }));
    expect(w.status).toBe(200);
    const { etag } = (await w.json()) as { etag: string };
    expect(etag).toBeTruthy();
    expect(await (await get()).json()).toEqual({ doc: doc({ 'style.css': 'a' }), etag });
  });

  it('keeps files and resume in separate documents', async () => {
    await put(doc({ a: '1' }));
    const resume = { current: { pathId: 'block-theme', lessonId: 'l1', beatIndex: 2 }, updatedAt: '2026-10-28T10:00:00.000Z' };
    expect((await put(resume, {}, 'resume')).status).toBe(200);
    expect(((await (await get('resume')).json()) as any).doc).toEqual(resume);
    expect(((await (await get('files')).json()) as any).doc.files).toEqual({ a: '1' });
  });

  it('concurrent writers do not lose a file: the second PUT with a stale If-Match is refused, not applied', async () => {
    const first = (await (await put(doc({ a: '1' }))).json()) as { etag: string };
    // Writer 1 (the studio) and writer 2 (an agent) both read first.etag.
    const studio = await put(doc({ a: '1', b: '2' }), { 'If-Match': first.etag });
    const agent = await put(doc({ a: '1', c: '3' }), { 'If-Match': first.etag });
    expect(studio.status).toBe(200);
    expect(agent.status).toBe(412);
    expect(((await agent.json()) as any).error.code).toBe('conflict');
    const now = (await (await get()).json()) as any;
    expect(Object.keys(now.doc.files).sort()).toEqual(['a', 'b']);
    // The loser refetches, merges and retries with the new etag.
    const retry = await put(doc({ a: '1', b: '2', c: '3' }), { 'If-Match': now.etag });
    expect(retry.status).toBe(200);
    expect(Object.keys(((await (await get()).json()) as any).doc.files).sort()).toEqual(['a', 'b', 'c']);
  });

  it('a create-only write over an existing document is refused', async () => {
    await put(doc({ a: '1' }));
    expect((await put(doc({ b: '2' }))).status).toBe(412);
  });

  it('over 2 MB returns too-large and stores nothing', async () => {
    const big = JSON.stringify(doc({ 'big.txt': 'x'.repeat(STATE_MAX_BYTES) }));
    const res = await put(big);
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error.code).toBe('too-large');
    expect(((await (await get()).json()) as any).doc).toBeNull();
  });

  it('the cap counts bytes while streaming, not the content-length header', async () => {
    const big = JSON.stringify(doc({ 'big.txt': 'x'.repeat(STATE_MAX_BYTES) }));
    const res = await put(big, { 'content-length': '10' });
    expect(res.status).toBe(413);
  });

  it('rejects documents of the wrong shape', async () => {
    expect((await put({ files: { a: 1 } })).status).toBe(400);
    expect((await put({ nope: true })).status).toBe(400);
    expect((await put('{"files":{"__proto__":"x"}}')).status).toBe(400);
    expect((await put({ current: { lessonId: 'x' } }, {}, 'resume')).status).toBe(400);
  });

  it('answers 503 when the LRS is down', async () => {
    lrs.down = true;
    expect((await get()).status).toBe(503);
  });
});

/** The ledger refuses to make a learner (503) while `refuse` is set; every other call goes to the fake LRS. */
const learnerDown = (real: typeof fetch, refuse: { on: boolean }) =>
  (async (input: RequestInfo | URL, init?: RequestInit) =>
    refuse.on && init?.method === 'POST' && String(input).endsWith('/course-server/learners') ? new Response('x', { status: 503 }) : real(input, init)) as typeof fetch;
const OLD_ACTOR = 'legacy-actor-made-before-learners';
const sessionActor = async () => (await env.DB.prepare('SELECT actor_name FROM sessions').first<{ actor_name: string }>())!.actor_name;

describe('/api/state for a session made before Sensei learners were on', () => {
  const refuse = { on: false };
  const doc1 = { files: { a: '1' }, times: { a: '2026-10-28T10:00:00.000Z' } };
  beforeEach(async () => {
    enrolHealth.downUntil = 0;
    refuse.on = false;
    vi.stubGlobal('fetch', learnerDown(lrs.fetch, refuse));
    await env.DB.prepare('UPDATE sessions SET wp_user_id = NULL, actor_name = ?').bind(OLD_ACTOR).run();
  });
  afterEach(() => {
    enrolHealth.downUntil = 0;
    vi.restoreAllMocks();
  });

  it('GET and PUT answer 503 connector-unavailable and touch no State document while no learner can be made', async () => {
    refuse.on = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const res of [await get(), await put(doc1)]) {
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('connector-unavailable');
    }
    expect(lrs.calls).toEqual([]);
    expect(lrs.state.size).toBe(0);
  });

  it('a learner adopted in the same request writes the document under the ledger actor', async () => {
    expect((await put(doc1)).status).toBe(200);
    const actor = await sessionActor();
    expect(actor).toMatch(/^ledger-\d+$/);
    const keys = JSON.stringify([...lrs.state.keys()]);
    expect(keys).toContain(actor);
    expect(keys).not.toContain(OLD_ACTOR);
    expect(((await (await get()).json()) as { doc: unknown }).doc).toEqual(doc1);
  });
});
