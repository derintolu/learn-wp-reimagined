// Shared plumbing for /api/agent/*: the site's own calls to the relay. No AI, no outbound fetch.
// Handles are bearer secrets: they are never logged, and errors never echo them.
import { isHandle } from '../../../vendor/learning-mcp/core/index.ts';
import type { Env } from '../env';
import { SERVER_FLAGS } from '../config';
import { error } from '../http';
import { HttpError, readJsonCapped } from '../guards';
import { ensureSchema } from '../db';
import { rateLimit } from '../ratelimit';
import { MCP_GLOBAL_KEY, MCP_LIMITS, mcpHandleKey } from './gate';
import { isAnyHandle } from './handles';
import { ensureMcpSchema } from './recordStore';
import { loadCurrentCourse } from '../course/cache';

export const BAD_HANDLE = "That doesn't look like a record handle. It starts with cxp_ or lr_.";
export const NO_RECORD = 'No record for that handle. It may have expired after 30 days without use, or been deleted.';
export const LIMITED = 'Too many requests right now. Wait a few minutes and try again.';

/** Runs a route body; maps HttpError to its response and anything else to a generic 500 (logged without detail). */
export async function agentRoute(env: Env, fn: () => Promise<Response>): Promise<Response> {
  try {
    await ensureSchema(env.DB);
    await ensureMcpSchema(env.DB);
    await loadCurrentCourse(env);
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return error(e.status, e.code, e.message);
    console.error('agent route failed');
    return error(500, 'internal', 'Something went wrong. Try again in a moment.');
  }
}

/** Throws 429 unless `key` is under its limit. */
export async function limit(env: Env, key: string, l: { limit: number; windowMs: number }, now: number): Promise<void> {
  if (!(await rateLimit(env.DB, key, now, l.limit, l.windowMs))) throw new HttpError(429, 'rate-limited', LIMITED);
}

/** Reads `{ handle }`, checks its shape and applies the global and per-handle limits. On the standard either format. */
export async function readHandle(req: Request, env: Env, now: number): Promise<string> {
  const body = await readJsonCapped<{ handle?: unknown }>(req, 1024);
  const handle = typeof body?.handle === 'string' ? body.handle.trim() : body?.handle;
  const valid = SERVER_FLAGS.mcpOnStandard ? isAnyHandle : isHandle;
  if (!valid(handle)) throw new HttpError(400, 'bad-handle', BAD_HANDLE);
  await limit(env, MCP_GLOBAL_KEY, MCP_LIMITS.global, now);
  await limit(env, await mcpHandleKey(handle), MCP_LIMITS.perHandle, now);
  return handle;
}
