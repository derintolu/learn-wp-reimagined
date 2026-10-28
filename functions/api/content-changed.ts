// The Learning Ledger's content-changed ping (R24: POST <course_server_url>/content-changed). Forces a refresh.
import type { Handler } from '../_lib/env';
import { error } from '../_lib/http';
import { guarded } from '../_lib/ai';
import { verifyRequest } from '../_lib/ledger/sign';
import { ensureCourseCacheSchema, isDuplicateKey } from '../_lib/db';
import { refreshContent } from '../_lib/course/cache';

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    if (!env.CONNECTOR_PING_PUBLIC_KEY) return error(503, 'not-configured', 'Pings are not configured.');
    const body = new Uint8Array(await req.arrayBuffer());
    const url = new URL(req.url);
    const now = Date.now();
    const v = await verifyRequest({
      method: 'POST',
      path: url.pathname + url.search,
      body,
      headers: req.headers,
      publicKeyB64: env.CONNECTOR_PING_PUBLIC_KEY,
      now: Math.floor(now / 1000),
    });
    if (!v.ok) return error(401, 'unauthorized', 'Not allowed.');
    // A nonce is accepted once; rows older than the window are dropped.
    await ensureCourseCacheSchema(env.DB);
    await env.DB.prepare('DELETE FROM ping_nonces WHERE seen < ?').bind(now - 600_000).run();
    try {
      await env.DB.prepare('INSERT INTO ping_nonces (nonce, seen) VALUES (?, ?)').bind(v.nonce, now).run();
    } catch (e) {
      if (isDuplicateKey(e)) return error(401, 'unauthorized', 'Not allowed.');
      throw e;
    }
    await refreshContent(env, Date.now(), { force: true });
    return new Response(null, { status: 202 });
  });
