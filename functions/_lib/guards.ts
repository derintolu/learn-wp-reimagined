import { HttpError } from './http';
import type { Env } from './env';

export { HttpError };

const CLIENT_ID = /^[A-Za-z0-9-]{16,64}$/;

/**
 * Rate-limit key, strongest identity first:
 *  1. the header named by env.TRUSTED_IP_HEADER (default cf-connecting-ip);
 *  2. the RIGHTMOST x-forwarded-for entry (appended by the nearest proxy; the leftmost is
 *     client-controlled);
 *  3. `c:<id>` from the `x-client-id` header, a random id the browser makes once (R26);
 *  4. 'anon', a shared bucket with a lower limit (ANON_LIMIT).
 * IP keys are `ip:<value>`, so no header value can collide with `anon`, a `c:` id or GLOBAL_KEY.
 *
 * Spacefast passes no visitor IP to functions (Task 15), so there it is the client id.
 * Accepted limitation: the id is client-supplied, so a script can rotate it to get a fresh
 * bucket. The global ceiling (GLOBAL_LIMIT) and the $10/day spending cap are the backstop.
 */
export function clientKey(req: Request, env?: Pick<Env, 'TRUSTED_IP_HEADER'>): string {
  const trusted = req.headers.get(env?.TRUSTED_IP_HEADER || 'cf-connecting-ip')?.trim();
  if (trusted) return `ip:${trusted}`;
  const parts = req.headers.get('x-forwarded-for')?.split(',') ?? [];
  const last = parts[parts.length - 1]?.trim();
  if (last) return `ip:${last}`;
  const id = req.headers.get('x-client-id')?.trim() ?? '';
  return CLIENT_ID.test(id) ? `c:${id}` : 'anon';
}

/** Per-key AI requests per RATE_WINDOW_MS; requests with no identity share the smaller anon bucket. */
export const CLIENT_LIMIT = 30;
export const ANON_LIMIT = 10;
/** Ceiling across every visitor, checked after the per-client limit. */
export const GLOBAL_LIMIT = 600;
/** The global bucket's key; namespaced so no client key can equal it. */
export const GLOBAL_KEY = 'g:global';
export const RATE_WINDOW_MS = 600_000;

/** Reads a JSON body, enforcing the byte cap while streaming (content-length can lie). */
export async function readJsonCapped<T>(req: Request, maxBytes: number): Promise<T> {
  const text = await readTextCapped(req, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'bad-json', 'The request body was not valid JSON.');
  }
}

/** Reads a UTF-8 body, enforcing the byte cap while streaming (content-length can lie). */
export async function readTextCapped(req: Request, maxBytes: number): Promise<string> {
  const tooBig = () => new HttpError(413, 'too-large', 'That input is too long. Please shorten it and try again.');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooBig();
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}
