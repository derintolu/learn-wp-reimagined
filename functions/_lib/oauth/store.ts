// The MCP authorization server's storage and shared pieces: OAuth 2.1 public clients (RFC 7591 dynamic
// registration), pending authorization requests, single-use codes, opaque access tokens and rotating
// refresh tokens. Request ids, browser bindings, codes and tokens are random 256-bit secrets stored as
// SHA-256 hex only. Shaped after the standard's reference auth server (learning-mcp
// reference/packages/server/src/auth, Apache-2.0); this is our own code for this course and touches no
// other SSO or OAuth configuration.
import type { Env } from '../env';
import { ensureOAuthSchema, ensureSchema } from '../db';
import { HttpError, readTextCapped } from '../guards';
import { LEGACY_XAPI_BASES, XAPI_BASE } from '../../../src/shared/xapi';
import { b64url, safeEqual } from './pkce';

export const SCOPE = 'course';
export const ACCESS_TTL_S = 3600;
/** A refresh token unused this long expires. Every use rotates it, so its age is its idle time. */
export const REFRESH_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 60_000;
/** A pending authorization request, from authorize to the consent decision, lives this long. */
export const REQUEST_TTL_MS = 600_000;
export const ISSUER = XAPI_BASE;
export const RESOURCE = `${XAPI_BASE}/api/mcp`;
/** Resource values a client may send: the canonical one and the legacy host's. Tokens are the same. */
export const RESOURCES: readonly string[] = [RESOURCE, ...LEGACY_XAPI_BASES.map((b) => `${b}/api/mcp`)];
/** Binds a pending request to the browser that opened it, so a leaked request id cannot be approved elsewhere. */
export const BROWSER_COOKIE = 'lwr_oauth_req';

export interface Actor {
  objectType: 'Agent';
  account: { homePage: string; name: string };
}

/** Who a code or token stands for. wpUserId is 0 and registration '' until Tasks 25 and 30 fill them. */
export interface Grant {
  actorName: string;
  wpUserId: number;
  registration: string;
}

export const actorOf = (name: string): Actor => ({ objectType: 'Agent', account: { homePage: XAPI_BASE, name } });

export class OAuthError extends Error {
  constructor(
    public error: string,
    description: string,
    public status = 400,
  ) {
    super(description);
    this.name = 'OAuthError';
  }
}

// ---- secrets ----

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 random bytes, base64url (43 characters). */
export const newSecret = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));
const SECRET = /^[A-Za-z0-9_-]{43}$/;
export const isSecret = (v: unknown): v is string => typeof v === 'string' && SECRET.test(v);

/** The tables every OAuth route needs: rate limits and sessions, then the OAuth ones. */
export async function ready(env: Env): Promise<void> {
  await ensureSchema(env.DB);
  await ensureOAuthSchema(env.DB);
}

// ---- HTTP helpers for the agent-facing endpoints ----

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache', ...headers },
  });
}

export const oauthError = (error: string, description: string, status = 400): Response =>
  oauthJson({ error, error_description: description }, status);

/** Runs an agent-facing handler, mapping failures to RFC 6749 error bodies. */
export async function oauthGuarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(e.error, e.message, e.status);
    if (e instanceof HttpError) return oauthError('invalid_request', e.message, e.status);
    return oauthError('server_error', 'Something went wrong.', 500);
  }
}

export interface Params {
  get(name: string): string | undefined;
  duplicated: boolean;
}

export function params(sp: URLSearchParams): Params {
  const duplicated = [...new Set(sp.keys())].some((k) => sp.getAll(k).length > 1);
  return { get: (n) => sp.get(n) ?? undefined, duplicated };
}

/** The value of the named cookie, or undefined. */
export function cookieNamed(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

const FORM_BYTES = 16_384;

/** An application/x-www-form-urlencoded body of at most 16 KB. */
export async function readForm(req: Request): Promise<Params> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new OAuthError('invalid_request', 'Send an application/x-www-form-urlencoded body.');
  }
  return params(new URLSearchParams(await readTextCapped(req, FORM_BYTES)));
}

