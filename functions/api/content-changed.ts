// The Learning Ledger's content-changed ping (R24: POST <course_server_url>/content-changed). Forces a refresh.
import type { Handler } from '../_lib/env';
import { error } from '../_lib/http';
import { guarded } from '../_lib/ai';
import { verifySigned, HEADER_SIGNATURE, HEADER_TIMESTAMP } from '../_lib/ledger/sign';
import { refreshContent } from '../_lib/course/cache';

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    if (!env.CONNECTOR_PING_PUBLIC_KEY) return error(503, 'not-configured', 'Pings are not configured.');
    const body = new Uint8Array(await req.arrayBuffer());
    const ok = await verifySigned({
      timestamp: req.headers.get(HEADER_TIMESTAMP) ?? '',
      body,
      signatureB64: req.headers.get(HEADER_SIGNATURE) ?? '',
      publicKeyB64: env.CONNECTOR_PING_PUBLIC_KEY,
      now: Math.floor(Date.now() / 1000),
    });
    if (!ok) return error(401, 'unauthorized', 'Not allowed.');
    await refreshContent(env, Date.now(), { force: true });
    return new Response(null, { status: 202 });
  });
