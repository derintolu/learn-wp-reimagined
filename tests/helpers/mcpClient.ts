import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Env, Handler } from '../../functions/_lib/env';

export type Era = 'legacy' | 'modern';
export type FetchFn = (req: Request) => Promise<Response>;

export const TOOLS = [
  'list_paths', 'start_placement', 'choose_placement', 'get_lesson', 'next_beat', 'check_code',
  'submit_checkpoint', 'choose_branch', 'get_record', 'link_record', 'delete_record',
];

/** An SDK client wired straight to a fetch handler (no network), after learning-mcp's test helpers. */
export async function connectMcp(fetchFn: FetchFn, era: Era, url = 'http://localhost/api/mcp') {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: (u, init) => fetchFn(new Request(u, init)),
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
export function routeFetch(mod: Record<string, unknown>, env: Env): FetchFn {
  return async (req) => {
    const fn = mod[req.method.toUpperCase()] as Handler | undefined;
    if (typeof fn !== 'function') return new Response('Method not allowed', { status: 405 });
    return fn(req, { params: {}, env });
  };
}
