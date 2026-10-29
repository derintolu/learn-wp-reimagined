// POST /api/oauth/register: RFC 7591 dynamic client registration, open to any agent, public clients only.
import type { Handler } from '../../_lib/env';
import { readJsonCapped } from '../../_lib/guards';
import { rateLimit } from '../../_lib/ratelimit';
import { OAuthError, REGISTER_LIMIT, addressKey, oauthGuarded, oauthJson, ready, registerClient } from '../../_lib/oauth/store';

export const POST: Handler = (req, { env }) =>
  oauthGuarded(async () => {
    await ready(env);
    const now = Date.now();
    const { perKey, global, windowMs } = REGISTER_LIMIT;
    // Per key first, so a key that is already blocked never uses up the global ceiling. Visitors with no
    // address ('anon', the whole world on Spacefast) are held by the global ceiling alone.
    const key = addressKey(req, env);
    const perKeyOk = key === 'anon' ? true : await rateLimit(env.DB, `oauth:reg:${key}`, now, perKey, windowMs);
    if (!perKeyOk || !(await rateLimit(env.DB, 'oauth:reg:g', now, global, windowMs))) {
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