// ---- clients (RFC 7591, public clients only) ----

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;
const MAX_NAME_LENGTH = 200;
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);
const CLIENT_ID = /^[A-Za-z0-9_-]{32}$/;

export interface Client {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  createdAt: number;
}

/** https anywhere, http only on loopback (127.0.0.1 or localhost); no fragment, no user info. */
export function isAllowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > MAX_URI_LENGTH || uri.includes('#')) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
}

export async function registerClient(env: Env, meta: unknown, now: number): Promise<Client & { grantTypes: string[] }> {
  const bad = (d: string) => new OAuthError('invalid_client_metadata', d);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw bad('The body must be a JSON object.');
  const m = meta as Record<string, unknown>;
  if (m.token_endpoint_auth_method !== undefined && m.token_endpoint_auth_method !== 'none') {
    throw bad('Only public clients (token_endpoint_auth_method "none") are supported.');
  }
  const grantTypes = m.grant_types ?? ['authorization_code', 'refresh_token'];
  if (
    !Array.isArray(grantTypes) ||
    !grantTypes.includes('authorization_code') ||
    grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token')
  ) {
    throw bad('grant_types must be authorization_code, optionally with refresh_token.');
  }
  if (m.response_types !== undefined && (!Array.isArray(m.response_types) || m.response_types.some((r) => r !== 'code'))) {
    throw bad('response_types must be ["code"].');
  }
  if (m.client_name !== undefined && (typeof m.client_name !== 'string' || m.client_name.length > MAX_NAME_LENGTH)) {
    throw bad('client_name must be text of at most 200 characters.');
  }
  const uris = m.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(isAllowedRedirectUri)) {
    throw new OAuthError(
      'invalid_redirect_uri',
      'redirect_uris must list 1 to 10 URIs, each https or http on 127.0.0.1 or localhost, without a fragment.',
    );
  }
  const client: Client = {
    clientId: b64url(crypto.getRandomValues(new Uint8Array(24))),
    clientName: (m.client_name as string | undefined) ?? null,
    redirectUris: [...(uris as string[])],
    createdAt: now,
  };
  await env.DB
    .prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created) VALUES (?, ?, ?, ?)')
    .bind(client.clientId, client.clientName, JSON.stringify(client.redirectUris), now)
    .run();
  return { ...client, grantTypes: [...(grantTypes as string[])] };
}

export async function getClient(env: Env, clientId: string | undefined): Promise<Client | null> {
  if (!clientId || !CLIENT_ID.test(clientId)) return null;
  const row = await env.DB
    .prepare('SELECT client_id, client_name, redirect_uris, created FROM oauth_clients WHERE client_id = ?')
    .bind(clientId)
    .first<{ client_id: string; client_name: string | null; redirect_uris: string; created: number | string }>();
  if (!row) return null;
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    createdAt: Number(row.created),
  };
}

// ---- pending authorization requests ----

export interface AuthRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
}

/** Stores a validated request bound to `browser` (the binding cookie's value); returns its id. */
export async function putRequest(env: Env, r: AuthRequest, browser: string, now: number): Promise<string> {
  const id = newSecret();
  await env.DB
    .prepare(
      "INSERT INTO oauth_codes (code_hash, kind, client_id, redirect_uri, code_challenge, state, browser_hash, family_id, actor_name, wp_user_id, registration, created, expires, used) VALUES (?, 'request', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, 0)",
    )
    .bind(await sha256Hex(id), r.clientId, r.redirectUri, r.codeChallenge, r.state, await sha256Hex(browser), now, now + REQUEST_TTL_MS)
    .run();
  return id;
}

interface RequestRow {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
  browser_hash: string;
  expires: number | string;
}

