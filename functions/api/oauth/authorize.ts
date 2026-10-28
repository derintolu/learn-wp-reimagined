// GET /api/oauth/authorize: validates the agent's request (registered client, exact redirect URI, PKCE S256),
// stores it bound to this browser, and sends the browser to the consent page.
import type { Handler } from '../../_lib/env';
import { isS256Challenge } from '../../_lib/oauth/pkce';
import { rateLimit } from '../../_lib/ratelimit';
import {
  AUTHORIZE_LIMIT,
  BROWSER_COOKIE,
  cookieNamed,
  issuerFor,
  REQUEST_TTL_MS,
  RESOURCES,
  SCOPE,
  getClient,
  isSecret,
  newSecret,
  oauthGuarded,
  params,
  putRequest,
  ready,
} from '../../_lib/oauth/store';

const MAX_STATE = 1024;

/** Before the redirect URI is trusted, errors go to the browser, never to the agent's address. */
const page = (message: string, status = 400) =>
  new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });

export const GET: Handler = (req, { env }) =>
  oauthGuarded(async () => {
    await ready(env);
    const now = Date.now();
    const p = params(new URL(req.url).searchParams);
    const client = await getClient(env, p.get('client_id'));
    if (!client) return page('The agent asking to connect is not registered with this course.');
    const redirectUri = p.get('redirect_uri');
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return page('The agent gave a return address it has not registered.');
    }
    const state = p.get('state');
    const fail = (error: string, description: string) => {
      const loc = new URL(redirectUri);
      loc.searchParams.set('error', error);
      loc.searchParams.set('error_description', description);
      if (state !== undefined && state.length <= MAX_STATE) loc.searchParams.set('state', state);
      loc.searchParams.set('iss', issuerFor(req));
      return new Response(null, { status: 302, headers: { location: loc.href, 'cache-control': 'no-store' } });
    };
    if (p.duplicated) return fail('invalid_request', 'A parameter was sent more than once.');
    if (state !== undefined && state.length > MAX_STATE) return fail('invalid_request', 'state is too long.');
    if (p.get('response_type') !== 'code') return fail('unsupported_response_type', 'response_type must be code.');
    const challenge = p.get('code_challenge');
    if (p.get('code_challenge_method') !== 'S256' || !isS256Challenge(challenge)) {
      return fail('invalid_request', 'PKCE with code_challenge_method S256 is required.');
    }
    const resource = p.get('resource');
    if (resource !== undefined && !RESOURCES.includes(resource)) return fail('invalid_target', `resource must be ${RESOURCES[0]}.`);
    const scope = p.get('scope');
    if (scope !== undefined && scope.split(' ').some((s) => s !== '' && s !== SCOPE)) {
      return fail('invalid_scope', `The only scope is ${SCOPE}.`);
    }

    // Every pending request is a row: limited per client, then globally, before it is written.
    const { perClient, global, windowMs } = AUTHORIZE_LIMIT;
    if (
      !(await rateLimit(env.DB, `oauth:az:${client.clientId}`, now, perClient, windowMs)) ||
      !(await rateLimit(env.DB, 'oauth:az:g', now, global, windowMs))
    ) {
      return page('Too many sign-in attempts right now. Wait a few minutes and try again.', 429);
    }

    const known = cookieNamed(req, BROWSER_COOKIE);
    const browser = isSecret(known) ? known : newSecret();
    const id = await putRequest(
      env,
      { clientId: client.clientId, redirectUri, codeChallenge: challenge, state: state ?? null },
      browser,
      now,
    );
    // Set every time, so the binding outlives this request even when an earlier one created it.
    return new Response(null, {
      status: 302,
      headers: {
        location: `/consent?request=${encodeURIComponent(id)}`,
        'cache-control': 'no-store',
        'set-cookie': `${BROWSER_COOKIE}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=${REQUEST_TTL_MS / 1000}`,
      },
    });
  });
