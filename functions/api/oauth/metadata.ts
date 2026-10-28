// GET /api/oauth/metadata, reached through sf.jsonc rewrites of /.well-known/oauth-protected-resource
// (RFC 9728) and /.well-known/oauth-authorization-server (RFC 8414). The legacy host names itself and
// every other host the canonical one (ruling R19, issuerFor).
import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { SCOPE, issuerFor } from '../../_lib/oauth/store';

export function resourceMetadata(issuer: string) {
  return {
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
  };
}

export function serverMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
    // RFC 9728 section 4: the resources this server issues tokens for.
    protected_resources: [`${issuer}/api/mcp`],
  };
}

export const GET: Handler = async (req) => {
  const path = new URL(req.url).pathname;
  const issuer = issuerFor(req);
  if (path === '/.well-known/oauth-protected-resource') return json(resourceMetadata(issuer));
  if (path === '/.well-known/oauth-authorization-server') return json(serverMetadata(issuer));
  // A rewrite hands the Function its own path (G0 probe 3), so it cannot tell which was asked for. The
  // two documents share no field with different values, and both RFCs say unknown fields are ignored,
  // so their union is valid as either.
  return json({ ...resourceMetadata(issuer), ...serverMetadata(issuer) });
};
