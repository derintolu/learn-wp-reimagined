// Tests never reach a real course server. Calls to /api/events get an empty answer by default
// (the studio then keeps its local statements), /api/session answers as a server with no
// session key would, and any other /api/ route (the official record, State, badges, Sensei) answers 404;
// a test that stubs fetch itself overrides this.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === '/api/events') return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
  if (url === '/api/session') {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return Promise.resolve(new Response(JSON.stringify({ actor: null }), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ error: { code: 'disabled' } }), { status: 503 }));
  }
  if (url.startsWith('/api/')) return Promise.resolve(new Response(JSON.stringify({ error: { code: 'not-found' } }), { status: 404 }));
  return realFetch(input, init);
}) as typeof fetch;
