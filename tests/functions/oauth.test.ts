import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { SESSION_COOKIE } from '../../functions/_lib/session/session';
import { XAPI_BASE } from '../../src/shared/xapi';
import {
  ACCESS_TTL_S,
  CODE_TTL_MS,
  REFRESH_IDLE_MS,
  AUTHORIZE_LIMIT,
  REGISTER_LIMIT,
  REQUEST_TTL_MS,
  SCOPE,
  resolveToken,
  revokeAllForActor,
} from '../../functions/_lib/oauth/store';
import { POST as register } from '../../functions/api/oauth/register';
import { GET as authorize } from '../../functions/api/oauth/authorize';
import { GET as consentInfo, POST as consent } from '../../functions/api/oauth/consent';
import { POST as token } from '../../functions/api/oauth/token';
import { POST as revoke } from '../../functions/api/oauth/revoke';
import { POST as revokeAll } from '../../functions/api/oauth/revoke-all';
import { GET as metadata } from '../../functions/api/oauth/metadata';

const KEY = 'test-session-key-not-a-secret';
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
const REDIRECT = 'http://127.0.0.1:33418/callback';
const VERIFIER = 'v'.repeat(20) + '-._~' + 'abcdefghijklmnopqrstu';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const BASE = 'https://learnwp.sqwrlz.com';
const LEGACY = 'https://learn-wp-reimagined.space.fast';

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let now = T0;
const ctx = () => ({ params: {}, env });

const cookiePair = (res: Response, name: string): string | undefined =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith(`${name}=`));

async function newClient(redirectUris: string[] = [REDIRECT], headers: Record<string, string> = {}): Promise<Response> {
  return register(
    new Request(`${BASE}/api/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ client_name: 'Test Agent', redirect_uris: redirectUris }),
    }),
    ctx(),
  );
}

async function clientId(): Promise<string> {
  const res = await newClient();
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function authorizeUrl(id: string, extra: Record<string, string> = {}, host = BASE): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'st-1',
    scope: SCOPE,
    ...extra,
  });
  return `${host}/api/oauth/authorize?${p}`;
}

/** Runs authorize and returns the request id and the browser binding cookie. */
async function startRequest(id: string, host = BASE): Promise<{ request: string; browser: string }> {
  const res = await authorize(new Request(authorizeUrl(id, {}, host)), ctx());
  expect(res.status).toBe(302);
  const loc = res.headers.get('location')!;
  expect(loc).toMatch(/^\/consent\?request=/);
  const request = new URL(loc, BASE).searchParams.get('request')!;
  return { request, browser: cookiePair(res, 'lwr_oauth_req')! };
}

function consentReq(body: unknown, cookies: string[], host = BASE): Request {
  return new Request(`${host}/api/oauth/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies.join('; '), 'x-client-id': 'client-id-for-tests-0001' },
    body: JSON.stringify(body),
  });
}

/** Full flow up to the code; returns the code plus the cookies the browser now holds. */
async function getCode(id: string, cookies: string[] = []): Promise<{ code: string; session: string | undefined; redirect: URL }> {
  const { request, browser } = await startRequest(id);
  const res = await consent(consentReq({ request, decision: 'allow' }, [browser, ...cookies]), ctx());
  expect(res.status).toBe(200);
  const redirect = new URL(((await res.json()) as { redirect: string }).redirect);
  return { code: redirect.searchParams.get('code')!, session: cookiePair(res, SESSION_COOKIE), redirect };
}

