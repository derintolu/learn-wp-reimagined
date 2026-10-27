// Tests never reach a real course server. Calls to /api/events get an empty answer by default
// (the studio then keeps its local statements); a test that stubs fetch itself overrides this.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === '/api/events') return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
  return realFetch(input, init);
}) as typeof fetch;
