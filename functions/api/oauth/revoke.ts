// POST /api/oauth/revoke: RFC 7009 token revocation for public clients. Ends the token's whole grant.
import type { Handler } from '../../_lib/env';
import { OAuthError, oauthGuarded, readForm, ready, revokeToken } from '../../_lib/oauth/store';

export const POST: Handler = (req, { env }) =>
  oauthGuarded(async () => {
    await ready(env);
    const p = await readForm(req);
    const clientId = p.get('client_id');
    const token = p.get('token');
    if (!clientId || !token) throw new OAuthError('invalid_request', 'token and client_id are required.');
    await revokeToken(env, token, clientId);
    // 200 whether or not the token was known (RFC 7009 2.2).
    return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
  });
