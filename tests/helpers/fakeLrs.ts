import { LRS_API, LRS_XAPI } from '../../functions/_lib/config';

/**
 * An in-memory stand-in for Learning Ledger's LRS, installed as the global fetch. `down` answers every call 503;
 * `hang` never answers (the call ends only when the client's timeout aborts it); `rejectIds` answers 400 to a
 * POST holding one of those statement ids and to a PUT of one.
 */
export function fakeLrs() {
  const lrs = {
    down: false,
    hang: false,
    rejectIds: new Set<string>(),
    statements: [] as any[],
    state: new Map<string, unknown>(),
    /** Bumped on every State write; the ETag is `"v<n>"`. */
    versions: new Map<string, number>(),
    imports: [] as string[],
    calls: [] as { method: string; url: string }[],
    posts: [] as any[][],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? 'GET';
      lrs.calls.push({ method, url });
      if (lrs.down) return new Response(null, { status: 503 });
      if (lrs.hang) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      const u = new URL(url);
      if (url.startsWith(`${LRS_XAPI}/activities/state`)) {
        const p = u.searchParams;
        const key = [p.get('activityId'), p.get('agent'), p.get('registration') ?? '', p.get('stateId')].join('|');
        if (method === 'GET') {
          return lrs.state.has(key)
            ? new Response(JSON.stringify(lrs.state.get(key)), { status: 200, headers: { ETag: `"v${lrs.versions.get(key) ?? 1}"` } })
            : new Response(null, { status: 404 });
        }
        const h = new Headers(init?.headers);
        if (h.get('If-None-Match') === '*' && lrs.state.has(key)) return new Response(null, { status: 412 });
        const ifMatch = h.get('If-Match');
        if (ifMatch !== null && ifMatch !== `"v${lrs.versions.get(key) ?? 1}"`) return new Response(null, { status: 412 });
        lrs.state.set(key, JSON.parse(String(init?.body)));
        lrs.versions.set(key, (lrs.versions.get(key) ?? 0) + 1);
        return new Response(null, { status: 204 });
      }
      if (url === `${LRS_XAPI}/statements` && method === 'POST') {
        const batch = JSON.parse(String(init?.body)) as any[];
        lrs.posts.push(batch);
        if (batch.some((s) => lrs.rejectIds.has(s.id))) return new Response(null, { status: 400 });
        lrs.statements.push(...batch);
        return new Response(JSON.stringify(batch.map((s) => s.id)), { status: 200 });
      }
      if (url.startsWith(`${LRS_XAPI}/statements?statementId=`) && method === 'PUT') {
        const s = JSON.parse(String(init?.body));
        if (lrs.rejectIds.has(s.id)) return new Response(null, { status: 400 });
        lrs.statements.push(s);
        return new Response(null, { status: 204 });
      }
      if (url === `${LRS_API}/courses` && method === 'PUT') {
        const bytes = new Uint8Array(init?.body as Uint8Array);
        const etag = `"${bytes.join('-')}"`;
        lrs.imports.push(etag);
        return new Response(JSON.stringify({ etag }), { status: 201 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch,
  };
  return lrs;
}
