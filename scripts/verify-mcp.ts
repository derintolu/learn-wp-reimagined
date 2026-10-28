// Checks a running course connector with the official MCP SDK client.
//
//   npx tsx scripts/verify-mcp.ts <url> [legacy|modern] [--handle-file <path>] [--export <path>]
//   npx tsx scripts/verify-mcp.ts <url> [legacy|modern] --oauth --cookie-file <path>
//
// --oauth signs in the way an agent does (SERVER_FLAGS.agentOnStandard): the 401's protected-resource metadata,
// dynamic client registration, PKCE (S256), consent as the learner whose studio session cookie is in the file
// (`lwr_sid=<value>`, or the bare value), the code exchange, then tools/list and get_status with the access token.
// The grant is revoked at the end. Prints the server name, the tool names and the custody; never a token, code
// or cookie.
//
// Extra request headers (for example an access token for a private space) are read from the JSON file
// named by $MCP_HEADERS_FILE. Prints only the server name, the tool names and, with --handle-file, the
// lesson the record continues at. Never prints header values or handles. Works with both servers /api/mcp
// can be (SERVER_FLAGS.mcpOnStandard): the course-xapi-mcp reference server and today's learning-mcp one;
// --export writes the practice copy (standard) or the learning-mcp record.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export async function verifyMcp(
  url: string,
  era: 'legacy' | 'modern',
  headers: Record<string, string>,
  opts: { handle?: string; exportTo?: string; fetch?: (url: string | URL, init?: RequestInit) => Promise<Response> } = {},
): Promise<{ serverName: string; tools: string[]; lessonId?: string }> {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers }, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const client = new Client(
    { name: 'learn-wp-verify', version: '0.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    const out: { serverName: string; tools: string[]; lessonId?: string } = { serverName: client.getServerVersion()?.name ?? '', tools };
    if (opts.handle) {
      const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
      const start = await call('start_placement', { handle: opts.handle });
      if (start.isError) throw new Error(`start_placement failed: ${start.structuredContent?.error}`);
      const beat = await call('next_beat', { handle: opts.handle });
      // The standard names a lesson by key, learning-mcp by id.
      out.lessonId = beat.structuredContent?.lesson?.key ?? beat.structuredContent?.lesson?.id;
      if (opts.exportTo) {
        const rec = await call('get_record', { handle: opts.handle });
        const copy = rec.content?.find((c: { type: string }) => c.type === 'resource')?.resource?.text;
        writeFileSync(opts.exportTo, copy ?? JSON.stringify(rec.structuredContent.record, null, 2), { mode: 0o600 });
      }
    }
    return out;
  } finally {
    await client.close();
  }
}

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

const b64url = (b: Buffer) => b.toString('base64url');
/** A loopback redirect URI: nothing listens there, because the consent call returns the redirect as data. */
export const OAUTH_REDIRECT = 'http://127.0.0.1:8976/callback';

