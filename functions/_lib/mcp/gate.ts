// What sits in front of the course server: a body cap, then rate limits on a global MCP ceiling and, signed in,
// per learner, keyed by the access token's SHA-256. Keys are namespaced `mcp:` so they never share a bucket
// with the AI routes (`g:global`, `c:…`, `ip:…`, `anon`). Spacefast passes no visitor IP to functions,
// so the global ceiling stands in for a per-IP limit.
import type { D1Like, Env } from '../env';
import { rateLimit } from '../ratelimit';
import { isPracticeHandle } from '../../../vendor/course-xapi-mcp/core/practice-record.ts';

export const MCP_LIMITS = {
  bodyBytes: 1_048_576,
  global: { limit: 1200, windowMs: 600_000 },
  perToken: { limit: 120, windowMs: 600_000 },
} as const;

export const MCP_GLOBAL_KEY = 'mcp:g';

/** A signed-in agent's bucket: the first 128 bits of its access token's SHA-256 (hex), never the token. */
export const mcpTokenKey = (tokenHash: string) => 'mcp:t:' + tokenHash.slice(0, 32);

/** A record handle of the retired practice connector: `cxp_<32>`, or `lr_<32>` from the server before it. */
const LEGACY_HANDLE = /^lr_[A-Za-z0-9_-]{32}$/;
const isAnyHandle = (h: unknown): h is string => (typeof h === 'string' && LEGACY_HANDLE.test(h)) || isPracticeHandle(h);

type JsonRpcId = string | number | null;

/**
 * What one JSON-RPC message or batch holds: `messages` (each is charged to the global bucket), the record
 * `handles` its tool calls carry (one entry per call) and the request ids. Invalid JSON gives one message and nothing else.
 */
export function inspectMcpBody(text: string): { messages: number; handles: string[]; ids: JsonRpcId[] } {
  const { calls: _calls, ...out } = inspect(text);
  return out;
}

function inspect(text: string): { messages: number; handles: string[]; ids: JsonRpcId[]; calls: number } {
  const out = { messages: 1, handles: [] as string[], ids: [] as JsonRpcId[], calls: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  out.messages = Math.max(1, list.length);
  for (const m of list) {
    if (m === null || typeof m !== 'object') continue;
    const msg = m as { id?: unknown; method?: unknown; params?: { arguments?: Record<string, unknown> } };
    if (typeof msg.id === 'string' || typeof msg.id === 'number') out.ids.push(msg.id);
    if (msg.method !== 'tools/call') continue;
    out.calls++;
    const args = msg.params?.arguments;
    const handle = args && typeof args === 'object' ? args.handle : undefined;
    if (isAnyHandle(handle)) out.handles.push(handle);
  }
  return out;
}

const rpcError = (status: number, id: JsonRpcId, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const TOO_LARGE = 'Request too large for this course server.';
export const TOO_MANY = 'Too many requests to this course server. Wait a few minutes and try again.';

/** Reads the raw body, at most `max` bytes. Returns null when it is larger. */
async function readCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
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
  const buf = new Uint8Array(new ArrayBuffer(total));
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}

/**
 * Checks one request against the limits. Returns a rebuilt request, or the 413/429 response to send. With
 * `tokenHash` (signed in), every tool call is also charged to the token's bucket.
 */
export async function gateMcp(
  req: Request,
  env: Pick<Env, 'DB'>,
  now: number,
  opts: { tokenHash?: string } = {},
): Promise<{ ok: true; req: Request } | { ok: false; res: Response }> {
  const body = await readCapped(req, MCP_LIMITS.bodyBytes);
  if (body === null) return { ok: false, res: rpcError(413, null, -32600, TOO_LARGE) };
  // Inspect a decoded copy; the course server gets the original bytes.
  const info = inspect(new TextDecoder().decode(body));
  const limited = { ok: false as const, res: rpcError(429, info.ids[0] ?? null, -32000, TOO_MANY) };
  const db: D1Like = env.DB;
  const { global, perToken } = MCP_LIMITS;
  // Every message in a batch is charged, and every tool call to the token's bucket.
  for (let i = 0; i < info.messages; i++) {
    if (!(await rateLimit(db, MCP_GLOBAL_KEY, now, global.limit, global.windowMs))) return limited;
  }
  if (opts.tokenHash !== undefined) {
    for (let i = 0; i < info.calls; i++) {
      if (!(await rateLimit(db, mcpTokenKey(opts.tokenHash), now, perToken.limit, perToken.windowMs))) return limited;
    }
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return { ok: true, req: new Request(req.url, { method: req.method, headers: req.headers, body: hasBody ? body : undefined }) };
}
