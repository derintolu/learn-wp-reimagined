import { LEDGER_BASE, LRS_API, LRS_XAPI } from '../../functions/_lib/config';
import { XAPI_BASE } from '../../src/shared/xapi';

const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

/**
 * What an env needs for the Learning Ledger connector on this site (the learner, enrolment and delete calls that
 * fakeLrs answers): every session has a Sensei learner, so a test that records or deletes reaches them.
 */
export const LEDGER_ENV = {
  CONNECTOR_SIGNING_KEY: Buffer.from('302e020100300506032b657004220420' + SEED_HEX, 'hex').toString('base64'),
  CONNECTOR_KEY_ID: 'kid1',
  SENSEI_COURSE_IDS: '{"block-theme":13,"learner":12,"vibe-coder":14}',
};

/**
 * An in-memory stand-in for Learning Ledger's LRS, installed as the global fetch. `down` answers every call 503;
 * `hang` never answers (the call ends only when the client's timeout aborts it); `delayMs` answers each call that
 * long after it is made (the live LRS takes about 500-700 ms); `rejectIds` answers 400 to a
 * POST holding one of those statement ids and to a PUT of one; `limited` answers every call 429 (rate limited).
 * As Learning Ledger does, a statement whose id is already stored is skipped when identical and answered 409 when
 * different (a POST then stores nothing). A statements GET returns the stored ones, by agent.
 * It also answers the site's Learning Ledger connector (with LEDGER_ENV): a new learner, an enrolment and a learner
 * delete, and 503 for the course package; those calls are in `ledgerCalls`, not `calls`.
 */
export function fakeLrs() {
  const lrs = {
    down: false,
    hang: false,
    delayMs: 0,
    limited: false,
    rejectIds: new Set<string>(),
    statements: [] as any[],
    state: new Map<string, unknown>(),
    /** Bumped on every State write; the ETag is `"v<n>"`. */
    versions: new Map<string, number>(),
    imports: [] as string[],
    calls: [] as { method: string; url: string }[],
    ledgerCalls: [] as { method: string; url: string }[],
    nextLearner: 1000,
    posts: [] as any[][],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? 'GET';
      if (url.startsWith(`${LEDGER_BASE}/`)) {
        lrs.ledgerCalls.push({ method, url });
        if (method === 'POST' && url === `${LEDGER_BASE}/course-server/learners`) {
          const id = lrs.nextLearner++;
          return new Response(JSON.stringify({ user_id: id, actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name: `ledger-${id}` } } }), { status: 201 });
        }
        // No course package here: the course cache keeps serving the baked bundle, as with the connector down.
        if (url.startsWith(`${LEDGER_BASE}/course-server/packages/`)) return new Response(null, { status: 503 });
        return new Response('{}', { status: 200 });
      }
      lrs.calls.push({ method, url });
      if (lrs.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, lrs.delayMs));
      if (lrs.down) return new Response(null, { status: 503 });
      if (lrs.limited) return new Response(null, { status: 429, headers: { 'Retry-After': '1' } });
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
      const stored = (s: any) => lrs.statements.find((x) => x.id === s.id);
      const differs = (s: any) => stored(s) !== undefined && JSON.stringify(stored(s)) !== JSON.stringify(s);
      if (url === `${LRS_XAPI}/statements` && method === 'POST') {
        const batch = JSON.parse(String(init?.body)) as any[];
        lrs.posts.push(batch);
        if (batch.some((s) => lrs.rejectIds.has(s.id))) return new Response(null, { status: 400 });
        if (batch.some(differs)) return new Response(null, { status: 409 });
        lrs.statements.push(...batch.filter((s) => !stored(s)));
        return new Response(JSON.stringify(batch.map((s) => s.id)), { status: 200 });
      }
      if (url.startsWith(`${LRS_XAPI}/statements?`) && method === 'GET') {
        const agent = u.searchParams.get('agent');
        const statements = lrs.statements.filter((s) => agent === null || JSON.stringify(s.actor) === agent);
        return new Response(JSON.stringify({ statements }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith(`${LRS_XAPI}/statements?statementId=`) && method === 'PUT') {
        const s = JSON.parse(String(init?.body));
        if (lrs.rejectIds.has(s.id)) return new Response(null, { status: 400 });
        if (differs(s)) return new Response(null, { status: 409 });
        if (!stored(s)) lrs.statements.push(s);
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
