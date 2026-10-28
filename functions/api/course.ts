import type { Handler } from '../_lib/env';
import { json } from '../_lib/http';
import { guarded } from '../_lib/ai';
import { getContent } from '../_lib/content';
import { refreshContent } from '../_lib/course/cache';

export const GET: Handler = (req, { env }) =>
  guarded(async () => {
    const { etag } = await refreshContent(env);
    const headers = { ETag: etag, 'Cache-Control': 'max-age=60, stale-while-revalidate=86400' };
    const inm = req.headers.get('if-none-match');
    if (inm && inm.split(',').some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers });
    const res = json(getContent());
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  });
