import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { GLOBAL_KEY, readJsonCapped, clientKey } from '../../functions/_lib/guards';
import { HttpError } from '../../functions/_lib/http';
import { GET } from '../../functions/api/admin/spend';
import { reserve } from '../../functions/_lib/budget';
import { ensureSchema } from '../../functions/_lib/db';

const post = (body: string) => new Request('http://x/', { method: 'POST', body });

describe('readJsonCapped', () => {
  it('parses valid JSON', async () => {
    expect(await readJsonCapped(post('{"a":1}'), 100)).toEqual({ a: 1 });
  });
  it('413 over the limit', async () => {
    const err = await readJsonCapped(post(JSON.stringify({ a: 'x'.repeat(200) })), 100).catch((e: HttpError) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  });
  it('413 when content-length lies low but body is large', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      body: 'x'.repeat(500),
      headers: { 'content-length': '5' },
    });
    const err = await readJsonCapped(req, 100).catch((e: HttpError) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  });
  it('400 on invalid JSON', async () => {
    await expect(readJsonCapped(post('{nope'), 100)).rejects.toMatchObject({ status: 400 });
  });
  it('400 on empty body', async () => {
    await expect(readJsonCapped(new Request('http://x/', { method: 'POST' }), 100)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('clientKey', () => {
  const h = (o: Record<string, string>) => new Request('http://x/', { headers: o });
  it('prefers cf-connecting-ip, then rightmost x-forwarded-for, then anon', () => {
    expect(clientKey(h({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('ip:1.1.1.1');
    expect(clientKey(h({ 'x-forwarded-for': 'spoofed, 2.2.2.2, 3.3.3.3' }))).toBe('ip:3.3.3.3');
    expect(clientKey(h({}))).toBe('anon');
  });
  it('uses a well-formed x-client-id as c:<id> when there is no IP (R26)', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(clientKey(h({ 'x-client-id': id }))).toBe(`c:${id}`);
    expect(clientKey(h({ 'x-client-id': 'A'.repeat(16) }))).toBe(`c:${'A'.repeat(16)}`);
    expect(clientKey(h({ 'x-client-id': 'A'.repeat(64) }))).toBe(`c:${'A'.repeat(64)}`);
  });
  it('an invalid x-client-id falls to anon', () => {
    for (const bad of ['short', 'A'.repeat(15), 'A'.repeat(65), 'has space in it here', 'a/b/c/d/e/f/g/h/i/j', 'global:aaaaaaaaaaaaaaa', '']) {
      expect(clientKey(h({ 'x-client-id': bad }))).toBe('anon');
    }
  });
  it('a trusted IP still wins over the client id', () => {
    expect(clientKey(h({ 'cf-connecting-ip': '1.1.1.1', 'x-client-id': 'A'.repeat(20) }))).toBe('ip:1.1.1.1');
  });
  it('namespaces every key, so a forged header can never equal anon, a client id or the global bucket', () => {
    expect(clientKey(h({ 'x-forwarded-for': 'global' }))).toBe('ip:global');
    expect(clientKey(h({ 'x-forwarded-for': 'g:global' }))).toBe('ip:g:global');
    expect(clientKey(h({ 'cf-connecting-ip': 'anon' }))).toBe('ip:anon');
    expect(clientKey(h({ 'x-forwarded-for': `c:${'A'.repeat(20)}` }))).toBe(`ip:c:${'A'.repeat(20)}`);
    for (const v of ['global', 'g:global', 'anon']) expect(clientKey(h({ 'x-forwarded-for': v }))).not.toBe(GLOBAL_KEY);
  });
  it('honours TRUSTED_IP_HEADER and ignores cf-connecting-ip then', () => {
    const env = { TRUSTED_IP_HEADER: 'x-real-ip' };
    expect(clientKey(h({ 'x-real-ip': '9.9.9.9', 'cf-connecting-ip': '1.1.1.1' }), env)).toBe('ip:9.9.9.9');
    expect(clientKey(h({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': 'a, 4.4.4.4' }), env)).toBe('ip:4.4.4.4');
  });
});

describe('GET /api/admin/spend', () => {
  const call = async (token: string | undefined, header?: string) => {
    const db = createSqliteD1();
    const req = new Request('http://x/api/admin/spend', {
      headers: header ? { authorization: header } : {},
    });
    return { db, res: await GET(req, { params: {}, env: { DB: db, ADMIN_TOKEN: token } }) };
  };

  it('401 without a token', async () => {
    expect((await call('secret')).res.status).toBe(401);
  });
  it('401 with the wrong token', async () => {
    expect((await call('secret', 'Bearer wrong')).res.status).toBe(401);
  });
  it('401 when ADMIN_TOKEN is unset, even with an empty or matching bearer', async () => {
    expect((await call(undefined, 'Bearer ')).res.status).toBe(401);
    expect((await call('', 'Bearer ')).res.status).toBe(401);
    expect((await call(undefined, 'Bearer undefined')).res.status).toBe(401);
  });
  it('never echoes the token', async () => {
    const { res } = await call('secret', 'Bearer wrong-secret');
    expect(await res.text()).not.toContain('secret');
  });
  it('returns spend in USD with the right token', async () => {
    const db = createSqliteD1();
    await ensureSchema(db);
    await reserve(db, 'claude-sonnet-5-5', 0, 3000, new Date());
    const res = await GET(new Request('http://x/', { headers: { authorization: 'Bearer secret' } }), {
      params: {},
      env: { DB: db, ADMIN_TOKEN: 'secret' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ month: 0.03, day: 0.03, monthCap: 100, dayCap: 10 });
  });
});
