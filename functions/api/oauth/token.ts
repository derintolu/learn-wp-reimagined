// POST /api/oauth/token: authorization_code (single use, PKCE S256) and refresh_token (rotating).
import type { Handler } from '../../_lib/env';
import { verifyS256 } from '../../_lib/oauth/pkce';
import {
  ACCESS_TTL_S,
  OAuthError,
  RESOURCES,
  SCOPE,
  issueTokens,
  oauthGuarded,
  oauthJson,
  readForm,
  ready,
  redeemCode,
  useRefresh,
  type Grant,
} from '../../_lib/oauth/store';

const invalidGrant = (d: string) => new OAuthError('invalid_grant', d);

export const POST: Handler = (req, { env }) =>
  oauthGuarded(async () => {
    await ready(env);
    const now = Date.now();
    const p = await readForm(req);
    if (p.duplicated) throw new OAuthError('invalid_request', 'A parameter was sent more than once.');
    const clientId = p.get('client_id');
    if (!clientId) throw new OAuthError('invalid_request', 'client_id is required.');
    const resource = p.get('resource');
    if (resource !== undefined && !RESOURCES.includes(resource)) throw new OAuthError('invalid_target', `resource must be ${RESOURCES[0]}.`);

    const tokens = async (g: Grant, familyId: string) => {
      const t = await issueTokens(env, g, clientId, familyId, now);
      return oauthJson({ access_token: t.accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: t.refreshToken, scope: SCOPE });
    };

    const grantType = p.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = p.get('code');
      const verifier = p.get('code_verifier');
      const redirectUri = p.get('redirect_uri');
      if (!code || !verifier || !redirectUri) throw new OAuthError('invalid_request', 'code, code_verifier and redirect_uri are required.');
      // Spent before any other check, so a code never gets a second try.
      const c = await redeemCode(env, code, now);
      if (!c) throw invalidGrant('The code is not valid, has expired or was already used.');
      if (c.clientId !== clientId || c.redirectUri !== redirectUri) throw invalidGrant('The code was issued to another client or redirect URI.');
      if (!(await verifyS256(verifier, c.codeChallenge))) throw invalidGrant('code_verifier does not match the code challenge.');
      return tokens(c.grant, c.familyId);
    }
    if (grantType === 'refresh_token') {
      const r = await useRefresh(env, p.get('refresh_token'), clientId, now);
      if (!r) throw invalidGrant('The refresh token is not valid, has expired or was already used. Sign in again.');
      return tokens(r.grant, r.familyId);
    }
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.');
  });
