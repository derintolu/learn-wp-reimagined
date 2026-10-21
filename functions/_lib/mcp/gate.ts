// What sits in front of the course server: a body cap, then rate limits on a global MCP ceiling, on
// record creation and per handle (ruling R-d). Keys are namespaced `mcp:` so they never share a bucket
// with the AI routes (`g:global`, `c:…`, `ip:…`, `anon`). Spacefast passes no visitor IP to functions,
// so the creation and global ceilings stand in for a per-IP limit.
import type { D1Like, Env } from '../env';
import { rateLimit } from '../ratelimit';
import { handleKey } from './recordStore';

export const MCP_LIMITS = {
  bodyBytes: 1_048_576,
  global: { limit: 1200, windowMs: 600_000 },
  perHandle: { limit: 120, windowMs: 600_000 },
  create: { limit: 60, windowMs: 600_000 },
} as const;

export const MCP_GLOBAL_KEY = 'mcp:g';
export const MCP_CREATE_KEY = 'mcp:new';
export const mcpHandleKey = async (handle: string) => 'mcp:h:' + (await handleKey(handle)).slice(0, 32);

type JsonRpcId = string | number | null;

/** The handles and record creations in one JSON-RPC message or batch. Invalid JSON gives nothing. */
export function inspectMcpBody(text: string): { handles: string[]; creates: number; ids: JsonRpcId[] } {
  const out = { handles: [] as string[], creates: 0, ids: [] as JsonRpcId[] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
    if (m === null || typeof m !== 'object') continue;
    const msg = m as { id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: Record<string, unknown> } };
    if (typeof msg.id === 'string' || typeof msg.id === 'number') out.ids.push(msg.id);
    if (msg.method !== 'tools/call') continue;
    const name = msg.params?.name;
    const args = msg.params?.arguments;
    const handle = args && typeof args === 'object' ? args.handle : undefined;
    if (typeof handle === 'string' && handle.length <= 64) out.handles.push(handle);
    if (name === 'link_record' || (name === 'start_placement' && handle === undefined)) out.creates++;
  }
  out.handles = [...new Set(out.handles)];
  return out;
}

const rpcError = (status: number, id: JsonRpcId, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const TOO_LARGE = 'Request too large for this course server.';
export const TOO_MANY = 'Too many requests to this course server. Wait a few minutes and try again.';

/** Reads the body as text, at most `max` bytes. Returns null when it is larger. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** Checks one request against the limits. Returns a rebuilt request, or the 413/429 response to send. */
export async function gateMcp(req: Request, env: Pick<Env, 'DB'>, now: number): Promise<{ ok: true; req: Request } | { ok: false; res: Response }> {
  const text = await readCapped(req, MCP_LIMITS.bodyBytes);
  if (text === null) return { ok: false, res: rpcError(413, null, -32600, TOO_LARGE) };
  const info = inspectMcpBody(text);
  const limited = { ok: false as const, res: rpcError(429, info.ids[0] ?? null, -32000, TOO_MANY) };
  const db: D1Like = env.DB;
  const { global, create, perHandle } = MCP_LIMITS;
  if (!(await rateLimit(db, MCP_GLOBAL_KEY, now, global.limit, global.windowMs))) return limited;
  for (let i = 0; i < info.creates; i++) {
    if (!(await rateLimit(db, MCP_CREATE_KEY, now, create.limit, create.windowMs))) return limited;
  }
  for (const h of info.handles) {
    if (!(await rateLimit(db, await mcpHandleKey(h), now, perHandle.limit, perHandle.windowMs))) return limited;
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return { ok: true, req: new Request(req.url, { method: req.method, headers: req.headers, body: hasBody ? text : undefined }) };
}
