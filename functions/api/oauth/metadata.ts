// GET /api/oauth/metadata, reached through sf.jsonc rewrites of /.well-known/oauth-protected-resource
// (RFC 9728) and /.well-known/oauth-authorization-server (RFC 8414). Both always name the canonical host,
// including for requests that arrive on the legacy one.
import type { Handler } from '../../_lib/env';
import { json } from '../../_lib/http';
import { ISSUER, RESOURCE, SCOPE } from '../../_lib/oauth/store';

export function resourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
  };
}

export function serverMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/api/oauth/authorize`,
    token_endpoint: `${ISSUER}/api/oauth/token`,
    registration_endpoint: `${ISSUER}/api/oauth/register`,
    revocation_endpoint: `${ISSUER}/api/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
    // RFC 9728 section 4: the resources this server issues tokens for.
    protected_resources: [RESOURCE],
  };
}

export const GET: Handler = async (req) => {
  const path = new URL(req.url).pathname;
  if (path === '/.well-known/oauth-protected-resource') return json(resourceMetadata());
  if (path === '/.well-known/oauth-authorization-server') return json(serverMetadata());
  // A rewrite hands the Function its own path (G0 probe 3), so it cannot tell which was asked for. The
  // two documents share no field with different values, and both RFCs say unknown fields are ignored,
  // so their union is valid as either.
  return json({ ...resourceMetadata(), ...serverMetadata() });
};