function tokenReq(form: Record<string, string>): Request {
  return new Request(`${BASE}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

const exchange = (id: string, code: string, extra: Record<string, string> = {}) =>
  token(tokenReq({ grant_type: 'authorization_code', client_id: id, code, code_verifier: VERIFIER, redirect_uri: REDIRECT, ...extra }), ctx());

const refreshWith = (id: string, refresh_token: string) =>
  token(tokenReq({ grant_type: 'refresh_token', client_id: id, refresh_token }), ctx());

const revokeAllReq = (cookie?: string, contentType = 'application/json') =>
  new Request(`${BASE}/api/oauth/revoke-all`, {
    method: 'POST',
    headers: { 'content-type': contentType, ...(cookie ? { cookie } : {}) },
    body: contentType === 'application/json' ? '{}' : 'x=1',
  });

const bearer = (t: string) => new Request(`${BASE}/api/mcp`, { headers: { authorization: `Bearer ${t}` } });

type Tokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };

async function signIn(): Promise<{ id: string; tokens: Tokens; session: string }> {
  const id = await clientId();
  const { code, session } = await getCode(id);
  const res = await exchange(id, code);
  expect(res.status).toBe(200);
  return { id, tokens: (await res.json()) as Tokens, session: session! };
}

beforeEach(async () => {
  db = createSqliteD1();
  env = { DB: db, SESSION_KEY: KEY };
  await ensureSchema(db);
  now = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('MCP authorization server', () => {
  it('plain PKCE is refused', async () => {
    const id = await clientId();
    const cases: Record<string, string>[] = [{ code_challenge_method: 'plain', code_challenge: VERIFIER }, { code_challenge_method: '' }, { code_challenge: 'short' }];
    for (const extra of cases) {
      const res = await authorize(new Request(authorizeUrl(id, extra)), ctx());
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.origin + loc.pathname).toBe(REDIRECT);
      expect(loc.searchParams.get('error')).toBe('invalid_request');
      expect(loc.searchParams.get('state')).toBe('st-1');
      expect(loc.searchParams.get('iss')).toBe(XAPI_BASE);
    }
    // and a verifier that does not hash to the challenge gets no tokens
    const { code } = await getCode(id);
    const bad = await exchange(id, code, { code_verifier: 'w'.repeat(43) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toBe('invalid_grant');
  });

  it('a code works once and expires after 60 s', async () => {
    const id = await clientId();
    const { code, redirect } = await getCode(id);
    expect(redirect.searchParams.get('state')).toBe('st-1');
    expect(redirect.searchParams.get('iss')).toBe(XAPI_BASE);
    const ok = await exchange(id, code);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const t = (await ok.json()) as Tokens;
    expect(t.token_type).toBe('Bearer');
    expect(t.expires_in).toBe(ACCESS_TTL_S);
    expect(t.scope).toBe('course');
    expect(await resolveToken(env, bearer(t.access_token), now)).not.toBeNull();

    // second use fails and ends the tokens the first use issued
    const again = await exchange(id, code);
    expect(again.status).toBe(400);
    expect(((await again.json()) as any).error).toBe('invalid_grant');
    expect(await resolveToken(env, bearer(t.access_token), now)).toBeNull();
    expect((await refreshWith(id, t.refresh_token)).status).toBe(400);

    const late = await getCode(id);
    now += CODE_TTL_MS - 1;
    const second = await getCode(id);
    now = T0 + CODE_TTL_MS;
    expect((await exchange(id, late.code)).status).toBe(400);
    expect((await exchange(id, second.code)).status).toBe(200);

    // a late replay, after a write has cleared old rows, still ends the tokens its first use issued
    const fresh = await getCode(id);
    const ft = (await (await exchange(id, fresh.code)).json()) as Tokens;
    now += CODE_TTL_MS + 1;
    await startRequest(id);
    expect((await exchange(id, fresh.code)).status).toBe(400);
    expect(await resolveToken(env, bearer(ft.access_token), now)).toBeNull();
  });

  it('redirect URI must match exactly', async () => {
    const id = await clientId();
    for (const uri of [REDIRECT + '/', 'http://127.0.0.1:33419/callback', REDIRECT + '?x=1', 'http://localhost:33418/callback']) {
      const res = await authorize(new Request(authorizeUrl(id, { redirect_uri: uri })), ctx());
      // never redirected to an unregistered address
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
    }
    expect((await authorize(new Request(authorizeUrl('no-such-client')), ctx())).status).toBe(400);

    // the token request must name the same redirect URI
    const { code } = await getCode(id);
    expect((await exchange(id, code, { redirect_uri: REDIRECT + '/' })).status).toBe(400);

    // registration: https anywhere, http only on loopback, no fragments or other schemes
    for (const bad of ['http://example.com/cb', 'https://example.com/cb#frag', 'javascript:alert(1)', 'myapp://cb', 'http://[::1]/cb', 'https://user:pw@example.com/cb']) {
      const res = await newClient([bad]);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toBe('invalid_redirect_uri');
    }
    for (const good of ['https://example.com/cb', 'http://localhost:8080/cb', 'http://127.0.0.1/cb']) {
      expect((await newClient([good])).status).toBe(201);
    }
  });

  it('refresh rotates and the old one stops working', async () => {
    const { id, tokens } = await signIn();
    const res = await refreshWith(id, tokens.refresh_token);
    expect(res.status).toBe(200);
    const next = (await res.json()) as Tokens;
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(await resolveToken(env, bearer(next.access_token), now)).not.toBeNull();

    // another client cannot use it, and trying ends nothing
    const other = await clientId();
    expect((await refreshWith(other, next.refresh_token)).status).toBe(400);
    expect(await resolveToken(env, bearer(next.access_token), now)).not.toBeNull();

    // replaying the old one, from any client, fails and ends the whole family
    const replay = await refreshWith(other, tokens.refresh_token);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as any).error).toBe('invalid_grant');
    expect(await resolveToken(env, bearer(next.access_token), now)).toBeNull();
    expect((await refreshWith(id, next.refresh_token)).status).toBe(400);
  });

  it('idle refresh token expires after 30 days', async () => {
    const { id, tokens } = await signIn();
    // access token lasts an hour
    now = T0 + ACCESS_TTL_S * 1000 - 1;
    expect(await resolveToken(env, bearer(tokens.access_token), now)).not.toBeNull();
    now = T0 + ACCESS_TTL_S * 1000;
    expect(await resolveToken(env, bearer(tokens.access_token), now)).toBeNull();

    // used within 30 days, it rotates; the new one has its own 30 days
    now = T0 + REFRESH_IDLE_MS - 1;
    const res = await refreshWith(id, tokens.refresh_token);
    expect(res.status).toBe(200);
    const next = (await res.json()) as Tokens;
    now += REFRESH_IDLE_MS;
    expect((await refreshWith(id, next.refresh_token)).status).toBe(400);
  });

  it('consent without a session creates the learner and sets the cookie', async () => {
    const id = await clientId();
    const { request, browser } = await startRequest(id);

    const info = await consentInfo(
      new Request(`${BASE}/api/oauth/consent?request=${encodeURIComponent(request)}`, { headers: { cookie: browser } }),
      ctx(),
    );
    expect(await info.json()).toEqual({ clientName: 'Test Agent', redirectHost: '127.0.0.1:33418', hasSession: false });

    // the request is bound to the browser that opened it
    const otherBrowser = (await startRequest(id)).browser;
    expect(otherBrowser).not.toBe(browser);
    for (const cookies of [[], [otherBrowser]]) {
      expect((await consent(consentReq({ request, decision: 'allow' }, cookies), ctx())).status).toBe(400);
    }

    const res = await consent(consentReq({ request, decision: 'allow' }, [browser]), ctx());
    expect(res.status).toBe(200);
    const sc = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/Secure/);
    const rows = (await db.prepare('SELECT actor_name FROM sessions').all<{ actor_name: string }>()).results;
    expect(rows).toHaveLength(1);

    const code = new URL(((await res.json()) as any).redirect).searchParams.get('code')!;
    const t = (await (await exchange(id, code)).json()) as Tokens;
    const who = await resolveToken(env, bearer(t.access_token), now);
    expect(who).toEqual({
      actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name: rows[0].actor_name } },
      wpUserId: 0,
      registration: '',
    });

    // a second agent in the same browser joins that learner instead of making another
    const second = await getCode(id, [sc.split(';')[0]]);
    expect(second.session).toBeUndefined();
    const t2 = (await (await exchange(id, second.code)).json()) as Tokens;
    expect((await resolveToken(env, bearer(t2.access_token), now))!.actor.account.name).toBe(rows[0].actor_name);
    expect((await db.prepare('SELECT COUNT(*) AS c FROM sessions').first<{ c: number }>())!.c).toBe(1);

    // cancel sends the agent access_denied and ends the request
    const r3 = await startRequest(id);
    const cancel = await consent(consentReq({ request: r3.request, decision: 'cancel' }, [r3.browser]), ctx());
    const denied = new URL(((await cancel.json()) as any).redirect);
    expect(denied.searchParams.get('error')).toBe('access_denied');
    expect(denied.searchParams.get('code')).toBeNull();
    expect((await consent(consentReq({ request: r3.request, decision: 'allow' }, [r3.browser]), ctx())).status).toBe(400);
  });

  it('revoke-all ends every token for the actor', async () => {
    const { id, tokens, session } = await signIn();
    const second = await getCode(id, [session]);
    const t2 = (await (await exchange(id, second.code)).json()) as Tokens;
    const someoneElse = await signIn();

    // a cross-site form post cannot do it: JSON only
    expect((await revokeAll(revokeAllReq(session, 'application/x-www-form-urlencoded'), ctx())).status).toBe(415);
    expect(await resolveToken(env, bearer(tokens.access_token), now)).not.toBeNull();

    const res = await revokeAll(revokeAllReq(session), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: 4 });
    for (const t of [tokens.access_token, t2.access_token]) expect(await resolveToken(env, bearer(t), now)).toBeNull();
    expect((await refreshWith(id, tokens.refresh_token)).status).toBe(400);
    expect((await refreshWith(id, t2.refresh_token)).status).toBe(400);
    expect(await resolveToken(env, bearer(someoneElse.tokens.access_token), now)).not.toBeNull();

    // no session, nothing to revoke
    expect((await revokeAll(revokeAllReq(), ctx())).status).toBe(401);

    // the helper Task 39 calls
    const who = (await resolveToken(env, bearer(someoneElse.tokens.access_token), now))!;
    expect(await revokeAllForActor(env, who.actor.account.name)).toBe(2);
    expect(await resolveToken(env, bearer(someoneElse.tokens.access_token), now)).toBeNull();

    // RFC 7009 revoke of one token ends its grant
    const third = await signIn();
    const r = await revoke(
      new Request(`${BASE}/api/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: third.tokens.refresh_token, client_id: third.id }).toString(),
      }),
      ctx(),
    );
    expect(r.status).toBe(200);
    expect(await resolveToken(env, bearer(third.tokens.access_token), now)).toBeNull();
  });

  it('metadata documents point at each other', async () => {
    const get = async (url: string) => (await (await metadata(new Request(url), ctx())).json()) as Record<string, any>;
    // Each host names itself (ruling R19): the resource is the URL the agent used (RFC 9728 3.3) and the
    // issuer is the URL its metadata came from (RFC 8414 3.3). Any other host gets the canonical ones.
    for (const [host, named] of [[BASE, BASE], [LEGACY, LEGACY], ['http://localhost:5173', BASE]]) {
      const pr = await get(`${host}/.well-known/oauth-protected-resource`);
      expect(pr.resource).toBe(`${named}/api/mcp`);
      expect(pr.authorization_servers).toEqual([named]);
      expect(pr.scopes_supported).toEqual(['course']);
      expect(pr.bearer_methods_supported).toEqual(['header']);

      const as = await get(`${pr.authorization_servers[0]}/.well-known/oauth-authorization-server`);
      expect(as.issuer).toBe(pr.authorization_servers[0]);
      expect(as.protected_resources).toEqual([pr.resource]);
      expect(as.authorization_endpoint).toBe(`${named}/api/oauth/authorize`);
      expect(as.token_endpoint).toBe(`${named}/api/oauth/token`);
      expect(as.registration_endpoint).toBe(`${named}/api/oauth/register`);
      expect(as.revocation_endpoint).toBe(`${named}/api/oauth/revoke`);
      expect(as.code_challenge_methods_supported).toEqual(['S256']);
      expect(as.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
      expect(as.response_types_supported).toEqual(['code']);
      expect(as.token_endpoint_auth_methods_supported).toEqual(['none']);

      // after the sf.jsonc rewrite the Function sees its own path: it then serves one document valid as both
      const both = await get(`${host}/api/oauth/metadata`);
      expect(both).toEqual({ ...pr, ...as });
    }
  });

  it('a sign-in on the legacy host is issued by the legacy host and its tokens work', async () => {
    const id = await clientId();
    const refused = await authorize(new Request(authorizeUrl(id, { code_challenge_method: 'plain' }, LEGACY)), ctx());
    expect(new URL(refused.headers.get('location')!).searchParams.get('iss')).toBe(LEGACY);

    const { request, browser } = await startRequest(id, LEGACY);
    const res = await consent(consentReq({ request, decision: 'allow' }, [browser], LEGACY), ctx());
    const redirect = new URL(((await res.json()) as any).redirect);
    expect(redirect.searchParams.get('iss')).toBe(LEGACY);
    const ok = await exchange(id, redirect.searchParams.get('code')!, { resource: `${LEGACY}/api/mcp` });
    expect(ok.status).toBe(200);
    expect(await resolveToken(env, bearer(((await ok.json()) as Tokens).access_token), now)).not.toBeNull();
    // tokens are accepted for either resource
    const { code } = await getCode(id);
    expect((await exchange(id, code, { resource: `${BASE}/api/mcp` })).status).toBe(200);
  });

  it('stores only SHA-256 of codes and tokens, and limits registration', async () => {
    const id = await clientId();
    const { request, browser } = await startRequest(id);
    const res = await consent(consentReq({ request, decision: 'allow' }, [browser]), ctx());
    const code = new URL(((await res.json()) as any).redirect).searchParams.get('code')!;
    const t = (await (await exchange(id, code)).json()) as Tokens;
    const dump = JSON.stringify([
      (await db.prepare('SELECT * FROM oauth_codes').all()).results,
      (await db.prepare('SELECT * FROM oauth_tokens').all()).results,
    ]);
    for (const secret of [request, browser.split('=')[1], code, t.access_token, t.refresh_token]) expect(dump).not.toContain(secret);
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    expect(dump).toContain(sha(code));
    expect(dump).toContain(sha(t.access_token));

  });

  it('registration and authorize are limited per client and globally, and expired requests are cleared', async () => {
    const ip = (n: number) => ({ 'cf-connecting-ip': `10.0.0.${n}` });
    const hitsAtLimit = (k: string, n: number) => db.prepare('UPDATE hits SET n = ? WHERE k = ?').bind(n, k).run();

    // a rotating x-client-id does not buy a fresh bucket
    for (let i = 0; i < REGISTER_LIMIT.perKey; i++) {
      expect((await newClient([REDIRECT], { 'x-client-id': `rotating-client-${String(i).padStart(4, '0')}` })).status).toBe(201);
    }
    expect((await newClient([REDIRECT], { 'x-client-id': 'rotating-client-9999' })).status).toBe(429);
    // a known visitor address has its own bucket, under the global ceiling
    const res = await newClient([REDIRECT], ip(9));
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { client_id: string }).client_id;
    await hitsAtLimit('oauth:reg:g', REGISTER_LIMIT.global);
    expect((await newClient([REDIRECT], ip(10))).status).toBe(429);

    // authorize: per client, then the global ceiling
    for (let i = 0; i < AUTHORIZE_LIMIT.perClient; i++) expect((await authorize(new Request(authorizeUrl(id)), ctx())).status).toBe(302);
    const blocked = await authorize(new Request(authorizeUrl(id)), ctx());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('location')).toBeNull();
    const pending = async () =>
      (await db.prepare("SELECT COUNT(*) AS c FROM oauth_codes WHERE kind = 'request'").first<{ c: number }>())!.c;
    expect(await pending()).toBe(AUTHORIZE_LIMIT.perClient);

    now += REQUEST_TTL_MS * 2 + 1;
    const other = ((await (await newClient([REDIRECT], ip(11))).json()) as { client_id: string }).client_id;
    expect((await authorize(new Request(authorizeUrl(other)), ctx())).status).toBe(302);
    // the expired requests went with that write
    expect(await pending()).toBe(1);
    await hitsAtLimit('oauth:az:g', AUTHORIZE_LIMIT.global);
    expect((await authorize(new Request(authorizeUrl(other)), ctx())).status).toBe(429);
  });
});
