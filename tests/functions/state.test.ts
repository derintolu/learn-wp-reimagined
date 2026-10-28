import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { POST as createSession } from '../../functions/api/session';
import { SESSION_COOKIE } from '../../functions/_lib/session/session';
import { GET, PUT, STATE_MAX_BYTES } from '../../functions/api/state';
import { lrsHealth } from '../../functions/_lib/record/registration';
import { fakeLrs } from '../helpers/fakeLrs';

let env: Env;
let lrs: ReturnType<typeof fakeLrs>;
let cookie: string;
const ctx = (kind = 'files') => ({ params: { kind }, env });
const url = (kind = 'files') => `http://x/api/state/${kind}`;

beforeEach(async () => {
  SERVER_FLAGS.sessions = true;
  SERVER_FLAGS.officialRecord = true;
  env = { DB: createSqliteD1(), SESSION_KEY: 'test-session-key-not-a-secret', LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test' };
  await ensureSchema(env.DB);
  lrs = fakeLrs();
  vi.stubGlobal('fetch', lrs.fetch);
  lrsHealth.downUntil = 0;
  const res = await createSession(new Request('http://x/api/session', { method: 'POST', headers: { 'cf-connecting-ip': '10.0.0.1' } }), ctx());
  cookie = `${SESSION_COOKIE}=${res.headers.get('set-cookie')!.split(';')[0].split('=').slice(1).join('=')}`;
});
afterEach(() => {
  SERVER_FLAGS.sessions = false;
  SERVER_FLAGS.officialRecord = false;
  vi.unstubAllGlobals();
});

const get = (kind = 'files', c: string | null = cookie) => GET(new Request(url(kind), { headers: c ? { cookie: c } : {} }), ctx(kind));
const put = (body: unknown, headers: Record<string, string> = {}, kind = 'files') =>
  PUT(new Request(url(kind), { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { cookie, ...headers } }), ctx(kind));
const doc = (files: Record<string, string>) => ({ files, times: Object.fromEntries(Object.keys(files).map((f) => [f, '2026-10-28T10:00:00.000Z'])) });

describe('/api/state', () => {
  it('answers 404 with the flag off', async () => {
    SERVER_FLAGS.officialRecord = false;
    expect((await get()).status).toBe(404);
    expect((await put(doc({ a: '1' }))).status).toBe(404);
    expect(lrs.calls).toHaveLength(0);
  });

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
