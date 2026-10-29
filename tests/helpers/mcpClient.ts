import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Env, Handler } from '../../functions/_lib/env';

export type Era = 'legacy' | 'modern';
export type FetchFn = (req: Request) => Promise<Response>;

/**
 * An SDK client wired straight to a fetch handler (no network), after learning-mcp's test helpers. `token`
 * is sent as `Authorization: Bearer <token>` on every request (MCP authorization).
 */
export async function connectMcp(fetchFn: FetchFn, era: Era, url = 'http://localhost/api/mcp', opts: { token?: string } = {}) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: (u, init) => fetchFn(new Request(u, init)),
    ...(opts.token ? { requestInit: { headers: { authorization: `Bearer ${opts.token}` } } } : {}),
  });
  const client = new Client(
    { name: 'learn-wp-test', version: '0.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    return { isError: Boolean(r.isError), data: r.structuredContent as any, raw: r };
  };
  return { client, call };
}

/** Dispatches a request to a route module's method exports, the way the Spacefast router does. */
export function routeFetch(mod: Record<string, unknown>, env: Env, ctx: Record<string, unknown> = {}): FetchFn {
  return async (req) => {
    const fn = mod[req.method.toUpperCase()] as Handler | undefined;
    if (typeof fn !== 'function') return new Response('Method not allowed', { status: 405 });
    return fn(req, { params: {}, env, ...ctx });
  };
}
