// POST /api/oauth/register: RFC 7591 dynamic client registration, open to any agent, public clients only.
import type { Handler } from '../../_lib/env';
import { clientKey, readJsonCapped } from '../../_lib/guards';
import { rateLimit } from '../../_lib/ratelimit';
import { OAuthError, oauthGuarded, oauthJson, ready, registerClient } from '../../_lib/oauth/store';

export const REGISTER_LIMIT = { limit: 20, windowMs: 600_000 } as const;

export const POST: Handler = (req, { env }) =>
  oauthGuarded(async () => {
    await ready(env);
    const now = Date.now();
    if (!(await rateLimit(env.DB, `oauth:reg:${clientKey(req, env)}`, now, REGISTER_LIMIT.limit, REGISTER_LIMIT.windowMs))) {
      throw new OAuthError('temporarily_unavailable', 'Too many registrations. Wait a few minutes and try again.', 429);
    }
    let meta: unknown;
    try {
      meta = await readJsonCapped(req, 16_384);
    } catch {
      throw new OAuthError('invalid_client_metadata', 'The body must be a JSON object of at most 16 KB.');
    }
    const c = await registerClient(env, meta, now);
    return oauthJson(
      {
        client_id: c.clientId,
        client_id_issued_at: Math.floor(c.createdAt / 1000),
        ...(c.clientName !== null ? { client_name: c.clientName } : {}),
        redirect_uris: c.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: c.grantTypes,
        response_types: ['code'],
      },
      201,
    );
  });