async function liveRequest(env: Env, id: unknown, browser: unknown, now: number): Promise<{ hash: string; r: AuthRequest } | null> {
  if (!isSecret(id) || !isSecret(browser)) return null;
  const hash = await sha256Hex(id);
  const row = await env.DB
    .prepare("SELECT client_id, redirect_uri, code_challenge, state, browser_hash, expires FROM oauth_codes WHERE code_hash = ? AND kind = 'request'")
    .bind(hash)
    .first<RequestRow>();
  if (!row || now >= Number(row.expires) || !safeEqual(row.browser_hash, await sha256Hex(browser))) return null;
  return { hash, r: { clientId: row.client_id, redirectUri: row.redirect_uri, codeChallenge: row.code_challenge, state: row.state } };
}

/** The live request with this id opened in this browser, left in place. */
export async function peekRequest(env: Env, id: unknown, browser: unknown, now: number): Promise<AuthRequest | null> {
  return (await liveRequest(env, id, browser, now))?.r ?? null;
}

/** Ends the request and returns it; concurrent decisions on one request get it at most once. */
export async function takeRequest(env: Env, id: unknown, browser: unknown, now: number): Promise<AuthRequest | null> {
  const live = await liveRequest(env, id, browser, now);
  if (!live) return null;
  const res = await env.DB.prepare("DELETE FROM oauth_codes WHERE code_hash = ? AND kind = 'request'").bind(live.hash).run();
  return res.meta.changes === 1 ? live.r : null;
}

// ---- authorization codes ----

