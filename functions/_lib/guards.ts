import { HttpError } from './http';

export { HttpError };

export function clientKey(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return xff || 'anon';
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
