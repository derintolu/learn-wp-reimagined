import { HttpError } from './http';
import type { Env } from './env';

export { HttpError };

/**
 * Rate-limit key. Uses the header named by env.TRUSTED_IP_HEADER (default cf-connecting-ip);
 * else the RIGHTMOST x-forwarded-for entry (appended by the nearest proxy; the leftmost is
 * client-controlled); else 'anon'.
 */
export function clientKey(req: Request, env?: Pick<Env, 'TRUSTED_IP_HEADER'>): string {
  const trusted = req.headers.get(env?.TRUSTED_IP_HEADER || 'cf-connecting-ip')?.trim();
  if (trusted) return trusted;
  const parts = req.headers.get('x-forwarded-for')?.split(',') ?? [];
  const last = parts[parts.length - 1]?.trim();
  return last || 'anon';
}

/** Reads a JSON body, enforcing the byte cap while streaming (content-length can lie). */
export async function readJsonCapped<T>(req: Request, maxBytes: number): Promise<T> {
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
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    throw new HttpError(400, 'bad-json', 'The request body was not valid JSON.');
  }
}