async function readJson(res: Response, what: string): Promise<any> {
  if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status})`);
  return res.json();
}

/**
 * Signs in as the learner whose session cookie is given, then checks the connector with the access token.
 * Throws with the step that failed; no message carries a token, code or cookie.
 */
export async function verifyMcpOAuth(
  url: string,
  era: 'legacy' | 'modern',
  opts: { cookie: string; fetch?: FetchLike },
): Promise<{ serverName: string; tools: string[]; custody: unknown; official: unknown }> {
  const f: FetchLike = opts.fetch ?? fetch;
  const session = opts.cookie.includes('=') ? opts.cookie.trim() : `lwr_sid=${opts.cookie.trim()}`;

  // 1. No token: 401 naming the protected-resource metadata.
  const probe = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'learn-wp-verify', version: '0.0.0' } } }),
  });
  if (probe.status !== 401) throw new Error(`expected 401 without a token, got HTTP ${probe.status}`);
  const metaUrl = /resource_metadata="([^"]+)"/.exec(probe.headers.get('www-authenticate') ?? '')?.[1];
  if (!metaUrl) throw new Error('the 401 names no resource_metadata');
  const resource = await readJson(await f(metaUrl), 'protected-resource metadata');
  const issuer: string = resource.authorization_servers?.[0];
  if (!issuer) throw new Error('the protected-resource metadata names no authorization server');
  const as = await readJson(await f(`${issuer}/.well-known/oauth-authorization-server`), 'authorization-server metadata');

  // 2. Dynamic client registration (RFC 7591), a public client.
  const client = await readJson(
    await f(as.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'learn-wp-verify', redirect_uris: [OAUTH_REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
    }),
    'client registration',
  );

  // 3. Authorization request with PKCE; the browser binding cookie comes back with the consent redirect.
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const authz = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: OAUTH_REDIRECT,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    state,
    resource: resource.resource,
    scope: (resource.scopes_supported ?? []).join(' '),
  })) {
    authz.searchParams.set(k, v);
  }
  const started = await f(authz, { redirect: 'manual' });
  const consentAt = started.headers.get('location');
  const request = consentAt ? new URL(consentAt, issuer).searchParams.get('request') : null;
  if (started.status !== 302 || !request) throw new Error(`the authorization request was refused (HTTP ${started.status})`);
  const binding = (started.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  // 4. Consent, as the learner's browser: their studio session plus the binding.
  const consent = await readJson(
    await f(new URL('/api/oauth/consent', issuer), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: [session, binding].filter(Boolean).join('; ') },
      body: JSON.stringify({ request, decision: 'allow' }),
    }),
    'consent',
  );
  const back = new URL(consent.redirect);
  if (back.searchParams.get('state') !== state) throw new Error('the consent redirect carries another state');
  if (back.searchParams.get('iss') !== as.issuer) throw new Error('the consent redirect names another issuer');
  const code = back.searchParams.get('code');
  if (!code) throw new Error(`consent gave no code (${back.searchParams.get('error') ?? 'no error'})`);

  // 5. Code exchange.
  const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  const tokens = await readJson(
    await f(as.token_endpoint, form({ grant_type: 'authorization_code', code, redirect_uri: OAUTH_REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: resource.resource })),
    'code exchange',
  );

  // 6. The connector, signed in.
  try {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    const mcp = new Client({ name: 'learn-wp-verify', version: '0.0.0' }, era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {});
    await mcp.connect(transport);
    try {
      const tools = (await mcp.listTools()).tools.map((t) => t.name);
      const status = (await mcp.callTool({ name: 'get_status', arguments: {} })) as { isError?: boolean; structuredContent?: Record<string, unknown> };
      if (status.isError) throw new Error(`get_status failed: ${String(status.structuredContent?.error ?? '')}`);
      return { serverName: mcp.getServerVersion()?.name ?? '', tools, custody: status.structuredContent?.custody, official: status.structuredContent?.official };
    } finally {
      await mcp.close();
    }
  } finally {
    // Leave no live grant behind.
    await f(as.revocation_endpoint, form({ token: tokens.refresh_token, client_id: client.client_id })).catch(() => undefined);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const oauth = args.includes('--oauth');
  if (oauth) args.splice(args.indexOf('--oauth'), 1);
  const cookieFile = flag('--cookie-file');
  const handleFile = flag('--handle-file');
  const exportTo = flag('--export');
  const [url, era = 'legacy'] = args;
  if (!url || (era !== 'legacy' && era !== 'modern') || (oauth && !cookieFile)) {
    throw new Error('usage: verify-mcp.ts <url> [legacy|modern] [--handle-file <path>] [--export <path>] | --oauth --cookie-file <path>');
  }
  if (oauth) {
    const r = await verifyMcpOAuth(url, era, { cookie: readFileSync(cookieFile!, 'utf8') });
    console.log(`server: ${r.serverName}`);
    console.log(`tools (${r.tools.length}): ${r.tools.join(', ')}`);
    console.log(`custody: ${String(r.custody)}, official: ${String(r.official)}`);
    process.exit(0);
  }
  const headers = process.env.MCP_HEADERS_FILE ? (JSON.parse(readFileSync(process.env.MCP_HEADERS_FILE, 'utf8')) as Record<string, string>) : {};
  const handle = handleFile ? readFileSync(handleFile, 'utf8').trim() : undefined;
  const r = await verifyMcp(url, era, headers, { handle, exportTo });
  console.log(`server: ${r.serverName}`);
  console.log(`tools (${r.tools.length}): ${r.tools.join(', ')}`);
  if (r.lessonId !== undefined) console.log(`continues at: ${r.lessonId}`);
}