/** Mints a single-use code for an approved request. Its grant family is fixed now, so a replay can end it. */
export async function putCode(env: Env, r: AuthRequest, g: Grant, now: number): Promise<string> {
  const code = newSecret();
  await env.DB
    .prepare(
      "INSERT INTO oauth_codes (code_hash, kind, client_id, redirect_uri, code_challenge, state, browser_hash, family_id, actor_name, wp_user_id, registration, created, expires, used) VALUES (?, 'code', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(await sha256Hex(code), r.clientId, r.redirectUri, r.codeChallenge, newSecret(), g.actorName, g.wpUserId, g.registration, now, now + CODE_TTL_MS)
    .run();
  return code;
}

export interface Redeemed {
  grant: Grant;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  familyId: string;
}

/**
 * Spends a code. Null when it is unknown, expired or already spent; a second spend also ends the tokens
 * the first one issued (RFC 9700 4.2.3 guidance on code replay).
 */
export async function redeemCode(env: Env, code: unknown, now: number): Promise<Redeemed | null> {
  if (!isSecret(code)) return null;
  const hash = await sha256Hex(code);
  const row = await env.DB
    .prepare(
      "SELECT client_id, redirect_uri, code_challenge, family_id, actor_name, wp_user_id, registration, expires FROM oauth_codes WHERE code_hash = ? AND kind = 'code'",
    )
    .bind(hash)
    .first<{
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      family_id: string;
      actor_name: string;
      wp_user_id: number | string | null;
      registration: string | null;
      expires: number | string;
    }>();
  if (!row) return null;
  const spent = await env.DB.prepare('UPDATE oauth_codes SET used = 1 WHERE code_hash = ? AND used = 0').bind(hash).run();
  if (spent.meta.changes !== 1) {
    await revokeFamily(env, row.family_id);
    return null;
  }
  if (now >= Number(row.expires)) return null;
  return {
    grant: { actorName: row.actor_name, wpUserId: Number(row.wp_user_id ?? 0), registration: row.registration ?? '' },
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    familyId: row.family_id,
  };
}

// ---- tokens ----

export async function issueTokens(
  env: Env,
  g: Grant,
  clientId: string,
  familyId: string,
  now: number,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = newSecret();
  const refreshToken = newSecret();
  const insert = (hash: string, kind: string, expires: number) =>
    env.DB
      .prepare(
        'INSERT INTO oauth_tokens (token_hash, kind, family_id, client_id, actor_name, wp_user_id, registration, created, expires, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
      )
      .bind(hash, kind, familyId, clientId, g.actorName, g.wpUserId, g.registration, now, expires)
      .run();
  await insert(await sha256Hex(accessToken), 'access', now + ACCESS_TTL_S * 1000);
  await insert(await sha256Hex(refreshToken), 'refresh', now + REFRESH_IDLE_MS);
  return { accessToken, refreshToken };
}

/**
 * Spends a refresh token for `clientId`. Null when it is unknown, expired, another client's or already
 * spent; a spent one coming back means it leaked, so its whole family ends.
 */
export async function useRefresh(env: Env, refresh: unknown, clientId: string, now: number): Promise<{ grant: Grant; familyId: string } | null> {
  if (!isSecret(refresh)) return null;
  const hash = await sha256Hex(refresh);
  const row = await env.DB
    .prepare("SELECT family_id, client_id, actor_name, wp_user_id, registration, expires, used FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'")
    .bind(hash)
    .first<{
      family_id: string;
      client_id: string;
      actor_name: string;
      wp_user_id: number | string | null;
      registration: string | null;
      expires: number | string;
      used: number | string;
    }>();
  if (!row) return null;
  if (Number(row.used)) {
    await revokeFamily(env, row.family_id);
    return null;
  }
  if (row.client_id !== clientId || now >= Number(row.expires)) return null;
  const spent = await env.DB.prepare('UPDATE oauth_tokens SET used = 1 WHERE token_hash = ? AND used = 0').bind(hash).run();
  if (spent.meta.changes !== 1) {
    await revokeFamily(env, row.family_id);
    return null;
  }
  return {
    grant: { actorName: row.actor_name, wpUserId: Number(row.wp_user_id ?? 0), registration: row.registration ?? '' },
    familyId: row.family_id,
  };
}

export async function revokeFamily(env: Env, familyId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM oauth_tokens WHERE family_id = ?').bind(familyId).run();
}

/** RFC 7009: ends the grant a token belongs to, when it was issued to `clientId`. Unknown tokens are ignored. */
export async function revokeToken(env: Env, token: unknown, clientId: string): Promise<void> {
  if (!isSecret(token)) return;
  const row = await env.DB
    .prepare('SELECT family_id, client_id FROM oauth_tokens WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first<{ family_id: string; client_id: string }>();
  if (row && row.client_id === clientId) await revokeFamily(env, row.family_id);
}

/** "Disconnect agents", and the erase step Task 39 runs: ends every code and token for the actor. Returns tokens removed. */
export async function revokeAllForActor(env: Env, actorName: string): Promise<number> {
  await ensureOAuthSchema(env.DB);
  await env.DB.prepare('DELETE FROM oauth_codes WHERE actor_name = ?').bind(actorName).run();
  const res = await env.DB.prepare('DELETE FROM oauth_tokens WHERE actor_name = ?').bind(actorName).run();
  return res.meta.changes;
}

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/i;

/** The actor a request's live access token stands for, or null. */
export async function resolveToken(
  env: Env,
  req: Request,
  now: number,
): Promise<{ actor: Actor; wpUserId: number; registration: string } | null> {
  const m = BEARER.exec((req.headers.get('authorization') ?? '').trim());
  if (!m) return null;
  await ensureOAuthSchema(env.DB);
  const row = await env.DB
    .prepare("SELECT actor_name, wp_user_id, registration, expires FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'")
    .bind(await sha256Hex(m[1]))
    .first<{ actor_name: string; wp_user_id: number | string | null; registration: string | null; expires: number | string }>();
  if (!row || now >= Number(row.expires)) return null;
  return { actor: actorOf(row.actor_name), wpUserId: Number(row.wp_user_id ?? 0), registration: row.registration ?? '' };
}
